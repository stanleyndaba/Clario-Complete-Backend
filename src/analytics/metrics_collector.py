"""
Metrics Collector Service
Phase 7: Real-time metrics collection and aggregation for analytics and monitoring
"""

import asyncio
import time
import json
from typing import Dict, Any, List, Optional, Union
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass, asdict
from enum import Enum
import uuid

from src.common.db_postgresql import DatabaseManager
from src.common.config import settings
from src.security.audit_service import audit_service, AuditAction, AuditSeverity

logger = logging.getLogger(__name__)

class MetricType(str, Enum):
    """Types of metrics collected"""
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    SUMMARY = "summary"
    TIMER = "timer"

class MetricCategory(str, Enum):
    """Categories of metrics"""
    SYSTEM = "system"
    USER = "user"
    EVIDENCE = "evidence"
    DISPUTE = "dispute"
    SUBMISSION = "submission"
    PROOF_PACKET = "proof_packet"
    PROMPT = "prompt"
    PARSER = "parser"
    MATCHING = "matching"
    API = "api"
    WEBSOCKET = "websocket"

@dataclass
class MetricData:
    """Metric data structure"""
    id: str
    name: str
    value: Union[int, float, str]
    metric_type: MetricType
    category: MetricCategory
    labels: Dict[str, str]
    timestamp: datetime
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class MetricsCollector:
    """Service for collecting and aggregating metrics"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.metrics_buffer = []
        self.buffer_size = 1000
        self.flush_interval = 30  # seconds
        self.metrics_task = None
        self.is_running = False
        
    async def start(self):
        """Start the metrics collector"""
        if self.is_running:
            return
            
        self.is_running = True
        self.metrics_task = asyncio.create_task(self._flush_metrics_loop())
        logger.info("Metrics collector started")
    
    async def stop(self):
        """Stop the metrics collector"""
        self.is_running = False
        if self.metrics_task:
            self.metrics_task.cancel()
            try:
                await self.metrics_task
            except asyncio.CancelledError:
                pass
        
        # Flush remaining metrics
        await self._flush_metrics()
        logger.info("Metrics collector stopped")
    
    async def record_metric(
        self,
        name: str,
        value: Union[int, float, str],
        metric_type: MetricType = MetricType.COUNTER,
        category: MetricCategory = MetricCategory.SYSTEM,
        labels: Optional[Dict[str, str]] = None,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Record a metric"""
        try:
            metric = MetricData(
                id=str(uuid.uuid4()),
                name=name,
                value=value,
                metric_type=metric_type,
                category=category,
                labels=labels or {},
                timestamp=datetime.utcnow(),
                user_id=user_id,
                session_id=session_id,
                metadata=metadata
            )
            
            self.metrics_buffer.append(metric)
            
            # Flush if buffer is full
            if len(self.metrics_buffer) >= self.buffer_size:
                await self._flush_metrics()
                
        except Exception as e:
            logger.error(f"Failed to record metric {name}: {e}")
    
    async def increment_counter(
        self,
        name: str,
        category: MetricCategory = MetricCategory.SYSTEM,
        labels: Optional[Dict[str, str]] = None,
        value: int = 1,
        user_id: Optional[str] = None
    ):
        """Increment a counter metric"""
        await self.record_metric(
            name=name,
            value=value,
            metric_type=MetricType.COUNTER,
            category=category,
            labels=labels,
            user_id=user_id
        )
    
    async def set_gauge(
        self,
        name: str,
        value: Union[int, float],
        category: MetricCategory = MetricCategory.SYSTEM,
        labels: Optional[Dict[str, str]] = None,
        user_id: Optional[str] = None
    ):
        """Set a gauge metric"""
        await self.record_metric(
            name=name,
            value=value,
            metric_type=MetricType.GAUGE,
            category=category,
            labels=labels,
            user_id=user_id
        )
    
    async def record_histogram(
        self,
        name: str,
        value: Union[int, float],
        category: MetricCategory = MetricCategory.SYSTEM,
        labels: Optional[Dict[str, str]] = None,
        user_id: Optional[str] = None
    ):
        """Record a histogram metric"""
        await self.record_metric(
            name=name,
            value=value,
            metric_type=MetricType.HISTOGRAM,
            category=category,
            labels=labels,
            user_id=user_id
        )
    
    async def record_timer(
        self,
        name: str,
        duration_ms: float,
        category: MetricCategory = MetricCategory.SYSTEM,
        labels: Optional[Dict[str, str]] = None,
        user_id: Optional[str] = None
    ):
        """Record a timer metric"""
        await self.record_metric(
            name=name,
            value=duration_ms,
            metric_type=MetricType.TIMER,
            category=category,
            labels=labels,
            user_id=user_id
        )
    
    async def _flush_metrics_loop(self):
        """Background task to flush metrics periodically"""
        while self.is_running:
            try:
                await asyncio.sleep(self.flush_interval)
                await self._flush_metrics()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in metrics flush loop: {e}")
    
    async def _flush_metrics(self):
        """Flush buffered metrics to database"""
        if not self.metrics_buffer:
            return
        
        try:
            metrics_to_flush = self.metrics_buffer.copy()
            self.metrics_buffer.clear()
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    for metric in metrics_to_flush:
                        cursor.execute("""
                            INSERT INTO metrics_data (
                                id, name, value, metric_type, category, labels,
                                user_id, session_id, timestamp, metadata
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            metric.id, metric.name, metric.value, metric.metric_type.value,
                            metric.category.value, json.dumps(metric.labels),
                            metric.user_id, metric.session_id, metric.timestamp,
                            json.dumps(metric.metadata) if metric.metadata else None
                        ))
            
            logger.debug(f"Flushed {len(metrics_to_flush)} metrics to database")
            
        except Exception as e:
            logger.error(f"Failed to flush metrics: {e}")
            # Put metrics back in buffer for retry
            self.metrics_buffer.extend(metrics_to_flush)
    
    async def get_metrics(
        self,
        category: Optional[MetricCategory] = None,
        name: Optional[str] = None,
        user_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 1000
    ) -> List[Dict[str, Any]]:
        """Get metrics with filtering"""
        try:
            where_conditions = []
            params = []
            
            if category:
                where_conditions.append("category = %s")
                params.append(category.value)
            
            if name:
                where_conditions.append("name = %s")
                params.append(name)
            
            if user_id:
                where_conditions.append("user_id = %s")
                params.append(user_id)
            
            if start_time:
                where_conditions.append("timestamp >= %s")
                params.append(start_time)
            
            if end_time:
                where_conditions.append("timestamp <= %s")
                params.append(end_time)
            
            where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(f"""
                        SELECT id, name, value, metric_type, category, labels,
                               user_id, session_id, timestamp, metadata
                        FROM metrics_data
                        {where_clause}
                        ORDER BY timestamp DESC
                        LIMIT %s
                    """, params + [limit])
                    
                    metrics = []
                    for row in cursor.fetchall():
                        metrics.append({
                            "id": str(row[0]),
                            "name": row[1],
                            "value": row[2],
                            "metric_type": row[3],
                            "category": row[4],
                            "labels": json.loads(row[5]) if row[5] else {},
                            "user_id": str(row[6]) if row[6] else None,
                            "session_id": row[7],
                            "timestamp": row[8].isoformat() + "Z",
                            "metadata": json.loads(row[9]) if row[9] else {}
                        })
                    
                    return metrics
                    
        except Exception as e:
            logger.error(f"Failed to get metrics: {e}")
            return []
    
    async def get_aggregated_metrics(
        self,
        category: Optional[MetricCategory] = None,
        name: Optional[str] = None,
        user_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        group_by: str = "hour"
    ) -> Dict[str, Any]:
        """Get aggregated metrics"""
        try:
            where_conditions = []
            params = []
            
            if category:
                where_conditions.append("category = %s")
                params.append(category.value)
            
            if name:
                where_conditions.append("name = %s")
                params.append(name)
            
            if user_id:
                where_conditions.append("user_id = %s")
                params.append(user_id)
            
            if start_time:
                where_conditions.append("timestamp >= %s")
                params.append(start_time)
            
            if end_time:
                where_conditions.append("timestamp <= %s")
                params.append(end_time)
            
            where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""
            
            # Determine time grouping
            time_grouping = {
                "minute": "DATE_TRUNC('minute', timestamp)",
                "hour": "DATE_TRUNC('hour', timestamp)",
                "day": "DATE_TRUNC('day', timestamp)",
                "week": "DATE_TRUNC('week', timestamp)",
                "month": "DATE_TRUNC('month', timestamp)"
            }.get(group_by, "DATE_TRUNC('hour', timestamp)")
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(f"""
                        SELECT 
                            {time_grouping} as time_bucket,
                            name,
                            metric_type,
                            COUNT(*) as count,
                            AVG(value::numeric) as avg_value,
                            MIN(value::numeric) as min_value,
                            MAX(value::numeric) as max_value,
                            SUM(value::numeric) as sum_value
                        FROM metrics_data
                        {where_clause}
                        GROUP BY {time_grouping}, name, metric_type
                        ORDER BY time_bucket DESC
                    """, params)
                    
                    aggregated = []
                    for row in cursor.fetchall():
                        aggregated.append({
                            "time_bucket": row[0].isoformat() + "Z",
                            "name": row[1],
                            "metric_type": row[2],
                            "count": row[3],
                            "avg_value": float(row[4]) if row[4] else 0,
                            "min_value": float(row[5]) if row[5] else 0,
                            "max_value": float(row[6]) if row[6] else 0,
                            "sum_value": float(row[7]) if row[7] else 0
                        })
                    
                    return {
                        "aggregated_metrics": aggregated,
                        "group_by": group_by,
                        "total_points": len(aggregated)
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get aggregated metrics: {e}")
            return {"aggregated_metrics": [], "group_by": group_by, "total_points": 0}
    
    async def get_system_health_metrics(self) -> Dict[str, Any]:
        """Get system health metrics"""
        try:
            # Get metrics from the last hour
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(hours=1)
            
            health_metrics = {}
            
            # API response times
            api_metrics = await self.get_aggregated_metrics(
                category=MetricCategory.API,
                name="api_response_time",
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            health_metrics["api_response_times"] = api_metrics
            
            # Error rates
            error_metrics = await self.get_aggregated_metrics(
                category=MetricCategory.SYSTEM,
                name="error_count",
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            health_metrics["error_rates"] = error_metrics
            
            # Evidence processing rates
            evidence_metrics = await self.get_aggregated_metrics(
                category=MetricCategory.EVIDENCE,
                name="documents_processed",
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            health_metrics["evidence_processing"] = evidence_metrics
            
            # Dispute submission rates
            dispute_metrics = await self.get_aggregated_metrics(
                category=MetricCategory.SUBMISSION,
                name="disputes_submitted",
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            health_metrics["dispute_submissions"] = dispute_metrics
            
            return health_metrics
            
        except Exception as e:
            logger.error(f"Failed to get system health metrics: {e}")
            return {}

# Global metrics collector instance
metrics_collector = MetricsCollector()
