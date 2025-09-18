"""
Alerting System
Phase 7: Real-time alerting and notification system for monitoring
"""

import asyncio
import json
from typing import Dict, Any, List, Optional, Callable
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass
from enum import Enum

from src.common.db_postgresql import DatabaseManager
from src.analytics.metrics_collector import metrics_collector, MetricCategory
from src.security.audit_service import audit_service, AuditAction, AuditSeverity

logger = logging.getLogger(__name__)

class AlertSeverity(str, Enum):
    """Alert severity levels"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"

class AlertStatus(str, Enum):
    """Alert status"""
    ACTIVE = "active"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    SUPPRESSED = "suppressed"

class AlertCondition(str, Enum):
    """Alert conditions"""
    GREATER_THAN = "gt"
    LESS_THAN = "lt"
    EQUALS = "eq"
    NOT_EQUALS = "ne"
    GREATER_THAN_OR_EQUAL = "gte"
    LESS_THAN_OR_EQUAL = "lte"
    CONTAINS = "contains"
    NOT_CONTAINS = "not_contains"

@dataclass
class AlertRule:
    """Alert rule configuration"""
    id: str
    name: str
    description: str
    metric_name: str
    category: MetricCategory
    condition: AlertCondition
    threshold: float
    severity: AlertSeverity
    duration_minutes: int
    is_enabled: bool
    labels: Dict[str, str]
    notification_channels: List[str]
    created_at: datetime
    updated_at: datetime

@dataclass
class Alert:
    """Active alert"""
    id: str
    rule_id: str
    severity: AlertSeverity
    status: AlertStatus
    message: str
    metric_value: float
    threshold: float
    triggered_at: datetime
    acknowledged_at: Optional[datetime]
    resolved_at: Optional[datetime]
    acknowledged_by: Optional[str]
    resolved_by: Optional[str]
    metadata: Dict[str, Any]

class AlertingSystem:
    """Service for managing alerts and notifications"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.alert_rules = {}
        self.active_alerts = {}
        self.notification_handlers = {}
        self.alert_task = None
        self.is_running = False
        
    async def start(self):
        """Start the alerting system"""
        if self.is_running:
            return
            
        self.is_running = True
        await self._load_alert_rules()
        self.alert_task = asyncio.create_task(self._monitor_alerts_loop())
        logger.info("Alerting system started")
    
    async def stop(self):
        """Stop the alerting system"""
        self.is_running = False
        if self.alert_task:
            self.alert_task.cancel()
            try:
                await self.alert_task
            except asyncio.CancelledError:
                pass
        logger.info("Alerting system stopped")
    
    async def create_alert_rule(
        self,
        name: str,
        description: str,
        metric_name: str,
        category: MetricCategory,
        condition: AlertCondition,
        threshold: float,
        severity: AlertSeverity,
        duration_minutes: int = 5,
        labels: Optional[Dict[str, str]] = None,
        notification_channels: Optional[List[str]] = None
    ) -> str:
        """Create a new alert rule"""
        try:
            rule_id = f"rule_{int(datetime.utcnow().timestamp())}"
            
            rule = AlertRule(
                id=rule_id,
                name=name,
                description=description,
                metric_name=metric_name,
                category=category,
                condition=condition,
                threshold=threshold,
                severity=severity,
                duration_minutes=duration_minutes,
                is_enabled=True,
                labels=labels or {},
                notification_channels=notification_channels or [],
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            
            self.alert_rules[rule_id] = rule
            
            # Store in database
            await self._store_alert_rule(rule)
            
            # Log rule creation
            await audit_service.log_event(
                action=AuditAction.CONFIG_CHANGE,
                resource_type="alert_rule",
                resource_id=rule_id,
                severity=AuditSeverity.MEDIUM,
                security_context={
                    "rule_name": name,
                    "metric_name": metric_name,
                    "threshold": threshold,
                    "severity": severity.value
                }
            )
            
            logger.info(f"Created alert rule: {name}")
            return rule_id
            
        except Exception as e:
            logger.error(f"Failed to create alert rule: {e}")
            raise
    
    async def update_alert_rule(
        self,
        rule_id: str,
        **updates
    ) -> bool:
        """Update an alert rule"""
        try:
            if rule_id not in self.alert_rules:
                return False
            
            rule = self.alert_rules[rule_id]
            
            # Update fields
            for key, value in updates.items():
                if hasattr(rule, key):
                    setattr(rule, key, value)
            
            rule.updated_at = datetime.utcnow()
            
            # Store in database
            await self._store_alert_rule(rule)
            
            logger.info(f"Updated alert rule: {rule_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to update alert rule: {e}")
            return False
    
    async def delete_alert_rule(self, rule_id: str) -> bool:
        """Delete an alert rule"""
        try:
            if rule_id not in self.alert_rules:
                return False
            
            # Remove from memory
            del self.alert_rules[rule_id]
            
            # Remove from database
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("DELETE FROM alert_rules WHERE id = %s", (rule_id,))
            
            logger.info(f"Deleted alert rule: {rule_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete alert rule: {e}")
            return False
    
    async def get_alert_rules(self) -> List[Dict[str, Any]]:
        """Get all alert rules"""
        rules = []
        for rule in self.alert_rules.values():
            rules.append({
                "id": rule.id,
                "name": rule.name,
                "description": rule.description,
                "metric_name": rule.metric_name,
                "category": rule.category.value,
                "condition": rule.condition.value,
                "threshold": rule.threshold,
                "severity": rule.severity.value,
                "duration_minutes": rule.duration_minutes,
                "is_enabled": rule.is_enabled,
                "labels": rule.labels,
                "notification_channels": rule.notification_channels,
                "created_at": rule.created_at.isoformat() + "Z",
                "updated_at": rule.updated_at.isoformat() + "Z"
            })
        return rules
    
    async def get_active_alerts(self) -> List[Dict[str, Any]]:
        """Get all active alerts"""
        alerts = []
        for alert in self.active_alerts.values():
            alerts.append({
                "id": alert.id,
                "rule_id": alert.rule_id,
                "severity": alert.severity.value,
                "status": alert.status.value,
                "message": alert.message,
                "metric_value": alert.metric_value,
                "threshold": alert.threshold,
                "triggered_at": alert.triggered_at.isoformat() + "Z",
                "acknowledged_at": alert.acknowledged_at.isoformat() + "Z" if alert.acknowledged_at else None,
                "resolved_at": alert.resolved_at.isoformat() + "Z" if alert.resolved_at else None,
                "acknowledged_by": alert.acknowledged_by,
                "resolved_by": alert.resolved_by,
                "metadata": alert.metadata
            })
        return alerts
    
    async def acknowledge_alert(
        self,
        alert_id: str,
        acknowledged_by: str
    ) -> bool:
        """Acknowledge an alert"""
        try:
            if alert_id not in self.active_alerts:
                return False
            
            alert = self.active_alerts[alert_id]
            alert.status = AlertStatus.ACKNOWLEDGED
            alert.acknowledged_at = datetime.utcnow()
            alert.acknowledged_by = acknowledged_by
            
            # Store in database
            await self._store_alert(alert)
            
            # Log acknowledgment
            await audit_service.log_event(
                action=AuditAction.SYSTEM_START,  # Reuse for acknowledgment
                user_id=acknowledged_by,
                resource_type="alert",
                resource_id=alert_id,
                security_context={
                    "alert_severity": alert.severity.value,
                    "rule_id": alert.rule_id
                }
            )
            
            logger.info(f"Alert {alert_id} acknowledged by {acknowledged_by}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to acknowledge alert: {e}")
            return False
    
    async def resolve_alert(
        self,
        alert_id: str,
        resolved_by: str
    ) -> bool:
        """Resolve an alert"""
        try:
            if alert_id not in self.active_alerts:
                return False
            
            alert = self.active_alerts[alert_id]
            alert.status = AlertStatus.RESOLVED
            alert.resolved_at = datetime.utcnow()
            alert.resolved_by = resolved_by
            
            # Store in database
            await self._store_alert(alert)
            
            # Remove from active alerts
            del self.active_alerts[alert_id]
            
            # Log resolution
            await audit_service.log_event(
                action=AuditAction.SYSTEM_START,  # Reuse for resolution
                user_id=resolved_by,
                resource_type="alert",
                resource_id=alert_id,
                security_context={
                    "alert_severity": alert.severity.value,
                    "rule_id": alert.rule_id
                }
            )
            
            logger.info(f"Alert {alert_id} resolved by {resolved_by}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to resolve alert: {e}")
            return False
    
    async def _monitor_alerts_loop(self):
        """Background task to monitor alerts"""
        while self.is_running:
            try:
                await self._check_alerts()
                await asyncio.sleep(30)  # Check every 30 seconds
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in alert monitoring loop: {e}")
    
    async def _check_alerts(self):
        """Check all alert rules and trigger alerts if needed"""
        try:
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(minutes=5)  # Check last 5 minutes
            
            for rule in self.alert_rules.values():
                if not rule.is_enabled:
                    continue
                
                # Get metrics for this rule
                metrics = await metrics_collector.get_metrics(
                    category=rule.category,
                    name=rule.metric_name,
                    start_time=start_time,
                    end_time=end_time,
                    limit=100
                )
                
                if not metrics:
                    continue
                
                # Check if alert should be triggered
                for metric in metrics:
                    if self._should_trigger_alert(rule, metric):
                        await self._trigger_alert(rule, metric)
                    else:
                        await self._check_alert_resolution(rule, metric)
                        
        except Exception as e:
            logger.error(f"Error checking alerts: {e}")
    
    def _should_trigger_alert(self, rule: AlertRule, metric: Dict[str, Any]) -> bool:
        """Check if an alert should be triggered for a metric"""
        try:
            metric_value = float(metric["value"])
            threshold = rule.threshold
            
            conditions = {
                AlertCondition.GREATER_THAN: metric_value > threshold,
                AlertCondition.LESS_THAN: metric_value < threshold,
                AlertCondition.EQUALS: metric_value == threshold,
                AlertCondition.NOT_EQUALS: metric_value != threshold,
                AlertCondition.GREATER_THAN_OR_EQUAL: metric_value >= threshold,
                AlertCondition.LESS_THAN_OR_EQUAL: metric_value <= threshold,
                AlertCondition.CONTAINS: str(metric_value).find(str(threshold)) != -1,
                AlertCondition.NOT_CONTAINS: str(metric_value).find(str(threshold)) == -1
            }
            
            return conditions.get(rule.condition, False)
            
        except (ValueError, TypeError):
            return False
    
    async def _trigger_alert(self, rule: AlertRule, metric: Dict[str, Any]):
        """Trigger an alert"""
        try:
            alert_id = f"alert_{int(datetime.utcnow().timestamp())}"
            
            # Check if alert already exists for this rule
            existing_alert = None
            for alert in self.active_alerts.values():
                if alert.rule_id == rule.id and alert.status == AlertStatus.ACTIVE:
                    existing_alert = alert
                    break
            
            if existing_alert:
                return  # Alert already active
            
            alert = Alert(
                id=alert_id,
                rule_id=rule.id,
                severity=rule.severity,
                status=AlertStatus.ACTIVE,
                message=f"{rule.name}: {rule.description}",
                metric_value=float(metric["value"]),
                threshold=rule.threshold,
                triggered_at=datetime.utcnow(),
                acknowledged_at=None,
                resolved_at=None,
                acknowledged_by=None,
                resolved_by=None,
                metadata={
                    "metric_labels": metric.get("labels", {}),
                    "user_id": metric.get("user_id"),
                    "session_id": metric.get("session_id")
                }
            )
            
            self.active_alerts[alert_id] = alert
            
            # Store in database
            await self._store_alert(alert)
            
            # Send notifications
            await self._send_notifications(alert, rule)
            
            # Log alert creation
            await audit_service.log_event(
                action=AuditAction.SYSTEM_ERROR,
                resource_type="alert",
                resource_id=alert_id,
                severity=AuditSeverity.HIGH if rule.severity == AlertSeverity.CRITICAL else AuditSeverity.MEDIUM,
                security_context={
                    "rule_name": rule.name,
                    "metric_name": rule.metric_name,
                    "metric_value": alert.metric_value,
                    "threshold": alert.threshold
                }
            )
            
            logger.warning(f"Alert triggered: {rule.name} - {alert.message}")
            
        except Exception as e:
            logger.error(f"Failed to trigger alert: {e}")
    
    async def _check_alert_resolution(self, rule: AlertRule, metric: Dict[str, Any]):
        """Check if an active alert should be resolved"""
        try:
            # Find active alert for this rule
            for alert in self.active_alerts.values():
                if alert.rule_id == rule.id and alert.status == AlertStatus.ACTIVE:
                    # Check if condition is no longer met
                    if not self._should_trigger_alert(rule, metric):
                        # Auto-resolve if condition is no longer met
                        alert.status = AlertStatus.RESOLVED
                        alert.resolved_at = datetime.utcnow()
                        alert.resolved_by = "system"
                        
                        # Store in database
                        await self._store_alert(alert)
                        
                        # Remove from active alerts
                        del self.active_alerts[alert.id]
                        
                        logger.info(f"Alert auto-resolved: {alert.id}")
                        
        except Exception as e:
            logger.error(f"Failed to check alert resolution: {e}")
    
    async def _send_notifications(self, alert: Alert, rule: AlertRule):
        """Send notifications for an alert"""
        try:
            for channel in rule.notification_channels:
                if channel in self.notification_handlers:
                    handler = self.notification_handlers[channel]
                    await handler(alert, rule)
                else:
                    # Default notification handler
                    await self._default_notification_handler(alert, rule, channel)
                    
        except Exception as e:
            logger.error(f"Failed to send notifications: {e}")
    
    async def _default_notification_handler(
        self, 
        alert: Alert, 
        rule: AlertRule, 
        channel: str
    ):
        """Default notification handler"""
        logger.warning(f"ALERT [{alert.severity.value.upper()}] {rule.name}: {alert.message}")
        logger.warning(f"Metric: {rule.metric_name} = {alert.metric_value} (threshold: {alert.threshold})")
        logger.warning(f"Channel: {channel}")
    
    def register_notification_handler(
        self, 
        channel: str, 
        handler: Callable[[Alert, AlertRule], None]
    ):
        """Register a notification handler for a channel"""
        self.notification_handlers[channel] = handler
    
    async def _load_alert_rules(self):
        """Load alert rules from database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, name, description, metric_name, category, condition,
                               threshold, severity, duration_minutes, is_enabled, labels,
                               notification_channels, created_at, updated_at
                        FROM alert_rules
                        WHERE is_enabled = TRUE
                    """)
                    
                    for row in cursor.fetchall():
                        rule = AlertRule(
                            id=row[0],
                            name=row[1],
                            description=row[2],
                            metric_name=row[3],
                            category=MetricCategory(row[4]),
                            condition=AlertCondition(row[5]),
                            threshold=float(row[6]),
                            severity=AlertSeverity(row[7]),
                            duration_minutes=row[8],
                            is_enabled=row[9],
                            labels=json.loads(row[10]) if row[10] else {},
                            notification_channels=json.loads(row[11]) if row[11] else [],
                            created_at=row[12],
                            updated_at=row[13]
                        )
                        
                        self.alert_rules[rule.id] = rule
                        
        except Exception as e:
            logger.error(f"Failed to load alert rules: {e}")
    
    async def _store_alert_rule(self, rule: AlertRule):
        """Store alert rule in database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO alert_rules (
                            id, name, description, metric_name, category, condition,
                            threshold, severity, duration_minutes, is_enabled, labels,
                            notification_channels, created_at, updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            description = EXCLUDED.description,
                            metric_name = EXCLUDED.metric_name,
                            category = EXCLUDED.category,
                            condition = EXCLUDED.condition,
                            threshold = EXCLUDED.threshold,
                            severity = EXCLUDED.severity,
                            duration_minutes = EXCLUDED.duration_minutes,
                            is_enabled = EXCLUDED.is_enabled,
                            labels = EXCLUDED.labels,
                            notification_channels = EXCLUDED.notification_channels,
                            updated_at = EXCLUDED.updated_at
                    """, (
                        rule.id, rule.name, rule.description, rule.metric_name,
                        rule.category.value, rule.condition.value, rule.threshold,
                        rule.severity.value, rule.duration_minutes, rule.is_enabled,
                        json.dumps(rule.labels), json.dumps(rule.notification_channels),
                        rule.created_at, rule.updated_at
                    ))
                    
        except Exception as e:
            logger.error(f"Failed to store alert rule: {e}")
    
    async def _store_alert(self, alert: Alert):
        """Store alert in database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO alerts (
                            id, rule_id, severity, status, message, metric_value,
                            threshold, triggered_at, acknowledged_at, resolved_at,
                            acknowledged_by, resolved_by, metadata
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            status = EXCLUDED.status,
                            acknowledged_at = EXCLUDED.acknowledged_at,
                            resolved_at = EXCLUDED.resolved_at,
                            acknowledged_by = EXCLUDED.acknowledged_by,
                            resolved_by = EXCLUDED.resolved_by,
                            metadata = EXCLUDED.metadata
                    """, (
                        alert.id, alert.rule_id, alert.severity.value, alert.status.value,
                        alert.message, alert.metric_value, alert.threshold, alert.triggered_at,
                        alert.acknowledged_at, alert.resolved_at, alert.acknowledged_by,
                        alert.resolved_by, json.dumps(alert.metadata)
                    ))
                    
        except Exception as e:
            logger.error(f"Failed to store alert: {e}")

# Global alerting system instance
alerting_system = AlertingSystem()
