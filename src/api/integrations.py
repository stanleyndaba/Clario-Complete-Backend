"""
Integrations API endpoints - Production Implementation
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Dict, Any, List
from datetime import datetime, timedelta
import logging
from src.api.auth_middleware import get_current_user
from src.api.schemas import IntegrationInfo, SyncJob, SyncActivityResponse, SyncActivity
from src.services.integrations_client import integrations_client

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/api/v1/integrations/status")
async def get_integrations_status(
    user: dict = Depends(get_current_user)
):
    """Get status of all integrations for the user"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Getting integrations status for user {user_id}")
        
        # Call real integrations service
        result = await integrations_client.get_user_integrations(user_id)
        
        if "error" in result:
            logger.error(f"Get integrations status failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Integration service error: {result['error']}")
        
        return {"ok": True, "data": result}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_integrations_status: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/integrations/connect-amazon")
async def connect_amazon(
    user: dict = Depends(get_current_user)
):
    """Connect to Amazon integration"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Connecting Amazon integration for user {user_id}")
        
        # Call real integrations service
        result = await integrations_client.connect_integration(user_id, "amazon")
        
        if "error" in result:
            logger.error(f"Amazon connection failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Integration service error: {result['error']}")
        
        return {"ok": True, "data": result}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in connect_amazon: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/api/v1/integrations/connect-docs")
async def connect_docs(
    provider: str = Query(..., description="Document provider (gmail, outlook, gdrive, dropbox)"),
    user: dict = Depends(get_current_user)
):
    """Connect to document provider integration"""
    
    if provider not in ["gmail", "outlook", "gdrive", "dropbox"]:
        raise HTTPException(status_code=400, detail="Invalid provider. Must be one of: gmail, outlook, gdrive, dropbox")
    
    try:
        user_id = user["user_id"]
        logger.info(f"Connecting {provider} integration for user {user_id}")
        
        # Call real integrations service
        result = await integrations_client.connect_integration(user_id, f"docs_{provider}")
        
        if "error" in result:
            logger.error(f"{provider} connection failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Integration service error: {result['error']}")
        
        return {"ok": True, "data": result}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in connect_docs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/api/v1/integrations/disconnect")
async def disconnect_integration(
    provider: str = Query(..., description="Integration provider to disconnect"),
    purge: bool = Query(False, description="Whether to purge data"),
    user: dict = Depends(get_current_user)
):
    """Disconnect an integration"""
    
    try:
        user_id = user["user_id"]
        logger.info(f"Disconnecting {provider} integration for user {user_id}, purge={purge}")
        
        # Call real integrations service
        result = await integrations_client.disconnect_integration(user_id, provider, purge)
        
        if "error" in result:
            logger.error(f"Disconnect failed: {result['error']}")
            raise HTTPException(status_code=502, detail=f"Integration service error: {result['error']}")
        
        return {"ok": True, "data": result}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in disconnect_integration: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

