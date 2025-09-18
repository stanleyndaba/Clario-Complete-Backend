"""
Feature Flags System
Phase 8: Feature flags and canary deployment management
"""

import asyncio
import json
from typing import Dict, Any, List, Optional, Union, Set
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass, asdict
from enum import Enum
import uuid

from src.common.db_postgresql import DatabaseManager
from src.common.config import settings
from src.security.audit_service import audit_service, AuditAction, AuditSeverity

logger = logging.getLogger(__name__)

class FeatureFlagType(str, Enum):
    """Types of feature flags"""
    BOOLEAN = "boolean"
    PERCENTAGE = "percentage"
    USER_LIST = "user_list"
    ENVIRONMENT = "environment"
    EXPERIMENT = "experiment"

class FeatureFlagStatus(str, Enum):
    """Feature flag status"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    CANARY = "canary"
    ROLLING_BACK = "rolling_back"
    ROLLED_BACK = "rolled_back"

class RolloutStrategy(str, Enum):
    """Rollout strategies"""
    ALL_USERS = "all_users"
    PERCENTAGE = "percentage"
    USER_LIST = "user_list"
    ENVIRONMENT = "environment"
    GRADUAL = "gradual"

@dataclass
class FeatureFlag:
    """Feature flag configuration"""
    id: str
    name: str
    description: str
    flag_type: FeatureFlagType
    status: FeatureFlagStatus
    rollout_strategy: RolloutStrategy
    rollout_percentage: float
    target_users: Set[str]
    target_environments: Set[str]
    config: Dict[str, Any]
    created_at: datetime
    updated_at: datetime
    created_by: str
    metadata: Dict[str, Any]

@dataclass
class FeatureFlagEvaluation:
    """Feature flag evaluation result"""
    flag_id: str
    user_id: Optional[str]
    environment: str
    enabled: bool
    variant: Optional[str]
    reason: str
    evaluated_at: datetime
    metadata: Dict[str, Any]

class FeatureFlagsService:
    """Service for managing feature flags and canary deployments"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.feature_flags = {}
        self.evaluation_cache = {}
        self.cache_ttl = 300  # 5 minutes
        self.is_running = False
        self.refresh_task = None
        
    async def start(self):
        """Start the feature flags service"""
        if self.is_running:
            return
            
        self.is_running = True
        await self._load_feature_flags()
        self.refresh_task = asyncio.create_task(self._refresh_flags_loop())
        logger.info("Feature flags service started")
    
    async def stop(self):
        """Stop the feature flags service"""
        self.is_running = False
        if self.refresh_task:
            self.refresh_task.cancel()
            try:
                await self.refresh_task
            except asyncio.CancelledError:
                pass
        logger.info("Feature flags service stopped")
    
    async def create_feature_flag(
        self,
        name: str,
        description: str,
        flag_type: FeatureFlagType,
        rollout_strategy: RolloutStrategy = RolloutStrategy.ALL_USERS,
        rollout_percentage: float = 100.0,
        target_users: Optional[Set[str]] = None,
        target_environments: Optional[Set[str]] = None,
        config: Optional[Dict[str, Any]] = None,
        created_by: str = "system"
    ) -> str:
        """Create a new feature flag"""
        try:
            flag_id = str(uuid.uuid4())
            
            flag = FeatureFlag(
                id=flag_id,
                name=name,
                description=description,
                flag_type=flag_type,
                status=FeatureFlagStatus.INACTIVE,
                rollout_strategy=rollout_strategy,
                rollout_percentage=rollout_percentage,
                target_users=target_users or set(),
                target_environments=target_environments or set(),
                config=config or {},
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                created_by=created_by,
                metadata={}
            )
            
            self.feature_flags[flag_id] = flag
            await self._store_feature_flag(flag)
            
            # Log flag creation
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="feature_flag",
                resource_id=flag_id,
                security_context={
                    "flag_name": name,
                    "flag_type": flag_type.value,
                    "rollout_strategy": rollout_strategy.value
                }
            )
            
            logger.info(f"Created feature flag: {name}")
            return flag_id
            
        except Exception as e:
            logger.error(f"Failed to create feature flag: {e}")
            raise
    
    async def update_feature_flag(
        self,
        flag_id: str,
        **updates
    ) -> bool:
        """Update a feature flag"""
        try:
            if flag_id not in self.feature_flags:
                return False
            
            flag = self.feature_flags[flag_id]
            
            # Update fields
            for key, value in updates.items():
                if hasattr(flag, key):
                    setattr(flag, key, value)
            
            flag.updated_at = datetime.utcnow()
            
            # Store in database
            await self._store_feature_flag(flag)
            
            # Clear cache for this flag
            self._clear_flag_cache(flag_id)
            
            logger.info(f"Updated feature flag: {flag_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to update feature flag: {e}")
            return False
    
    async def delete_feature_flag(self, flag_id: str) -> bool:
        """Delete a feature flag"""
        try:
            if flag_id not in self.feature_flags:
                return False
            
            flag = self.feature_flags[flag_id]
            
            # Remove from memory
            del self.feature_flags[flag_id]
            
            # Remove from database
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("DELETE FROM feature_flags WHERE id = %s", (flag_id,))
            
            # Clear cache
            self._clear_flag_cache(flag_id)
            
            # Log flag deletion
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="feature_flag",
                resource_id=flag_id,
                security_context={
                    "flag_name": flag.name,
                    "action": "deleted"
                }
            )
            
            logger.info(f"Deleted feature flag: {flag_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete feature flag: {e}")
            return False
    
    async def evaluate_feature_flag(
        self,
        flag_name: str,
        user_id: Optional[str] = None,
        environment: str = "production",
        context: Optional[Dict[str, Any]] = None
    ) -> FeatureFlagEvaluation:
        """Evaluate a feature flag for a user"""
        try:
            # Check cache first
            cache_key = f"{flag_name}:{user_id}:{environment}"
            if cache_key in self.evaluation_cache:
                cached_eval = self.evaluation_cache[cache_key]
                if datetime.utcnow() - cached_eval["timestamp"] < timedelta(seconds=self.cache_ttl):
                    return cached_eval["evaluation"]
            
            # Find the flag
            flag = None
            for f in self.feature_flags.values():
                if f.name == flag_name and f.status in [FeatureFlagStatus.ACTIVE, FeatureFlagStatus.CANARY]:
                    flag = f
                    break
            
            if not flag:
                evaluation = FeatureFlagEvaluation(
                    flag_id="",
                    user_id=user_id,
                    environment=environment,
                    enabled=False,
                    variant=None,
                    reason="flag_not_found",
                    evaluated_at=datetime.utcnow(),
                    metadata={}
                )
                return evaluation
            
            # Evaluate based on flag type and rollout strategy
            enabled, variant, reason = await self._evaluate_flag_logic(flag, user_id, environment, context)
            
            evaluation = FeatureFlagEvaluation(
                flag_id=flag.id,
                user_id=user_id,
                environment=environment,
                enabled=enabled,
                variant=variant,
                reason=reason,
                evaluated_at=datetime.utcnow(),
                metadata=context or {}
            )
            
            # Cache the evaluation
            self.evaluation_cache[cache_key] = {
                "evaluation": evaluation,
                "timestamp": datetime.utcnow()
            }
            
            return evaluation
            
        except Exception as e:
            logger.error(f"Failed to evaluate feature flag {flag_name}: {e}")
            return FeatureFlagEvaluation(
                flag_id="",
                user_id=user_id,
                environment=environment,
                enabled=False,
                variant=None,
                reason="evaluation_error",
                evaluated_at=datetime.utcnow(),
                metadata={"error": str(e)}
            )
    
    async def _evaluate_flag_logic(
        self,
        flag: FeatureFlag,
        user_id: Optional[str],
        environment: str,
        context: Optional[Dict[str, Any]]
    ) -> tuple[bool, Optional[str], str]:
        """Evaluate the logic for a feature flag"""
        try:
            # Check environment targeting
            if flag.target_environments and environment not in flag.target_environments:
                return False, None, "environment_not_targeted"
            
            # Check user targeting
            if flag.target_users and user_id and user_id not in flag.target_users:
                return False, None, "user_not_targeted"
            
            # Evaluate based on rollout strategy
            if flag.rollout_strategy == RolloutStrategy.ALL_USERS:
                return True, None, "all_users"
            
            elif flag.rollout_strategy == RolloutStrategy.PERCENTAGE:
                if not user_id:
                    return False, None, "no_user_id"
                
                # Use user ID hash for consistent percentage rollout
                user_hash = hash(user_id) % 100
                if user_hash < flag.rollout_percentage:
                    return True, None, "percentage_rollout"
                else:
                    return False, None, "percentage_rollout"
            
            elif flag.rollout_strategy == RolloutStrategy.USER_LIST:
                if user_id in flag.target_users:
                    return True, None, "user_list"
                else:
                    return False, None, "user_list"
            
            elif flag.rollout_strategy == RolloutStrategy.ENVIRONMENT:
                if environment in flag.target_environments:
                    return True, None, "environment"
                else:
                    return False, None, "environment"
            
            elif flag.rollout_strategy == RolloutStrategy.GRADUAL:
                # Gradual rollout based on time and percentage
                if not user_id:
                    return False, None, "no_user_id"
                
                # Calculate gradual rollout based on time since creation
                hours_since_creation = (datetime.utcnow() - flag.created_at).total_seconds() / 3600
                gradual_percentage = min(flag.rollout_percentage, hours_since_creation * 10)  # 10% per hour
                
                user_hash = hash(user_id) % 100
                if user_hash < gradual_percentage:
                    return True, None, "gradual_rollout"
                else:
                    return False, None, "gradual_rollout"
            
            return False, None, "unknown_strategy"
            
        except Exception as e:
            logger.error(f"Error evaluating flag logic: {e}")
            return False, None, "evaluation_error"
    
    async def start_canary_deployment(
        self,
        flag_id: str,
        canary_percentage: float = 10.0,
        canary_users: Optional[Set[str]] = None,
        monitoring_duration_hours: int = 24
    ) -> bool:
        """Start a canary deployment for a feature flag"""
        try:
            if flag_id not in self.feature_flags:
                return False
            
            flag = self.feature_flags[flag_id]
            
            # Update flag for canary deployment
            flag.status = FeatureFlagStatus.CANARY
            flag.rollout_strategy = RolloutStrategy.PERCENTAGE
            flag.rollout_percentage = canary_percentage
            if canary_users:
                flag.target_users.update(canary_users)
            
            flag.metadata.update({
                "canary_started_at": datetime.utcnow().isoformat() + "Z",
                "canary_percentage": canary_percentage,
                "monitoring_duration_hours": monitoring_duration_hours
            })
            
            await self._store_feature_flag(flag)
            
            # Log canary start
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="feature_flag",
                resource_id=flag_id,
                security_context={
                    "flag_name": flag.name,
                    "action": "canary_started",
                    "canary_percentage": canary_percentage,
                    "monitoring_duration_hours": monitoring_duration_hours
                }
            )
            
            logger.info(f"Started canary deployment for flag {flag_id} at {canary_percentage}%")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start canary deployment: {e}")
            return False
    
    async def promote_canary_to_full(
        self,
        flag_id: str,
        promoted_by: str
    ) -> bool:
        """Promote a canary deployment to full rollout"""
        try:
            if flag_id not in self.feature_flags:
                return False
            
            flag = self.feature_flags[flag_id]
            
            if flag.status != FeatureFlagStatus.CANARY:
                return False
            
            # Promote to full rollout
            flag.status = FeatureFlagStatus.ACTIVE
            flag.rollout_strategy = RolloutStrategy.ALL_USERS
            flag.rollout_percentage = 100.0
            
            flag.metadata.update({
                "promoted_at": datetime.utcnow().isoformat() + "Z",
                "promoted_by": promoted_by
            })
            
            await self._store_feature_flag(flag)
            
            # Log promotion
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="feature_flag",
                resource_id=flag_id,
                user_id=promoted_by,
                security_context={
                    "flag_name": flag.name,
                    "action": "canary_promoted"
                }
            )
            
            logger.info(f"Promoted canary deployment to full rollout for flag {flag_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to promote canary deployment: {e}")
            return False
    
    async def rollback_feature_flag(
        self,
        flag_id: str,
        rolled_back_by: str,
        reason: str = "manual_rollback"
    ) -> bool:
        """Rollback a feature flag"""
        try:
            if flag_id not in self.feature_flags:
                return False
            
            flag = self.feature_flags[flag_id]
            
            # Set status to rolling back
            flag.status = FeatureFlagStatus.ROLLING_BACK
            flag.rollout_percentage = 0.0
            
            flag.metadata.update({
                "rollback_started_at": datetime.utcnow().isoformat() + "Z",
                "rollback_reason": reason,
                "rolled_back_by": rolled_back_by
            })
            
            await self._store_feature_flag(flag)
            
            # Log rollback start
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="feature_flag",
                resource_id=flag_id,
                user_id=rolled_back_by,
                security_context={
                    "flag_name": flag.name,
                    "action": "rollback_started",
                    "reason": reason
                }
            )
            
            # Complete rollback after a short delay
            await asyncio.sleep(5)  # Allow time for rollback to propagate
            
            flag.status = FeatureFlagStatus.ROLLED_BACK
            flag.metadata.update({
                "rollback_completed_at": datetime.utcnow().isoformat() + "Z"
            })
            
            await self._store_feature_flag(flag)
            
            logger.info(f"Rolled back feature flag {flag_id}: {reason}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to rollback feature flag: {e}")
            return False
    
    async def get_feature_flags(
        self,
        status: Optional[FeatureFlagStatus] = None,
        environment: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get feature flags with optional filtering"""
        flags = []
        for flag in self.feature_flags.values():
            if status and flag.status != status:
                continue
            if environment and environment not in flag.target_environments:
                continue
            
            flags.append({
                "id": flag.id,
                "name": flag.name,
                "description": flag.description,
                "flag_type": flag.flag_type.value,
                "status": flag.status.value,
                "rollout_strategy": flag.rollout_strategy.value,
                "rollout_percentage": flag.rollout_percentage,
                "target_users": list(flag.target_users),
                "target_environments": list(flag.target_environments),
                "config": flag.config,
                "created_at": flag.created_at.isoformat() + "Z",
                "updated_at": flag.updated_at.isoformat() + "Z",
                "created_by": flag.created_by,
                "metadata": flag.metadata
            })
        
        return flags
    
    async def get_feature_flag_evaluations(
        self,
        flag_id: Optional[str] = None,
        user_id: Optional[str] = None,
        environment: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get feature flag evaluation history"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    where_conditions = []
                    params = []
                    
                    if flag_id:
                        where_conditions.append("flag_id = %s")
                        params.append(flag_id)
                    if user_id:
                        where_conditions.append("user_id = %s")
                        params.append(user_id)
                    if environment:
                        where_conditions.append("environment = %s")
                        params.append(environment)
                    
                    where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""
                    
                    cursor.execute(f"""
                        SELECT flag_id, user_id, environment, enabled, variant, reason,
                               evaluated_at, metadata
                        FROM feature_flag_evaluations
                        {where_clause}
                        ORDER BY evaluated_at DESC
                        LIMIT %s
                    """, params + [limit])
                    
                    evaluations = []
                    for row in cursor.fetchall():
                        evaluations.append({
                            "flag_id": str(row[0]),
                            "user_id": str(row[1]) if row[1] else None,
                            "environment": row[2],
                            "enabled": row[3],
                            "variant": row[4],
                            "reason": row[5],
                            "evaluated_at": row[6].isoformat() + "Z",
                            "metadata": json.loads(row[7]) if row[7] else {}
                        })
                    
                    return evaluations
                    
        except Exception as e:
            logger.error(f"Failed to get feature flag evaluations: {e}")
            return []
    
    async def _refresh_flags_loop(self):
        """Background task to refresh feature flags from database"""
        while self.is_running:
            try:
                await asyncio.sleep(60)  # Refresh every minute
                await self._load_feature_flags()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in feature flags refresh loop: {e}")
    
    async def _load_feature_flags(self):
        """Load feature flags from database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, name, description, flag_type, status, rollout_strategy,
                               rollout_percentage, target_users, target_environments, config,
                               created_at, updated_at, created_by, metadata
                        FROM feature_flags
                        WHERE status != 'deleted'
                    """)
                    
                    for row in cursor.fetchall():
                        flag = FeatureFlag(
                            id=row[0],
                            name=row[1],
                            description=row[2],
                            flag_type=FeatureFlagType(row[3]),
                            status=FeatureFlagStatus(row[4]),
                            rollout_strategy=RolloutStrategy(row[5]),
                            rollout_percentage=float(row[6]),
                            target_users=set(json.loads(row[7])) if row[7] else set(),
                            target_environments=set(json.loads(row[8])) if row[8] else set(),
                            config=json.loads(row[9]) if row[9] else {},
                            created_at=row[10],
                            updated_at=row[11],
                            created_by=row[12],
                            metadata=json.loads(row[13]) if row[13] else {}
                        )
                        
                        self.feature_flags[flag.id] = flag
                        
        except Exception as e:
            logger.error(f"Failed to load feature flags: {e}")
    
    async def _store_feature_flag(self, flag: FeatureFlag):
        """Store feature flag in database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO feature_flags (
                            id, name, description, flag_type, status, rollout_strategy,
                            rollout_percentage, target_users, target_environments, config,
                            created_at, updated_at, created_by, metadata
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            description = EXCLUDED.description,
                            flag_type = EXCLUDED.flag_type,
                            status = EXCLUDED.status,
                            rollout_strategy = EXCLUDED.rollout_strategy,
                            rollout_percentage = EXCLUDED.rollout_percentage,
                            target_users = EXCLUDED.target_users,
                            target_environments = EXCLUDED.target_environments,
                            config = EXCLUDED.config,
                            updated_at = EXCLUDED.updated_at,
                            metadata = EXCLUDED.metadata
                    """, (
                        flag.id, flag.name, flag.description, flag.flag_type.value,
                        flag.status.value, flag.rollout_strategy.value, flag.rollout_percentage,
                        json.dumps(list(flag.target_users)), json.dumps(list(flag.target_environments)),
                        json.dumps(flag.config), flag.created_at, flag.updated_at,
                        flag.created_by, json.dumps(flag.metadata)
                    ))
                    
        except Exception as e:
            logger.error(f"Failed to store feature flag: {e}")
    
    def _clear_flag_cache(self, flag_id: str):
        """Clear cache for a specific flag"""
        keys_to_remove = []
        for key in self.evaluation_cache:
            if flag_id in key:
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self.evaluation_cache[key]

# Global feature flags service instance
feature_flags_service = FeatureFlagsService()
