"""
Sync API Router
Handles sync operations for integrations and data synchronization
"""

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import Optional
import logging
from src.api.auth_middleware import get_current_user
from src.api.schemas import SyncJob, SyncActivity, SyncActivityResponse
from src.services.integrations_client import integrations_client
from src.api.service_connector import service_connector

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/api/sync/start", response_model=SyncJob)
async def start_sync(
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user)
):
    """
    Start a new sync job for the authenticated user
    
    Args:
        background_tasks: FastAPI background tasks
        user: Authenticated user information
        
    Returns:
        SyncJob: Sync job information
    """
    try:
        user_id = user["user_id"]
        logger.info(f"Starting sync for user {user_id}")
        
        # Call integrations service to start sync
        sync_job = await integrations_client.start_sync(user_id)
        
        # Start background task for sync monitoring
        background_tasks.add_task(monitor_sync_progress, sync_job["id"], user_id)
        
        return SyncJob(**sync_job)
        
    except Exception as e:
        logger.error(f"Failed to start sync for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start sync: {str(e)}"
        )

@router.get("/api/sync/status", response_model=SyncJob)
async def get_sync_status(
    id: str = Query(..., description="Sync job ID"),
    user: dict = Depends(get_current_user)
):
    """
    Get status of a specific sync job
    
    Args:
        id: Sync job ID
        user: Authenticated user information
        
    Returns:
        SyncJob: Sync job status
    """
    try:
        user_id = user["user_id"]
        logger.info(f"Getting sync status for job {id}, user {user_id}")
        
        # Call integrations service to get sync status
        sync_status = await integrations_client.get_sync_status(id, user_id)
        
        return SyncJob(**sync_status)
        
    except Exception as e:
        logger.error(f"Failed to get sync status for job {id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get sync status: {str(e)}"
        )

@router.get("/api/sync/activity", response_model=SyncActivityResponse)
async def get_sync_activity(
    limit: int = Query(10, ge=1, le=100, description="Number of activities to return"),
    offset: int = Query(0, ge=0, description="Number of activities to skip"),
    user: dict = Depends(get_current_user)
):
    """
    Get sync activity history for the authenticated user
    
    Args:
        limit: Maximum number of activities to return
        offset: Number of activities to skip
        user: Authenticated user information
        
    Returns:
        SyncActivityResponse: List of sync activities
    """
    try:
        user_id = user["user_id"]
        logger.info(f"Getting sync activity for user {user_id}, limit={limit}, offset={offset}")
        
        # Call integrations service to get sync activity
        activity_data = await integrations_client.get_sync_activity(user_id, limit, offset)
        
        activities = [SyncActivity(**activity) for activity in activity_data.get("activities", [])]
        
        return SyncActivityResponse(
            activities=activities,
            total=activity_data.get("total", 0),
            has_more=activity_data.get("has_more", False)
        )
        
    except Exception as e:
        logger.error(f"Failed to get sync activity for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get sync activity: {str(e)}"
        )

async def monitor_sync_progress(sync_id: str, user_id: str):
    """
    Background task to monitor sync progress
    
    Args:
        sync_id: Sync job ID
        user_id: User ID
    """
    try:
        logger.info(f"Starting sync monitoring for job {sync_id}")
        
        # This would typically involve polling the sync status
        # and updating the database or sending notifications
        # For now, we'll just log the monitoring start
        
        logger.info(f"Sync monitoring started for job {sync_id}")
        
    except Exception as e:
        logger.error(f"Sync monitoring failed for job {sync_id}: {str(e)}")

@router.post("/api/sync/cancel")
async def cancel_sync(
    id: str = Query(..., description="Sync job ID"),
    user: dict = Depends(get_current_user)
):
    """
    Cancel a running sync job
    
    Args:
        id: Sync job ID
        user: Authenticated user information
        
    Returns:
        dict: Cancellation result
    """
    try:
        user_id = user["user_id"]
        logger.info(f"Cancelling sync job {id} for user {user_id}")
        
        # Call integrations service to cancel sync
        result = await integrations_client.cancel_sync(id, user_id)
        
        return {"ok": True, "message": "Sync cancelled successfully", "data": result}
        
    except Exception as e:
        logger.error(f"Failed to cancel sync job {id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to cancel sync: {str(e)}"
        )

