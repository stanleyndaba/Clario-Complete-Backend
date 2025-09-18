"""
Tests for the Detection Engine module.
"""

import pytest
import json
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime
from src.models.detection_engine import (
    DetectionEngine, AnomalyType, AnomalySeverity, 
    ThresholdOperator, DetectionThreshold, DetectionWhitelist,
    DetectionResult, AnomalyEvidence
)


class TestDetectionEngine:
    """Test cases for DetectionEngine class."""

    @pytest.fixture
    def mock_config(self):
        """Mock configuration for testing."""
        return {
            'database': {
                'url': 'postgresql://test:test@localhost:5432/testdb'
            },
            'aws': {
                'access_key_id': 'test-key',
                'secret_access_key': 'test-secret',
                'region': 'us-east-1',
                's3_bucket': 'test-bucket'
            },
            'redis': {
                'url': 'redis://localhost:6379'
            }
        }

    @pytest.fixture
    def detection_engine(self, mock_config):
        """Create DetectionEngine instance with mocked dependencies."""
        with patch('src.models.detection_engine.create_engine'), \
             patch('src.models.detection_engine.sessionmaker'), \
             patch('src.models.detection_engine.boto3.client'), \
             patch('src.models.detection_engine.redis.Redis.from_url'):
            
            engine = DetectionEngine(mock_config)
            return engine

    @pytest.fixture
    def mock_cost_documents(self):
        """Mock cost documents for testing."""
        return [
            {
                'id': 'doc-1',
                'sku_id': 'sku-123',
                'metadata': {
                    'lost_units': 2,
                    'fee_amount': 15.50,
                    'expected_fee': 10.00,
                    'damaged_stock': 1
                }
            },
            {
                'id': 'doc-2',
                'sku_id': 'sku-456',
                'metadata': {
                    'lost_units': 0,
                    'fee_amount': 5.00,
                    'expected_fee': 5.00,
                    'damaged_stock': 0
                }
            }
        ]

    def test_init(self, detection_engine, mock_config):
        """Test DetectionEngine initialization."""
        assert detection_engine.config == mock_config
        assert len(detection_engine.default_thresholds) == 3
        assert AnomalyType.LOST_UNITS in detection_engine.default_thresholds
        assert AnomalyType.OVERCHARGED_FEES in detection_engine.default_thresholds
        assert AnomalyType.DAMAGED_STOCK in detection_engine.default_thresholds

    def test_load_custom_thresholds_success(self, detection_engine):
        """Test successful loading of custom thresholds."""
        mock_session = Mock()
        mock_result = Mock()
        mock_result.anomaly_type = 'lost_units'
        mock_result.threshold = 5.0
        mock_result.operator = 'greater_than'
        mock_result.is_active = True
        mock_result.description = 'Custom threshold'
        
        mock_session.execute.return_value = [mock_result]
        
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.return_value = mock_session
            
            detection_engine.load_custom_thresholds()
            
            # Verify custom threshold was loaded
            assert detection_engine.default_thresholds[AnomalyType.LOST_UNITS].threshold == 5.0

    def test_load_custom_thresholds_failure(self, detection_engine):
        """Test handling of threshold loading failure."""
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.side_effect = Exception('DB Error')
            
            # Should not raise exception, just log warning
            detection_engine.load_custom_thresholds()

    def test_load_whitelists_success(self, detection_engine):
        """Test successful loading of whitelists."""
        mock_session = Mock()
        mock_result = Mock()
        mock_result.sku_code = 'sku-123'
        mock_result.vendor_name = 'Test Vendor'
        mock_result.account_id = 'acc-456'
        mock_result.reason = 'Test reason'
        mock_result.is_active = True
        
        mock_session.execute.return_value = [mock_result]
        
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.return_value = mock_session
            
            detection_engine.load_whitelists()
            
            assert len(detection_engine.whitelists) == 1
            assert detection_engine.whitelists[0].sku_code == 'sku-123'

    def test_load_whitelists_failure(self, detection_engine):
        """Test handling of whitelist loading failure."""
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.side_effect = Exception('DB Error')
            
            # Should not raise exception, just log warning
            detection_engine.load_whitelists()
            assert detection_engine.whitelists == []

    def test_detect_anomalies_lost_units(self, detection_engine, mock_cost_documents):
        """Test detection of lost units anomalies."""
        # Mock thresholds and whitelists
        detection_engine.default_thresholds = {
            AnomalyType.LOST_UNITS: DetectionThreshold(
                anomaly_type=AnomalyType.LOST_UNITS,
                threshold=1.0,
                operator=ThresholdOperator.GREATER_THAN
            )
        }
        detection_engine.whitelists = []
        
        anomalies = detection_engine.detect_anomalies(
            mock_cost_documents, 'claim-123', 'user-456'
        )
        
        assert len(anomalies) == 1
        assert anomalies[0].anomaly_type == AnomalyType.LOST_UNITS
        assert anomalies[0].actual_value == 2
        assert anomalies[0].severity == AnomalySeverity.MEDIUM

    def test_detect_anomalies_overcharged_fees(self, detection_engine, mock_cost_documents):
        """Test detection of overcharged fees anomalies."""
        detection_engine.default_thresholds = {
            AnomalyType.OVERCHARGED_FEES: DetectionThreshold(
                anomaly_type=AnomalyType.OVERCHARGED_FEES,
                threshold=0.50,
                operator=ThresholdOperator.GREATER_THAN
            )
        }
        detection_engine.whitelists = []
        
        anomalies = detection_engine.detect_anomalies(
            mock_cost_documents, 'claim-123', 'user-456'
        )
        
        assert len(anomalies) == 1
        assert anomalies[0].anomaly_type == AnomalyType.OVERCHARGED_FEES
        assert anomalies[0].actual_value == 5.50  # 15.50 - 10.00
        assert anomalies[0].severity == AnomalySeverity.HIGH

    def test_detect_anomalies_damaged_stock(self, detection_engine, mock_cost_documents):
        """Test detection of damaged stock anomalies."""
        detection_engine.default_thresholds = {
            AnomalyType.DAMAGED_STOCK: DetectionThreshold(
                anomaly_type=AnomalyType.DAMAGED_STOCK,
                threshold=0.0,
                operator=ThresholdOperator.GREATER_THAN
            )
        }
        detection_engine.whitelists = []
        
        anomalies = detection_engine.detect_anomalies(
            mock_cost_documents, 'claim-123', 'user-456'
        )
        
        assert len(anomalies) == 1
        assert anomalies[0].anomaly_type == AnomalyType.DAMAGED_STOCK
        assert anomalies[0].actual_value == 1
        assert anomalies[0].severity == AnomalySeverity.LOW

    def test_detect_anomalies_with_whitelist(self, detection_engine, mock_cost_documents):
        """Test that whitelisted items are not flagged as anomalies."""
        detection_engine.default_thresholds = {
            AnomalyType.LOST_UNITS: DetectionThreshold(
                anomaly_type=AnomalyType.LOST_UNITS,
                threshold=1.0,
                operator=ThresholdOperator.GREATER_THAN
            )
        }
        detection_engine.whitelists = [
            DetectionWhitelist(sku_code='sku-123', is_active=True)
        ]
        
        anomalies = detection_engine.detect_anomalies(
            mock_cost_documents, 'claim-123', 'user-456'
        )
        
        # Should not detect anomaly for whitelisted SKU
        assert len(anomalies) == 0

    def test_check_threshold_greater_than(self, detection_engine):
        """Test greater than threshold checking."""
        threshold = DetectionThreshold(
            anomaly_type=AnomalyType.LOST_UNITS,
            threshold=1.0,
            operator=ThresholdOperator.GREATER_THAN
        )
        
        assert detection_engine._check_threshold(2, threshold) is True
        assert detection_engine._check_threshold(0, threshold) is False

    def test_check_threshold_less_than(self, detection_engine):
        """Test less than threshold checking."""
        threshold = DetectionThreshold(
            anomaly_type=AnomalyType.DAMAGED_STOCK,
            threshold=5.0,
            operator=ThresholdOperator.LESS_THAN
        )
        
        assert detection_engine._check_threshold(3, threshold) is True
        assert detection_engine._check_threshold(7, threshold) is False

    def test_check_threshold_equals(self, detection_engine):
        """Test equals threshold checking."""
        threshold = DetectionThreshold(
            anomaly_type=AnomalyType.LOST_UNITS,
            threshold=1.0,
            operator=ThresholdOperator.EQUALS
        )
        
        assert detection_engine._check_threshold(1, threshold) is True
        assert detection_engine._check_threshold(2, threshold) is False

    def test_is_whitelisted_sku_code(self, detection_engine):
        """Test whitelist checking by SKU code."""
        detection_engine.whitelists = [
            DetectionWhitelist(sku_code='sku-123', is_active=True)
        ]
        
        cost_doc = {'sku_id': 'sku-123', 'metadata': {}}
        assert detection_engine._is_whitelisted(cost_doc) is True
        
        cost_doc = {'sku_id': 'sku-456', 'metadata': {}}
        assert detection_engine._is_whitelisted(cost_doc) is False

    def test_is_whitelisted_vendor_name(self, detection_engine):
        """Test whitelist checking by vendor name."""
        detection_engine.whitelists = [
            DetectionWhitelist(vendor_name='Test Vendor', is_active=True)
        ]
        
        cost_doc = {'metadata': {'vendor_name': 'Test Vendor'}}
        assert detection_engine._is_whitelisted(cost_doc) is True
        
        cost_doc = {'metadata': {'vendor_name': 'Other Vendor'}}
        assert detection_engine._is_whitelisted(cost_doc) is False

    def test_is_whitelisted_inactive(self, detection_engine):
        """Test that inactive whitelists are ignored."""
        detection_engine.whitelists = [
            DetectionWhitelist(sku_code='sku-123', is_active=False)
        ]
        
        cost_doc = {'sku_id': 'sku-123', 'metadata': {}}
        assert detection_engine._is_whitelisted(cost_doc) is False

    def test_calculate_severity(self, detection_engine):
        """Test severity calculation."""
        assert detection_engine._calculate_severity(1.5, 1.0) == AnomalySeverity.MEDIUM
        assert detection_engine._calculate_severity(4.0, 1.0) == AnomalySeverity.HIGH
        assert detection_engine._calculate_severity(6.0, 1.0) == AnomalySeverity.CRITICAL
        assert detection_engine._calculate_severity(0.5, 1.0) == AnomalySeverity.LOW

    def test_calculate_confidence(self, detection_engine):
        """Test confidence calculation."""
        assert detection_engine._calculate_confidence(5.0, 1.0) == 0.5
        assert detection_engine._calculate_confidence(20.0, 1.0) == 0.95
        assert detection_engine._calculate_confidence(0.1, 1.0) == 0.5

    def test_generate_evidence_artifact(self, detection_engine):
        """Test evidence artifact generation and S3 upload."""
        anomalies = [
            DetectionResult(
                detection_job_id='',
                cost_doc_id='doc-1',
                sku_id='sku-123',
                anomaly_type=AnomalyType.LOST_UNITS,
                severity=AnomalySeverity.MEDIUM,
                confidence=0.7,
                evidence_url='',
                evidence_json={'claim_id': 'claim-123'},
                threshold_value=1.0,
                actual_value=2,
                is_whitelisted=False
            )
        ]
        
        detection_engine.s3_client.put_object = Mock()
        
        evidence_key = detection_engine.generate_evidence_artifact(
            'job-123', 'user-456', anomalies
        )
        
        assert evidence_key == 'evidence/user-456/job-123/detection.json'
        detection_engine.s3_client.put_object.assert_called_once()
        
        # Verify evidence structure
        call_args = detection_engine.s3_client.put_object.call_args
        evidence_data = json.loads(call_args[1]['Body'])
        
        assert evidence_data['sync_id'] == 'job-123'
        assert evidence_data['seller_id'] == 'user-456'
        assert len(evidence_data['detected_anomalies']) == 1
        assert evidence_data['detected_anomalies'][0]['event_type'] == 'lost_units'

    def test_generate_evidence_artifact_s3_error(self, detection_engine):
        """Test handling of S3 upload errors."""
        anomalies = [
            DetectionResult(
                detection_job_id='',
                cost_doc_id='doc-1',
                sku_id='sku-123',
                anomaly_type=AnomalyType.LOST_UNITS,
                severity=AnomalySeverity.MEDIUM,
                confidence=0.7,
                evidence_url='',
                evidence_json={},
                threshold_value=1.0,
                actual_value=2,
                is_whitelisted=False
            )
        ]
        
        detection_engine.s3_client.put_object.side_effect = Exception('S3 Error')
        
        with pytest.raises(Exception, match='S3 Error'):
            detection_engine.generate_evidence_artifact('job-123', 'user-456', anomalies)

    def test_store_detection_results(self, detection_engine):
        """Test storage of detection results in database."""
        anomalies = [
            DetectionResult(
                detection_job_id='',
                cost_doc_id='doc-1',
                sku_id='sku-123',
                anomaly_type=AnomalyType.LOST_UNITS,
                severity=AnomalySeverity.MEDIUM,
                confidence=0.7,
                evidence_url='',
                evidence_json={'claim_id': 'claim-123'},
                threshold_value=1.0,
                actual_value=2,
                is_whitelisted=False
            )
        ]
        
        mock_session = Mock()
        
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.return_value = mock_session
            
            detection_engine.store_detection_results('job-123', anomalies, 'evidence-url')
            
            # Verify database insert was called
            mock_session.execute.assert_called_once()
            mock_session.commit.assert_called_once()

    def test_store_detection_results_error(self, detection_engine):
        """Test handling of database storage errors."""
        anomalies = [
            DetectionResult(
                detection_job_id='',
                cost_doc_id='doc-1',
                sku_id='sku-123',
                anomaly_type=AnomalyType.LOST_UNITS,
                severity=AnomalySeverity.MEDIUM,
                confidence=0.7,
                evidence_url='',
                evidence_json={},
                threshold_value=1.0,
                actual_value=2,
                is_whitelisted=False
            )
        ]
        
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.side_effect = Exception('DB Error')
            
            with pytest.raises(Exception, match='DB Error'):
                detection_engine.store_detection_results('job-123', anomalies, 'evidence-url')

    def test_get_detection_results(self, detection_engine):
        """Test retrieval of detection results."""
        mock_session = Mock()
        mock_result = Mock()
        mock_result.anomaly_type = 'lost_units'
        mock_result.severity = 'medium'
        
        mock_session.execute.return_value = [mock_result]
        
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.return_value = mock_session
            
            results = detection_engine.get_detection_results('claim-123')
            
            assert len(results) == 1
            mock_session.execute.assert_called_once()

    def test_get_detection_results_error(self, detection_engine):
        """Test handling of result retrieval errors."""
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.side_effect = Exception('DB Error')
            
            results = detection_engine.get_detection_results('claim-123')
            assert results == []

    def test_get_detection_statistics(self, detection_engine):
        """Test retrieval of detection statistics."""
        mock_session = Mock()
        
        # Mock job statistics
        mock_job_stats = Mock()
        mock_job_stats.total_jobs = 10
        mock_job_stats.completed_jobs = 8
        mock_job_stats.failed_jobs = 1
        
        # Mock anomaly count
        mock_anomaly_count = Mock()
        mock_anomaly_count.total_anomalies = 15
        
        mock_session.execute.return_value.fetchone.side_effect = [
            mock_job_stats, mock_anomaly_count
        ]
        
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.return_value = mock_session
            
            stats = detection_engine.get_detection_statistics('user-123')
            
            assert stats['total_jobs'] == 10
            assert stats['completed_jobs'] == 8
            assert stats['failed_jobs'] == 1
            assert stats['total_anomalies'] == 15
            assert stats['success_rate'] == 80.0

    def test_get_detection_statistics_error(self, detection_engine):
        """Test handling of statistics retrieval errors."""
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.side_effect = Exception('DB Error')
            
            stats = detection_engine.get_detection_statistics('user-123')
            
            assert stats == {
                'total_jobs': 0,
                'completed_jobs': 0,
                'failed_jobs': 0,
                'total_anomalies': 0,
                'success_rate': 0
            }

    def test_get_detection_statistics_zero_jobs(self, detection_engine):
        """Test statistics calculation with zero jobs."""
        mock_session = Mock()
        
        mock_job_stats = Mock()
        mock_job_stats.total_jobs = 0
        mock_job_stats.completed_jobs = 0
        mock_job_stats.failed_jobs = 0
        
        mock_anomaly_count = Mock()
        mock_anomaly_count.total_anomalies = 0
        
        mock_session.execute.return_value.fetchone.side_effect = [
            mock_job_stats, mock_anomaly_count
        ]
        
        with patch.object(detection_engine, 'SessionLocal') as mock_session_local:
            mock_session_local.return_value.__enter__.return_value = mock_session
            
            stats = detection_engine.get_detection_statistics('user-123')
            
            assert stats['success_rate'] == 0


class TestAnomalyTypes:
    """Test cases for AnomalyType enum."""

    def test_anomaly_types(self):
        """Test that all expected anomaly types are defined."""
        expected_types = [
            'lost_units',
            'overcharged_fees',
            'damaged_stock',
            'duplicate_charges',
            'invalid_shipping',
            'pricing_discrepancy'
        ]
        
        for expected_type in expected_types:
            assert expected_type in [t.value for t in AnomalyType]


class TestAnomalySeverity:
    """Test cases for AnomalySeverity enum."""

    def test_severity_levels(self):
        """Test that all expected severity levels are defined."""
        expected_levels = ['low', 'medium', 'high', 'critical']
        
        for expected_level in expected_levels:
            assert expected_level in [s.value for s in AnomalySeverity]


class TestThresholdOperator:
    """Test cases for ThresholdOperator enum."""

    def test_operators(self):
        """Test that all expected operators are defined."""
        expected_operators = [
            'greater_than',
            'greater_than_or_equal',
            'less_than',
            'less_than_or_equal',
            'equals',
            'not_equals'
        ]
        
        for expected_operator in expected_operators:
            assert expected_operator in [o.value for o in ThresholdOperator]


class TestDetectionThreshold:
    """Test cases for DetectionThreshold dataclass."""

    def test_detection_threshold_creation(self):
        """Test DetectionThreshold creation and attributes."""
        threshold = DetectionThreshold(
            anomaly_type=AnomalyType.LOST_UNITS,
            threshold=1.0,
            operator=ThresholdOperator.GREATER_THAN,
            description='Test threshold'
        )
        
        assert threshold.anomaly_type == AnomalyType.LOST_UNITS
        assert threshold.threshold == 1.0
        assert threshold.operator == ThresholdOperator.GREATER_THAN
        assert threshold.is_active is True
        assert threshold.description == 'Test threshold'


class TestDetectionWhitelist:
    """Test cases for DetectionWhitelist dataclass."""

    def test_detection_whitelist_creation(self):
        """Test DetectionWhitelist creation and attributes."""
        whitelist = DetectionWhitelist(
            sku_code='sku-123',
            vendor_name='Test Vendor',
            reason='Test reason'
        )
        
        assert whitelist.sku_code == 'sku-123'
        assert whitelist.vendor_name == 'Test Vendor'
        assert whitelist.reason == 'Test reason'
        assert whitelist.is_active is True


class TestAnomalyEvidence:
    """Test cases for AnomalyEvidence dataclass."""

    def test_anomaly_evidence_creation(self):
        """Test AnomalyEvidence creation and attributes."""
        evidence = AnomalyEvidence(
            sync_id='sync-123',
            seller_id='seller-456',
            detected_anomalies=[{'type': 'test'}],
            metadata={'version': '1.0'},
            created_at='2024-01-01T00:00:00Z'
        )
        
        assert evidence.sync_id == 'sync-123'
        assert evidence.seller_id == 'seller-456'
        assert len(evidence.detected_anomalies) == 1
        assert evidence.metadata['version'] == '1.0'
        assert evidence.created_at == '2024-01-01T00:00:00Z'


class TestDetectionResult:
    """Test cases for DetectionResult dataclass."""

    def test_detection_result_creation(self):
        """Test DetectionResult creation and attributes."""
        result = DetectionResult(
            detection_job_id='job-123',
            cost_doc_id='doc-456',
            sku_id='sku-789',
            anomaly_type=AnomalyType.LOST_UNITS,
            severity=AnomalySeverity.MEDIUM,
            confidence=0.8,
            evidence_url='evidence-url',
            evidence_json={'test': 'data'},
            threshold_value=1.0,
            actual_value=2.0,
            is_whitelisted=False
        )
        
        assert result.detection_job_id == 'job-123'
        assert result.cost_doc_id == 'doc-456'
        assert result.sku_id == 'sku-789'
        assert result.anomaly_type == AnomalyType.LOST_UNITS
        assert result.severity == AnomalySeverity.MEDIUM
        assert result.confidence == 0.8
        assert result.evidence_url == 'evidence-url'
        assert result.threshold_value == 1.0
        assert result.actual_value == 2.0
        assert result.is_whitelisted is False


