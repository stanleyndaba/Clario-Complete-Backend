"""
Evidence Engine - Core evidence processing service
Handles evidence matching, validation, and zero-effort evidence flow
"""

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, List, Optional
import logging
import asyncio
from datetime import datetime

from .matching_engine import EvidenceMatchingEngine
from .auto_submit_service import AutoSubmitService
from .enhanced_smart_prompts_service import EnhancedSmartPromptsService
from .proof_packet_worker import ProofPacketWorker
from .matching_worker import EvidenceMatchingWorker

logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Evidence Engine",
    description="Core evidence processing service for Opside",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
matching_engine = EvidenceMatchingEngine()
auto_submit_service = AutoSubmitService()
smart_prompts_service = EnhancedSmartPromptsService()
proof_packet_worker = ProofPacketWorker()
matching_worker = EvidenceMatchingWorker()

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info("Starting Evidence Engine...")
    
    # Start background services
    await smart_prompts_service.start()
    await proof_packet_worker.start()
    await matching_worker.start()
    
    logger.info("Evidence Engine started successfully")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down Evidence Engine...")
    
    await smart_prompts_service.stop()
    await proof_packet_worker.stop()
    await matching_worker.stop()
    
    logger.info("Evidence Engine shutdown complete")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Evidence Engine",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/v1/evidence/match")
async def match_evidence(
    dispute_id: str,
    evidence_documents: List[Dict[str, Any]]
):
    """Match evidence documents to dispute cases"""
    try:
        result = await matching_engine.match_evidence(
            dispute_id=dispute_id,
            evidence_documents=evidence_documents
        )
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"Evidence matching failed: {e}")
        raise HTTPException(status_code=500, detail="Evidence matching failed")

@app.post("/api/v1/evidence/auto-submit")
async def auto_submit_evidence(
    match_id: str,
    user_id: str
):
    """Auto-submit high-confidence evidence matches"""
    try:
        result = await auto_submit_service.auto_submit_evidence(
            match_id=match_id,
            user_id=user_id
        )
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"Auto-submit failed: {e}")
        raise HTTPException(status_code=500, detail="Auto-submit failed")

@app.post("/api/v1/evidence/smart-prompts")
async def create_smart_prompt(
    dispute_id: str,
    question: str,
    options: List[Dict[str, Any]],
    user_id: str
):
    """Create a smart prompt for ambiguous evidence"""
    try:
        prompt = await smart_prompts_service.create_smart_prompt(
            user_id=user_id,
            dispute_id=dispute_id,
            evidence_document_id="placeholder",
            question=question,
            options=options,
            expires_in_hours=24
        )
        return {"success": True, "data": prompt}
    except Exception as e:
        logger.error(f"Smart prompt creation failed: {e}")
        raise HTTPException(status_code=500, detail="Smart prompt creation failed")

@app.post("/api/v1/evidence/proof-packet")
async def generate_proof_packet(
    dispute_id: str,
    user_id: str
):
    """Generate proof packet for successful claims"""
    try:
        result = await proof_packet_worker.generate_proof_packet(
            dispute_id=dispute_id,
            user_id=user_id
        )
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"Proof packet generation failed: {e}")
        raise HTTPException(status_code=500, detail="Proof packet generation failed")

@app.get("/api/v1/evidence/status")
async def get_evidence_status():
    """Get evidence processing status"""
    return {
        "matching_engine": "active",
        "auto_submit_service": "active",
        "smart_prompts_service": "active",
        "proof_packet_worker": "active",
        "matching_worker": "active"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)

