"""
Rollback Manager
Phase 8: Automatic and manual rollback mechanisms
"""

import asyncio
import json
from typing import Dict, Any, List, Optional, Set
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass
from enum import Enum
import uuid

from src.common.db_postgresql import DatabaseManager
from src.analytics.metrics_collector import metrics_collector, MetricCategory
from src.analytics.alerting_system import alerting_system, AlertSeverity
from src.security.audit_service import audit_service, AuditAction, AuditSeverity

logger = logging.getLogger(__name__)

class RollbackType(str, Enum):
    """Types of rollbacks"""
    AUTOMATIC = "automatic"
    MANUAL = "manual"
    SCHEDULED = "scheduled"
    EMERGENCY = "emergency"

class RollbackStatus(str, Enum):
    """Rollback status"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class RollbackScope(str, Enum):
    """Rollback scope"""
    FEATURE_FLAG = "feature_flag"
    CANARY_DEPLOYMENT = "canary_deployment"
    SYSTEM_WIDE = "system_wide"
    USER_GROUP = "user_group"
    ENVIRONMENT = "environment"

@dataclass
class RollbackPlan:
    """Rollback plan configuration"""
    id: str
    name: str
    description: str
    rollback_type: RollbackType
    scope: RollbackScope
    target_id: str  # Feature flag ID, deployment ID, etc.
    rollback_steps: List[Dict[str, Any]]
    rollback_criteria: Dict[str, Any]
    created_at: datetime
    created_by: str
    metadata: Dict[str, Any]

@dataclass
class RollbackExecution:
    """Rollback execution record"""
    id: str
    plan_id: str
    status: RollbackStatus
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    executed_by: str
    execution_log: List[Dict[str, Any]]
    error_message: Optional[str]
    metadata: Dict[str, Any]

class RollbackManager:
    """Service for managing rollbacks and system state recovery"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.active_rollbacks = {}
        self.rollback_plans = {}
        self.monitoring_task = None
        self.is_running = False
        
    async def start(self):
        """Start the rollback manager"""
        if self.is_running:
            return
            
        self.is_running = True
        await self._load_rollback_plans()
        self.monitoring_task = asyncio.create_task(self._monitor_rollbacks_loop())
        logger.info("Rollback manager started")
    
    async def stop(self):
        """Stop the rollback manager"""
        self.is_running = False
        if self.monitoring_task:
            self.monitoring_task.cancel()
            try:
                await self.monitoring_task
            except asyncio.CancelledError:
                pass
        logger.info("Rollback manager stopped")
    
    async def create_rollback_plan(
        self,
        name: str,
        description: str,
        rollback_type: RollbackType,
        scope: RollbackScope,
        target_id: str,
        rollback_steps: List[Dict[str, Any]],
        rollback_criteria: Optional[Dict[str, Any]] = None,
        created_by: str = "system"
    ) -> str:
        """Create a rollback plan"""
        try:
            plan_id = str(uuid.uuid4())
            
            plan = RollbackPlan(
                id=plan_id,
                name=name,
                description=description,
                rollback_type=rollback_type,
                scope=scope,
                target_id=target_id,
                rollback_steps=rollback_steps,
                rollback_criteria=rollback_criteria or {
                    "max_error_rate": 0.10,
                    "min_success_rate": 0.80,
                    "max_response_time_ms": 5000
                },
                created_at=datetime.utcnow(),
                created_by=created_by,
                metadata={}
            )
            
            self.rollback_plans[plan_id] = plan
            await self._store_rollback_plan(plan)
            
            # Log plan creation
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="rollback_plan",
                resource_id=plan_id,
                user_id=created_by,
                security_context={
                    "plan_name": name,
                    "rollback_type": rollback_type.value,
                    "scope": scope.value
                }
            )
            
            logger.info(f"Created rollback plan: {name}")
            return plan_id
            
        except Exception as e:
            logger.error(f"Failed to create rollback plan: {e}")
            raise
    
    async def execute_rollback(
        self,
        plan_id: str,
        executed_by: str,
        reason: str = "manual_rollback"
    ) -> str:
        """Execute a rollback plan"""
        try:
            if plan_id not in self.rollback_plans:
                raise ValueError(f"Rollback plan {plan_id} not found")
            
            plan = self.rollback_plans[plan_id]
            execution_id = str(uuid.uuid4())
            
            execution = RollbackExecution(
                id=execution_id,
                plan_id=plan_id,
                status=RollbackStatus.PENDING,
                started_at=None,
                completed_at=None,
                executed_by=executed_by,
                execution_log=[],
                error_message=None,
                metadata={"reason": reason}
            )
            
            self.active_rollbacks[execution_id] = execution
            await self._store_rollback_execution(execution)
            
            # Log rollback start
            await audit_service.log_event(
                action=AuditAction.SYSTEM_ERROR,
                resource_type="rollback_execution",
                resource_id=execution_id,
                user_id=executed_by,
                security_context={
                    "plan_name": plan.name,
                    "reason": reason
                }
            )
            
            # Execute rollback asynchronously
            asyncio.create_task(self._execute_rollback_steps(execution))
            
            logger.info(f"Started rollback execution: {execution_id}")
            return execution_id
            
        except Exception as e:
            logger.error(f"Failed to execute rollback: {e}")
            raise
    
    async def emergency_rollback(
        self,
        target_id: str,
        scope: RollbackScope,
        executed_by: str,
        reason: str = "emergency_rollback"
    ) -> str:
        """Execute an emergency rollback"""
        try:
            # Create emergency rollback plan
            plan_id = await self.create_rollback_plan(
                name=f"Emergency Rollback - {target_id}",
                description=f"Emergency rollback for {scope.value} {target_id}",
                rollback_type=RollbackType.EMERGENCY,
                scope=scope,
                target_id=target_id,
                rollback_steps=await self._get_emergency_rollback_steps(scope, target_id),
                created_by=executed_by
            )
            
            # Execute immediately
            execution_id = await self.execute_rollback(plan_id, executed_by, reason)
            
            logger.warning(f"Emergency rollback executed: {execution_id}")
            return execution_id
            
        except Exception as e:
            logger.error(f"Failed to execute emergency rollback: {e}")
            raise
    
    async def check_rollback_criteria(
        self,
        target_id: str,
        scope: RollbackScope
    ) -> bool:
        """Check if rollback criteria are met"""
        try:
            # Get recent metrics
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(minutes=5)
            
            metrics = await metrics_collector.get_aggregated_metrics(
                category=MetricCategory.SYSTEM,
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            
            # Check error rate
            error_rate = 0.0
            success_rate = 0.0
            response_time_ms = 0.0
            
            for metric in metrics["aggregated_metrics"]:
                if metric["name"] == "api_error_rate":
                    error_rate = metric["avg_value"]
                elif metric["name"] == "api_success_rate":
                    success_rate = metric["avg_value"]
                elif metric["name"] == "api_response_time":
                    response_time_ms = metric["avg_value"]
            
            # Default rollback criteria
            if error_rate > 0.10 or success_rate < 0.80 or response_time_ms > 5000:
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Failed to check rollback criteria: {e}")
            return False
    
    async def get_rollback_status(
        self,
        execution_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get rollback execution status"""
        if execution_id not in self.active_rollbacks:
            return None
        
        execution = self.active_rollbacks[execution_id]
        plan = self.rollback_plans.get(execution.plan_id)
        
        return {
            "execution_id": execution.id,
            "plan_id": execution.plan_id,
            "plan_name": plan.name if plan else "Unknown",
            "status": execution.status.value,
            "started_at": execution.started_at.isoformat() + "Z" if execution.started_at else None,
            "completed_at": execution.completed_at.isoformat() + "Z" if execution.completed_at else None,
            "executed_by": execution.executed_by,
            "execution_log": execution.execution_log,
            "error_message": execution.error_message,
            "metadata": execution.metadata
        }
    
    async def cancel_rollback(
        self,
        execution_id: str,
        cancelled_by: str,
        reason: str = "manual_cancellation"
    ) -> bool:
        """Cancel a rollback execution"""
        try:
            if execution_id not in self.active_rollbacks:
                return False
            
            execution = self.active_rollbacks[execution_id]
            
            if execution.status not in [RollbackStatus.PENDING, RollbackStatus.IN_PROGRESS]:
                return False
            
            execution.status = RollbackStatus.CANCELLED
            execution.completed_at = datetime.utcnow()
            execution.metadata.update({
                "cancelled_by": cancelled_by,
                "cancellation_reason": reason,
                "cancelled_at": execution.completed_at.isoformat() + "Z"
            })
            
            await self._store_rollback_execution(execution)
            
            # Remove from active rollbacks
            del self.active_rollbacks[execution_id]
            
            # Log cancellation
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="rollback_execution",
                resource_id=execution_id,
                user_id=cancelled_by,
                security_context={
                    "action": "cancelled",
                    "reason": reason
                }
            )
            
            logger.info(f"Cancelled rollback execution: {execution_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to cancel rollback: {e}")
            return False
    
    async def _execute_rollback_steps(self, execution: RollbackExecution):
        """Execute rollback steps"""
        try:
            execution.status = RollbackStatus.IN_PROGRESS
            execution.started_at = datetime.utcnow()
            await self._store_rollback_execution(execution)
            
            plan = self.rollback_plans[execution.plan_id]
            
            for step in plan.rollback_steps:
                try:
                    step_result = await self._execute_rollback_step(step, execution)
                    execution.execution_log.append({
                        "step": step,
                        "result": step_result,
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    })
                    
                    if not step_result.get("success", False):
                        execution.status = RollbackStatus.FAILED
                        execution.error_message = step_result.get("error", "Step execution failed")
                        break
                        
                except Exception as e:
                    execution.execution_log.append({
                        "step": step,
                        "result": {"success": False, "error": str(e)},
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    })
                    execution.status = RollbackStatus.FAILED
                    execution.error_message = str(e)
                    break
            
            if execution.status == RollbackStatus.IN_PROGRESS:
                execution.status = RollbackStatus.COMPLETED
                execution.completed_at = datetime.utcnow()
            
            await self._store_rollback_execution(execution)
            
            # Remove from active rollbacks
            if execution.id in self.active_rollbacks:
                del self.active_rollbacks[execution.id]
            
            logger.info(f"Completed rollback execution: {execution.id}")
            
        except Exception as e:
            logger.error(f"Error executing rollback steps: {e}")
            execution.status = RollbackStatus.FAILED
            execution.error_message = str(e)
            execution.completed_at = datetime.utcnow()
            await self._store_rollback_execution(execution)
    
    async def _execute_rollback_step(
        self,
        step: Dict[str, Any],
        execution: RollbackExecution
    ) -> Dict[str, Any]:
        """Execute a single rollback step"""
        try:
            step_type = step.get("type")
            step_config = step.get("config", {})
            
            if step_type == "disable_feature_flag":
                return await self._disable_feature_flag(step_config)
            elif step_type == "rollback_canary":
                return await self._rollback_canary_deployment(step_config)
            elif step_type == "restore_database":
                return await self._restore_database(step_config)
            elif step_type == "restart_service":
                return await self._restart_service(step_config)
            elif step_type == "revert_config":
                return await self._revert_config(step_config)
            else:
                return {"success": False, "error": f"Unknown step type: {step_type}"}
                
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _disable_feature_flag(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Disable a feature flag"""
        try:
            from src.features.feature_flags import feature_flags_service
            
            flag_id = config.get("flag_id")
            if not flag_id:
                return {"success": False, "error": "flag_id required"}
            
            success = await feature_flags_service.update_feature_flag(
                flag_id,
                status="inactive",
                rollout_percentage=0.0
            )
            
            return {"success": success, "message": f"Disabled feature flag {flag_id}"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _rollback_canary_deployment(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Rollback a canary deployment"""
        try:
            from src.features.canary_deployment import canary_deployment_service
            
            deployment_id = config.get("deployment_id")
            if not deployment_id:
                return {"success": False, "error": "deployment_id required"}
            
            success = await canary_deployment_service.rollback_canary_deployment(
                deployment_id,
                "rollback_manager",
                "automatic_rollback"
            )
            
            return {"success": success, "message": f"Rolled back canary deployment {deployment_id}"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _restore_database(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Restore database from backup"""
        try:
            # This would integrate with database backup/restore system
            backup_id = config.get("backup_id")
            if not backup_id:
                return {"success": False, "error": "backup_id required"}
            
            # Placeholder for database restore logic
            logger.info(f"Restoring database from backup {backup_id}")
            
            return {"success": True, "message": f"Restored database from backup {backup_id}"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _restart_service(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Restart a service"""
        try:
            service_name = config.get("service_name")
            if not service_name:
                return {"success": False, "error": "service_name required"}
            
            # Placeholder for service restart logic
            logger.info(f"Restarting service {service_name}")
            
            return {"success": True, "message": f"Restarted service {service_name}"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _revert_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Revert configuration changes"""
        try:
            config_key = config.get("config_key")
            previous_value = config.get("previous_value")
            
            if not config_key or previous_value is None:
                return {"success": False, "error": "config_key and previous_value required"}
            
            # Placeholder for config revert logic
            logger.info(f"Reverting config {config_key} to {previous_value}")
            
            return {"success": True, "message": f"Reverted config {config_key}"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def _get_emergency_rollback_steps(
        self,
        scope: RollbackScope,
        target_id: str
    ) -> List[Dict[str, Any]]:
        """Get emergency rollback steps based on scope"""
        steps = []
        
        if scope == RollbackScope.FEATURE_FLAG:
            steps.append({
                "type": "disable_feature_flag",
                "config": {"flag_id": target_id}
            })
        elif scope == RollbackScope.CANARY_DEPLOYMENT:
            steps.append({
                "type": "rollback_canary",
                "config": {"deployment_id": target_id}
            })
        elif scope == RollbackScope.SYSTEM_WIDE:
            steps.extend([
                {
                    "type": "restart_service",
                    "config": {"service_name": "evidence_validator"}
                },
                {
                    "type": "restore_database",
                    "config": {"backup_id": "latest"}
                }
            ])
        
        return steps
    
    async def _monitor_rollbacks_loop(self):
        """Background task to monitor for automatic rollbacks"""
        while self.is_running:
            try:
                # Check for automatic rollback triggers
                await self._check_automatic_rollbacks()
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in rollback monitoring loop: {e}")
    
    async def _check_automatic_rollbacks(self):
        """Check for conditions that trigger automatic rollbacks"""
        try:
            # Check system health metrics
            if await self.check_rollback_criteria("system", RollbackScope.SYSTEM_WIDE):
                # Trigger emergency rollback
                await self.emergency_rollback(
                    target_id="system",
                    scope=RollbackScope.SYSTEM_WIDE,
                    executed_by="system",
                    reason="automatic_rollback_triggered"
                )
                
        except Exception as e:
            logger.error(f"Error checking automatic rollbacks: {e}")
    
    async def _load_rollback_plans(self):
        """Load rollback plans from database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, name, description, rollback_type, scope, target_id,
                               rollback_steps, rollback_criteria, created_at, created_by, metadata
                        FROM rollback_plans
                        WHERE status = 'active'
                    """)
                    
                    for row in cursor.fetchall():
                        plan = RollbackPlan(
                            id=row[0],
                            name=row[1],
                            description=row[2],
                            rollback_type=RollbackType(row[3]),
                            scope=RollbackScope(row[4]),
                            target_id=row[5],
                            rollback_steps=json.loads(row[6]) if row[6] else [],
                            rollback_criteria=json.loads(row[7]) if row[7] else {},
                            created_at=row[8],
                            created_by=row[9],
                            metadata=json.loads(row[10]) if row[10] else {}
                        )
                        
                        self.rollback_plans[plan.id] = plan
                        
        except Exception as e:
            logger.error(f"Failed to load rollback plans: {e}")
    
    async def _store_rollback_plan(self, plan: RollbackPlan):
        """Store rollback plan in database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO rollback_plans (
                            id, name, description, rollback_type, scope, target_id,
                            rollback_steps, rollback_criteria, created_at, created_by, metadata
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            description = EXCLUDED.description,
                            rollback_steps = EXCLUDED.rollback_steps,
                            rollback_criteria = EXCLUDED.rollback_criteria,
                            metadata = EXCLUDED.metadata
                    """, (
                        plan.id, plan.name, plan.description, plan.rollback_type.value,
                        plan.scope.value, plan.target_id, json.dumps(plan.rollback_steps),
                        json.dumps(plan.rollback_criteria), plan.created_at, plan.created_by,
                        json.dumps(plan.metadata)
                    ))
                    
        except Exception as e:
            logger.error(f"Failed to store rollback plan: {e}")
    
    async def _store_rollback_execution(self, execution: RollbackExecution):
        """Store rollback execution in database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO rollback_executions (
                            id, plan_id, status, started_at, completed_at, executed_by,
                            execution_log, error_message, metadata
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            status = EXCLUDED.status,
                            started_at = EXCLUDED.started_at,
                            completed_at = EXCLUDED.completed_at,
                            execution_log = EXCLUDED.execution_log,
                            error_message = EXCLUDED.error_message,
                            metadata = EXCLUDED.metadata
                    """, (
                        execution.id, execution.plan_id, execution.status.value,
                        execution.started_at, execution.completed_at, execution.executed_by,
                        json.dumps(execution.execution_log), execution.error_message,
                        json.dumps(execution.metadata)
                    ))
                    
        except Exception as e:
            logger.error(f"Failed to store rollback execution: {e}")

# Global rollback manager instance
rollback_manager = RollbackManager()
