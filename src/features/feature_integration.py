"""
Feature Flags Integration Service
Phase 8: Integration service for feature flags across all system components
"""

import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime
import logging
from contextlib import asynccontextmanager

from src.features.feature_flags import feature_flags_service, FeatureFlagStatus
from src.features.canary_deployment import canary_deployment_service
from src.features.rollback_manager import rollback_manager
from src.analytics.metrics_collector import metrics_collector, MetricCategory
from src.security.audit_service import audit_service, AuditAction, AuditSeverity

logger = logging.getLogger(__name__)

class FeatureIntegration:
    """Service for integrating feature flags across all system components"""
    
    def __init__(self):
        self.feature_flags_service = feature_flags_service
        self.canary_deployment_service = canary_deployment_service
        self.rollback_manager = rollback_manager
        self.is_running = False
        self.background_tasks = []
        
    async def start(self):
        """Start the feature integration service"""
        if self.is_running:
            return
            
        self.is_running = True
        
        # Start all feature services
        await self.feature_flags_service.start()
        await self.canary_deployment_service.start()
        await self.rollback_manager.start()
        
        # Start background monitoring tasks
        self.background_tasks = [
            asyncio.create_task(self._monitor_feature_flags()),
            asyncio.create_task(self._monitor_canary_deployments()),
            asyncio.create_task(self._monitor_rollbacks())
        ]
        
        logger.info("Feature integration service started")
    
    async def stop(self):
        """Stop the feature integration service"""
        self.is_running = False
        
        # Stop background tasks
        for task in self.background_tasks:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        
        # Stop all feature services
        await self.feature_flags_service.stop()
        await self.canary_deployment_service.stop()
        await self.rollback_manager.stop()
        
        logger.info("Feature integration service stopped")
    
    async def is_feature_enabled(
        self,
        feature_name: str,
        user_id: Optional[str] = None,
        environment: str = "production"
    ) -> bool:
        """Check if a feature is enabled for a user"""
        try:
            evaluation = await self.feature_flags_service.evaluate_feature_flag(
                flag_name=feature_name,
                user_id=user_id,
                environment=environment
            )
            
            # Track feature flag evaluation
            await metrics_collector.increment_counter(
                name="feature_flag_evaluations",
                category=MetricCategory.SYSTEM,
                labels={
                    "feature_name": feature_name,
                    "enabled": str(evaluation.enabled),
                    "environment": environment
                },
                user_id=user_id
            )
            
            return evaluation.enabled
            
        except Exception as e:
            logger.error(f"Failed to check feature flag {feature_name}: {e}")
            return False
    
    async def get_feature_variant(
        self,
        feature_name: str,
        user_id: Optional[str] = None,
        environment: str = "production"
    ) -> Optional[str]:
        """Get the variant for a feature flag"""
        try:
            evaluation = await self.feature_flags_service.evaluate_feature_flag(
                flag_name=feature_name,
                user_id=user_id,
                environment=environment
            )
            
            return evaluation.variant
            
        except Exception as e:
            logger.error(f"Failed to get feature variant {feature_name}: {e}")
            return None
    
    @asynccontextmanager
    async def feature_context(
        self,
        feature_name: str,
        user_id: Optional[str] = None,
        environment: str = "production"
    ):
        """Context manager for feature-gated code"""
        enabled = await self.is_feature_enabled(feature_name, user_id, environment)
        
        try:
            if enabled:
                yield True
            else:
                yield False
        finally:
            # Track feature usage
            await metrics_collector.increment_counter(
                name="feature_usage",
                category=MetricCategory.SYSTEM,
                labels={
                    "feature_name": feature_name,
                    "enabled": str(enabled),
                    "environment": environment
                },
                user_id=user_id
            )
    
    async def track_feature_usage(
        self,
        feature_name: str,
        action: str,
        user_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Track feature usage for analytics"""
        try:
            await metrics_collector.increment_counter(
                name="feature_usage_actions",
                category=MetricCategory.USER,
                labels={
                    "feature_name": feature_name,
                    "action": action
                },
                user_id=user_id,
                metadata=metadata
            )
            
        except Exception as e:
            logger.error(f"Failed to track feature usage: {e}")
    
    async def create_feature_flag(
        self,
        name: str,
        description: str,
        flag_type: str = "boolean",
        rollout_strategy: str = "all_users",
        rollout_percentage: float = 100.0,
        target_users: Optional[List[str]] = None,
        target_environments: Optional[List[str]] = None,
        config: Optional[Dict[str, Any]] = None,
        created_by: str = "system"
    ) -> str:
        """Create a new feature flag with default configuration"""
        try:
            from src.features.feature_flags import FeatureFlagType, RolloutStrategy
            
            flag_id = await self.feature_flags_service.create_feature_flag(
                name=name,
                description=description,
                flag_type=FeatureFlagType(flag_type),
                rollout_strategy=RolloutStrategy(rollout_strategy),
                rollout_percentage=rollout_percentage,
                target_users=set(target_users) if target_users else None,
                target_environments=set(target_environments) if target_environments else None,
                config=config,
                created_by=created_by
            )
            
            # Track feature flag creation
            await metrics_collector.increment_counter(
                name="feature_flags_created",
                category=MetricCategory.SYSTEM,
                labels={
                    "flag_type": flag_type,
                    "rollout_strategy": rollout_strategy
                },
                user_id=created_by
            )
            
            return flag_id
            
        except Exception as e:
            logger.error(f"Failed to create feature flag: {e}")
            raise
    
    async def start_canary_deployment(
        self,
        feature_flag_id: str,
        canary_percentage: float = 10.0,
        canary_users: Optional[List[str]] = None,
        monitoring_duration_hours: int = 24,
        started_by: str = "system"
    ) -> str:
        """Start a canary deployment for a feature flag"""
        try:
            # Start canary deployment
            success = await self.feature_flags_service.start_canary_deployment(
                flag_id=feature_flag_id,
                canary_percentage=canary_percentage,
                canary_users=set(canary_users) if canary_users else None,
                monitoring_duration_hours=monitoring_duration_hours
            )
            
            if not success:
                raise ValueError(f"Failed to start canary deployment for flag {feature_flag_id}")
            
            # Create canary deployment record
            deployment_id = await self.canary_deployment_service.create_canary_deployment(
                feature_flag_id=feature_flag_id,
                name=f"Canary for {feature_flag_id}",
                description=f"Canary deployment for feature flag {feature_flag_id}",
                strategy="percentage",
                target_percentage=canary_percentage,
                target_users=set(canary_users) if canary_users else None,
                monitoring_duration_hours=monitoring_duration_hours,
                created_by=started_by
            )
            
            # Start the deployment
            await self.canary_deployment_service.start_canary_deployment(
                deployment_id=deployment_id,
                started_by=started_by
            )
            
            # Track canary deployment start
            await metrics_collector.increment_counter(
                name="canary_deployments_started",
                category=MetricCategory.SYSTEM,
                labels={
                    "feature_flag_id": feature_flag_id,
                    "canary_percentage": str(canary_percentage)
                },
                user_id=started_by
            )
            
            return deployment_id
            
        except Exception as e:
            logger.error(f"Failed to start canary deployment: {e}")
            raise
    
    async def promote_canary_deployment(
        self,
        feature_flag_id: str,
        promoted_by: str
    ) -> bool:
        """Promote a canary deployment to full rollout"""
        try:
            # Promote the feature flag
            success = await self.feature_flags_service.promote_canary_to_full(
                flag_id=feature_flag_id,
                promoted_by=promoted_by
            )
            
            if success:
                # Track promotion
                await metrics_collector.increment_counter(
                    name="canary_deployments_promoted",
                    category=MetricCategory.SYSTEM,
                    labels={"feature_flag_id": feature_flag_id},
                    user_id=promoted_by
                )
            
            return success
            
        except Exception as e:
            logger.error(f"Failed to promote canary deployment: {e}")
            return False
    
    async def rollback_feature(
        self,
        feature_flag_id: str,
        rolled_back_by: str,
        reason: str = "manual_rollback"
    ) -> bool:
        """Rollback a feature flag"""
        try:
            # Rollback the feature flag
            success = await self.feature_flags_service.rollback_feature_flag(
                flag_id=feature_flag_id,
                rolled_back_by=rolled_back_by,
                reason=reason
            )
            
            if success:
                # Track rollback
                await metrics_collector.increment_counter(
                    name="feature_rollbacks",
                    category=MetricCategory.SYSTEM,
                    labels={
                        "feature_flag_id": feature_flag_id,
                        "reason": reason
                    },
                    user_id=rolled_back_by
                )
            
            return success
            
        except Exception as e:
            logger.error(f"Failed to rollback feature: {e}")
            return False
    
    async def emergency_rollback(
        self,
        target_id: str,
        scope: str,
        executed_by: str,
        reason: str = "emergency_rollback"
    ) -> str:
        """Execute an emergency rollback"""
        try:
            from src.features.rollback_manager import RollbackScope
            
            execution_id = await self.rollback_manager.emergency_rollback(
                target_id=target_id,
                scope=RollbackScope(scope),
                executed_by=executed_by,
                reason=reason
            )
            
            # Track emergency rollback
            await metrics_collector.increment_counter(
                name="emergency_rollbacks",
                category=MetricCategory.SYSTEM,
                labels={
                    "target_id": target_id,
                    "scope": scope,
                    "reason": reason
                },
                user_id=executed_by
            )
            
            return execution_id
            
        except Exception as e:
            logger.error(f"Failed to execute emergency rollback: {e}")
            raise
    
    async def get_feature_status(
        self,
        feature_name: str,
        user_id: Optional[str] = None,
        environment: str = "production"
    ) -> Dict[str, Any]:
        """Get comprehensive feature status"""
        try:
            evaluation = await self.feature_flags_service.evaluate_feature_flag(
                flag_name=feature_name,
                user_id=user_id,
                environment=environment
            )
            
            return {
                "feature_name": feature_name,
                "user_id": user_id,
                "environment": environment,
                "enabled": evaluation.enabled,
                "variant": evaluation.variant,
                "reason": evaluation.reason,
                "evaluated_at": evaluation.evaluated_at.isoformat() + "Z"
            }
            
        except Exception as e:
            logger.error(f"Failed to get feature status: {e}")
            return {
                "feature_name": feature_name,
                "user_id": user_id,
                "environment": environment,
                "enabled": False,
                "variant": None,
                "reason": "error",
                "evaluated_at": datetime.utcnow().isoformat() + "Z"
            }
    
    async def get_system_feature_summary(self) -> Dict[str, Any]:
        """Get summary of all features and their status"""
        try:
            # Get all feature flags
            flags = await self.feature_flags_service.get_feature_flags()
            
            # Get active canary deployments
            canary_deployments = await self.canary_deployment_service.get_canary_deployments()
            
            # Get active rollbacks
            active_rollbacks = []
            for execution_id in self.rollback_manager.active_rollbacks:
                status = await self.rollback_manager.get_rollback_status(execution_id)
                if status:
                    active_rollbacks.append(status)
            
            return {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "feature_flags": {
                    "total": len(flags),
                    "active": len([f for f in flags if f["status"] == "active"]),
                    "canary": len([f for f in flags if f["status"] == "canary"]),
                    "inactive": len([f for f in flags if f["status"] == "inactive"])
                },
                "canary_deployments": {
                    "total": len(canary_deployments),
                    "running": len([d for d in canary_deployments if d["status"] == "running"]),
                    "monitoring": len([d for d in canary_deployments if d["status"] == "monitoring"])
                },
                "rollbacks": {
                    "active": len(active_rollbacks),
                    "executions": active_rollbacks
                }
            }
            
        except Exception as e:
            logger.error(f"Failed to get system feature summary: {e}")
            return {"error": str(e)}
    
    async def _monitor_feature_flags(self):
        """Background task to monitor feature flags"""
        while self.is_running:
            try:
                # Check for feature flags that need attention
                flags = await self.feature_flags_service.get_feature_flags()
                
                for flag in flags:
                    if flag["status"] == "canary":
                        # Check if canary should be promoted or rolled back
                        # This would integrate with monitoring metrics
                        pass
                
                await asyncio.sleep(60)  # Check every minute
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error monitoring feature flags: {e}")
                await asyncio.sleep(60)
    
    async def _monitor_canary_deployments(self):
        """Background task to monitor canary deployments"""
        while self.is_running:
            try:
                # Check for canary deployments that need attention
                deployments = await self.canary_deployment_service.get_canary_deployments()
                
                for deployment in deployments:
                    if deployment["status"] in ["running", "monitoring"]:
                        # Check metrics and criteria
                        # This would integrate with monitoring metrics
                        pass
                
                await asyncio.sleep(60)  # Check every minute
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error monitoring canary deployments: {e}")
                await asyncio.sleep(60)
    
    async def _monitor_rollbacks(self):
        """Background task to monitor rollbacks"""
        while self.is_running:
            try:
                # Check for rollbacks that need attention
                # This would integrate with monitoring metrics
                pass
                
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error monitoring rollbacks: {e}")
                await asyncio.sleep(30)

# Global feature integration instance
feature_integration = FeatureIntegration()
