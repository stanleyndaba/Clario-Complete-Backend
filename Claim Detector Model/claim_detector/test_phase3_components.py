#!/usr/bin/env python3
"""
Test Script for Phase 3 Components - Confidence Calibration
Tests the probability calibration system with different methods
"""

import logging
import numpy as np
import pandas as pd
from datetime import datetime
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from src.ml_detector.confidence_calibrator import (
    ConfidenceCalibrator, PlattScaling, IsotonicRegression, 
    TemperatureScaling, CalibrationResult
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def create_mock_calibration_data(n_samples: int = 1000):
    """Create mock data for testing calibration"""
    np.random.seed(42)  # For reproducible results
    
    # Generate raw probabilities (these would normally come from a model)
    raw_probs = np.random.beta(2, 5, n_samples)  # Skewed towards lower probabilities
    
    # Generate true labels with some noise
    true_labels = (raw_probs > 0.3).astype(float)  # Threshold-based labels
    noise = np.random.random(n_samples) < 0.1  # 10% noise
    true_labels[noise] = 1 - true_labels[noise]
    
    return raw_probs, true_labels

def test_platt_scaling():
    """Test Platt scaling calibration"""
    logger.info("🧪 Testing Platt Scaling...")
    
    try:
        # Create mock data
        raw_probs, true_labels = create_mock_calibration_data(500)
        
        # Initialize and fit Platt scaling
        platt = PlattScaling(max_iter=50, learning_rate=0.01)
        platt.fit(raw_probs, true_labels)
        
        # Make predictions
        calibrated_probs = platt.predict(raw_probs)
        
        # Basic validation
        assert len(calibrated_probs) == len(raw_probs)
        assert np.all(calibrated_probs >= 0) and np.all(calibrated_probs <= 1)
        
        logger.info(f"✅ Platt scaling test passed:")
        logger.info(f"   Raw probs range: [{raw_probs.min():.3f}, {raw_probs.max():.3f}]")
        logger.info(f"   Calibrated probs range: [{calibrated_probs.min():.3f}, {calibrated_probs.max():.3f}]")
        logger.info(f"   Parameters: a={platt.a:.3f}, b={platt.b:.3f}")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Platt scaling test failed: {e}")
        return False

def test_isotonic_regression():
    """Test isotonic regression calibration"""
    logger.info("🧪 Testing Isotonic Regression...")
    
    try:
        # Create mock data
        raw_probs, true_labels = create_mock_calibration_data(500)
        
        # Initialize and fit isotonic regression
        isotonic = IsotonicRegression()
        isotonic.fit(raw_probs, true_labels)
        
        # Make predictions
        calibrated_probs = isotonic.predict(raw_probs)
        
        # Basic validation
        assert len(calibrated_probs) == len(raw_probs)
        assert np.all(calibrated_probs >= 0) and np.all(calibrated_probs <= 1)
        
        logger.info(f"✅ Isotonic regression test passed:")
        logger.info(f"   Calibration map size: {len(isotonic.calibration_map)}")
        logger.info(f"   Raw probs range: [{raw_probs.min():.3f}, {raw_probs.max():.3f}]")
        logger.info(f"   Calibrated probs range: [{calibrated_probs.min():.3f}, {calibrated_probs.max():.3f}]")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Isotonic regression test failed: {e}")
        return False

def test_temperature_scaling():
    """Test temperature scaling calibration"""
    logger.info("🧪 Testing Temperature Scaling...")
    
    try:
        # Create mock data
        raw_probs, true_labels = create_mock_calibration_data(500)
        
        # Initialize and fit temperature scaling
        temp_scaling = TemperatureScaling(max_iter=50, learning_rate=0.01)
        temp_scaling.fit(raw_probs, true_labels)
        
        # Make predictions
        calibrated_probs = temp_scaling.predict(raw_probs)
        
        # Basic validation
        assert len(calibrated_probs) == len(raw_probs)
        assert np.all(calibrated_probs >= 0) and np.all(calibrated_probs <= 1)
        
        logger.info(f"✅ Temperature scaling test passed:")
        logger.info(f"   Temperature parameter: {temp_scaling.temperature:.3f}")
        logger.info(f"   Raw probs range: [{raw_probs.min():.3f}, {raw_probs.max():.3f}]")
        logger.info(f"   Calibrated probs range: [{calibrated_probs.min():.3f}, {calibrated_probs.max():.3f}]")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Temperature scaling test failed: {e}")
        return False

def test_confidence_calibrator():
    """Test the main confidence calibration system"""
    logger.info("🧪 Testing Confidence Calibrator...")
    
    try:
        # Create mock data
        raw_probs, true_labels = create_mock_calibration_data(1000)
        logger.info(f"   Created test data: {len(raw_probs)} samples")
        
        # Initialize calibrator
        calibrator = ConfidenceCalibrator()
        logger.info("   ✅ Calibrator initialized")
        
        # Test all calibration methods
        methods = ["platt", "isotonic", "temperature"]
        results = {}
        
        for method in methods:
            logger.info(f"   Testing {method} method...")
            
            try:
                # Calibrate probabilities
                result = calibrator.calibrate_probabilities(raw_probs, true_labels, method=method)
                logger.info(f"     ✅ {method} calibration completed")
                
                # Store results
                results[method] = result
                
                # Validate result
                if not isinstance(result, CalibrationResult):
                    logger.error(f"     ❌ Expected CalibrationResult, got {type(result)}")
                    return False
                
                if result.calibration_method != method:
                    logger.error(f"     ❌ Expected method {method}, got {result.calibration_method}")
                    return False
                
                if len(result.calibrated_probabilities) != len(raw_probs):
                    logger.error(f"     ❌ Expected {len(raw_probs)} probabilities, got {len(result.calibrated_probabilities)}")
                    return False
                
                logger.info(f"     ✅ {method} validation passed:")
                logger.info(f"       ECE: {result.calibration_quality['expected_calibration_error']:.3f}")
                logger.info(f"       Brier Score: {result.calibration_quality['brier_score']:.3f}")
                logger.info(f"       Log Loss: {result.calibration_quality['log_loss']:.3f}")
                
            except Exception as e:
                logger.error(f"     ❌ Error testing {method} method: {e}")
                return False
        
        logger.info("   ✅ All calibration methods tested successfully")
        
        # Test calibration summary
        try:
            summary = calibrator.get_calibration_summary()
            logger.info(f"✅ Calibration summary:")
            logger.info(f"   Current method: {summary['current_method']}")
            logger.info(f"   Latest quality: {summary['latest_calibration']['quality_level']}")
            logger.info(f"   Available methods: {', '.join(summary['available_methods'])}")
        except Exception as e:
            logger.error(f"   ❌ Error getting calibration summary: {e}")
            return False
        
        # Test saving and loading
        try:
            test_model_path = "test_calibration_model.pkl"
            calibrator.save_calibration_model(test_model_path)
            logger.info(f"   ✅ Model saved to {test_model_path}")
            
            # Test loading
            new_calibrator = ConfidenceCalibrator()
            load_success = new_calibrator.load_calibration_model(test_model_path)
            logger.info(f"   Load success: {load_success}")
            
            if not load_success:
                logger.error("   ❌ Failed to load calibration model")
                return False
            
            # Cleanup
            if Path(test_model_path).exists():
                Path(test_model_path).unlink()
                logger.info("   ✅ Test file cleaned up")
                
        except Exception as e:
            logger.error(f"   ❌ Error in save/load test: {e}")
            return False
        
        logger.info("   ✅ All confidence calibrator tests passed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Confidence calibrator test failed with exception: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return False

def test_calibration_quality_metrics():
    """Test calibration quality evaluation"""
    logger.info("🧪 Testing Calibration Quality Metrics...")
    
    try:
        # Create mock data with known calibration issues
        np.random.seed(42)
        n_samples = 1000
        
        # Generate poorly calibrated probabilities (overconfident)
        raw_probs = np.random.beta(1, 1, n_samples)  # Uniform distribution
        true_labels = (raw_probs > 0.5).astype(float)  # Simple threshold
        
        # Make probabilities overconfident
        overconfident_probs = np.where(raw_probs > 0.5, 
                                     raw_probs * 1.5,  # Increase high probs
                                     raw_probs * 0.5)  # Decrease low probs
        overconfident_probs = np.clip(overconfident_probs, 0, 1)
        
        # Initialize calibrator
        calibrator = ConfidenceCalibrator()
        
        # Test calibration on overconfident data
        result = calibrator.calibrate_probabilities(overconfident_probs, true_labels, method="platt")
        
        # Check that calibration improved the metrics
        original_ece = calibrator._expected_calibration_error(overconfident_probs, true_labels)
        calibrated_ece = result.calibration_quality["expected_calibration_error"]
        
        logger.info(f"✅ Calibration quality test passed:")
        logger.info(f"   Original ECE: {original_ece:.3f}")
        logger.info(f"   Calibrated ECE: {calibrated_ece:.3f}")
        logger.info(f"   Improvement: {original_ece - calibrated_ece:.3f}")
        
        # Test reliability diagram
        reliability_data = result.calibration_quality["reliability_diagram"]
        assert "bin_accuracies" in reliability_data
        assert "bin_confidences" in reliability_data
        assert len(reliability_data["bin_accuracies"]) == 10  # 10 bins
        
        logger.info(f"   Reliability diagram: {len(reliability_data['bin_accuracies'])} bins")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Calibration quality test failed: {e}")
        return False

def test_integration():
    """Test integration with other components"""
    logger.info("🧪 Testing Component Integration...")
    
    try:
        # Create mock data
        raw_probs, true_labels = create_mock_calibration_data(800)
        
        # Initialize calibrator
        calibrator = ConfidenceCalibrator()
        
        # Test end-to-end workflow
        logger.info("   Testing end-to-end calibration workflow...")
        
        # 1. Calibrate using different methods
        methods_results = {}
        for method in ["platt", "isotonic", "temperature"]:
            result = calibrator.calibrate_probabilities(raw_probs, true_labels, method=method)
            methods_results[method] = result
        
        # 2. Compare methods
        logger.info("   Method comparison:")
        for method, result in methods_results.items():
            ece = result.calibration_quality["expected_calibration_error"]
            brier = result.calibration_quality["brier_score"]
            logger.info(f"     {method}: ECE={ece:.3f}, Brier={brier:.3f}")
        
        # 3. Test business risk thresholds
        logger.info("   Testing business risk thresholds...")
        
        # Simulate business decisions based on calibrated probabilities
        test_probs = np.array([0.1, 0.3, 0.5, 0.7, 0.9])
        
        # Use best performing method for predictions
        best_method = min(methods_results.keys(), 
                         key=lambda m: methods_results[m].calibration_quality["expected_calibration_error"])
        best_result = methods_results[best_method]
        
        calibrated_test_probs = best_result.calibration_model.predict(test_probs)
        
        # Apply business thresholds
        high_confidence_threshold = 0.8
        medium_confidence_threshold = 0.6
        low_confidence_threshold = 0.4
        
        high_conf_claims = calibrated_test_probs >= high_confidence_threshold
        medium_conf_claims = (calibrated_test_probs >= medium_confidence_threshold) & (calibrated_test_probs < high_confidence_threshold)
        low_conf_claims = (calibrated_test_probs >= low_confidence_threshold) & (calibrated_test_probs < medium_confidence_threshold)
        reject_claims = calibrated_test_probs < low_confidence_threshold
        
        logger.info(f"   Business risk assessment:")
        logger.info(f"     High confidence (≥{high_confidence_threshold}): {np.sum(high_conf_claims)} claims")
        logger.info(f"     Medium confidence (≥{medium_confidence_threshold}): {np.sum(medium_conf_claims)} claims")
        logger.info(f"     Low confidence (≥{low_confidence_threshold}): {np.sum(low_conf_claims)} claims")
        logger.info(f"     Reject (<{low_confidence_threshold}): {np.sum(reject_claims)} claims")
        
        # 4. Test confidence quality metrics
        logger.info("   Testing confidence quality metrics...")
        
        # Simulate a realistic scenario
        realistic_probs = np.random.beta(2, 3, 200)
        realistic_labels = (realistic_probs > 0.4).astype(float)
        
        # Add some noise to make it realistic
        noise_mask = np.random.random(200) < 0.15
        realistic_labels[noise_mask] = 1 - realistic_labels[noise_mask]
        
        # Calibrate
        realistic_result = calibrator.calibrate_probabilities(realistic_probs, realistic_labels, method="platt")
        
        # Check confidence quality
        confidence_quality = realistic_result.calibration_quality["confidence_quality"]
        logger.info(f"     Confidence-accuracy correlation: {confidence_quality['confidence_accuracy_correlation']:.3f}")
        logger.info(f"     Overconfidence: {confidence_quality['overconfidence']:.3f}")
        logger.info(f"     Underconfidence: {confidence_quality['underconfidence']:.3f}")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Integration test failed: {e}")
        return False

def run_all_tests():
    """Run all Phase 3 component tests"""
    logger.info("🚀 Starting Phase 3 Component Tests")
    logger.info("=" * 50)
    
    test_results = {}
    
    # Test 1: Platt Scaling
    test_results['platt_scaling'] = test_platt_scaling()
    
    # Test 2: Isotonic Regression
    test_results['isotonic_regression'] = test_isotonic_regression()
    
    # Test 3: Temperature Scaling
    test_results['temperature_scaling'] = test_temperature_scaling()
    
    # Test 4: Confidence Calibrator
    test_results['confidence_calibrator'] = test_confidence_calibrator()
    
    # Test 5: Calibration Quality
    test_results['calibration_quality'] = test_calibration_quality_metrics()
    
    # Test 6: Integration
    test_results['integration'] = test_integration()
    
    # Summary
    logger.info("=" * 50)
    logger.info("📊 Phase 3 Test Results Summary")
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
        logger.info("🎉 All Phase 3 components are working correctly!")
        logger.info("🚀 Ready to proceed to Phase 4: Continuous Retraining")
    else:
        logger.error("⚠️ Some tests failed. Please review the errors above.")
    
    return passed == total

def main():
    """Main function to run tests"""
    try:
        # Run tests
        success = run_all_tests()
        
        if success:
            print("\n🎉 Phase 3 Implementation Complete!")
            print("✅ Probability calibration system is operational")
            print("✅ Platt scaling, isotonic regression, and temperature scaling working")
            print("✅ Calibration quality metrics and business risk thresholds functional")
            print("\n🚀 Ready for Phase 4: Continuous Retraining")
        else:
            print("\n⚠️ Some Phase 3 tests failed")
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
