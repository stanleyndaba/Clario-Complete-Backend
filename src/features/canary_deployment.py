"""
Canary Deployment System
Phase 8: Canary deployment management and monitoring
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

class CanaryStatus(str, Enum):
    """Canary deployment status"""
    PENDING = "pending"
    RUNNING = "running"
    MONITORING = "monitoring"
    PROMOTED = "promoted"
    ROLLED_BACK = "rolled_back"
    FAILED = "failed"

class CanaryStrategy(str, Enum):
    """Canary deployment strategies"""
    PERCENTAGE = "percentage"
    USER_LIST = "user_list"
    ENVIRONMENT = "environment"
    GRADUAL = "gradual"
    A_B_TEST = "a_b_test"

@dataclass
class CanaryDeployment:
    """Canary deployment configuration"""
    id: str
    feature_flag_id: str
    name: str
    description: str
    strategy: CanaryStrategy
    target_percentage: float
    target_users: Set[str]
    target_environments: Set[str]
    monitoring_duration_hours: int
    success_criteria: Dict[str, Any]
    rollback_criteria: Dict[str, Any]
    status: CanaryStatus
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_by: str
    metadata: Dict[str, Any]

@dataclass
class CanaryMetrics:
    """Canary deployment metrics"""
    deployment_id: str
    timestamp: datetime
    success_rate: float
    error_rate: float
    response_time_ms: float
    throughput_per_second: float
    user_satisfaction: Optional[float]
    business_metrics: Dict[str, float]
    system_health: Dict[str, float]

class CanaryDeploymentService:
    """Service for managing canary deployments"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.active_deployments = {}
        self.monitoring_task = None
        self.is_running = False
        
    async def start(self):
        """Start the canary deployment service"""
        if self.is_running:
            return
            
        self.is_running = True
        await self._load_active_deployments()
        self.monitoring_task = asyncio.create_task(self._monitor_deployments_loop())
        logger.info("Canary deployment service started")
    
    async def stop(self):
        """Stop the canary deployment service"""
        self.is_running = False
        if self.monitoring_task:
            self.monitoring_task.cancel()
            try:
                await self.monitoring_task
            except asyncio.CancelledError:
                pass
        logger.info("Canary deployment service stopped")
    
    async def create_canary_deployment(
        self,
        feature_flag_id: str,
        name: str,
        description: str,
        strategy: CanaryStrategy,
        target_percentage: float = 10.0,
        target_users: Optional[Set[str]] = None,
        target_environments: Optional[Set[str]] = None,
        monitoring_duration_hours: int = 24,
        success_criteria: Optional[Dict[str, Any]] = None,
        rollback_criteria: Optional[Dict[str, Any]] = None,
        created_by: str = "system"
    ) -> str:
        """Create a new canary deployment"""
        try:
            deployment_id = str(uuid.uuid4())
            
            deployment = CanaryDeployment(
                id=deployment_id,
                feature_flag_id=feature_flag_id,
                name=name,
                description=description,
                strategy=strategy,
                target_percentage=target_percentage,
                target_users=target_users or set(),
                target_environments=target_environments or set(),
                monitoring_duration_hours=monitoring_duration_hours,
                success_criteria=success_criteria or {
                    "min_success_rate": 0.95,
                    "max_error_rate": 0.05,
                    "max_response_time_ms": 2000
                },
                rollback_criteria=rollback_criteria or {
                    "max_error_rate": 0.10,
                    "min_success_rate": 0.80,
                    "max_response_time_ms": 5000
                },
                status=CanaryStatus.PENDING,
                started_at=None,
                completed_at=None,
                created_by=created_by,
                metadata={}
            )
            
            self.active_deployments[deployment_id] = deployment
            await self._store_canary_deployment(deployment)
            
            # Log deployment creation
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="canary_deployment",
                resource_id=deployment_id,
                user_id=created_by,
                security_context={
                    "deployment_name": name,
                    "strategy": strategy.value,
                    "target_percentage": target_percentage
                }
            )
            
            logger.info(f"Created canary deployment: {name}")
            return deployment_id
            
        except Exception as e:
            logger.error(f"Failed to create canary deployment: {e}")
            raise
    
    async def start_canary_deployment(
        self,
        deployment_id: str,
        started_by: str
    ) -> bool:
        """Start a canary deployment"""
        try:
            if deployment_id not in self.active_deployments:
                return False
            
            deployment = self.active_deployments[deployment_id]
            
            if deployment.status != CanaryStatus.PENDING:
                return False
            
            # Start the deployment
            deployment.status = CanaryStatus.RUNNING
            deployment.started_at = datetime.utcnow()
            deployment.metadata.update({
                "started_by": started_by,
                "started_at": deployment.started_at.isoformat() + "Z"
            })
            
            await self._store_canary_deployment(deployment)
            
            # Log deployment start
            await audit_service.log_event(
                action=AuditAction.SYSTEM_START,
                resource_type="canary_deployment",
                resource_id=deployment_id,
                user_id=started_by,
                security_context={
                    "deployment_name": deployment.name,
                    "strategy": deployment.strategy.value
                }
            )
            
            # Start monitoring after a short delay
            await asyncio.sleep(30)  # Allow deployment to stabilize
            deployment.status = CanaryStatus.MONITORING
            await self._store_canary_deployment(deployment)
            
            logger.info(f"Started canary deployment: {deployment_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start canary deployment: {e}")
            return False
    
    async def promote_canary_deployment(
        self,
        deployment_id: str,
        promoted_by: str
    ) -> bool:
        """Promote a canary deployment to full rollout"""
        try:
            if deployment_id not in self.active_deployments:
                return False
            
            deployment = self.active_deployments[deployment_id]
            
            if deployment.status not in [CanaryStatus.RUNNING, CanaryStatus.MONITORING]:
                return False
            
            # Promote to full rollout
            deployment.status = CanaryStatus.PROMOTED
            deployment.completed_at = datetime.utcnow()
            deployment.metadata.update({
                "promoted_by": promoted_by,
                "promoted_at": deployment.completed_at.isoformat() + "Z"
            })
            
            await self._store_canary_deployment(deployment)
            
            # Log promotion
            await audit_service.log_event(
                action=AuditAction.SYSTEM_START,
                resource_type="canary_deployment",
                resource_id=deployment_id,
                user_id=promoted_by,
                security_context={
                    "deployment_name": deployment.name,
                    "action": "promoted"
                }
            )
            
            # Remove from active deployments
            del self.active_deployments[deployment_id]
            
            logger.info(f"Promoted canary deployment: {deployment_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to promote canary deployment: {e}")
            return False
    
    async def rollback_canary_deployment(
        self,
        deployment_id: str,
        rolled_back_by: str,
        reason: str = "manual_rollback"
    ) -> bool:
        """Rollback a canary deployment"""
        try:
            if deployment_id not in self.active_deployments:
                return False
            
            deployment = self.active_deployments[deployment_id]
            
            if deployment.status not in [CanaryStatus.RUNNING, CanaryStatus.MONITORING]:
                return False
            
            # Rollback the deployment
            deployment.status = CanaryStatus.ROLLED_BACK
            deployment.completed_at = datetime.utcnow()
            deployment.metadata.update({
                "rolled_back_by": rolled_back_by,
                "rollback_reason": reason,
                "rolled_back_at": deployment.completed_at.isoformat() + "Z"
            })
            
            await self._store_canary_deployment(deployment)
            
            # Log rollback
            await audit_service.log_event(
                action=AuditAction.SYSTEM_ERROR,
                resource_type="canary_deployment",
                resource_id=deployment_id,
                user_id=rolled_back_by,
                security_context={
                    "deployment_name": deployment.name,
                    "action": "rolled_back",
                    "reason": reason
                }
            )
            
            # Remove from active deployments
            del self.active_deployments[deployment_id]
            
            logger.info(f"Rolled back canary deployment {deployment_id}: {reason}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to rollback canary deployment: {e}")
            return False
    
    async def get_canary_deployments(
        self,
        status: Optional[CanaryStatus] = None,
        feature_flag_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get canary deployments with optional filtering"""
        deployments = []
        for deployment in self.active_deployments.values():
            if status and deployment.status != status:
                continue
            if feature_flag_id and deployment.feature_flag_id != feature_flag_id:
                continue
            
            deployments.append({
                "id": deployment.id,
                "feature_flag_id": deployment.feature_flag_id,
                "name": deployment.name,
                "description": deployment.description,
                "strategy": deployment.strategy.value,
                "target_percentage": deployment.target_percentage,
                "target_users": list(deployment.target_users),
                "target_environments": list(deployment.target_environments),
                "monitoring_duration_hours": deployment.monitoring_duration_hours,
                "success_criteria": deployment.success_criteria,
                "rollback_criteria": deployment.rollback_criteria,
                "status": deployment.status.value,
                "started_at": deployment.started_at.isoformat() + "Z" if deployment.started_at else None,
                "completed_at": deployment.completed_at.isoformat() + "Z" if deployment.completed_at else None,
                "created_by": deployment.created_by,
                "metadata": deployment.metadata
            })
        
        return deployments
    
    async def get_canary_metrics(
        self,
        deployment_id: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """Get metrics for a canary deployment"""
        try:
            if not start_time:
                start_time = datetime.utcnow() - timedelta(hours=24)
            if not end_time:
                end_time = datetime.utcnow()
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT deployment_id, timestamp, success_rate, error_rate,
                               response_time_ms, throughput_per_second, user_satisfaction,
                               business_metrics, system_health
                        FROM canary_metrics
                        WHERE deployment_id = %s AND timestamp >= %s AND timestamp <= %s
                        ORDER BY timestamp DESC
                    """, (deployment_id, start_time, end_time))
                    
                    metrics = []
                    for row in cursor.fetchall():
                        metrics.append({
                            "deployment_id": str(row[0]),
                            "timestamp": row[1].isoformat() + "Z",
                            "success_rate": float(row[2]) if row[2] else 0,
                            "error_rate": float(row[3]) if row[3] else 0,
                            "response_time_ms": float(row[4]) if row[4] else 0,
                            "throughput_per_second": float(row[5]) if row[5] else 0,
                            "user_satisfaction": float(row[6]) if row[6] else None,
                            "business_metrics": json.loads(row[7]) if row[7] else {},
                            "system_health": json.loads(row[8]) if row[8] else {}
                        })
                    
                    return metrics
                    
        except Exception as e:
            logger.error(f"Failed to get canary metrics: {e}")
            return []
    
    async def _monitor_deployments_loop(self):
        """Background task to monitor active canary deployments"""
        while self.is_running:
            try:
                for deployment_id, deployment in list(self.active_deployments.items()):
                    if deployment.status == CanaryStatus.MONITORING:
                        await self._monitor_deployment(deployment)
                
                await asyncio.sleep(60)  # Check every minute
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in canary monitoring loop: {e}")
    
    async def _monitor_deployment(self, deployment: CanaryDeployment):
        """Monitor a specific canary deployment"""
        try:
            # Check if monitoring duration has expired
            if deployment.started_at:
                duration_hours = (datetime.utcnow() - deployment.started_at).total_seconds() / 3600
                if duration_hours >= deployment.monitoring_duration_hours:
                    # Auto-promote if success criteria are met
                    if await self._check_success_criteria(deployment):
                        await self.promote_canary_deployment(deployment.id, "system")
                    else:
                        await self.rollback_canary_deployment(deployment.id, "system", "monitoring_timeout")
                    return
            
            # Collect metrics
            metrics = await self._collect_deployment_metrics(deployment)
            await self._store_canary_metrics(metrics)
            
            # Check rollback criteria
            if await self._check_rollback_criteria(deployment, metrics):
                await self.rollback_canary_deployment(deployment.id, "system", "rollback_criteria_met")
                return
            
            # Check success criteria
            if await self._check_success_criteria(deployment, metrics):
                # Wait a bit more before promoting
                if deployment.started_at:
                    duration_hours = (datetime.utcnow() - deployment.started_at).total_seconds() / 3600
                    if duration_hours >= 1:  # At least 1 hour of successful monitoring
                        await self.promote_canary_deployment(deployment.id, "system")
            
        except Exception as e:
            logger.error(f"Error monitoring deployment {deployment.id}: {e}")
    
    async def _collect_deployment_metrics(self, deployment: CanaryDeployment) -> CanaryMetrics:
        """Collect metrics for a canary deployment"""
        try:
            # Get metrics from the last hour
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(hours=1)
            
            # Collect system metrics
            system_metrics = await metrics_collector.get_aggregated_metrics(
                category=MetricCategory.SYSTEM,
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            
            # Calculate success rate
            success_rate = 0.0
            error_rate = 0.0
            response_time_ms = 0.0
            throughput_per_second = 0.0
            
            for metric in system_metrics["aggregated_metrics"]:
                if metric["name"] == "api_success_rate":
                    success_rate = metric["avg_value"]
                elif metric["name"] == "api_error_rate":
                    error_rate = metric["avg_value"]
                elif metric["name"] == "api_response_time":
                    response_time_ms = metric["avg_value"]
                elif metric["name"] == "api_throughput":
                    throughput_per_second = metric["avg_value"]
            
            # Calculate business metrics
            business_metrics = {}
            evidence_metrics = await metrics_collector.get_aggregated_metrics(
                category=MetricCategory.EVIDENCE,
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            
            for metric in evidence_metrics["aggregated_metrics"]:
                if metric["name"] == "documents_processed":
                    business_metrics["documents_processed"] = metric["sum_value"]
                elif metric["name"] == "parsing_success_rate":
                    business_metrics["parsing_success_rate"] = metric["avg_value"]
            
            # Calculate system health
            system_health = {}
            for metric in system_metrics["aggregated_metrics"]:
                if metric["name"] == "cpu_usage_percent":
                    system_health["cpu_usage"] = metric["avg_value"]
                elif metric["name"] == "memory_usage_percent":
                    system_health["memory_usage"] = metric["avg_value"]
            
            return CanaryMetrics(
                deployment_id=deployment.id,
                timestamp=end_time,
                success_rate=success_rate,
                error_rate=error_rate,
                response_time_ms=response_time_ms,
                throughput_per_second=throughput_per_second,
                user_satisfaction=None,  # Would need user feedback system
                business_metrics=business_metrics,
                system_health=system_health
            )
            
        except Exception as e:
            logger.error(f"Failed to collect deployment metrics: {e}")
            return CanaryMetrics(
                deployment_id=deployment.id,
                timestamp=datetime.utcnow(),
                success_rate=0.0,
                error_rate=1.0,
                response_time_ms=0.0,
                throughput_per_second=0.0,
                user_satisfaction=None,
                business_metrics={},
                system_health={}
            )
    
    async def _check_success_criteria(
        self,
        deployment: CanaryDeployment,
        metrics: Optional[CanaryMetrics] = None
    ) -> bool:
        """Check if success criteria are met"""
        try:
            if not metrics:
                return False
            
            criteria = deployment.success_criteria
            
            # Check success rate
            if "min_success_rate" in criteria:
                if metrics.success_rate < criteria["min_success_rate"]:
                    return False
            
            # Check error rate
            if "max_error_rate" in criteria:
                if metrics.error_rate > criteria["max_error_rate"]:
                    return False
            
            # Check response time
            if "max_response_time_ms" in criteria:
                if metrics.response_time_ms > criteria["max_response_time_ms"]:
                    return False
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to check success criteria: {e}")
            return False
    
    async def _check_rollback_criteria(
        self,
        deployment: CanaryDeployment,
        metrics: CanaryMetrics
    ) -> bool:
        """Check if rollback criteria are met"""
        try:
            criteria = deployment.rollback_criteria
            
            # Check error rate
            if "max_error_rate" in criteria:
                if metrics.error_rate > criteria["max_error_rate"]:
                    return True
            
            # Check success rate
            if "min_success_rate" in criteria:
                if metrics.success_rate < criteria["min_success_rate"]:
                    return True
            
            # Check response time
            if "max_response_time_ms" in criteria:
                if metrics.response_time_ms > criteria["max_response_time_ms"]:
                    return True
            
            return False
            
        except Exception as e:
            logger.error(f"Failed to check rollback criteria: {e}")
            return False
    
    async def _load_active_deployments(self):
        """Load active canary deployments from database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, feature_flag_id, name, description, strategy,
                               target_percentage, target_users, target_environments,
                               monitoring_duration_hours, success_criteria, rollback_criteria,
                               status, started_at, completed_at, created_by, metadata
                        FROM canary_deployments
                        WHERE status IN ('pending', 'running', 'monitoring')
                    """)
                    
                    for row in cursor.fetchall():
                        deployment = CanaryDeployment(
                            id=row[0],
                            feature_flag_id=row[1],
                            name=row[2],
                            description=row[3],
                            strategy=CanaryStrategy(row[4]),
                            target_percentage=float(row[5]),
                            target_users=set(json.loads(row[6])) if row[6] else set(),
                            target_environments=set(json.loads(row[7])) if row[7] else set(),
                            monitoring_duration_hours=row[8],
                            success_criteria=json.loads(row[9]) if row[9] else {},
                            rollback_criteria=json.loads(row[10]) if row[10] else {},
                            status=CanaryStatus(row[11]),
                            started_at=row[12],
                            completed_at=row[13],
                            created_by=row[14],
                            metadata=json.loads(row[15]) if row[15] else {}
                        )
                        
                        self.active_deployments[deployment.id] = deployment
                        
        except Exception as e:
            logger.error(f"Failed to load active deployments: {e}")
    
    async def _store_canary_deployment(self, deployment: CanaryDeployment):
        """Store canary deployment in database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO canary_deployments (
                            id, feature_flag_id, name, description, strategy,
                            target_percentage, target_users, target_environments,
                            monitoring_duration_hours, success_criteria, rollback_criteria,
                            status, started_at, completed_at, created_by, metadata
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            status = EXCLUDED.status,
                            started_at = EXCLUDED.started_at,
                            completed_at = EXCLUDED.completed_at,
                            metadata = EXCLUDED.metadata
                    """, (
                        deployment.id, deployment.feature_flag_id, deployment.name,
                        deployment.description, deployment.strategy.value, deployment.target_percentage,
                        json.dumps(list(deployment.target_users)), json.dumps(list(deployment.target_environments)),
                        deployment.monitoring_duration_hours, json.dumps(deployment.success_criteria),
                        json.dumps(deployment.rollback_criteria), deployment.status.value,
                        deployment.started_at, deployment.completed_at, deployment.created_by,
                        json.dumps(deployment.metadata)
                    ))
                    
        except Exception as e:
            logger.error(f"Failed to store canary deployment: {e}")
    
    async def _store_canary_metrics(self, metrics: CanaryMetrics):
        """Store canary metrics in database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO canary_metrics (
                            deployment_id, timestamp, success_rate, error_rate,
                            response_time_ms, throughput_per_second, user_satisfaction,
                            business_metrics, system_health
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        metrics.deployment_id, metrics.timestamp, metrics.success_rate,
                        metrics.error_rate, metrics.response_time_ms, metrics.throughput_per_second,
                        metrics.user_satisfaction, json.dumps(metrics.business_metrics),
                        json.dumps(metrics.system_health)
                    ))
                    
        except Exception as e:
            logger.error(f"Failed to store canary metrics: {e}")

# Global canary deployment service instance
canary_deployment_service = CanaryDeploymentService()
