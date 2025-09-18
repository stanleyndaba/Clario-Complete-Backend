"""
API controllers for Evidence & Value Engine
"""
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse
from datetime import datetime
from decimal import Decimal
import json

from .services import (
    StorageService, OCRService, InvoiceParserService, SKUMappingService,
    LandedCostService, ValueComparisonService
)
from .database import Invoice, InvoiceItem, LandedCost, ValueComparison
from .validators import validate_invoice_upload, validate_value_comparison_request

logger = logging.getLogger(__name__)

# Initialize services
storage_service = StorageService()
ocr_service = OCRService()
parser_service = InvoiceParserService()
mapping_service = SKUMappingService()
landed_cost_service = LandedCostService()
value_comparison_service = ValueComparisonService()

# Create router
evidence_router = APIRouter(prefix="/evidence", tags=["Evidence & Value Engine"])

@evidence_router.post("/invoices/upload")
async def upload_invoice(
    file: UploadFile = File(...),
    invoice_date: Optional[str] = Form(None),
    currency: Optional[str] = Form("USD"),
    seller_id: str = Form(...)
):
    """
    Upload invoice file for processing
    
    Args:
        file: Invoice file (PDF, PNG, JPG)
        invoice_date: Optional invoice date (YYYY-MM-DD)
        currency: Currency code (default: USD)
        seller_id: Seller identifier
        
    Returns:
        Upload result with invoice ID and status
    """
    try:
        # Validate request
        validation_result = validate_invoice_upload(file, seller_id)
        if not validation_result['is_valid']:
            raise HTTPException(status_code=400, detail=validation_result['errors'])
        
        # Read file content
        file_content = await file.read()
        
        # Validate file
        file_validation = storage_service.validate_file(file_content, file.content_type)
        if not file_validation['is_valid']:
            raise HTTPException(status_code=400, detail=file_validation['errors'])
        
        # Upload to storage
        upload_metadata = {
            'seller_id': seller_id,
            'filename': file.filename,
            'mime_type': file.content_type
        }
        
        upload_result = storage_service.upload(file_content, upload_metadata)
        
        # Create invoice record in database
        # TODO: Implement database insertion
        invoice_id = "mock_invoice_123"  # Placeholder
        
        # Enqueue OCR job
        # TODO: Implement job queue
        ocr_status = "queued"
        
        logger.info(f"Invoice uploaded successfully: {invoice_id}")
        
        return {
            "invoice_id": invoice_id,
            "status": ocr_status,
            "filename": file.filename,
            "storage_url": upload_result['storage_url'],
            "bytes": upload_result['bytes'],
            "uploaded_at": upload_result['uploaded_at']
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Invoice upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@evidence_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, seller_id: str = Query(...)):
    """
    Get invoice metadata and items
    
    Args:
        invoice_id: Invoice identifier
        seller_id: Seller identifier (for authorization)
        
    Returns:
        Invoice data with items and landed costs
    """
    try:
        # TODO: Implement database lookup with seller authorization
        # For now, return mock data
        
        mock_invoice = {
            "id": invoice_id,
            "seller_id": seller_id,
            "filename": "sample_invoice.pdf",
            "storage_url": "https://storage.example.com/invoice.pdf",
            "mime_type": "application/pdf",
            "bytes": 1024000,
            "uploaded_at": datetime.now().isoformat(),
            "ocr_status": "done",
            "ocr_confidence": 0.85,
            "items": [
                {
                    "id": "item_1",
                    "raw_sku": "SKU-001",
                    "mapped_sku": "SKU-001",
                    "asin": "B07XYZ123",
                    "description": "Sample Product 1",
                    "unit_cost": 25.50,
                    "quantity": 10,
                    "total_cost": 255.00
                }
            ],
            "landed_costs": [
                {
                    "id": "landed_1",
                    "sku": "SKU-001",
                    "landed_per_unit": 28.75,
                    "unit_cost": 25.50,
                    "freight_alloc": 2.50,
                    "duties_alloc": 1.00,
                    "prep_alloc": 1.00,
                    "other_alloc": 0.00
                }
            ]
        }
        
        return mock_invoice
        
    except Exception as e:
        logger.error(f"Failed to get invoice {invoice_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get invoice: {str(e)}")

@evidence_router.get("/invoices/{invoice_id}/preview-url")
async def get_invoice_preview_url(invoice_id: str, seller_id: str = Query(...)):
    """
    Get signed URL for invoice preview
    
    Args:
        invoice_id: Invoice identifier
        seller_id: Seller identifier (for authorization)
        
    Returns:
        Signed URL for temporary access
    """
    try:
        # TODO: Implement database lookup and seller authorization
        # For now, return mock signed URL
        
        mock_storage_url = "https://storage.example.com/invoice.pdf"
        signed_url = storage_service.get_signed_url(mock_storage_url, expires_in=300)
        
        return {
            "invoice_id": invoice_id,
            "preview_url": signed_url,
            "expires_in": 300,
            "expires_at": (datetime.now().timestamp() + 300).isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get preview URL for invoice {invoice_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get preview URL: {str(e)}")

@evidence_router.get("/value/compare")
async def compare_values(
    sku: str = Query(...),
    seller_id: str = Query(...)
):
    """
    Compare Amazon default vs Opside True Value for a SKU
    
    Args:
        sku: SKU to compare
        seller_id: Seller identifier
        
    Returns:
        Value comparison result
    """
    try:
        # Validate request
        validation_result = value_comparison_service.validate_comparison_request(seller_id, sku)
        if not validation_result[0]:
            raise HTTPException(status_code=400, detail=validation_result[1])
        
        # Perform comparison
        comparison_result = value_comparison_service.compare_values(seller_id, sku)
        
        return comparison_result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Value comparison failed for {sku}: {e}")
        raise HTTPException(status_code=500, detail=f"Comparison failed: {str(e)}")

@evidence_router.post("/value/compare/batch")
async def batch_compare_values(
    request: Dict[str, Any]
):
    """
    Batch compare values for multiple SKUs
    
    Args:
        request: Dict with seller_id and skus list
        
    Returns:
        List of comparison results
    """
    try:
        seller_id = request.get('seller_id')
        skus = request.get('skus', [])
        
        if not seller_id:
            raise HTTPException(status_code=400, detail="seller_id is required")
        
        if not skus or not isinstance(skus, list):
            raise HTTPException(status_code=400, detail="skus must be a non-empty list")
        
        if len(skus) > 200:
            raise HTTPException(status_code=400, detail="Maximum 200 SKUs allowed per batch")
        
        # Perform batch comparison
        comparison_results = value_comparison_service.batch_compare_values(seller_id, skus)
        
        return {
            "seller_id": seller_id,
            "total_skus": len(skus),
            "results": comparison_results,
            "processed_at": datetime.now().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Batch value comparison failed: {e}")
        raise HTTPException(status_code=500, detail=f"Batch comparison failed: {str(e)}")

@evidence_router.get("/value/statistics")
async def get_value_statistics(
    seller_id: str = Query(...),
    days: int = Query(30, ge=1, le=365)
):
    """
    Get value comparison statistics for a seller
    
    Args:
        seller_id: Seller identifier
        days: Number of days to look back
        
    Returns:
        Comparison statistics
    """
    try:
        statistics = value_comparison_service.get_comparison_statistics(seller_id, days)
        
        return statistics
        
    except Exception as e:
        logger.error(f"Failed to get statistics for seller {seller_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get statistics: {str(e)}")

@evidence_router.get("/value/opportunities")
async def get_top_opportunities(
    seller_id: str = Query(...),
    limit: int = Query(10, ge=1, le=100)
):
    """
    Get top gain opportunities for a seller
    
    Args:
        seller_id: Seller identifier
        limit: Maximum number of opportunities to return
        
    Returns:
        List of top gain opportunities
    """
    try:
        opportunities = value_comparison_service.get_top_gain_opportunities(seller_id, limit)
        
        return {
            "seller_id": seller_id,
            "opportunities": opportunities,
            "total_count": len(opportunities)
        }
        
    except Exception as e:
        logger.error(f"Failed to get opportunities for seller {seller_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get opportunities: {str(e)}")

@evidence_router.post("/claims/calculate")
async def calculate_claim(payload: Dict[str, Any]):
    """
    Calculate a claim from discrepancy data and return value evidence.

    Expected payload (from Smart Inventory Sync):
    {
      "discrepancy_data": { ... },
      "inventory_context": { ... },
      "historical_data": { ... }
    }
    """
    try:
        discrepancy = payload.get('discrepancy_data', {})
        inventory_ctx = payload.get('inventory_context', {})
        historical = payload.get('historical_data', {})

        user_id = discrepancy.get('userId') or payload.get('user_id') or 'unknown'
        sku = discrepancy.get('sku')
        confidence = float(discrepancy.get('confidence', 0.0))

        if not sku:
            raise HTTPException(status_code=400, detail="sku is required in discrepancy_data")

        # Compute value comparison for proof and true value vs Amazon default
        comparison = value_comparison_service.compare_values(user_id, sku)

        amazon_default_value = comparison.get('amazon_default') or 0
        opside_true_value = comparison.get('opside_true_value') or 0
        net_gain = comparison.get('net_gain') or 0

        # Heuristic claim amount: net_gain times quantity if quantity present, else net_gain
        quantity = 1
        if 'targetValue' in discrepancy and isinstance(discrepancy['targetValue'], (int, float)):
            quantity = int(discrepancy['targetValue']) or 1
        elif 'currentQuantity' in inventory_ctx:
            try:
                quantity = int(inventory_ctx['currentQuantity']) or 1
            except Exception:
                quantity = 1

        claim_amount = float(Decimal(str(net_gain)) * Decimal(str(max(quantity, 1))))

        result = {
            "claim_id": f"calc-{sku}-{int(datetime.utcnow().timestamp())}",
            "sku": sku,
            "currency": "USD",
            "confidence": confidence,
            "claim_amount": round(claim_amount, 2),
            "amazon_default_value": float(amazon_default_value or 0),
            "opside_true_value": float(opside_true_value or 0),
            "net_gain": float(net_gain or 0),
            "proof": comparison.get('proof', {}),
            "calculated_at": datetime.utcnow().isoformat(),
            "metadata": {
                "discrepancy": discrepancy,
                "inventory_context": inventory_ctx,
                "historical": historical,
            },
        }

        return JSONResponse(content=result)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Claim calculation failed for payload: {e}")
        raise HTTPException(status_code=500, detail=f"Claim calculation failed: {str(e)}")

@evidence_router.post("/landed-cost/calculate")
async def calculate_landed_costs(
    request: Dict[str, Any]
):
    """
    Calculate landed costs for invoice items
    
    Args:
        request: Dict with invoice data and optional seller policy
        
    Returns:
        Landed cost calculations
    """
    try:
        invoice_data = request.get('invoice_data')
        seller_policy = request.get('seller_policy')
        
        if not invoice_data:
            raise HTTPException(status_code=400, detail="invoice_data is required")
        
        # Validate invoice data
        is_valid, issues = landed_cost_service.validate_invoice_for_landed_cost(invoice_data)
        if not is_valid:
            raise HTTPException(status_code=400, detail=issues)
        
        # Calculate landed costs
        landed_costs = landed_cost_service.calculate_landed_costs(invoice_data, seller_policy)
        
        # Get summary
        summary = landed_cost_service.get_landed_cost_summary(landed_costs)
        
        return {
            "landed_costs": landed_costs,
            "summary": summary,
            "calculated_at": datetime.now().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Landed cost calculation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Calculation failed: {str(e)}")

@evidence_router.get("/landed-cost/{sku}")
async def get_landed_cost(
    sku: str,
    seller_id: str = Query(...)
):
    """
    Get latest landed cost for a SKU
    
    Args:
        sku: SKU to get landed cost for
        seller_id: Seller identifier
        
    Returns:
        Latest landed cost data
    """
    try:
        # TODO: Implement database lookup
        # For now, return mock data
        
        mock_landed_cost = {
            "sku": sku,
            "seller_id": seller_id,
            "landed_per_unit": 28.75,
            "unit_cost": 25.50,
            "freight_alloc": 2.50,
            "duties_alloc": 1.00,
            "prep_alloc": 1.00,
            "other_alloc": 0.00,
            "calculated_at": datetime.now().isoformat(),
            "invoice_id": "mock_invoice_123"
        }
        
        return mock_landed_cost
        
    except Exception as e:
        logger.error(f"Failed to get landed cost for {sku}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get landed cost: {str(e)}")

@evidence_router.post("/mapping/batch")
async def batch_map_skus(
    request: Dict[str, Any]
):
    """
    Batch map invoice SKUs to catalog SKUs/ASINs
    
    Args:
        request: Dict with skus list and catalog data
        
    Returns:
        Mapping results
    """
    try:
        skus = request.get('skus', [])
        catalog_data = request.get('catalog_data', {})
        
        if not skus or not isinstance(skus, list):
            raise HTTPException(status_code=400, detail="skus must be a non-empty list")
        
        if not catalog_data:
            raise HTTPException(status_code=400, detail="catalog_data is required")
        
        # Perform batch mapping
        mapping_results = mapping_service.batch_map_skus(skus, catalog_data)
        
        # Get mapping statistics
        stats = mapping_service.get_mapping_statistics(list(mapping_results.values()))
        
        return {
            "mapping_results": mapping_results,
            "statistics": stats,
            "mapped_at": datetime.now().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Batch SKU mapping failed: {e}")
        raise HTTPException(status_code=500, detail=f"Mapping failed: {str(e)}")

@evidence_router.delete("/cache/clear")
async def clear_cache(seller_id: Optional[str] = Query(None)):
    """
    Clear comparison cache
    
    Args:
        seller_id: Optional seller ID to clear only their cache
        
    Returns:
        Cache clearing result
    """
    try:
        value_comparison_service.clear_cache(seller_id)
        
        return {
            "message": "Cache cleared successfully",
            "seller_id": seller_id,
            "cleared_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Cache clearing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cache clearing failed: {str(e)}")
