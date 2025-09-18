"""
Feature Flags API Endpoints
Phase 8: Feature flags and canary deployment management API
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from typing import List, Optional, Dict, Any, Set
from datetime import datetime, timedelta
import logging

from src.api.auth_middleware import get_current_user
from src.features.feature_flags import feature_flags_service, FeatureFlagType, FeatureFlagStatus, RolloutStrategy
from src.features.canary_deployment import canary_deployment_service, CanaryStrategy, CanaryStatus
from src.features.rollback_manager import rollback_manager, RollbackType, RollbackScope

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/api/v1/feature-flags", response_model=List[Dict[str, Any]], tags=["feature-flags"])
async def get_feature_flags(
    status: Optional[FeatureFlagStatus] = Query(None, description="Filter by status"),
    environment: Optional[str] = Query(None, description="Filter by environment"),
    user: dict = Depends(get_current_user)
):
    """
    Get all feature flags with optional filtering.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        flags = await feature_flags_service.get_feature_flags(
            status=status,
            environment=environment
        )
        return flags
        
    except Exception as e:
        logger.error(f"Failed to get feature flags: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve feature flags")

@router.post("/api/v1/feature-flags", response_model=Dict[str, Any], tags=["feature-flags"])
async def create_feature_flag(
    name: str,
    description: str,
    flag_type: FeatureFlagType,
    rollout_strategy: RolloutStrategy = RolloutStrategy.ALL_USERS,
    rollout_percentage: float = Query(100.0, ge=0.0, le=100.0),
    target_users: Optional[List[str]] = None,
    target_environments: Optional[List[str]] = None,
    config: Optional[Dict[str, Any]] = None,
    user: dict = Depends(get_current_user)
):
    """
    Create a new feature flag.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        flag_id = await feature_flags_service.create_feature_flag(
            name=name,
            description=description,
            flag_type=flag_type,
            rollout_strategy=rollout_strategy,
            rollout_percentage=rollout_percentage,
            target_users=set(target_users) if target_users else None,
            target_environments=set(target_environments) if target_environments else None,
            config=config,
            created_by=current_user_id
        )
        
        return {
            "success": True,
            "flag_id": flag_id,
            "message": "Feature flag created successfully"
        }
        
    except Exception as e:
        logger.error(f"Failed to create feature flag: {e}")
        raise HTTPException(status_code=500, detail="Failed to create feature flag")

@router.put("/api/v1/feature-flags/{flag_id}", response_model=Dict[str, Any], tags=["feature-flags"])
async def update_feature_flag(
    flag_id: str,
    updates: Dict[str, Any],
    user: dict = Depends(get_current_user)
):
    """
    Update a feature flag.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await feature_flags_service.update_feature_flag(flag_id, **updates)
        
        if success:
            return {
                "success": True,
                "flag_id": flag_id,
                "message": "Feature flag updated successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Feature flag not found")
            
    except Exception as e:
        logger.error(f"Failed to update feature flag: {e}")
        raise HTTPException(status_code=500, detail="Failed to update feature flag")

@router.delete("/api/v1/feature-flags/{flag_id}", response_model=Dict[str, Any], tags=["feature-flags"])
async def delete_feature_flag(
    flag_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Delete a feature flag.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await feature_flags_service.delete_feature_flag(flag_id)
        
        if success:
            return {
                "success": True,
                "flag_id": flag_id,
                "message": "Feature flag deleted successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Feature flag not found")
            
    except Exception as e:
        logger.error(f"Failed to delete feature flag: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete feature flag")

@router.get("/api/v1/feature-flags/{flag_name}/evaluate", response_model=Dict[str, Any], tags=["feature-flags"])
async def evaluate_feature_flag(
    flag_name: str,
    environment: str = Query("production", description="Environment to evaluate for"),
    user: dict = Depends(get_current_user)
):
    """
    Evaluate a feature flag for the current user.
    """
    current_user_id = user["user_id"]
    
    try:
        evaluation = await feature_flags_service.evaluate_feature_flag(
            flag_name=flag_name,
            user_id=current_user_id,
            environment=environment
        )
        
        return {
            "flag_name": flag_name,
            "user_id": current_user_id,
            "environment": environment,
            "enabled": evaluation.enabled,
            "variant": evaluation.variant,
            "reason": evaluation.reason,
            "evaluated_at": evaluation.evaluated_at.isoformat() + "Z"
        }
        
    except Exception as e:
        logger.error(f"Failed to evaluate feature flag: {e}")
        raise HTTPException(status_code=500, detail="Failed to evaluate feature flag")

@router.post("/api/v1/feature-flags/{flag_id}/canary", response_model=Dict[str, Any], tags=["feature-flags"])
async def start_canary_deployment(
    flag_id: str,
    canary_percentage: float = Query(10.0, ge=1.0, le=50.0),
    canary_users: Optional[List[str]] = None,
    monitoring_duration_hours: int = Query(24, ge=1, le=168),
    user: dict = Depends(get_current_user)
):
    """
    Start a canary deployment for a feature flag.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await feature_flags_service.start_canary_deployment(
            flag_id=flag_id,
            canary_percentage=canary_percentage,
            canary_users=set(canary_users) if canary_users else None,
            monitoring_duration_hours=monitoring_duration_hours
        )
        
        if success:
            return {
                "success": True,
                "flag_id": flag_id,
                "canary_percentage": canary_percentage,
                "message": "Canary deployment started successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Feature flag not found")
            
    except Exception as e:
        logger.error(f"Failed to start canary deployment: {e}")
        raise HTTPException(status_code=500, detail="Failed to start canary deployment")

@router.post("/api/v1/feature-flags/{flag_id}/promote", response_model=Dict[str, Any], tags=["feature-flags"])
async def promote_canary_to_full(
    flag_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Promote a canary deployment to full rollout.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await feature_flags_service.promote_canary_to_full(
            flag_id=flag_id,
            promoted_by=current_user_id
        )
        
        if success:
            return {
                "success": True,
                "flag_id": flag_id,
                "message": "Canary deployment promoted to full rollout"
            }
        else:
            raise HTTPException(status_code=404, detail="Feature flag not found or not in canary status")
            
    except Exception as e:
        logger.error(f"Failed to promote canary deployment: {e}")
        raise HTTPException(status_code=500, detail="Failed to promote canary deployment")

@router.post("/api/v1/feature-flags/{flag_id}/rollback", response_model=Dict[str, Any], tags=["feature-flags"])
async def rollback_feature_flag(
    flag_id: str,
    reason: str = "manual_rollback",
    user: dict = Depends(get_current_user)
):
    """
    Rollback a feature flag.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await feature_flags_service.rollback_feature_flag(
            flag_id=flag_id,
            rolled_back_by=current_user_id,
            reason=reason
        )
        
        if success:
            return {
                "success": True,
                "flag_id": flag_id,
                "message": "Feature flag rolled back successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Feature flag not found")
            
    except Exception as e:
        logger.error(f"Failed to rollback feature flag: {e}")
        raise HTTPException(status_code=500, detail="Failed to rollback feature flag")

@router.get("/api/v1/canary-deployments", response_model=List[Dict[str, Any]], tags=["canary-deployments"])
async def get_canary_deployments(
    status: Optional[CanaryStatus] = Query(None, description="Filter by status"),
    feature_flag_id: Optional[str] = Query(None, description="Filter by feature flag ID"),
    user: dict = Depends(get_current_user)
):
    """
    Get all canary deployments with optional filtering.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        deployments = await canary_deployment_service.get_canary_deployments(
            status=status,
            feature_flag_id=feature_flag_id
        )
        return deployments
        
    except Exception as e:
        logger.error(f"Failed to get canary deployments: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve canary deployments")

@router.post("/api/v1/canary-deployments", response_model=Dict[str, Any], tags=["canary-deployments"])
async def create_canary_deployment(
    feature_flag_id: str,
    name: str,
    description: str,
    strategy: CanaryStrategy,
    target_percentage: float = Query(10.0, ge=1.0, le=50.0),
    target_users: Optional[List[str]] = None,
    target_environments: Optional[List[str]] = None,
    monitoring_duration_hours: int = Query(24, ge=1, le=168),
    success_criteria: Optional[Dict[str, Any]] = None,
    rollback_criteria: Optional[Dict[str, Any]] = None,
    user: dict = Depends(get_current_user)
):
    """
    Create a new canary deployment.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        deployment_id = await canary_deployment_service.create_canary_deployment(
            feature_flag_id=feature_flag_id,
            name=name,
            description=description,
            strategy=strategy,
            target_percentage=target_percentage,
            target_users=set(target_users) if target_users else None,
            target_environments=set(target_environments) if target_environments else None,
            monitoring_duration_hours=monitoring_duration_hours,
            success_criteria=success_criteria,
            rollback_criteria=rollback_criteria,
            created_by=current_user_id
        )
        
        return {
            "success": True,
            "deployment_id": deployment_id,
            "message": "Canary deployment created successfully"
        }
        
    except Exception as e:
        logger.error(f"Failed to create canary deployment: {e}")
        raise HTTPException(status_code=500, detail="Failed to create canary deployment")

@router.post("/api/v1/canary-deployments/{deployment_id}/start", response_model=Dict[str, Any], tags=["canary-deployments"])
async def start_canary_deployment(
    deployment_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Start a canary deployment.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await canary_deployment_service.start_canary_deployment(
            deployment_id=deployment_id,
            started_by=current_user_id
        )
        
        if success:
            return {
                "success": True,
                "deployment_id": deployment_id,
                "message": "Canary deployment started successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Canary deployment not found or not in pending status")
            
    except Exception as e:
        logger.error(f"Failed to start canary deployment: {e}")
        raise HTTPException(status_code=500, detail="Failed to start canary deployment")

@router.post("/api/v1/canary-deployments/{deployment_id}/promote", response_model=Dict[str, Any], tags=["canary-deployments"])
async def promote_canary_deployment(
    deployment_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Promote a canary deployment to full rollout.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await canary_deployment_service.promote_canary_deployment(
            deployment_id=deployment_id,
            promoted_by=current_user_id
        )
        
        if success:
            return {
                "success": True,
                "deployment_id": deployment_id,
                "message": "Canary deployment promoted to full rollout"
            }
        else:
            raise HTTPException(status_code=404, detail="Canary deployment not found or not in monitoring status")
            
    except Exception as e:
        logger.error(f"Failed to promote canary deployment: {e}")
        raise HTTPException(status_code=500, detail="Failed to promote canary deployment")

@router.post("/api/v1/canary-deployments/{deployment_id}/rollback", response_model=Dict[str, Any], tags=["canary-deployments"])
async def rollback_canary_deployment(
    deployment_id: str,
    reason: str = "manual_rollback",
    user: dict = Depends(get_current_user)
):
    """
    Rollback a canary deployment.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await canary_deployment_service.rollback_canary_deployment(
            deployment_id=deployment_id,
            rolled_back_by=current_user_id,
            reason=reason
        )
        
        if success:
            return {
                "success": True,
                "deployment_id": deployment_id,
                "message": "Canary deployment rolled back successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Canary deployment not found")
            
    except Exception as e:
        logger.error(f"Failed to rollback canary deployment: {e}")
        raise HTTPException(status_code=500, detail="Failed to rollback canary deployment")

@router.get("/api/v1/canary-deployments/{deployment_id}/metrics", response_model=List[Dict[str, Any]], tags=["canary-deployments"])
async def get_canary_metrics(
    deployment_id: str,
    start_time: Optional[datetime] = Query(None, description="Start time for metrics"),
    end_time: Optional[datetime] = Query(None, description="End time for metrics"),
    user: dict = Depends(get_current_user)
):
    """
    Get metrics for a canary deployment.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        metrics = await canary_deployment_service.get_canary_metrics(
            deployment_id=deployment_id,
            start_time=start_time,
            end_time=end_time
        )
        return metrics
        
    except Exception as e:
        logger.error(f"Failed to get canary metrics: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve canary metrics")

@router.post("/api/v1/rollbacks/execute", response_model=Dict[str, Any], tags=["rollbacks"])
async def execute_rollback(
    plan_id: str,
    reason: str = "manual_rollback",
    user: dict = Depends(get_current_user)
):
    """
    Execute a rollback plan.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        execution_id = await rollback_manager.execute_rollback(
            plan_id=plan_id,
            executed_by=current_user_id,
            reason=reason
        )
        
        return {
            "success": True,
            "execution_id": execution_id,
            "message": "Rollback execution started"
        }
        
    except Exception as e:
        logger.error(f"Failed to execute rollback: {e}")
        raise HTTPException(status_code=500, detail="Failed to execute rollback")

@router.post("/api/v1/rollbacks/emergency", response_model=Dict[str, Any], tags=["rollbacks"])
async def emergency_rollback(
    target_id: str,
    scope: RollbackScope,
    reason: str = "emergency_rollback",
    user: dict = Depends(get_current_user)
):
    """
    Execute an emergency rollback.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        execution_id = await rollback_manager.emergency_rollback(
            target_id=target_id,
            scope=scope,
            executed_by=current_user_id,
            reason=reason
        )
        
        return {
            "success": True,
            "execution_id": execution_id,
            "message": "Emergency rollback executed"
        }
        
    except Exception as e:
        logger.error(f"Failed to execute emergency rollback: {e}")
        raise HTTPException(status_code=500, detail="Failed to execute emergency rollback")

@router.get("/api/v1/rollbacks/{execution_id}/status", response_model=Dict[str, Any], tags=["rollbacks"])
async def get_rollback_status(
    execution_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Get rollback execution status.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        status = await rollback_manager.get_rollback_status(execution_id)
        
        if status:
            return status
        else:
            raise HTTPException(status_code=404, detail="Rollback execution not found")
            
    except Exception as e:
        logger.error(f"Failed to get rollback status: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve rollback status")

@router.post("/api/v1/rollbacks/{execution_id}/cancel", response_model=Dict[str, Any], tags=["rollbacks"])
async def cancel_rollback(
    execution_id: str,
    reason: str = "manual_cancellation",
    user: dict = Depends(get_current_user)
):
    """
    Cancel a rollback execution.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await rollback_manager.cancel_rollback(
            execution_id=execution_id,
            cancelled_by=current_user_id,
            reason=reason
        )
        
        if success:
            return {
                "success": True,
                "execution_id": execution_id,
                "message": "Rollback execution cancelled"
            }
        else:
            raise HTTPException(status_code=404, detail="Rollback execution not found or not cancellable")
            
    except Exception as e:
        logger.error(f"Failed to cancel rollback: {e}")
        raise HTTPException(status_code=500, detail="Failed to cancel rollback")

@router.get("/api/v1/feature-flags/evaluations", response_model=List[Dict[str, Any]], tags=["feature-flags"])
async def get_feature_flag_evaluations(
    flag_id: Optional[str] = Query(None, description="Filter by flag ID"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    environment: Optional[str] = Query(None, description="Filter by environment"),
    limit: int = Query(100, ge=1, le=1000),
    user: dict = Depends(get_current_user)
):
    """
    Get feature flag evaluation history.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        evaluations = await feature_flags_service.get_feature_flag_evaluations(
            flag_id=flag_id,
            user_id=user_id,
            environment=environment,
            limit=limit
        )
        return evaluations
        
    except Exception as e:
        logger.error(f"Failed to get feature flag evaluations: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve feature flag evaluations")
