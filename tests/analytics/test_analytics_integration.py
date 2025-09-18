"""
Analytics Integration Tests
Phase 7: Comprehensive testing for analytics and monitoring components
"""

import pytest
import asyncio
import json
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock

from src.analytics.metrics_collector import metrics_collector, MetricsCollector, MetricType, MetricCategory
from src.analytics.monitoring_dashboard import monitoring_dashboard, MonitoringDashboard
from src.analytics.alerting_system import alerting_system, AlertingSystem, AlertSeverity, AlertCondition
from src.analytics.analytics_integration import analytics_integration, AnalyticsIntegration

class TestMetricsCollector:
    """Test metrics collector functionality"""
    
    @pytest.fixture
    def metrics_svc(self):
        return MetricsCollector()
    
    @pytest.mark.asyncio
    async def test_record_metric(self, metrics_svc):
        """Test basic metric recording"""
        await metrics_svc.record_metric(
            name="test_metric",
            value=42.5,
            metric_type=MetricType.GAUGE,
            category=MetricCategory.SYSTEM
        )
        
        # Verify metric was added to buffer
        assert len(metrics_svc.metrics_buffer) == 1
        metric = metrics_svc.metrics_buffer[0]
        assert metric.name == "test_metric"
        assert metric.value == 42.5
        assert metric.metric_type == MetricType.GAUGE
        assert metric.category == MetricCategory.SYSTEM
    
    @pytest.mark.asyncio
    async def test_increment_counter(self, metrics_svc):
        """Test counter increment"""
        await metrics_svc.increment_counter(
            name="test_counter",
            category=MetricCategory.API,
            value=5
        )
        
        assert len(metrics_svc.metrics_buffer) == 1
        metric = metrics_svc.metrics_buffer[0]
        assert metric.name == "test_counter"
        assert metric.value == 5
        assert metric.metric_type == MetricType.COUNTER
        assert metric.category == MetricCategory.API
    
    @pytest.mark.asyncio
    async def test_set_gauge(self, metrics_svc):
        """Test gauge setting"""
        await metrics_svc.set_gauge(
            name="test_gauge",
            value=75.0,
            category=MetricCategory.SYSTEM
        )
        
        assert len(metrics_svc.metrics_buffer) == 1
        metric = metrics_svc.metrics_buffer[0]
        assert metric.name == "test_gauge"
        assert metric.value == 75.0
        assert metric.metric_type == MetricType.GAUGE
    
    @pytest.mark.asyncio
    async def test_record_histogram(self, metrics_svc):
        """Test histogram recording"""
        await metrics_svc.record_histogram(
            name="test_histogram",
            value=100.0,
            category=MetricCategory.EVIDENCE
        )
        
        assert len(metrics_svc.metrics_buffer) == 1
        metric = metrics_svc.metrics_buffer[0]
        assert metric.name == "test_histogram"
        assert metric.value == 100.0
        assert metric.metric_type == MetricType.HISTOGRAM
        assert metric.category == MetricCategory.EVIDENCE
    
    @pytest.mark.asyncio
    async def test_record_timer(self, metrics_svc):
        """Test timer recording"""
        await metrics_svc.record_timer(
            name="test_timer",
            duration_ms=250.5,
            category=MetricCategory.API
        )
        
        assert len(metrics_svc.metrics_buffer) == 1
        metric = metrics_svc.metrics_buffer[0]
        assert metric.name == "test_timer"
        assert metric.value == 250.5
        assert metric.metric_type == MetricType.TIMER
    
    @pytest.mark.asyncio
    async def test_metrics_flush(self, metrics_svc):
        """Test metrics flushing to database"""
        with patch.object(metrics_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Add some metrics to buffer
            metrics_svc.metrics_buffer = [
                Mock(
                    id="test1", name="metric1", value=10, metric_type=MetricType.COUNTER,
                    category=MetricCategory.SYSTEM, labels={}, timestamp=datetime.utcnow(),
                    user_id=None, session_id=None, metadata=None
                )
            ]
            
            await metrics_svc._flush_metrics()
            
            # Verify database insert was called
            mock_cursor.execute.assert_called()
            assert len(metrics_svc.metrics_buffer) == 0
    
    @pytest.mark.asyncio
    async def test_get_metrics(self, metrics_svc):
        """Test metrics retrieval"""
        with patch.object(metrics_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            # Mock database response
            mock_cursor.fetchall.return_value = [
                ("test1", "metric1", "10", "counter", "system", "{}", None, None, datetime.utcnow(), "{}")
            ]
            
            metrics = await metrics_svc.get_metrics(
                category=MetricCategory.SYSTEM,
                limit=10
            )
            
            assert len(metrics) == 1
            assert metrics[0]["name"] == "metric1"
            assert metrics[0]["value"] == "10"

class TestMonitoringDashboard:
    """Test monitoring dashboard functionality"""
    
    @pytest.fixture
    def dashboard_svc(self):
        return MonitoringDashboard()
    
    def test_initialize_dashboards(self, dashboard_svc):
        """Test dashboard initialization"""
        assert "system_health" in dashboard_svc.dashboards
        assert "evidence_processing" in dashboard_svc.dashboards
        assert "dispute_submissions" in dashboard_svc.dashboards
        assert "user_activity" in dashboard_svc.dashboards
    
    @pytest.mark.asyncio
    async def test_get_dashboard(self, dashboard_svc):
        """Test getting a specific dashboard"""
        dashboard = await dashboard_svc.get_dashboard("system_health")
        assert dashboard is not None
        assert dashboard["id"] == "system_health"
        assert "widgets" in dashboard
    
    @pytest.mark.asyncio
    async def test_get_all_dashboards(self, dashboard_svc):
        """Test getting all dashboards"""
        dashboards = await dashboard_svc.get_all_dashboards()
        assert len(dashboards) == 4
        assert all("id" in dashboard for dashboard in dashboards)
    
    @pytest.mark.asyncio
    async def test_get_dashboard_data(self, dashboard_svc):
        """Test getting dashboard data with metrics"""
        with patch.object(metrics_collector, 'get_metrics') as mock_get_metrics:
            mock_get_metrics.return_value = []
            
            with patch.object(metrics_collector, 'get_aggregated_metrics') as mock_get_aggregated:
                mock_get_aggregated.return_value = {"aggregated_metrics": []}
                
                data = await dashboard_svc.get_dashboard_data("system_health", "1h")
                
                assert "dashboard" in data
                assert "data" in data
                assert "generated_at" in data
                assert "time_range" in data
    
    @pytest.mark.asyncio
    async def test_create_custom_dashboard(self, dashboard_svc):
        """Test creating a custom dashboard"""
        with patch.object(audit_service, 'log_event') as mock_log:
            success = await dashboard_svc.create_custom_dashboard(
                dashboard_id="test_dashboard",
                name="Test Dashboard",
                description="Test dashboard description",
                widgets=[]
            )
            
            assert success is True
            assert "test_dashboard" in dashboard_svc.dashboards
            mock_log.assert_called()

class TestAlertingSystem:
    """Test alerting system functionality"""
    
    @pytest.fixture
    def alerting_svc(self):
        return AlertingSystem()
    
    @pytest.mark.asyncio
    async def test_create_alert_rule(self, alerting_svc):
        """Test creating an alert rule"""
        with patch.object(alerting_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                rule_id = await alerting_svc.create_alert_rule(
                    name="Test Alert",
                    description="Test alert description",
                    metric_name="test_metric",
                    category=MetricCategory.SYSTEM,
                    condition=AlertCondition.GREATER_THAN,
                    threshold=80.0,
                    severity=AlertSeverity.WARNING
                )
                
                assert rule_id is not None
                assert rule_id in alerting_svc.alert_rules
                mock_log.assert_called()
    
    @pytest.mark.asyncio
    async def test_update_alert_rule(self, alerting_svc):
        """Test updating an alert rule"""
        # First create a rule
        rule_id = "test_rule"
        alerting_svc.alert_rules[rule_id] = Mock(
            id=rule_id, name="Test Rule", threshold=80.0
        )
        
        with patch.object(alerting_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            success = await alerting_svc.update_alert_rule(
                rule_id, threshold=90.0
            )
            
            assert success is True
            assert alerting_svc.alert_rules[rule_id].threshold == 90.0
    
    @pytest.mark.asyncio
    async def test_acknowledge_alert(self, alerting_svc):
        """Test acknowledging an alert"""
        alert_id = "test_alert"
        alerting_svc.active_alerts[alert_id] = Mock(
            id=alert_id, status="active", rule_id="test_rule"
        )
        
        with patch.object(alerting_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                success = await alerting_svc.acknowledge_alert(alert_id, "user123")
                
                assert success is True
                assert alerting_svc.active_alerts[alert_id].status == "acknowledged"
                mock_log.assert_called()
    
    @pytest.mark.asyncio
    async def test_resolve_alert(self, alerting_svc):
        """Test resolving an alert"""
        alert_id = "test_alert"
        alerting_svc.active_alerts[alert_id] = Mock(
            id=alert_id, status="acknowledged", rule_id="test_rule"
        )
        
        with patch.object(alerting_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                success = await alerting_svc.resolve_alert(alert_id, "user123")
                
                assert success is True
                assert alert_id not in alerting_svc.active_alerts
                mock_log.assert_called()
    
    def test_should_trigger_alert(self, alerting_svc):
        """Test alert condition evaluation"""
        rule = Mock(
            condition=AlertCondition.GREATER_THAN,
            threshold=80.0
        )
        
        metric = {"value": "85.0"}
        should_trigger = alerting_svc._should_trigger_alert(rule, metric)
        assert should_trigger is True
        
        metric = {"value": "75.0"}
        should_trigger = alerting_svc._should_trigger_alert(rule, metric)
        assert should_trigger is False

class TestAnalyticsIntegration:
    """Test analytics integration functionality"""
    
    @pytest.fixture
    def analytics_svc(self):
        return AnalyticsIntegration()
    
    @pytest.mark.asyncio
    async def test_track_operation(self, analytics_svc):
        """Test operation tracking context manager"""
        with patch.object(analytics_svc.metrics_collector, 'record_timer') as mock_timer:
            with patch.object(analytics_svc.metrics_collector, 'increment_counter') as mock_counter:
                with patch.object(analytics_svc, '_record_performance_benchmark') as mock_benchmark:
                    async with analytics_svc.track_operation("test_operation", "user123"):
                        await asyncio.sleep(0.01)  # Small delay
                    
                    mock_timer.assert_called()
                    mock_counter.assert_called()
                    mock_benchmark.assert_called()
    
    @pytest.mark.asyncio
    async def test_track_api_request(self, analytics_svc):
        """Test API request tracking"""
        with patch.object(analytics_svc.metrics_collector, 'record_timer') as mock_timer:
            with patch.object(analytics_svc.metrics_collector, 'increment_counter') as mock_counter:
                await analytics_svc.track_api_request(
                    endpoint="/api/test",
                    method="GET",
                    status_code=200,
                    duration_ms=150.0,
                    user_id="user123"
                )
                
                assert mock_timer.call_count == 1
                assert mock_counter.call_count == 1
    
    @pytest.mark.asyncio
    async def test_track_evidence_processing(self, analytics_svc):
        """Test evidence processing tracking"""
        with patch.object(analytics_svc.metrics_collector, 'record_timer') as mock_timer:
            with patch.object(analytics_svc.metrics_collector, 'increment_counter') as mock_counter:
                await analytics_svc.track_evidence_processing(
                    document_id="doc123",
                    processing_time_ms=500.0,
                    success=True,
                    user_id="user123"
                )
                
                assert mock_timer.call_count == 1
                assert mock_counter.call_count == 2  # documents_processed + parsing_success
    
    @pytest.mark.asyncio
    async def test_track_matching_result(self, analytics_svc):
        """Test matching result tracking"""
        with patch.object(analytics_svc.metrics_collector, 'record_histogram') as mock_histogram:
            with patch.object(analytics_svc.metrics_collector, 'increment_counter') as mock_counter:
                await analytics_svc.track_matching_result(
                    dispute_id="dispute123",
                    confidence_score=0.85,
                    match_type="exact_match",
                    auto_submit=True,
                    user_id="user123"
                )
                
                assert mock_histogram.call_count == 1
                assert mock_counter.call_count == 2  # matches_found + auto_submissions
    
    @pytest.mark.asyncio
    async def test_track_dispute_submission(self, analytics_svc):
        """Test dispute submission tracking"""
        with patch.object(analytics_svc.metrics_collector, 'record_timer') as mock_timer:
            with patch.object(analytics_svc.metrics_collector, 'increment_counter') as mock_counter:
                await analytics_svc.track_dispute_submission(
                    submission_id="sub123",
                    success=True,
                    processing_time_ms=1000.0,
                    user_id="user123"
                )
                
                assert mock_timer.call_count == 1
                assert mock_counter.call_count == 2  # disputes_submitted + submission_success
    
    @pytest.mark.asyncio
    async def test_track_user_activity(self, analytics_svc):
        """Test user activity tracking"""
        with patch.object(analytics_svc.metrics_collector, 'increment_counter') as mock_counter:
            with patch.object(analytics_svc.metrics_collector, 'set_gauge') as mock_gauge:
                await analytics_svc.track_user_activity(
                    action="login",
                    resource_type="user",
                    user_id="user123",
                    session_id="session123"
                )
                
                assert mock_counter.call_count == 1
                assert mock_gauge.call_count == 1
    
    @pytest.mark.asyncio
    async def test_track_websocket_event(self, analytics_svc):
        """Test WebSocket event tracking"""
        with patch.object(analytics_svc.metrics_collector, 'increment_counter') as mock_counter:
            await analytics_svc.track_websocket_event(
                event_type="user_connected",
                user_id="user123",
                session_id="session123"
            )
            
            assert mock_counter.call_count == 1
    
    @pytest.mark.asyncio
    async def test_get_analytics_summary(self, analytics_svc):
        """Test analytics summary generation"""
        with patch.object(analytics_svc.metrics_collector, 'get_system_health_metrics') as mock_health:
            with patch.object(analytics_svc.alerting_system, 'get_active_alerts') as mock_alerts:
                with patch.object(analytics_svc.monitoring_dashboard, 'get_system_overview') as mock_overview:
                    mock_health.return_value = {"cpu": 50.0, "memory": 60.0}
                    mock_alerts.return_value = []
                    mock_overview.return_value = {"overview": "data"}
                    
                    summary = await analytics_svc.get_analytics_summary()
                    
                    assert "timestamp" in summary
                    assert "system_health" in summary
                    assert "active_alerts" in summary
                    assert "dashboard_overview" in summary
                    assert "services_status" in summary

class TestAnalyticsIntegrationFlow:
    """Integration tests for analytics flow"""
    
    @pytest.mark.asyncio
    async def test_end_to_end_analytics_flow(self):
        """Test complete analytics flow"""
        # Test metrics collection
        await metrics_collector.record_metric(
            name="test_integration_metric",
            value=100.0,
            metric_type=MetricType.GAUGE,
            category=MetricCategory.SYSTEM
        )
        
        # Test dashboard data retrieval
        with patch.object(metrics_collector, 'get_metrics') as mock_get_metrics:
            mock_get_metrics.return_value = []
            
            with patch.object(metrics_collector, 'get_aggregated_metrics') as mock_get_aggregated:
                mock_get_aggregated.return_value = {"aggregated_metrics": []}
                
                dashboard_data = await monitoring_dashboard.get_dashboard_data("system_health", "1h")
                assert "dashboard" in dashboard_data
        
        # Test alert rule creation
        with patch.object(alerting_system.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                rule_id = await alerting_system.create_alert_rule(
                    name="Integration Test Alert",
                    description="Test alert for integration",
                    metric_name="test_metric",
                    category=MetricCategory.SYSTEM,
                    condition=AlertCondition.GREATER_THAN,
                    threshold=90.0,
                    severity=AlertSeverity.ERROR
                )
                
                assert rule_id is not None
                mock_log.assert_called()
    
    def test_metric_categories_and_types(self):
        """Test metric categories and types"""
        # Test all metric categories
        categories = [cat for cat in MetricCategory]
        assert len(categories) == 11  # system, user, evidence, dispute, submission, proof_packet, prompt, parser, matching, api, websocket
        
        # Test all metric types
        types = [t for t in MetricType]
        assert len(types) == 5  # counter, gauge, histogram, summary, timer
    
    def test_alert_severities_and_conditions(self):
        """Test alert severities and conditions"""
        # Test all alert severities
        severities = [s for s in AlertSeverity]
        assert len(severities) == 4  # info, warning, error, critical
        
        # Test all alert conditions
        conditions = [c for c in AlertCondition]
        assert len(conditions) == 8  # gt, lt, eq, ne, gte, lte, contains, not_contains

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
