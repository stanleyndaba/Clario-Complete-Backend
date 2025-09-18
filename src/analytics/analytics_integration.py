"""
Analytics Integration Service
Phase 7: Integration service for real-time analytics and monitoring
"""

import asyncio
import time
from typing import Dict, Any, Optional, Callable
from datetime import datetime, timedelta
import logging
from contextlib import asynccontextmanager

from src.analytics.metrics_collector import metrics_collector, MetricCategory, MetricType
from src.analytics.monitoring_dashboard import monitoring_dashboard
from src.analytics.alerting_system import alerting_system, AlertSeverity, AlertCondition
from src.security.audit_service import audit_service, AuditAction, AuditSeverity

logger = logging.getLogger(__name__)

class AnalyticsIntegration:
    """Service for integrating analytics across all system components"""
    
    def __init__(self):
        self.metrics_collector = metrics_collector
        self.monitoring_dashboard = monitoring_dashboard
        self.alerting_system = alerting_system
        self.is_running = False
        self.background_tasks = []
        
    async def start(self):
        """Start all analytics services"""
        if self.is_running:
            return
            
        self.is_running = True
        
        # Start metrics collector
        await self.metrics_collector.start()
        
        # Start alerting system
        await self.alerting_system.start()
        
        # Start background monitoring tasks
        self.background_tasks = [
            asyncio.create_task(self._system_health_monitor()),
            asyncio.create_task(self._performance_monitor()),
            asyncio.create_task(self._user_activity_monitor()),
            asyncio.create_task(self._evidence_processing_monitor()),
            asyncio.create_task(self._dispute_submission_monitor())
        ]
        
        logger.info("Analytics integration started")
    
    async def stop(self):
        """Stop all analytics services"""
        self.is_running = False
        
        # Stop background tasks
        for task in self.background_tasks:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        
        # Stop services
        await self.metrics_collector.stop()
        await self.alerting_system.stop()
        
        logger.info("Analytics integration stopped")
    
    @asynccontextmanager
    async def track_operation(self, operation_name: str, user_id: Optional[str] = None):
        """Context manager for tracking operation performance"""
        start_time = time.time()
        success = False
        
        try:
            yield
            success = True
        except Exception as e:
            success = False
            raise
        finally:
            duration_ms = (time.time() - start_time) * 1000
            
            # Record performance benchmark
            await self._record_performance_benchmark(
                operation_name, duration_ms, success, user_id
            )
            
            # Record metrics
            await self.metrics_collector.record_timer(
                name=f"{operation_name}_duration",
                duration_ms=duration_ms,
                category=MetricCategory.SYSTEM,
                user_id=user_id
            )
            
            await self.metrics_collector.increment_counter(
                name=f"{operation_name}_count",
                category=MetricCategory.SYSTEM,
                labels={"success": str(success)},
                user_id=user_id
            )
    
    async def track_api_request(
        self,
        endpoint: str,
        method: str,
        status_code: int,
        duration_ms: float,
        user_id: Optional[str] = None
    ):
        """Track API request metrics"""
        try:
            # Record API metrics
            await self.metrics_collector.record_timer(
                name="api_response_time",
                duration_ms=duration_ms,
                category=MetricCategory.API,
                labels={
                    "endpoint": endpoint,
                    "method": method,
                    "status_code": str(status_code)
                },
                user_id=user_id
            )
            
            await self.metrics_collector.increment_counter(
                name="api_requests",
                category=MetricCategory.API,
                labels={
                    "endpoint": endpoint,
                    "method": method,
                    "status_code": str(status_code)
                },
                user_id=user_id
            )
            
            # Track error rates
            if status_code >= 400:
                await self.metrics_collector.increment_counter(
                    name="api_errors",
                    category=MetricCategory.API,
                    labels={
                        "endpoint": endpoint,
                        "status_code": str(status_code)
                    },
                    user_id=user_id
                )
                
        except Exception as e:
            logger.error(f"Failed to track API request: {e}")
    
    async def track_evidence_processing(
        self,
        document_id: str,
        processing_time_ms: float,
        success: bool,
        error_message: Optional[str] = None,
        user_id: Optional[str] = None
    ):
        """Track evidence processing metrics"""
        try:
            # Record processing metrics
            await self.metrics_collector.record_timer(
                name="evidence_processing_time",
                duration_ms=processing_time_ms,
                category=MetricCategory.EVIDENCE,
                labels={"success": str(success)},
                user_id=user_id
            )
            
            await self.metrics_collector.increment_counter(
                name="documents_processed",
                category=MetricCategory.EVIDENCE,
                labels={"success": str(success)},
                user_id=user_id
            )
            
            if success:
                await self.metrics_collector.increment_counter(
                    name="parsing_success",
                    category=MetricCategory.PARSER,
                    user_id=user_id
                )
            else:
                await self.metrics_collector.increment_counter(
                    name="parsing_failure",
                    category=MetricCategory.PARSER,
                    labels={"error": error_message or "unknown"},
                    user_id=user_id
                )
                
        except Exception as e:
            logger.error(f"Failed to track evidence processing: {e}")
    
    async def track_matching_result(
        self,
        dispute_id: str,
        confidence_score: float,
        match_type: str,
        auto_submit: bool,
        user_id: Optional[str] = None
    ):
        """Track evidence matching results"""
        try:
            # Record matching metrics
            await self.metrics_collector.record_histogram(
                name="match_confidence",
                value=confidence_score,
                category=MetricCategory.MATCHING,
                labels={"match_type": match_type},
                user_id=user_id
            )
            
            await self.metrics_collector.increment_counter(
                name="matches_found",
                category=MetricCategory.MATCHING,
                labels={
                    "match_type": match_type,
                    "auto_submit": str(auto_submit)
                },
                user_id=user_id
            )
            
            if auto_submit:
                await self.metrics_collector.increment_counter(
                    name="auto_submissions",
                    category=MetricCategory.SUBMISSION,
                    user_id=user_id
                )
                
        except Exception as e:
            logger.error(f"Failed to track matching result: {e}")
    
    async def track_dispute_submission(
        self,
        submission_id: str,
        success: bool,
        processing_time_ms: float,
        error_message: Optional[str] = None,
        user_id: Optional[str] = None
    ):
        """Track dispute submission metrics"""
        try:
            # Record submission metrics
            await self.metrics_collector.record_timer(
                name="submission_processing_time",
                duration_ms=processing_time_ms,
                category=MetricCategory.SUBMISSION,
                labels={"success": str(success)},
                user_id=user_id
            )
            
            await self.metrics_collector.increment_counter(
                name="disputes_submitted",
                category=MetricCategory.SUBMISSION,
                labels={"success": str(success)},
                user_id=user_id
            )
            
            if success:
                await self.metrics_collector.increment_counter(
                    name="submission_success",
                    category=MetricCategory.SUBMISSION,
                    user_id=user_id
                )
            else:
                await self.metrics_collector.increment_counter(
                    name="submission_failure",
                    category=MetricCategory.SUBMISSION,
                    labels={"error": error_message or "unknown"},
                    user_id=user_id
                )
                
        except Exception as e:
            logger.error(f"Failed to track dispute submission: {e}")
    
    async def track_user_activity(
        self,
        action: str,
        resource_type: str,
        user_id: str,
        session_id: Optional[str] = None
    ):
        """Track user activity metrics"""
        try:
            # Record user activity
            await self.metrics_collector.increment_counter(
                name="user_actions",
                category=MetricCategory.USER,
                labels={
                    "action": action,
                    "resource_type": resource_type
                },
                user_id=user_id,
                session_id=session_id
            )
            
            # Track active users
            await self.metrics_collector.set_gauge(
                name="active_users",
                value=1,
                category=MetricCategory.USER,
                user_id=user_id,
                session_id=session_id
            )
            
        except Exception as e:
            logger.error(f"Failed to track user activity: {e}")
    
    async def track_websocket_event(
        self,
        event_type: str,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None
    ):
        """Track WebSocket events"""
        try:
            await self.metrics_collector.increment_counter(
                name="websocket_events",
                category=MetricCategory.WEBSOCKET,
                labels={"event_type": event_type},
                user_id=user_id,
                session_id=session_id
            )
            
        except Exception as e:
            logger.error(f"Failed to track WebSocket event: {e}")
    
    async def _system_health_monitor(self):
        """Background task to monitor system health"""
        while self.is_running:
            try:
                # Simulate system health metrics (in production, these would come from actual system monitoring)
                import psutil
                
                cpu_percent = psutil.cpu_percent(interval=1)
                memory = psutil.virtual_memory()
                disk = psutil.disk_usage('/')
                
                # Record system metrics
                await self.metrics_collector.set_gauge(
                    name="cpu_usage_percent",
                    value=cpu_percent,
                    category=MetricCategory.SYSTEM
                )
                
                await self.metrics_collector.set_gauge(
                    name="memory_usage_percent",
                    value=memory.percent,
                    category=MetricCategory.SYSTEM
                )
                
                await self.metrics_collector.set_gauge(
                    name="disk_usage_percent",
                    value=disk.percent,
                    category=MetricCategory.SYSTEM
                )
                
                # Calculate error rate (simplified)
                error_rate = 0.01  # 1% error rate for demo
                await self.metrics_collector.set_gauge(
                    name="error_rate",
                    value=error_rate,
                    category=MetricCategory.SYSTEM
                )
                
                await asyncio.sleep(60)  # Check every minute
                
            except Exception as e:
                logger.error(f"Error in system health monitor: {e}")
                await asyncio.sleep(60)
    
    async def _performance_monitor(self):
        """Background task to monitor performance"""
        while self.is_running:
            try:
                # Get performance metrics from database
                # This would typically query actual performance data
                
                await asyncio.sleep(300)  # Check every 5 minutes
                
            except Exception as e:
                logger.error(f"Error in performance monitor: {e}")
                await asyncio.sleep(300)
    
    async def _user_activity_monitor(self):
        """Background task to monitor user activity"""
        while self.is_running:
            try:
                # Track active users
                # This would typically query active sessions
                
                await asyncio.sleep(60)  # Check every minute
                
            except Exception as e:
                logger.error(f"Error in user activity monitor: {e}")
                await asyncio.sleep(60)
    
    async def _evidence_processing_monitor(self):
        """Background task to monitor evidence processing"""
        while self.is_running:
            try:
                # Monitor evidence processing metrics
                # This would typically query processing queues and results
                
                await asyncio.sleep(120)  # Check every 2 minutes
                
            except Exception as e:
                logger.error(f"Error in evidence processing monitor: {e}")
                await asyncio.sleep(120)
    
    async def _dispute_submission_monitor(self):
        """Background task to monitor dispute submissions"""
        while self.is_running:
            try:
                # Monitor dispute submission metrics
                # This would typically query submission queues and results
                
                await asyncio.sleep(180)  # Check every 3 minutes
                
            except Exception as e:
                logger.error(f"Error in dispute submission monitor: {e}")
                await asyncio.sleep(180)
    
    async def _record_performance_benchmark(
        self,
        operation_name: str,
        duration_ms: float,
        success: bool,
        user_id: Optional[str] = None
    ):
        """Record performance benchmark data"""
        try:
            from src.common.db_postgresql import DatabaseManager
            db = DatabaseManager()
            
            with db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO performance_benchmarks 
                        (operation_name, duration_ms, success, user_id, created_at)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (operation_name, duration_ms, success, user_id, datetime.utcnow()))
                    
        except Exception as e:
            logger.error(f"Failed to record performance benchmark: {e}")
    
    async def get_analytics_summary(self) -> Dict[str, Any]:
        """Get comprehensive analytics summary"""
        try:
            # Get system health
            system_health = await self.metrics_collector.get_system_health_metrics()
            
            # Get active alerts
            active_alerts = await self.alerting_system.get_active_alerts()
            
            # Get dashboard overview
            dashboard_overview = await self.monitoring_dashboard.get_system_overview()
            
            return {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "system_health": system_health,
                "active_alerts": active_alerts,
                "dashboard_overview": dashboard_overview,
                "services_status": {
                    "metrics_collector": self.metrics_collector.is_running,
                    "alerting_system": self.alerting_system.is_running,
                    "monitoring_dashboard": True
                }
            }
            
        except Exception as e:
            logger.error(f"Failed to get analytics summary: {e}")
            return {"error": str(e)}

# Global analytics integration instance
analytics_integration = AnalyticsIntegration()
