"""
FastAPI application for MCDE.
Main API service for document processing and cost estimation.
"""
import time
from datetime import datetime
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn

from src.config import settings
from src.logger import get_logger, log_api_request, log_audit_event
from src.data.document_ingestion import document_service
from src.data.ocr_extraction import ocr_service
from src.data.persistence import persist_invoice, persist_parsed_items, persist_claim_metadata, load_claim_metadata
from src.integrations.refund_engine_client import refund_engine_client

logger = get_logger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="MCDE - Manufacturing Cost Document Engine",
    description="World-class microservice for Amazon FBA manufacturing cost document generation and validation",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.security.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]  # Configure based on deployment
)

# Pydantic models
class DocumentUploadResponse(BaseModel):
    """Response model for document upload."""
    document_id: str
    filename: str
    document_type: str
    status: str
    uploaded_at: str
    metadata: Dict[str, Any]

class CostEstimateRequest(BaseModel):
    """Request model for cost estimation."""
    claim_id: str = Field(..., description="Refund claim identifier")
    document_id: str = Field(..., description="Document identifier")
    processing_options: Optional[Dict[str, Any]] = Field(None, description="Processing options")

class CostEstimateResponse(BaseModel):
    """Response model for cost estimation."""
    claim_id: str
    document_id: str
    estimated_cost: float
    confidence: float
    cost_components: Dict[str, float]
    validation_status: str
    generated_at: str

class DocumentGenerationRequest(BaseModel):
    """Request model for document generation."""
    claim_id: str = Field(..., description="Refund claim identifier")
    cost_estimate: Dict[str, Any] = Field(..., description="Cost estimation data")
    document_type: str = Field("cost_document", description="Type of document to generate")

class DocumentGenerationResponse(BaseModel):
    """Response model for document generation."""
    claim_id: str
    document_url: str
    document_type: str
    generated_at: str
    status: str

class ComplianceValidationRequest(BaseModel):
    """Request model for compliance validation."""
    claim_id: str = Field(..., description="Refund claim identifier")
    document_id: str = Field(..., description="Document identifier")
    cost_data: Dict[str, Any] = Field(..., description="Cost data for validation")

class ComplianceValidationResponse(BaseModel):
    """Response model for compliance validation."""
    claim_id: str
    is_compliant: bool
    validation_errors: List[str]
    compliance_score: float
    validated_at: str

class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    service: str
    version: str
    timestamp: str
    dependencies: Dict[str, str]

class PublicConfigResponse(BaseModel):
    feature_x_enabled: bool
    model_version: str

# Middleware for request logging
@app.middleware("http")
async def log_requests(request, call_next):
    """Log all API requests."""
    start_time = time.time()
    
    response = await call_next(request)
    
    duration = time.time() - start_time
    
    log_api_request(
        endpoint=str(request.url.path),
        method=request.method,
        duration=duration,
        status_code=response.status_code
    )
    
    return response

# Health check endpoint
@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    # Check Refund Engine health
    refund_engine_health = await refund_engine_client.health_check()
    
    dependencies = {
        "refund_engine": refund_engine_health.get("status", "unknown")
    }
    
    return HealthResponse(
        status="healthy",
        service="mcde",
        version="1.0.0",
        timestamp=datetime.utcnow().isoformat(),
        dependencies=dependencies
    )

# Public, non-sensitive config for frontend
@app.get("/api/config/public", response_model=PublicConfigResponse)
async def get_public_config():
    return PublicConfigResponse(
        feature_x_enabled=True,
        model_version="v1.2.0"
    )

# Document upload endpoint
@app.post("/upload-document", response_model=DocumentUploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    document_type: str = Form("invoice"),
    user_id: str = Form(...)
):
    """
    Upload manufacturing document for processing.
    
    Args:
        file: Document file to upload
        document_type: Type of document (invoice, receipt, etc.)
        user_id: User uploading the document
        
    Returns:
        Document upload response with metadata
    """
    try:
        result = await document_service.upload_document(
            file=file,
            user_id=user_id,
            document_type=document_type
        )
        # Persist invoice metadata
        persist_invoice(result["document_id"], result)
        
        return DocumentUploadResponse(**result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Document upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Cost estimation endpoint
@app.post("/cost-estimate", response_model=CostEstimateResponse)
async def estimate_cost(request: CostEstimateRequest):
    """
    Estimate manufacturing cost from uploaded document.
    
    Args:
        request: Cost estimation request
        
    Returns:
        Cost estimation response with detailed breakdown
    """
    try:
        # Get document path from ingestion
        document_path = f"data/raw/{request.document_id}.pdf"
        
        # Process document for OCR
        processing_result = await document_service.process_document(
            document_id=request.document_id,
            file_path=document_path,
            processing_options=request.processing_options
        )
        
        if processing_result["processing_status"] != "completed":
            raise HTTPException(status_code=400, detail="Document processing failed")
        
        # Extract OCR text and derive structured fields and cost components
        # For first page only currently
        from src.data.ocr_extraction import OCRResult
        ocr_result = OCRResult(text="", confidence=0.0, bounding_boxes=[], words=[], page_number=1)
        if processing_result.get("pages"):
            # Placeholder: you would run extract_text_from_image here with actual page image
            pass
        structured = await ocr_service.extract_structured_data(ocr_result)
        cost_components = await ocr_service.extract_cost_components(ocr_result)
        estimated_cost = sum(cost_components.values())
        confidence = min(0.95, 0.6 + (ocr_result.confidence / 100) * 0.35)
        
        # Persist parsed items
        persist_parsed_items(request.document_id, {
            "structured": structured,
            "cost_components": cost_components,
            "estimated_cost": estimated_cost,
            "confidence": confidence,
            "processing_result": processing_result,
        })
        
        # Validate with Refund Engine
        validation_result = await refund_engine_client.get_cost_estimate_for_claim(
            claim_id=request.claim_id,
            cost_data={
                "estimated_cost": estimated_cost,
                "cost_components": cost_components,
                "confidence": confidence
            }
        )
        
        return CostEstimateResponse(
            claim_id=request.claim_id,
            document_id=request.document_id,
            estimated_cost=estimated_cost,
            confidence=confidence,
            cost_components=cost_components,
            validation_status="validated" if "error" not in validation_result else "failed",
            generated_at=datetime.utcnow().isoformat()
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cost estimation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Document generation endpoint
@app.post("/generate-document", response_model=DocumentGenerationResponse)
async def generate_document(request: DocumentGenerationRequest):
    """
    Generate Amazon-compliant cost document.
    
    Args:
        request: Document generation request
        
    Returns:
        Document generation response with URL
    """
    try:
        # Generate a pseudo signed URL (in production, generate S3/Supabase signed URL)
        document_url = f"https://mcde-documents.local/{request.claim_id}/cost_document.pdf?sig={int(time.time())}"
        # Persist claim metadata with document link
        persist_claim_metadata(request.claim_id, {
            "document_url": document_url,
            "document_type": request.document_type,
            "generated_at": datetime.utcnow().isoformat(),
        })
        
        return DocumentGenerationResponse(
            claim_id=request.claim_id,
            document_url=document_url,
            document_type=request.document_type,
            generated_at=datetime.utcnow().isoformat(),
            status="generated"
        )
        
    except Exception as e:
        logger.error(f"Document generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Compliance validation endpoint
@app.post("/validate-compliance", response_model=ComplianceValidationResponse)
async def validate_compliance(request: ComplianceValidationRequest):
    """
    Validate document compliance with Amazon requirements.
    
    Args:
        request: Compliance validation request
        
    Returns:
        Compliance validation response
    """
    try:
        # TODO: Implement actual compliance validation
        # For now, return placeholder response
        
        is_compliant = True
        validation_errors = []
        compliance_score = 0.95
        
        return ComplianceValidationResponse(
            claim_id=request.claim_id,
            is_compliant=is_compliant,
            validation_errors=validation_errors,
            compliance_score=compliance_score,
            validated_at=datetime.utcnow().isoformat()
        )
        
    except Exception as e:
        logger.error(f"Compliance validation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Refund Engine callback endpoint
@app.post("/refund-engine-callback")
async def refund_engine_callback(request: Dict[str, Any]):
    """
    Handle callbacks from Refund Engine.
    
    Args:
        request: Callback request from Refund Engine
        
    Returns:
        Callback response
    """
    try:
        # Log the callback
        logger.info(f"Received callback from Refund Engine: {request}")
        
        # TODO: Implement callback processing logic
        
        return {"status": "received", "processed_at": datetime.utcnow().isoformat()}
        
    except Exception as e:
        logger.error(f"Callback processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail, "timestamp": datetime.utcnow().isoformat()}
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions."""
    logger.error(f"Unhandled exception: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "timestamp": datetime.utcnow().isoformat()}
    )

# Startup event
@app.on_event("startup")
async def startup_event():
    """Initialize application on startup."""
    logger.info("MCDE service starting up...")
    
    # Check Refund Engine connectivity
    health_check = await refund_engine_client.health_check()
    if health_check["status"] == "healthy":
        logger.info("Refund Engine connection established")
    else:
        logger.warning(f"Refund Engine connection failed: {health_check}")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("MCDE service shutting down...")

if __name__ == "__main__":
    uvicorn.run(
        "src.api.main:app",
        host=settings.api.host,
        port=settings.api.port,
        reload=settings.debug
    ) 