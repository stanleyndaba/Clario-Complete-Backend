"""
Monitoring Dashboard Service
Phase 7: Real-time monitoring dashboards and visualizations
"""

import asyncio
import json
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass

from src.common.db_postgresql import DatabaseManager
from src.analytics.metrics_collector import metrics_collector, MetricCategory
from src.security.audit_service import audit_service, AuditSeverity

logger = logging.getLogger(__name__)

@dataclass
class DashboardWidget:
    """Dashboard widget configuration"""
    id: str
    title: str
    widget_type: str
    metric_name: str
    category: MetricCategory
    time_range: str
    aggregation: str
    chart_type: str
    position: Dict[str, int]
    size: Dict[str, int]
    config: Dict[str, Any]

class MonitoringDashboard:
    """Service for monitoring dashboards and visualizations"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.dashboards = {}
        self._initialize_default_dashboards()
    
    def _initialize_default_dashboards(self):
        """Initialize default monitoring dashboards"""
        
        # System Health Dashboard
        self.dashboards["system_health"] = {
            "id": "system_health",
            "name": "System Health",
            "description": "Real-time system health monitoring",
            "widgets": [
                {
                    "id": "cpu_usage",
                    "title": "CPU Usage",
                    "widget_type": "gauge",
                    "metric_name": "cpu_usage_percent",
                    "category": "system",
                    "time_range": "1h",
                    "aggregation": "avg",
                    "chart_type": "gauge",
                    "position": {"x": 0, "y": 0},
                    "size": {"width": 6, "height": 4},
                    "config": {"min": 0, "max": 100, "thresholds": [70, 90]}
                },
                {
                    "id": "memory_usage",
                    "title": "Memory Usage",
                    "widget_type": "gauge",
                    "metric_name": "memory_usage_percent",
                    "category": "system",
                    "time_range": "1h",
                    "aggregation": "avg",
                    "chart_type": "gauge",
                    "position": {"x": 6, "y": 0},
                    "size": {"width": 6, "height": 4},
                    "config": {"min": 0, "max": 100, "thresholds": [80, 95]}
                },
                {
                    "id": "api_response_times",
                    "title": "API Response Times",
                    "widget_type": "line_chart",
                    "metric_name": "api_response_time",
                    "category": "api",
                    "time_range": "1h",
                    "aggregation": "avg",
                    "chart_type": "line",
                    "position": {"x": 0, "y": 4},
                    "size": {"width": 12, "height": 4},
                    "config": {"y_axis_label": "Response Time (ms)"}
                },
                {
                    "id": "error_rates",
                    "title": "Error Rates",
                    "widget_type": "bar_chart",
                    "metric_name": "error_count",
                    "category": "system",
                    "time_range": "1h",
                    "aggregation": "sum",
                    "chart_type": "bar",
                    "position": {"x": 0, "y": 8},
                    "size": {"width": 6, "height": 4},
                    "config": {"y_axis_label": "Error Count"}
                },
                {
                    "id": "active_users",
                    "title": "Active Users",
                    "widget_type": "counter",
                    "metric_name": "active_users",
                    "category": "user",
                    "time_range": "1h",
                    "aggregation": "max",
                    "chart_type": "counter",
                    "position": {"x": 6, "y": 8},
                    "size": {"width": 6, "height": 4},
                    "config": {"color": "green"}
                }
            ]
        }
        
        # Evidence Processing Dashboard
        self.dashboards["evidence_processing"] = {
            "id": "evidence_processing",
            "name": "Evidence Processing",
            "description": "Evidence ingestion and processing metrics",
            "widgets": [
                {
                    "id": "documents_processed",
                    "title": "Documents Processed",
                    "widget_type": "line_chart",
                    "metric_name": "documents_processed",
                    "category": "evidence",
                    "time_range": "24h",
                    "aggregation": "sum",
                    "chart_type": "line",
                    "position": {"x": 0, "y": 0},
                    "size": {"width": 12, "height": 4},
                    "config": {"y_axis_label": "Documents per Hour"}
                },
                {
                    "id": "parsing_success_rate",
                    "title": "Parsing Success Rate",
                    "widget_type": "gauge",
                    "metric_name": "parsing_success_rate",
                    "category": "parser",
                    "time_range": "1h",
                    "aggregation": "avg",
                    "chart_type": "gauge",
                    "position": {"x": 0, "y": 4},
                    "size": {"width": 4, "height": 4},
                    "config": {"min": 0, "max": 100, "thresholds": [85, 95]}
                },
                {
                    "id": "matching_confidence_distribution",
                    "title": "Matching Confidence Distribution",
                    "widget_type": "histogram",
                    "metric_name": "match_confidence",
                    "category": "matching",
                    "time_range": "24h",
                    "aggregation": "count",
                    "chart_type": "histogram",
                    "position": {"x": 4, "y": 4},
                    "size": {"width": 8, "height": 4},
                    "config": {"bins": 20, "x_axis_label": "Confidence Score"}
                },
                {
                    "id": "evidence_types",
                    "title": "Evidence Types",
                    "widget_type": "pie_chart",
                    "metric_name": "evidence_type_count",
                    "category": "evidence",
                    "time_range": "24h",
                    "aggregation": "sum",
                    "chart_type": "pie",
                    "position": {"x": 0, "y": 8},
                    "size": {"width": 6, "height": 4},
                    "config": {"show_legend": True}
                },
                {
                    "id": "processing_errors",
                    "title": "Processing Errors",
                    "widget_type": "bar_chart",
                    "metric_name": "processing_error_count",
                    "category": "evidence",
                    "time_range": "24h",
                    "aggregation": "sum",
                    "chart_type": "bar",
                    "position": {"x": 6, "y": 8},
                    "size": {"width": 6, "height": 4},
                    "config": {"y_axis_label": "Error Count"}
                }
            ]
        }
        
        # Dispute Submissions Dashboard
        self.dashboards["dispute_submissions"] = {
            "id": "dispute_submissions",
            "name": "Dispute Submissions",
            "description": "Dispute submission and processing metrics",
            "widgets": [
                {
                    "id": "submissions_timeline",
                    "title": "Submissions Timeline",
                    "widget_type": "line_chart",
                    "metric_name": "disputes_submitted",
                    "category": "submission",
                    "time_range": "24h",
                    "aggregation": "sum",
                    "chart_type": "line",
                    "position": {"x": 0, "y": 0},
                    "size": {"width": 12, "height": 4},
                    "config": {"y_axis_label": "Submissions per Hour"}
                },
                {
                    "id": "submission_success_rate",
                    "title": "Submission Success Rate",
                    "widget_type": "gauge",
                    "metric_name": "submission_success_rate",
                    "category": "submission",
                    "time_range": "1h",
                    "aggregation": "avg",
                    "chart_type": "gauge",
                    "position": {"x": 0, "y": 4},
                    "size": {"width": 4, "height": 4},
                    "config": {"min": 0, "max": 100, "thresholds": [90, 95]}
                },
                {
                    "id": "auto_vs_manual_submissions",
                    "title": "Auto vs Manual Submissions",
                    "widget_type": "pie_chart",
                    "metric_name": "submission_type_count",
                    "category": "submission",
                    "time_range": "24h",
                    "aggregation": "sum",
                    "chart_type": "pie",
                    "position": {"x": 4, "y": 4},
                    "size": {"width": 8, "height": 4},
                    "config": {"show_legend": True}
                },
                {
                    "id": "submission_status_distribution",
                    "title": "Submission Status Distribution",
                    "widget_type": "bar_chart",
                    "metric_name": "submission_status_count",
                    "category": "submission",
                    "time_range": "24h",
                    "aggregation": "sum",
                    "chart_type": "bar",
                    "position": {"x": 0, "y": 8},
                    "size": {"width": 12, "height": 4},
                    "config": {"y_axis_label": "Count"}
                }
            ]
        }
        
        # User Activity Dashboard
        self.dashboards["user_activity"] = {
            "id": "user_activity",
            "name": "User Activity",
            "description": "User interaction and activity metrics",
            "widgets": [
                {
                    "id": "active_users_timeline",
                    "title": "Active Users Timeline",
                    "widget_type": "line_chart",
                    "metric_name": "active_users",
                    "category": "user",
                    "time_range": "24h",
                    "aggregation": "max",
                    "chart_type": "line",
                    "position": {"x": 0, "y": 0},
                    "size": {"width": 12, "height": 4},
                    "config": {"y_axis_label": "Active Users"}
                },
                {
                    "id": "user_actions",
                    "title": "User Actions",
                    "widget_type": "bar_chart",
                    "metric_name": "user_action_count",
                    "category": "user",
                    "time_range": "24h",
                    "aggregation": "sum",
                    "chart_type": "bar",
                    "position": {"x": 0, "y": 4},
                    "size": {"width": 6, "height": 4},
                    "config": {"y_axis_label": "Action Count"}
                },
                {
                    "id": "session_duration",
                    "title": "Average Session Duration",
                    "widget_type": "gauge",
                    "metric_name": "session_duration_minutes",
                    "category": "user",
                    "time_range": "1h",
                    "aggregation": "avg",
                    "chart_type": "gauge",
                    "position": {"x": 6, "y": 4},
                    "size": {"width": 6, "height": 4},
                    "config": {"min": 0, "max": 120, "thresholds": [30, 60]}
                },
                {
                    "id": "top_users",
                    "title": "Top Active Users",
                    "widget_type": "table",
                    "metric_name": "user_activity_count",
                    "category": "user",
                    "time_range": "24h",
                    "aggregation": "sum",
                    "chart_type": "table",
                    "position": {"x": 0, "y": 8},
                    "size": {"width": 12, "height": 4},
                    "config": {"columns": ["user_id", "action_count", "last_activity"]}
                }
            ]
        }
    
    async def get_dashboard(self, dashboard_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific dashboard"""
        return self.dashboards.get(dashboard_id)
    
    async def get_all_dashboards(self) -> List[Dict[str, Any]]:
        """Get all available dashboards"""
        return list(self.dashboards.values())
    
    async def get_dashboard_data(
        self, 
        dashboard_id: str, 
        time_range: str = "1h"
    ) -> Dict[str, Any]:
        """Get dashboard data with metrics"""
        dashboard = await self.get_dashboard(dashboard_id)
        if not dashboard:
            return {}
        
        # Calculate time range
        end_time = datetime.utcnow()
        start_time = self._calculate_start_time(time_range, end_time)
        
        dashboard_data = {
            "dashboard": dashboard,
            "data": {},
            "generated_at": end_time.isoformat() + "Z",
            "time_range": time_range
        }
        
        # Get data for each widget
        for widget in dashboard["widgets"]:
            try:
                widget_data = await self._get_widget_data(widget, start_time, end_time)
                dashboard_data["data"][widget["id"]] = widget_data
            except Exception as e:
                logger.error(f"Failed to get data for widget {widget['id']}: {e}")
                dashboard_data["data"][widget["id"]] = {"error": str(e)}
        
        return dashboard_data
    
    async def _get_widget_data(
        self, 
        widget: Dict[str, Any], 
        start_time: datetime, 
        end_time: datetime
    ) -> Dict[str, Any]:
        """Get data for a specific widget"""
        widget_type = widget["widget_type"]
        metric_name = widget["metric_name"]
        category = MetricCategory(widget["category"])
        aggregation = widget["aggregation"]
        
        if widget_type == "gauge":
            # Get latest value for gauge
            metrics = await metrics_collector.get_metrics(
                category=category,
                name=metric_name,
                start_time=start_time,
                end_time=end_time,
                limit=1
            )
            
            if metrics:
                return {
                    "value": metrics[0]["value"],
                    "timestamp": metrics[0]["timestamp"]
                }
            else:
                return {"value": 0, "timestamp": end_time.isoformat() + "Z"}
        
        elif widget_type in ["line_chart", "bar_chart", "histogram"]:
            # Get time series data
            group_by = "minute" if (end_time - start_time).total_seconds() < 3600 else "hour"
            
            aggregated = await metrics_collector.get_aggregated_metrics(
                category=category,
                name=metric_name,
                start_time=start_time,
                end_time=end_time,
                group_by=group_by
            )
            
            return {
                "data": aggregated["aggregated_metrics"],
                "group_by": group_by
            }
        
        elif widget_type == "pie_chart":
            # Get distribution data
            metrics = await metrics_collector.get_metrics(
                category=category,
                name=metric_name,
                start_time=start_time,
                end_time=end_time,
                limit=100
            )
            
            # Group by labels for pie chart
            distribution = {}
            for metric in metrics:
                labels = metric["labels"]
                if labels:
                    key = list(labels.values())[0]  # Use first label value as key
                    distribution[key] = distribution.get(key, 0) + float(metric["value"])
            
            return {
                "data": [{"label": k, "value": v} for k, v in distribution.items()]
            }
        
        elif widget_type == "counter":
            # Get total count
            aggregated = await metrics_collector.get_aggregated_metrics(
                category=category,
                name=metric_name,
                start_time=start_time,
                end_time=end_time,
                group_by="hour"
            )
            
            total = sum(item["sum_value"] for item in aggregated["aggregated_metrics"])
            return {"value": total}
        
        elif widget_type == "table":
            # Get table data
            metrics = await metrics_collector.get_metrics(
                category=category,
                name=metric_name,
                start_time=start_time,
                end_time=end_time,
                limit=50
            )
            
            # Group and aggregate for table
            table_data = {}
            for metric in metrics:
                labels = metric["labels"]
                if labels:
                    key = labels.get("user_id", "unknown")
                    if key not in table_data:
                        table_data[key] = {
                            "user_id": key,
                            "action_count": 0,
                            "last_activity": metric["timestamp"]
                        }
                    table_data[key]["action_count"] += float(metric["value"])
            
            return {
                "data": list(table_data.values())[:10]  # Top 10
            }
        
        return {"error": "Unknown widget type"}
    
    def _calculate_start_time(self, time_range: str, end_time: datetime) -> datetime:
        """Calculate start time based on time range string"""
        time_ranges = {
            "5m": timedelta(minutes=5),
            "15m": timedelta(minutes=15),
            "30m": timedelta(minutes=30),
            "1h": timedelta(hours=1),
            "3h": timedelta(hours=3),
            "6h": timedelta(hours=6),
            "12h": timedelta(hours=12),
            "24h": timedelta(hours=24),
            "7d": timedelta(days=7),
            "30d": timedelta(days=30)
        }
        
        delta = time_ranges.get(time_range, timedelta(hours=1))
        return end_time - delta
    
    async def create_custom_dashboard(
        self,
        dashboard_id: str,
        name: str,
        description: str,
        widgets: List[Dict[str, Any]]
    ) -> bool:
        """Create a custom dashboard"""
        try:
            self.dashboards[dashboard_id] = {
                "id": dashboard_id,
                "name": name,
                "description": description,
                "widgets": widgets,
                "custom": True
            }
            
            # Log dashboard creation
            await audit_service.log_event(
                action="dashboard_created",
                resource_type="monitoring_dashboard",
                resource_id=dashboard_id,
                security_context={
                    "dashboard_name": name,
                    "widget_count": len(widgets)
                }
            )
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to create custom dashboard: {e}")
            return False
    
    async def get_system_overview(self) -> Dict[str, Any]:
        """Get system overview metrics"""
        try:
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(hours=1)
            
            # Get key metrics
            overview = {
                "timestamp": end_time.isoformat() + "Z",
                "system_health": {},
                "evidence_processing": {},
                "dispute_submissions": {},
                "user_activity": {}
            }
            
            # System health metrics
            system_metrics = await metrics_collector.get_aggregated_metrics(
                category=MetricCategory.SYSTEM,
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            overview["system_health"] = {
                "total_metrics": len(system_metrics["aggregated_metrics"]),
                "avg_cpu": self._get_metric_avg(system_metrics, "cpu_usage_percent"),
                "avg_memory": self._get_metric_avg(system_metrics, "memory_usage_percent"),
                "error_count": self._get_metric_sum(system_metrics, "error_count")
            }
            
            # Evidence processing metrics
            evidence_metrics = await metrics_collector.get_aggregated_metrics(
                category=MetricCategory.EVIDENCE,
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            overview["evidence_processing"] = {
                "documents_processed": self._get_metric_sum(evidence_metrics, "documents_processed"),
                "parsing_success_rate": self._get_metric_avg(evidence_metrics, "parsing_success_rate"),
                "avg_processing_time": self._get_metric_avg(evidence_metrics, "processing_time_ms")
            }
            
            # Dispute submission metrics
            submission_metrics = await metrics_collector.get_aggregated_metrics(
                category=MetricCategory.SUBMISSION,
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            overview["dispute_submissions"] = {
                "total_submissions": self._get_metric_sum(submission_metrics, "disputes_submitted"),
                "success_rate": self._get_metric_avg(submission_metrics, "submission_success_rate"),
                "avg_submission_time": self._get_metric_avg(submission_metrics, "submission_time_ms")
            }
            
            # User activity metrics
            user_metrics = await metrics_collector.get_aggregated_metrics(
                category=MetricCategory.USER,
                start_time=start_time,
                end_time=end_time,
                group_by="minute"
            )
            overview["user_activity"] = {
                "active_users": self._get_metric_max(user_metrics, "active_users"),
                "total_actions": self._get_metric_sum(user_metrics, "user_action_count"),
                "avg_session_duration": self._get_metric_avg(user_metrics, "session_duration_minutes")
            }
            
            return overview
            
        except Exception as e:
            logger.error(f"Failed to get system overview: {e}")
            return {"error": str(e)}
    
    def _get_metric_avg(self, metrics_data: Dict[str, Any], metric_name: str) -> float:
        """Get average value for a specific metric"""
        for metric in metrics_data["aggregated_metrics"]:
            if metric["name"] == metric_name:
                return metric["avg_value"]
        return 0.0
    
    def _get_metric_sum(self, metrics_data: Dict[str, Any], metric_name: str) -> float:
        """Get sum value for a specific metric"""
        for metric in metrics_data["aggregated_metrics"]:
            if metric["name"] == metric_name:
                return metric["sum_value"]
        return 0.0
    
    def _get_metric_max(self, metrics_data: Dict[str, Any], metric_name: str) -> float:
        """Get max value for a specific metric"""
        for metric in metrics_data["aggregated_metrics"]:
            if metric["name"] == metric_name:
                return metric["max_value"]
        return 0.0

# Global monitoring dashboard instance
monitoring_dashboard = MonitoringDashboard()
