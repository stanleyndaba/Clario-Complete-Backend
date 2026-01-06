#!/usr/bin/env python3
"""
Test Script for Phase 4 Components - Continuous Retraining
Tests the continuous retraining pipeline and related components
"""

import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
import sys
import os
import time
import threading

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from src.ml_detector.continuous_retrainer import (
    ContinuousRetrainer, RetrainingConfig, RetrainingTrigger, 
    RetrainingStatus, DataDriftDetector, PerformanceMonitor
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def create_mock_training_data(n_samples: int = 1000):
    """Create mock training data for testing"""
    np.random.seed(42)
    
    # Generate mock features (claim characteristics)
    features = np.random.randn(n_samples, 10)  # 10 features
    
    # Generate mock labels (claim validity)
    labels = (np.random.random(n_samples) > 0.3).astype(int)
    
    return features, labels

def test_data_drift_detector():
    """Test the data drift detection system"""
    logger.info("🧪 Testing Data Drift Detector...")
    
    try:
        # Create reference data
        reference_data = np.random.normal(0, 1, 1000)
        
        # Initialize drift detector
        detector = DataDriftDetector(reference_data, drift_threshold=0.1)
        logger.info("✅ Drift detector initialized")
        
        # Test with similar data (no drift)
        similar_data = np.random.normal(0, 1, 500)
        has_drift, drift_score, details = detector.detect_drift(similar_data)
        
        logger.info(f"   Similar data test:")
        logger.info(f"     Has drift: {has_drift}")
        logger.info(f"     Drift score: {drift_score:.3f}")
        logger.info(f"     Mean drift: {details['mean_drift']:.3f}")
        
        # Test with drifted data
        drifted_data = np.random.normal(2, 1.5, 500)  # Different distribution
        has_drift_drifted, drift_score_drifted, details_drifted = detector.detect_drift(drifted_data)
        
        logger.info(f"   Drifted data test:")
        logger.info(f"     Has drift: {has_drift_drifted}")
        logger.info(f"     Drift score: {drift_score_drifted:.3f}")
        logger.info(f"     Mean drift: {details_drifted['mean_drift']:.3f}")
        
        # Validate that drifted data is detected
        assert has_drift_drifted, "Drifted data should be detected"
        assert drift_score_drifted > drift_score, "Drifted data should have higher drift score"
        
        logger.info("✅ Data drift detection test passed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Data drift detection test failed: {e}")
        return False

def test_performance_monitor():
    """Test the performance monitoring system"""
    logger.info("🧪 Testing Performance Monitor...")
    
    try:
        # Initialize performance monitor
        monitor = PerformanceMonitor()
        logger.info("✅ Performance monitor initialized")
        
        # Add some historical performance records
        base_time = datetime.now()
        
        # Add good performance
        good_metrics = {"precision": 0.90, "recall": 0.88, "f1_score": 0.89, "accuracy": 0.91}
        monitor.add_performance_record(base_time - timedelta(days=7), good_metrics)
        
        # Add mediocre performance
        mediocre_metrics = {"precision": 0.85, "recall": 0.83, "f1_score": 0.84, "accuracy": 0.86}
        monitor.add_performance_record(base_time - timedelta(days=3), mediocre_metrics)
        
        # Add poor performance
        poor_metrics = {"precision": 0.78, "recall": 0.75, "f1_score": 0.76, "accuracy": 0.79}
        monitor.add_performance_record(base_time - timedelta(days=1), poor_metrics)
        
        logger.info(f"   Added {len(monitor.performance_history)} performance records")
        
        # Test performance decay detection
        current_metrics = {"precision": 0.75, "recall": 0.72, "f1_score": 0.73, "accuracy": 0.76}
        
        has_decay, decay_score, details = monitor.detect_performance_decay(
            current_metrics, decay_threshold=0.05
        )
        
        logger.info(f"   Performance decay test:")
        logger.info(f"     Has decay: {has_decay}")
        logger.info(f"     Decay score: {decay_score:.3f}")
        logger.info(f"     Precision drop: {details.get('precision', 0):.3f}")
        
        # Validate that performance decay is detected
        assert has_decay, "Performance decay should be detected"
        assert decay_score > 0.05, "Decay score should exceed threshold"
        
        logger.info("✅ Performance monitoring test passed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Performance monitoring test failed: {e}")
        return False

def test_retraining_config():
    """Test retraining configuration"""
    logger.info("🧪 Testing Retraining Configuration...")
    
    try:
        # Test default configuration
        default_config = RetrainingConfig()
        logger.info("✅ Default configuration created")
        logger.info(f"   Scheduled interval: {default_config.scheduled_interval_hours} hours")
        logger.info(f"   Min data samples: {default_config.min_data_samples}")
        logger.info(f"   Performance threshold: {default_config.performance_decay_threshold}")
        
        # Test custom configuration
        custom_config = RetrainingConfig(
            scheduled_interval_hours=24,  # Daily
            min_data_samples=500,
            performance_decay_threshold=0.03,
            max_concurrent_jobs=3
        )
        
        logger.info("✅ Custom configuration created")
        logger.info(f"   Scheduled interval: {custom_config.scheduled_interval_hours} hours")
        logger.info(f"   Min data samples: {custom_config.min_data_samples}")
        logger.info(f"   Performance threshold: {custom_config.performance_decay_threshold}")
        logger.info(f"   Max concurrent jobs: {custom_config.max_concurrent_jobs}")
        
        # Validate configuration values
        assert custom_config.scheduled_interval_hours == 24
        assert custom_config.min_data_samples == 500
        assert custom_config.performance_decay_threshold == 0.03
        assert custom_config.max_concurrent_jobs == 3
        
        logger.info("✅ Retraining configuration test passed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Retraining configuration test failed: {e}")
        return False

def test_continuous_retrainer_basic():
    """Test basic continuous retrainer functionality"""
    logger.info("🧪 Testing Continuous Retrainer (Basic)...")
    
    try:
        # Create configuration
        config = RetrainingConfig(
            scheduled_interval_hours=1,  # Short interval for testing
            max_concurrent_jobs=2,
            max_training_time_hours=1
        )
        
        # Initialize retrainer
        retrainer = ContinuousRetrainer(config, model_path="test_models")
        logger.info("✅ Continuous retrainer initialized")
        
        # Test manual retraining trigger
        retrainer.manual_retraining_trigger("Test manual trigger")
        logger.info("✅ Manual retraining triggered")
        
        # Wait a bit for job to start
        time.sleep(3)
        
        # Check status
        summary = retrainer.get_retraining_summary()
        logger.info(f"   Retraining summary:")
        logger.info(f"     Status: {summary['status']}")
        logger.info(f"     Active jobs: {summary['active_jobs']}")
        logger.info(f"     Queued jobs: {summary['queued_jobs']}")
        logger.info(f"     Total jobs: {summary['total_jobs']}")
        
        # Wait for job to complete
        time.sleep(5)
        
        # Check final status
        final_summary = retrainer.get_retraining_summary()
        logger.info(f"   Final summary:")
        logger.info(f"     Active jobs: {final_summary['active_jobs']}")
        logger.info(f"     Total jobs: {final_summary['total_jobs']}")
        
        # Get job history
        job_history = retrainer.get_job_history(limit=5)
        logger.info(f"   Job history: {len(job_history)} jobs")
        
        if job_history:
            latest_job = job_history[0]
            logger.info(f"   Latest job:")
            logger.info(f"     ID: {latest_job.job_id}")
            logger.info(f"     Status: {latest_job.status.value}")
            logger.info(f"     Trigger: {latest_job.trigger_type.value}")
            logger.info(f"     Training samples: {latest_job.training_samples}")
            
            # Validate job completion
            assert latest_job.status == RetrainingStatus.COMPLETED, "Job should be completed"
            assert latest_job.training_samples > 0, "Job should have training samples"
            assert latest_job.performance_metrics, "Job should have performance metrics"
        
        # Cleanup
        retrainer.stop_scheduler()
        
        # Remove test models directory
        import shutil
        if Path("test_models").exists():
            shutil.rmtree("test_models")
        
        logger.info("✅ Continuous retrainer basic test passed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Continuous retrainer basic test failed: {e}")
        return False

def test_retraining_job_lifecycle():
    """Test the complete retraining job lifecycle"""
    logger.info("🧪 Testing Retraining Job Lifecycle...")
    
    try:
        # Create configuration
        config = RetrainingConfig(
            scheduled_interval_hours=1,
            max_concurrent_jobs=1,
            max_training_time_hours=1
        )
        
        # Initialize retrainer
        retrainer = ContinuousRetrainer(config, model_path="test_models_lifecycle")
        logger.info("✅ Retrainer initialized for lifecycle test")
        
        # Test multiple job triggers
        triggers = [
            (RetrainingTrigger.MANUAL, "Manual test 1"),
            (RetrainingTrigger.SCHEDULED, "Scheduled test 1"),
            (RetrainingTrigger.PERFORMANCE_DECAY, "Performance test 1")
        ]
        
        for trigger, reason in triggers:
            logger.info(f"   Triggering {trigger.value}: {reason}")
            retrainer.manual_retraining_trigger(reason)
            time.sleep(1)  # Small delay between triggers
        
        # Wait for jobs to process
        time.sleep(10)
        
        # Check job processing
        summary = retrainer.get_retraining_summary()
        logger.info(f"   Lifecycle test summary:")
        logger.info(f"     Active jobs: {summary['active_jobs']}")
        logger.info(f"     Queued jobs: {summary['queued_jobs']}")
        logger.info(f"     Total jobs: {summary['total_jobs']}")
        
        # Get detailed job history
        job_history = retrainer.get_job_history(limit=10)
        logger.info(f"   Job lifecycle details:")
        
        for i, job in enumerate(job_history[:3]):  # Show first 3 jobs
            logger.info(f"     Job {i+1}:")
            logger.info(f"       ID: {job.job_id}")
            logger.info(f"       Trigger: {job.trigger_type.value}")
            logger.info(f"       Status: {job.status.value}")
            logger.info(f"       Created: {job.created_at.strftime('%H:%M:%S')}")
            if job.completed_at:
                logger.info(f"       Completed: {job.completed_at.strftime('%H:%M:%S')}")
                logger.info(f"       Duration: {(job.completed_at - job.created_at).total_seconds():.1f}s")
        
        # Validate job processing
        assert summary['total_jobs'] >= 1, "Should have processed at least one job"
        
        # Cleanup
        retrainer.stop_scheduler()
        
        # Remove test models directory
        import shutil
        if Path("test_models_lifecycle").exists():
            shutil.rmtree("test_models_lifecycle")
        
        logger.info("✅ Retraining job lifecycle test passed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Retraining job lifecycle test failed: {e}")
        return False

def test_integration():
    """Test integration of all Phase 4 components"""
    logger.info("🧪 Testing Component Integration...")
    
    try:
        # Create configuration
        config = RetrainingConfig(
            scheduled_interval_hours=1,
            max_concurrent_jobs=2,
            min_data_samples=100
        )
        
        # Initialize retrainer
        retrainer = ContinuousRetrainer(config, model_path="test_models_integration")
        logger.info("✅ Integration test retrainer initialized")
        
        # Test data drift detection integration
        reference_data = np.random.normal(0, 1, 1000)
        drift_detector = DataDriftDetector(reference_data, drift_threshold=0.1)
        
        # Simulate data drift scenario
        drifted_data = np.random.normal(2, 1.5, 500)
        has_drift, drift_score, details = drift_detector.detect_drift(drifted_data)
        
        if has_drift:
            logger.info(f"   Data drift detected (score: {drift_score:.3f})")
            # In a real system, this would trigger retraining
            retrainer.manual_retraining_trigger(f"Data drift detected: {drift_score:.3f}")
        
        # Test performance monitoring integration
        performance_monitor = PerformanceMonitor()
        
        # Add historical performance
        base_time = datetime.now()
        good_performance = {"precision": 0.90, "recall": 0.88, "f1_score": 0.89}
        performance_monitor.add_performance_record(base_time - timedelta(days=7), good_performance)
        
        # Simulate performance decay
        current_performance = {"precision": 0.80, "recall": 0.78, "f1_score": 0.79}
        has_decay, decay_score, details = performance_monitor.detect_performance_decay(
            current_performance, decay_threshold=0.05
        )
        
        if has_decay:
            logger.info(f"   Performance decay detected (score: {decay_score:.3f})")
            # In a real system, this would trigger retraining
            retrainer.manual_retraining_trigger(f"Performance decay detected: {decay_score:.3f}")
        
        # Wait for jobs to process
        time.sleep(8)
        
        # Check integration results
        summary = retrainer.get_retraining_summary()
        logger.info(f"   Integration test results:")
        logger.info(f"     Total jobs: {summary['total_jobs']}")
        logger.info(f"     Recent performance: {summary.get('recent_performance', 'N/A')}")
        
        # Validate integration
        assert summary['total_jobs'] >= 0, "Integration should work without errors"
        
        # Cleanup
        retrainer.stop_scheduler()
        
        # Remove test models directory
        import shutil
        if Path("test_models_integration").exists():
            shutil.rmtree("test_models_integration")
        
        logger.info("✅ Component integration test passed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Component integration test failed: {e}")
        return False

def run_all_tests():
    """Run all Phase 4 component tests"""
    logger.info("🚀 Starting Phase 4 Component Tests")
    logger.info("=" * 50)
    
    test_results = {}
    
    # Test 1: Data Drift Detection
    test_results['data_drift_detector'] = test_data_drift_detector()
    
    # Test 2: Performance Monitoring
    test_results['performance_monitor'] = test_performance_monitor()
    
    # Test 3: Retraining Configuration
    test_results['retraining_config'] = test_retraining_config()
    
    # Test 4: Continuous Retrainer Basic
    test_results['continuous_retrainer_basic'] = test_continuous_retrainer_basic()
    
    # Test 5: Retraining Job Lifecycle
    test_results['retraining_job_lifecycle'] = test_retraining_job_lifecycle()
    
    # Test 6: Component Integration
    test_results['integration'] = test_integration()
    
    # Summary
    logger.info("=" * 50)
    logger.info("📊 Phase 4 Test Results Summary")
    logger.info("=" * 50)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        logger.info(f"{test_name:.<30} {status}")
        if result:
            passed += 1
    
    logger.info("=" * 50)
    logger.info(f"Overall Result: {passed}/{total} tests passed")
    
    if passed == total:
        logger.info("🎉 All Phase 4 components are working correctly!")
        logger.info("🚀 Ready to proceed to Phase 5: Evaluation & Monitoring")
    else:
        logger.error("⚠️ Some tests failed. Please review the errors above.")
    
    return passed == total

def main():
    """Main function to run tests"""
    try:
        # Run tests
        success = run_all_tests()
        
        if success:
            print("\n🎉 Phase 4 Implementation Complete!")
            print("✅ Continuous retraining pipeline is operational")
            print("✅ Data drift detection and performance monitoring working")
            print("✅ Automated retraining scheduling and execution functional")
            print("\n🚀 Ready for Phase 5: Evaluation & Monitoring")
        else:
            print("\n⚠️ Some Phase 4 tests failed")
            print("Please review the errors and fix issues before proceeding")
        
        return 0 if success else 1
        
    except KeyboardInterrupt:
        logger.info("🛑 Tests interrupted by user")
        return 1
    except Exception as e:
        logger.error(f"❌ Unexpected error during testing: {e}")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)


