"""
Feature Flags & Canary Deployment Tests
Phase 8: Comprehensive testing for feature flags and canary deployments
"""

import pytest
import asyncio
import json
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock

from src.features.feature_flags import feature_flags_service, FeatureFlagsService, FeatureFlagType, FeatureFlagStatus, RolloutStrategy
from src.features.canary_deployment import canary_deployment_service, CanaryDeploymentService, CanaryStrategy, CanaryStatus
from src.features.rollback_manager import rollback_manager, RollbackManager, RollbackType, RollbackScope, RollbackStatus
from src.features.feature_integration import feature_integration, FeatureIntegration

class TestFeatureFlagsService:
    """Test feature flags service functionality"""
    
    @pytest.fixture
    def feature_flags_svc(self):
        return FeatureFlagsService()
    
    @pytest.mark.asyncio
    async def test_create_feature_flag(self, feature_flags_svc):
        """Test creating a feature flag"""
        with patch.object(feature_flags_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                flag_id = await feature_flags_svc.create_feature_flag(
                    name="test_flag",
                    description="Test feature flag",
                    flag_type=FeatureFlagType.BOOLEAN,
                    created_by="test_user"
                )
                
                assert flag_id is not None
                assert flag_id in feature_flags_svc.feature_flags
                mock_log.assert_called()
    
    @pytest.mark.asyncio
    async def test_evaluate_feature_flag_all_users(self, feature_flags_svc):
        """Test evaluating a feature flag for all users"""
        # Create a flag
        flag_id = "test_flag_id"
        feature_flags_svc.feature_flags[flag_id] = Mock(
            id=flag_id,
            name="test_flag",
            status=FeatureFlagStatus.ACTIVE,
            rollout_strategy=RolloutStrategy.ALL_USERS,
            target_environments=set(),
            target_users=set()
        )
        
        evaluation = await feature_flags_svc.evaluate_feature_flag(
            flag_name="test_flag",
            user_id="user123",
            environment="production"
        )
        
        assert evaluation.enabled is True
        assert evaluation.reason == "all_users"
    
    @pytest.mark.asyncio
    async def test_evaluate_feature_flag_percentage(self, feature_flags_svc):
        """Test evaluating a feature flag with percentage rollout"""
        # Create a flag with 50% rollout
        flag_id = "test_flag_id"
        feature_flags_svc.feature_flags[flag_id] = Mock(
            id=flag_id,
            name="test_flag",
            status=FeatureFlagStatus.ACTIVE,
            rollout_strategy=RolloutStrategy.PERCENTAGE,
            rollout_percentage=50.0,
            target_environments=set(),
            target_users=set()
        )
        
        # Test with a user that should be included (hash % 100 < 50)
        with patch('builtins.hash', return_value=25):
            evaluation = await feature_flags_svc.evaluate_feature_flag(
                flag_name="test_flag",
                user_id="user123",
                environment="production"
            )
            assert evaluation.enabled is True
            assert evaluation.reason == "percentage_rollout"
        
        # Test with a user that should be excluded (hash % 100 >= 50)
        with patch('builtins.hash', return_value=75):
            evaluation = await feature_flags_svc.evaluate_feature_flag(
                flag_name="test_flag",
                user_id="user456",
                environment="production"
            )
            assert evaluation.enabled is False
            assert evaluation.reason == "percentage_rollout"
    
    @pytest.mark.asyncio
    async def test_evaluate_feature_flag_user_list(self, feature_flags_svc):
        """Test evaluating a feature flag with user list targeting"""
        # Create a flag with specific user targeting
        flag_id = "test_flag_id"
        feature_flags_svc.feature_flags[flag_id] = Mock(
            id=flag_id,
            name="test_flag",
            status=FeatureFlagStatus.ACTIVE,
            rollout_strategy=RolloutStrategy.USER_LIST,
            target_users={"user123"},
            target_environments=set()
        )
        
        # Test with targeted user
        evaluation = await feature_flags_svc.evaluate_feature_flag(
            flag_name="test_flag",
            user_id="user123",
            environment="production"
        )
        assert evaluation.enabled is True
        assert evaluation.reason == "user_list"
        
        # Test with non-targeted user
        evaluation = await feature_flags_svc.evaluate_feature_flag(
            flag_name="test_flag",
            user_id="user456",
            environment="production"
        )
        assert evaluation.enabled is False
        assert evaluation.reason == "user_list"
    
    @pytest.mark.asyncio
    async def test_start_canary_deployment(self, feature_flags_svc):
        """Test starting a canary deployment"""
        flag_id = "test_flag_id"
        feature_flags_svc.feature_flags[flag_id] = Mock(
            id=flag_id,
            name="test_flag",
            status=FeatureFlagStatus.INACTIVE,
            rollout_strategy=RolloutStrategy.ALL_USERS,
            rollout_percentage=100.0,
            target_users=set(),
            target_environments=set(),
            metadata={}
        )
        
        with patch.object(feature_flags_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            success = await feature_flags_svc.start_canary_deployment(
                flag_id=flag_id,
                canary_percentage=10.0
            )
            
            assert success is True
            assert feature_flags_svc.feature_flags[flag_id].status == FeatureFlagStatus.CANARY
            assert feature_flags_svc.feature_flags[flag_id].rollout_percentage == 10.0
    
    @pytest.mark.asyncio
    async def test_promote_canary_to_full(self, feature_flags_svc):
        """Test promoting a canary deployment to full rollout"""
        flag_id = "test_flag_id"
        feature_flags_svc.feature_flags[flag_id] = Mock(
            id=flag_id,
            name="test_flag",
            status=FeatureFlagStatus.CANARY,
            rollout_strategy=RolloutStrategy.PERCENTAGE,
            rollout_percentage=10.0,
            target_users=set(),
            target_environments=set(),
            metadata={}
        )
        
        with patch.object(feature_flags_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                success = await feature_flags_svc.promote_canary_to_full(
                    flag_id=flag_id,
                    promoted_by="test_user"
                )
                
                assert success is True
                assert feature_flags_svc.feature_flags[flag_id].status == FeatureFlagStatus.ACTIVE
                assert feature_flags_svc.feature_flags[flag_id].rollout_percentage == 100.0
                mock_log.assert_called()
    
    @pytest.mark.asyncio
    async def test_rollback_feature_flag(self, feature_flags_svc):
        """Test rolling back a feature flag"""
        flag_id = "test_flag_id"
        feature_flags_svc.feature_flags[flag_id] = Mock(
            id=flag_id,
            name="test_flag",
            status=FeatureFlagStatus.ACTIVE,
            rollout_strategy=RolloutStrategy.ALL_USERS,
            rollout_percentage=100.0,
            target_users=set(),
            target_environments=set(),
            metadata={}
        )
        
        with patch.object(feature_flags_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                success = await feature_flags_svc.rollback_feature_flag(
                    flag_id=flag_id,
                    rolled_back_by="test_user",
                    reason="test_rollback"
                )
                
                assert success is True
                assert feature_flags_svc.feature_flags[flag_id].status == FeatureFlagStatus.ROLLED_BACK
                assert feature_flags_svc.feature_flags[flag_id].rollout_percentage == 0.0
                mock_log.assert_called()

class TestCanaryDeploymentService:
    """Test canary deployment service functionality"""
    
    @pytest.fixture
    def canary_svc(self):
        return CanaryDeploymentService()
    
    @pytest.mark.asyncio
    async def test_create_canary_deployment(self, canary_svc):
        """Test creating a canary deployment"""
        with patch.object(canary_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                deployment_id = await canary_svc.create_canary_deployment(
                    feature_flag_id="test_flag_id",
                    name="Test Canary",
                    description="Test canary deployment",
                    strategy=CanaryStrategy.PERCENTAGE,
                    created_by="test_user"
                )
                
                assert deployment_id is not None
                assert deployment_id in canary_svc.active_deployments
                mock_log.assert_called()
    
    @pytest.mark.asyncio
    async def test_start_canary_deployment(self, canary_svc):
        """Test starting a canary deployment"""
        deployment_id = "test_deployment_id"
        canary_svc.active_deployments[deployment_id] = Mock(
            id=deployment_id,
            status=CanaryStatus.PENDING,
            started_at=None,
            metadata={}
        )
        
        with patch.object(canary_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                success = await canary_svc.start_canary_deployment(
                    deployment_id=deployment_id,
                    started_by="test_user"
                )
                
                assert success is True
                assert canary_svc.active_deployments[deployment_id].status == CanaryStatus.MONITORING
                assert canary_svc.active_deployments[deployment_id].started_at is not None
                mock_log.assert_called()
    
    @pytest.mark.asyncio
    async def test_promote_canary_deployment(self, canary_svc):
        """Test promoting a canary deployment"""
        deployment_id = "test_deployment_id"
        canary_svc.active_deployments[deployment_id] = Mock(
            id=deployment_id,
            status=CanaryStatus.MONITORING,
            started_at=datetime.utcnow(),
            completed_at=None,
            metadata={}
        )
        
        with patch.object(canary_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                success = await canary_svc.promote_canary_deployment(
                    deployment_id=deployment_id,
                    promoted_by="test_user"
                )
                
                assert success is True
                assert canary_svc.active_deployments[deployment_id].status == CanaryStatus.PROMOTED
                assert canary_svc.active_deployments[deployment_id].completed_at is not None
                assert deployment_id not in canary_svc.active_deployments
                mock_log.assert_called()
    
    @pytest.mark.asyncio
    async def test_rollback_canary_deployment(self, canary_svc):
        """Test rolling back a canary deployment"""
        deployment_id = "test_deployment_id"
        canary_svc.active_deployments[deployment_id] = Mock(
            id=deployment_id,
            status=CanaryStatus.MONITORING,
            started_at=datetime.utcnow(),
            completed_at=None,
            metadata={}
        )
        
        with patch.object(canary_svc.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                success = await canary_svc.rollback_canary_deployment(
                    deployment_id=deployment_id,
                    rolled_back_by="test_user",
                    reason="test_rollback"
                )
                
                assert success is True
                assert canary_svc.active_deployments[deployment_id].status == CanaryStatus.ROLLED_BACK
                assert canary_svc.active_deployments[deployment_id].completed_at is not None
                assert deployment_id not in canary_svc.active_deployments
                mock_log.assert_called()

class TestRollbackManager:
    """Test rollback manager functionality"""
    
    @pytest.fixture
    def rollback_mgr(self):
        return RollbackManager()
    
    @pytest.mark.asyncio
    async def test_create_rollback_plan(self, rollback_mgr):
        """Test creating a rollback plan"""
        with patch.object(rollback_mgr.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                plan_id = await rollback_mgr.create_rollback_plan(
                    name="Test Rollback Plan",
                    description="Test rollback plan description",
                    rollback_type=RollbackType.MANUAL,
                    scope=RollbackScope.FEATURE_FLAG,
                    target_id="test_flag_id",
                    rollback_steps=[{"type": "disable_feature_flag", "config": {"flag_id": "test_flag_id"}}],
                    created_by="test_user"
                )
                
                assert plan_id is not None
                assert plan_id in rollback_mgr.rollback_plans
                mock_log.assert_called()
    
    @pytest.mark.asyncio
    async def test_execute_rollback(self, rollback_mgr):
        """Test executing a rollback plan"""
        plan_id = "test_plan_id"
        rollback_mgr.rollback_plans[plan_id] = Mock(
            id=plan_id,
            name="Test Plan",
            rollback_steps=[{"type": "disable_feature_flag", "config": {"flag_id": "test_flag_id"}}]
        )
        
        with patch.object(rollback_mgr.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                with patch.object(rollback_mgr, '_execute_rollback_steps') as mock_execute:
                    execution_id = await rollback_mgr.execute_rollback(
                        plan_id=plan_id,
                        executed_by="test_user",
                        reason="test_execution"
                    )
                    
                    assert execution_id is not None
                    assert execution_id in rollback_mgr.active_rollbacks
                    mock_log.assert_called()
                    mock_execute.assert_called()
    
    @pytest.mark.asyncio
    async def test_emergency_rollback(self, rollback_mgr):
        """Test executing an emergency rollback"""
        with patch.object(rollback_mgr, 'create_rollback_plan') as mock_create_plan:
            with patch.object(rollback_mgr, 'execute_rollback') as mock_execute:
                mock_create_plan.return_value = "emergency_plan_id"
                mock_execute.return_value = "execution_id"
                
                execution_id = await rollback_mgr.emergency_rollback(
                    target_id="test_target",
                    scope=RollbackScope.SYSTEM_WIDE,
                    executed_by="test_user",
                    reason="emergency"
                )
                
                assert execution_id == "execution_id"
                mock_create_plan.assert_called()
                mock_execute.assert_called()
    
    @pytest.mark.asyncio
    async def test_check_rollback_criteria(self, rollback_mgr):
        """Test checking rollback criteria"""
        with patch.object(metrics_collector, 'get_aggregated_metrics') as mock_get_metrics:
            # Test with high error rate (should trigger rollback)
            mock_get_metrics.return_value = {
                "aggregated_metrics": [
                    {"name": "api_error_rate", "avg_value": 0.15},
                    {"name": "api_success_rate", "avg_value": 0.85},
                    {"name": "api_response_time", "avg_value": 1000}
                ]
            }
            
            should_rollback = await rollback_mgr.check_rollback_criteria(
                target_id="test_target",
                scope=RollbackScope.SYSTEM_WIDE
            )
            
            assert should_rollback is True
            
            # Test with low error rate (should not trigger rollback)
            mock_get_metrics.return_value = {
                "aggregated_metrics": [
                    {"name": "api_error_rate", "avg_value": 0.05},
                    {"name": "api_success_rate", "avg_value": 0.95},
                    {"name": "api_response_time", "avg_value": 500}
                ]
            }
            
            should_rollback = await rollback_mgr.check_rollback_criteria(
                target_id="test_target",
                scope=RollbackScope.SYSTEM_WIDE
            )
            
            assert should_rollback is False

class TestFeatureIntegration:
    """Test feature integration service functionality"""
    
    @pytest.fixture
    def feature_integration_svc(self):
        return FeatureIntegration()
    
    @pytest.mark.asyncio
    async def test_is_feature_enabled(self, feature_integration_svc):
        """Test checking if a feature is enabled"""
        with patch.object(feature_integration_svc.feature_flags_service, 'evaluate_feature_flag') as mock_evaluate:
            with patch.object(metrics_collector, 'increment_counter') as mock_metrics:
                mock_evaluate.return_value = Mock(enabled=True, variant=None, reason="all_users")
                
                enabled = await feature_integration_svc.is_feature_enabled(
                    feature_name="test_feature",
                    user_id="user123",
                    environment="production"
                )
                
                assert enabled is True
                mock_evaluate.assert_called()
                mock_metrics.assert_called()
    
    @pytest.mark.asyncio
    async def test_feature_context(self, feature_integration_svc):
        """Test feature context manager"""
        with patch.object(feature_integration_svc.feature_flags_service, 'evaluate_feature_flag') as mock_evaluate:
            with patch.object(metrics_collector, 'increment_counter') as mock_metrics:
                mock_evaluate.return_value = Mock(enabled=True, variant=None, reason="all_users")
                
                async with feature_integration_svc.feature_context(
                    feature_name="test_feature",
                    user_id="user123"
                ) as enabled:
                    assert enabled is True
                
                # Check that metrics were recorded
                assert mock_metrics.call_count == 2  # One for evaluation, one for usage
    
    @pytest.mark.asyncio
    async def test_track_feature_usage(self, feature_integration_svc):
        """Test tracking feature usage"""
        with patch.object(metrics_collector, 'increment_counter') as mock_metrics:
            await feature_integration_svc.track_feature_usage(
                feature_name="test_feature",
                action="click",
                user_id="user123",
                metadata={"button": "submit"}
            )
            
            mock_metrics.assert_called_with(
                name="feature_usage_actions",
                category=MetricCategory.USER,
                labels={
                    "feature_name": "test_feature",
                    "action": "click"
                },
                user_id="user123",
                metadata={"button": "submit"}
            )
    
    @pytest.mark.asyncio
    async def test_create_feature_flag(self, feature_integration_svc):
        """Test creating a feature flag through integration"""
        with patch.object(feature_integration_svc.feature_flags_service, 'create_feature_flag') as mock_create:
            with patch.object(metrics_collector, 'increment_counter') as mock_metrics:
                mock_create.return_value = "flag_id_123"
                
                flag_id = await feature_integration_svc.create_feature_flag(
                    name="test_flag",
                    description="Test flag",
                    flag_type="boolean",
                    created_by="test_user"
                )
                
                assert flag_id == "flag_id_123"
                mock_create.assert_called()
                mock_metrics.assert_called()
    
    @pytest.mark.asyncio
    async def test_start_canary_deployment(self, feature_integration_svc):
        """Test starting a canary deployment through integration"""
        with patch.object(feature_integration_svc.feature_flags_service, 'start_canary_deployment') as mock_start_flag:
            with patch.object(feature_integration_svc.canary_deployment_service, 'create_canary_deployment') as mock_create_canary:
                with patch.object(feature_integration_svc.canary_deployment_service, 'start_canary_deployment') as mock_start_canary:
                    with patch.object(metrics_collector, 'increment_counter') as mock_metrics:
                        mock_start_flag.return_value = True
                        mock_create_canary.return_value = "deployment_id_123"
                        mock_start_canary.return_value = True
                        
                        deployment_id = await feature_integration_svc.start_canary_deployment(
                            feature_flag_id="flag_id_123",
                            canary_percentage=10.0,
                            started_by="test_user"
                        )
                        
                        assert deployment_id == "deployment_id_123"
                        mock_start_flag.assert_called()
                        mock_create_canary.assert_called()
                        mock_start_canary.assert_called()
                        mock_metrics.assert_called()
    
    @pytest.mark.asyncio
    async def test_get_system_feature_summary(self, feature_integration_svc):
        """Test getting system feature summary"""
        with patch.object(feature_integration_svc.feature_flags_service, 'get_feature_flags') as mock_get_flags:
            with patch.object(feature_integration_svc.canary_deployment_service, 'get_canary_deployments') as mock_get_canaries:
                with patch.object(feature_integration_svc.rollback_manager, 'get_rollback_status') as mock_get_rollback:
                    mock_get_flags.return_value = [
                        {"status": "active", "name": "flag1"},
                        {"status": "canary", "name": "flag2"},
                        {"status": "inactive", "name": "flag3"}
                    ]
                    mock_get_canaries.return_value = [
                        {"status": "running", "name": "canary1"},
                        {"status": "monitoring", "name": "canary2"}
                    ]
                    mock_get_rollback.return_value = {"status": "completed"}
                    
                    # Mock active rollbacks
                    feature_integration_svc.rollback_manager.active_rollbacks = {"exec1": Mock()}
                    
                    summary = await feature_integration_svc.get_system_feature_summary()
                    
                    assert "feature_flags" in summary
                    assert "canary_deployments" in summary
                    assert "rollbacks" in summary
                    assert summary["feature_flags"]["total"] == 3
                    assert summary["feature_flags"]["active"] == 1
                    assert summary["feature_flags"]["canary"] == 1
                    assert summary["feature_flags"]["inactive"] == 1

class TestFeatureFlagsIntegration:
    """Integration tests for feature flags system"""
    
    @pytest.mark.asyncio
    async def test_end_to_end_feature_flag_flow(self):
        """Test complete feature flag lifecycle"""
        # Test feature flag creation
        with patch.object(feature_flags_service.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                flag_id = await feature_flags_service.create_feature_flag(
                    name="integration_test_flag",
                    description="Integration test feature flag",
                    flag_type=FeatureFlagType.BOOLEAN,
                    created_by="test_user"
                )
                
                assert flag_id is not None
                mock_log.assert_called()
        
        # Test canary deployment creation
        with patch.object(canary_deployment_service.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                deployment_id = await canary_deployment_service.create_canary_deployment(
                    feature_flag_id=flag_id,
                    name="Integration Test Canary",
                    description="Integration test canary deployment",
                    strategy=CanaryStrategy.PERCENTAGE,
                    created_by="test_user"
                )
                
                assert deployment_id is not None
                mock_log.assert_called()
        
        # Test rollback plan creation
        with patch.object(rollback_manager.db, '_get_connection') as mock_conn:
            mock_cursor = Mock()
            mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
            
            with patch.object(audit_service, 'log_event') as mock_log:
                plan_id = await rollback_manager.create_rollback_plan(
                    name="Integration Test Rollback",
                    description="Integration test rollback plan",
                    rollback_type=RollbackType.MANUAL,
                    scope=RollbackScope.FEATURE_FLAG,
                    target_id=flag_id,
                    rollback_steps=[{"type": "disable_feature_flag", "config": {"flag_id": flag_id}}],
                    created_by="test_user"
                )
                
                assert plan_id is not None
                mock_log.assert_called()
    
    def test_feature_flag_types_and_statuses(self):
        """Test feature flag types and statuses"""
        # Test all feature flag types
        types = [t for t in FeatureFlagType]
        assert len(types) == 5  # boolean, percentage, user_list, environment, experiment
        
        # Test all feature flag statuses
        statuses = [s for s in FeatureFlagStatus]
        assert len(statuses) == 5  # active, inactive, canary, rolling_back, rolled_back
        
        # Test all rollout strategies
        strategies = [s for s in RolloutStrategy]
        assert len(strategies) == 5  # all_users, percentage, user_list, environment, gradual
    
    def test_canary_strategies_and_statuses(self):
        """Test canary strategies and statuses"""
        # Test all canary strategies
        strategies = [s for s in CanaryStrategy]
        assert len(strategies) == 5  # percentage, user_list, environment, gradual, a_b_test
        
        # Test all canary statuses
        statuses = [s for s in CanaryStatus]
        assert len(statuses) == 6  # pending, running, monitoring, promoted, rolled_back, failed
    
    def test_rollback_types_and_scopes(self):
        """Test rollback types and scopes"""
        # Test all rollback types
        types = [t for t in RollbackType]
        assert len(types) == 4  # automatic, manual, scheduled, emergency
        
        # Test all rollback scopes
        scopes = [s for s in RollbackScope]
        assert len(scopes) == 5  # feature_flag, canary_deployment, system_wide, user_group, environment
        
        # Test all rollback statuses
        statuses = [s for s in RollbackStatus]
        assert len(statuses) == 5  # pending, in_progress, completed, failed, cancelled

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
