"""
Analytics API Endpoints
Phase 7: Analytics and monitoring API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import logging

from src.api.auth_middleware import get_current_user
from src.analytics.metrics_collector import metrics_collector, MetricCategory, MetricType
from src.analytics.monitoring_dashboard import monitoring_dashboard
from src.analytics.alerting_system import alerting_system, AlertSeverity, AlertCondition
from src.common.db_postgresql import DatabaseManager

logger = logging.getLogger(__name__)

router = APIRouter()
db = DatabaseManager()

@router.get("/api/v1/analytics/metrics", response_model=Dict[str, Any], tags=["analytics"])
async def get_metrics(
    category: Optional[MetricCategory] = Query(None, description="Filter by metric category"),
    name: Optional[str] = Query(None, description="Filter by metric name"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    start_time: Optional[datetime] = Query(None, description="Start time filter"),
    end_time: Optional[datetime] = Query(None, description="End time filter"),
    limit: int = Query(1000, ge=1, le=10000),
    user: dict = Depends(get_current_user)
):
    """
    Get metrics data with filtering.
    Requires analytics or admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        # Set default time range if not provided
        if not end_time:
            end_time = datetime.utcnow()
        if not start_time:
            start_time = end_time - timedelta(hours=24)
        
        metrics = await metrics_collector.get_metrics(
            category=category,
            name=name,
            user_id=user_id,
            start_time=start_time,
            end_time=end_time,
            limit=limit
        )
        
        return {
            "metrics": metrics,
            "total": len(metrics),
            "filters": {
                "category": category.value if category else None,
                "name": name,
                "user_id": user_id,
                "start_time": start_time.isoformat() + "Z",
                "end_time": end_time.isoformat() + "Z"
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get metrics: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve metrics")

@router.get("/api/v1/analytics/metrics/aggregated", response_model=Dict[str, Any], tags=["analytics"])
async def get_aggregated_metrics(
    category: Optional[MetricCategory] = Query(None, description="Filter by metric category"),
    name: Optional[str] = Query(None, description="Filter by metric name"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    start_time: Optional[datetime] = Query(None, description="Start time filter"),
    end_time: Optional[datetime] = Query(None, description="End time filter"),
    group_by: str = Query("hour", description="Time grouping (minute, hour, day, week, month)"),
    user: dict = Depends(get_current_user)
):
    """
    Get aggregated metrics data.
    Requires analytics or admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        # Set default time range if not provided
        if not end_time:
            end_time = datetime.utcnow()
        if not start_time:
            start_time = end_time - timedelta(hours=24)
        
        aggregated = await metrics_collector.get_aggregated_metrics(
            category=category,
            name=name,
            user_id=user_id,
            start_time=start_time,
            end_time=end_time,
            group_by=group_by
        )
        
        return aggregated
        
    except Exception as e:
        logger.error(f"Failed to get aggregated metrics: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve aggregated metrics")

@router.get("/api/v1/analytics/system/health", response_model=Dict[str, Any], tags=["analytics"])
async def get_system_health(
    user: dict = Depends(get_current_user)
):
    """
    Get system health metrics.
    Requires analytics or admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        health_metrics = await metrics_collector.get_system_health_metrics()
        return health_metrics
        
    except Exception as e:
        logger.error(f"Failed to get system health: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve system health")

@router.get("/api/v1/analytics/dashboards", response_model=List[Dict[str, Any]], tags=["analytics"])
async def get_dashboards(
    user: dict = Depends(get_current_user)
):
    """
    Get all available dashboards.
    Requires analytics or admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        dashboards = await monitoring_dashboard.get_all_dashboards()
        return dashboards
        
    except Exception as e:
        logger.error(f"Failed to get dashboards: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve dashboards")

@router.get("/api/v1/analytics/dashboards/{dashboard_id}", response_model=Dict[str, Any], tags=["analytics"])
async def get_dashboard(
    dashboard_id: str,
    time_range: str = Query("1h", description="Time range for dashboard data"),
    user: dict = Depends(get_current_user)
):
    """
    Get dashboard data with metrics.
    Requires analytics or admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        dashboard_data = await monitoring_dashboard.get_dashboard_data(dashboard_id, time_range)
        return dashboard_data
        
    except Exception as e:
        logger.error(f"Failed to get dashboard {dashboard_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve dashboard data")

@router.get("/api/v1/analytics/dashboards/{dashboard_id}/overview", response_model=Dict[str, Any], tags=["analytics"])
async def get_dashboard_overview(
    dashboard_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Get dashboard overview data.
    Requires analytics or admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        overview = await monitoring_dashboard.get_system_overview()
        return overview
        
    except Exception as e:
        logger.error(f"Failed to get dashboard overview: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve dashboard overview")

@router.post("/api/v1/analytics/dashboards", response_model=Dict[str, Any], tags=["analytics"])
async def create_dashboard(
    dashboard_id: str,
    name: str,
    description: str,
    widgets: List[Dict[str, Any]],
    user: dict = Depends(get_current_user)
):
    """
    Create a custom dashboard.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await monitoring_dashboard.create_custom_dashboard(
            dashboard_id=dashboard_id,
            name=name,
            description=description,
            widgets=widgets
        )
        
        if success:
            return {
                "success": True,
                "dashboard_id": dashboard_id,
                "message": "Dashboard created successfully"
            }
        else:
            raise HTTPException(status_code=400, detail="Failed to create dashboard")
            
    except Exception as e:
        logger.error(f"Failed to create dashboard: {e}")
        raise HTTPException(status_code=500, detail="Failed to create dashboard")

@router.get("/api/v1/analytics/alerts/rules", response_model=List[Dict[str, Any]], tags=["analytics"])
async def get_alert_rules(
    user: dict = Depends(get_current_user)
):
    """
    Get all alert rules.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        rules = await alerting_system.get_alert_rules()
        return rules
        
    except Exception as e:
        logger.error(f"Failed to get alert rules: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve alert rules")

@router.post("/api/v1/analytics/alerts/rules", response_model=Dict[str, Any], tags=["analytics"])
async def create_alert_rule(
    name: str,
    description: str,
    metric_name: str,
    category: MetricCategory,
    condition: AlertCondition,
    threshold: float,
    severity: AlertSeverity,
    duration_minutes: int = Query(5, ge=1, le=60),
    labels: Optional[Dict[str, str]] = None,
    notification_channels: Optional[List[str]] = None,
    user: dict = Depends(get_current_user)
):
    """
    Create a new alert rule.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        rule_id = await alerting_system.create_alert_rule(
            name=name,
            description=description,
            metric_name=metric_name,
            category=category,
            condition=condition,
            threshold=threshold,
            severity=severity,
            duration_minutes=duration_minutes,
            labels=labels,
            notification_channels=notification_channels
        )
        
        return {
            "success": True,
            "rule_id": rule_id,
            "message": "Alert rule created successfully"
        }
        
    except Exception as e:
        logger.error(f"Failed to create alert rule: {e}")
        raise HTTPException(status_code=500, detail="Failed to create alert rule")

@router.put("/api/v1/analytics/alerts/rules/{rule_id}", response_model=Dict[str, Any], tags=["analytics"])
async def update_alert_rule(
    rule_id: str,
    updates: Dict[str, Any],
    user: dict = Depends(get_current_user)
):
    """
    Update an alert rule.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await alerting_system.update_alert_rule(rule_id, **updates)
        
        if success:
            return {
                "success": True,
                "rule_id": rule_id,
                "message": "Alert rule updated successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Alert rule not found")
            
    except Exception as e:
        logger.error(f"Failed to update alert rule: {e}")
        raise HTTPException(status_code=500, detail="Failed to update alert rule")

@router.delete("/api/v1/analytics/alerts/rules/{rule_id}", response_model=Dict[str, Any], tags=["analytics"])
async def delete_alert_rule(
    rule_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Delete an alert rule.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await alerting_system.delete_alert_rule(rule_id)
        
        if success:
            return {
                "success": True,
                "rule_id": rule_id,
                "message": "Alert rule deleted successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Alert rule not found")
            
    except Exception as e:
        logger.error(f"Failed to delete alert rule: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete alert rule")

@router.get("/api/v1/analytics/alerts", response_model=List[Dict[str, Any]], tags=["analytics"])
async def get_alerts(
    user: dict = Depends(get_current_user)
):
    """
    Get all active alerts.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        alerts = await alerting_system.get_active_alerts()
        return alerts
        
    except Exception as e:
        logger.error(f"Failed to get alerts: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve alerts")

@router.post("/api/v1/analytics/alerts/{alert_id}/acknowledge", response_model=Dict[str, Any], tags=["analytics"])
async def acknowledge_alert(
    alert_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Acknowledge an alert.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await alerting_system.acknowledge_alert(alert_id, current_user_id)
        
        if success:
            return {
                "success": True,
                "alert_id": alert_id,
                "message": "Alert acknowledged successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Alert not found")
            
    except Exception as e:
        logger.error(f"Failed to acknowledge alert: {e}")
        raise HTTPException(status_code=500, detail="Failed to acknowledge alert")

@router.post("/api/v1/analytics/alerts/{alert_id}/resolve", response_model=Dict[str, Any], tags=["analytics"])
async def resolve_alert(
    alert_id: str,
    user: dict = Depends(get_current_user)
):
    """
    Resolve an alert.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        success = await alerting_system.resolve_alert(alert_id, current_user_id)
        
        if success:
            return {
                "success": True,
                "alert_id": alert_id,
                "message": "Alert resolved successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Alert not found")
            
    except Exception as e:
        logger.error(f"Failed to resolve alert: {e}")
        raise HTTPException(status_code=500, detail="Failed to resolve alert")

@router.get("/api/v1/analytics/performance/benchmarks", response_model=Dict[str, Any], tags=["analytics"])
async def get_performance_benchmarks(
    operation_name: Optional[str] = Query(None, description="Filter by operation name"),
    hours: int = Query(24, ge=1, le=168, description="Hours of data to retrieve"),
    user: dict = Depends(get_current_user)
):
    """
    Get performance benchmark data.
    Requires analytics or admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                if operation_name:
                    cursor.execute("""
                        SELECT get_performance_benchmarks(%s, %s)
                    """, (operation_name, hours))
                else:
                    cursor.execute("""
                        SELECT 
                            operation_name,
                            AVG(duration_ms) as avg_duration_ms,
                            MIN(duration_ms) as min_duration_ms,
                            MAX(duration_ms) as max_duration_ms,
                            AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) as success_rate,
                            COUNT(*) as total_operations,
                            COUNT(*) FILTER (WHERE NOT success) as error_count
                        FROM performance_benchmarks
                        WHERE created_at >= NOW() - INTERVAL '1 hour' * %s
                        GROUP BY operation_name
                        ORDER BY avg_duration_ms DESC
                    """, (hours,))
                
                results = cursor.fetchall()
                
                benchmarks = []
                for row in results:
                    if operation_name:
                        # Single operation result
                        benchmarks.append({
                            "operation_name": row[0],
                            "avg_duration_ms": float(row[1]) if row[1] else 0,
                            "min_duration_ms": float(row[2]) if row[2] else 0,
                            "max_duration_ms": float(row[3]) if row[3] else 0,
                            "success_rate": float(row[4]) if row[4] else 0,
                            "total_operations": row[5],
                            "error_count": row[6]
                        })
                    else:
                        # Multiple operations
                        benchmarks.append({
                            "operation_name": row[0],
                            "avg_duration_ms": float(row[1]) if row[1] else 0,
                            "min_duration_ms": float(row[2]) if row[2] else 0,
                            "max_duration_ms": float(row[3]) if row[3] else 0,
                            "success_rate": float(row[4]) if row[4] else 0,
                            "total_operations": row[5],
                            "error_count": row[6]
                        })
                
                return {
                    "benchmarks": benchmarks,
                    "total_operations": len(benchmarks),
                    "hours": hours
                }
                
    except Exception as e:
        logger.error(f"Failed to get performance benchmarks: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve performance benchmarks")

@router.get("/api/v1/analytics/reports/system", response_model=Dict[str, Any], tags=["analytics"])
async def get_system_report(
    start_date: Optional[datetime] = Query(None, description="Start date for report"),
    end_date: Optional[datetime] = Query(None, description="End date for report"),
    user: dict = Depends(get_current_user)
):
    """
    Get comprehensive system report.
    Requires admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        # Set default date range if not provided
        if not end_date:
            end_date = datetime.utcnow()
        if not start_date:
            start_date = end_date - timedelta(days=7)
        
        with db._get_connection() as conn:
            with conn.cursor() as cursor:
                # Get system health trends
                cursor.execute("""
                    SELECT get_system_health_trends(%s)
                """, (int((end_date - start_date).total_seconds() / 3600),))
                
                health_trends = cursor.fetchall()
                
                # Get performance benchmarks
                cursor.execute("""
                    SELECT 
                        operation_name,
                        AVG(duration_ms) as avg_duration,
                        AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) as success_rate,
                        COUNT(*) as total_operations
                    FROM performance_benchmarks
                    WHERE created_at >= %s AND created_at <= %s
                    GROUP BY operation_name
                    ORDER BY avg_duration DESC
                """, (start_date, end_date))
                
                performance_data = cursor.fetchall()
                
                # Get alert statistics
                cursor.execute("""
                    SELECT 
                        severity,
                        COUNT(*) as count
                    FROM alerts
                    WHERE triggered_at >= %s AND triggered_at <= %s
                    GROUP BY severity
                """, (start_date, end_date))
                
                alert_stats = cursor.fetchall()
                
                return {
                    "report_period": {
                        "start_date": start_date.isoformat() + "Z",
                        "end_date": end_date.isoformat() + "Z",
                        "duration_days": (end_date - start_date).days
                    },
                    "system_health": {
                        "trends": [{"time_bucket": row[0].isoformat() + "Z", "avg_cpu": float(row[1]) if row[1] else 0, "avg_memory": float(row[2]) if row[2] else 0, "avg_response_time": float(row[3]) if row[3] else 0, "avg_error_rate": float(row[4]) if row[4] else 0, "sample_count": row[5]} for row in health_trends]
                    },
                    "performance": {
                        "operations": [{"operation_name": row[0], "avg_duration_ms": float(row[1]) if row[1] else 0, "success_rate": float(row[2]) if row[2] else 0, "total_operations": row[3]} for row in performance_data]
                    },
                    "alerts": {
                        "by_severity": [{"severity": row[0], "count": row[1]} for row in alert_stats]
                    },
                    "generated_at": datetime.utcnow().isoformat() + "Z"
                }
                
    except Exception as e:
        logger.error(f"Failed to generate system report: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate system report")

@router.post("/api/v1/analytics/metrics/record", response_model=Dict[str, Any], tags=["analytics"])
async def record_metric(
    name: str,
    value: float,
    metric_type: MetricType = MetricType.COUNTER,
    category: MetricCategory = MetricCategory.SYSTEM,
    labels: Optional[Dict[str, str]] = None,
    user: dict = Depends(get_current_user)
):
    """
    Record a custom metric.
    Requires analytics or admin permissions.
    """
    current_user_id = user["user_id"]
    
    try:
        await metrics_collector.record_metric(
            name=name,
            value=value,
            metric_type=metric_type,
            category=category,
            labels=labels,
            user_id=current_user_id
        )
        
        return {
            "success": True,
            "message": "Metric recorded successfully"
        }
        
    except Exception as e:
        logger.error(f"Failed to record metric: {e}")
        raise HTTPException(status_code=500, detail="Failed to record metric")
