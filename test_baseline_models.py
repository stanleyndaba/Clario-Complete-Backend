# -*- coding: utf-8 -*-
"""
Test script for Baseline Models (Step 1)
Validates binary classification: Approved vs Rejected claims
"""

import asyncio
import sys
import os

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

from ml_detector.baseline_models import (
    BaselineModelTrainer, 
    generate_mock_baseline_data,
    BaselineModel
)

async def test_baseline_model_creation():
    """Test baseline model creation"""
    print("Testing Baseline Model Creation...")
    
    try:
        trainer = BaselineModelTrainer()
        trainer.create_baseline_models()
        
        # Verify models were created
        assert len(trainer.models) == 3, f"Expected 3 models, got {len(trainer.models)}"
        
        expected_models = [
            'logistic_regression_tfidf',
            'logistic_regression_tfidf_scaled', 
            'simple_logistic_regression'
        ]
        
        for model_name in expected_models:
            assert model_name in trainer.models, f"Model {model_name} not found"
            assert trainer.models[model_name].pipeline is not None, f"Pipeline for {model_name} is None"
        
        print("Baseline model creation successful")
        return True
        
    except Exception as e:
        print(f"Baseline model creation failed: {e}")
        return False

async def test_data_preparation():
    """Test training data preparation"""
    print("Testing Data Preparation...")
    
    try:
        # Generate mock data
        mock_data = generate_mock_baseline_data(500)
        assert len(mock_data) == 500, f"Expected 500 samples, got {len(mock_data)}"
        
        # Create trainer and prepare data
        trainer = BaselineModelTrainer()
        X, y = trainer.prepare_training_data(mock_data)
        
        # Verify data format
        assert len(X) == len(y), f"X and y lengths don't match: {len(X)} vs {len(y)}"
        assert len(X) == 500, f"Expected 500 samples, got {len(X)}"
        
        # Verify labels are binary
        unique_labels = set(y)
        assert unique_labels.issubset({0, 1}), f"Labels not binary: {unique_labels}"
        
        # Check approval rate (should be around 30%)
        approval_rate = sum(y) / len(y)
        assert 0.2 <= approval_rate <= 0.4, f"Approval rate {approval_rate:.2f} outside expected range"
        
        print(f"Data preparation successful - {len(X)} samples, {sum(y)} approved ({approval_rate:.1%})")
        return True
        
    except Exception as e:
        print(f"Data preparation failed: {e}")
        return False

async def test_model_training():
    """Test model training and validation"""
    print("Testing Model Training...")
    
    try:
        # Generate data and create trainer
        mock_data = generate_mock_baseline_data(1000)
        trainer = BaselineModelTrainer()
        trainer.create_baseline_models()
        
        # Prepare data
        X, y = trainer.prepare_training_data(mock_data)
        
        # Train models
        trainer.train_models(X, y, test_size=0.2)
        
        # Verify all models were trained
        trained_models = [m for m in trainer.models.values() if m.is_trained]
        assert len(trained_models) == 3, f"Expected 3 trained models, got {len(trained_models)}"
        
        # Verify metrics were calculated
        assert len(trainer.baseline_metrics) == 3, f"Expected 3 metric sets, got {len(trainer.baseline_metrics)}"
        
        # Check that metrics are reasonable
        for model_name, metrics in trainer.baseline_metrics.items():
            assert 0 <= metrics.precision <= 1, f"Invalid precision for {model_name}: {metrics.precision}"
            assert 0 <= metrics.recall <= 1, f"Invalid recall for {model_name}: {metrics.recall}"
            assert 0 <= metrics.f1_score <= 1, f"Invalid F1 for {model_name}: {metrics.f1_score}"
            assert 0 <= metrics.accuracy <= 1, f"Invalid accuracy for {model_name}: {metrics.accuracy}"
            assert 0 <= metrics.roc_auc <= 1, f"Invalid ROC AUC for {model_name}: {metrics.roc_auc}"
            
            # Verify cross-validation scores
            assert len(metrics.cross_val_scores) == 5, f"Expected 5 CV scores for {model_name}"
            cv_mean = sum(metrics.cross_val_scores) / len(metrics.cross_val_scores)
            assert 0 <= cv_mean <= 1, f"Invalid CV mean for {model_name}: {cv_mean}"
        
        print("Model training successful")
        return True
        
    except Exception as e:
        print(f"Model training failed: {e}")
        return False

async def test_best_model_selection():
    """Test best model selection"""
    print("Testing Best Model Selection...")
    
    try:
        # Generate data and train models
        mock_data = generate_mock_baseline_data(1000)
        trainer = BaselineModelTrainer()
        trainer.create_baseline_models()
        
        X, y = trainer.prepare_training_data(mock_data)
        trainer.train_models(X, y)
        
        # Select best model
        best_model = trainer.select_best_model()
        assert best_model is not None, "No best model selected"
        assert best_model.is_trained, "Best model not trained"
        
        # Verify best model has highest F1 score
        best_f1 = best_model.metrics.f1_score
        for model_name, metrics in trainer.baseline_metrics.items():
            assert metrics.f1_score <= best_f1 + 1e-6, f"Model {model_name} has higher F1 than best model"
        
        print(f"Best model selection successful: {best_model.name} (F1: {best_f1:.3f})")
        return True
        
    except Exception as e:
        print(f"Best model selection failed: {e}")
        return False

async def test_performance_summary():
    """Test performance summary generation"""
    print("Testing Performance Summary...")
    
    try:
        # Generate data and train models
        mock_data = generate_mock_baseline_data(1000)
        trainer = BaselineModelTrainer()
        trainer.create_baseline_models()
        
        X, y = trainer.prepare_training_data(mock_data)
        trainer.train_models(X, y)
        
        # Get performance summary
        summary = trainer.get_model_performance_summary()
        
        # Verify summary structure
        assert 'total_models' in summary, "Missing total_models in summary"
        assert 'models' in summary, "Missing models in summary"
        assert 'best_model' in summary, "Missing best_model in summary"
        assert 'overall_stats' in summary, "Missing overall_stats in summary"
        
        # Verify counts
        assert summary['total_models'] == 3, f"Expected 3 models, got {summary['total_models']}"
        assert len(summary['models']) == 3, f"Expected 3 model entries, got {len(summary['models'])}"
        
        # Verify best model info
        assert summary['best_model'] is not None, "Best model info missing"
        assert 'f1_score' in summary['best_model'], "Best model missing F1 score"
        
        # Verify overall stats
        overall_stats = summary['overall_stats']
        required_stats = ['avg_f1', 'avg_precision', 'avg_recall', 'std_f1', 'std_precision', 'std_recall']
        for stat in required_stats:
            assert stat in overall_stats, f"Missing {stat} in overall stats"
            assert isinstance(overall_stats[stat], (int, float)), f"{stat} is not numeric"
        
        print("Performance summary generation successful")
        return True
        
    except Exception as e:
        print(f"Performance summary failed: {e}")
        return False

async def test_prediction():
    """Test model prediction"""
    print("Testing Model Prediction...")
    
    try:
        # Generate data and train models
        mock_data = generate_mock_baseline_data(1000)
        trainer = BaselineModelTrainer()
        trainer.create_baseline_models()
        
        X, y = trainer.prepare_training_data(mock_data)
        trainer.train_models(X, y)
        
        # Select best model
        trainer.select_best_model()
        
        # Test prediction
        test_text = "Inventory lost during shipment, need reimbursement for $150"
        prediction = trainer.predict(test_text)
        
        # Verify prediction structure
        required_fields = ['prediction', 'confidence', 'approved_probability', 'rejected_probability', 'model_used']
        for field in required_fields:
            assert field in prediction, f"Missing {field} in prediction"
        
        # Verify prediction values
        assert prediction['prediction'] in ['approved', 'rejected'], f"Invalid prediction: {prediction['prediction']}"
        assert 0 <= prediction['confidence'] <= 1, f"Invalid confidence: {prediction['confidence']}"
        assert 0 <= prediction['approved_probability'] <= 1, f"Invalid approved prob: {prediction['approved_probability']}"
        assert 0 <= prediction['rejected_probability'] <= 1, f"Invalid rejected prob: {prediction['rejected_probability']}"
        
        # Verify probabilities sum to 1
        prob_sum = prediction['approved_probability'] + prediction['rejected_probability']
        assert abs(prob_sum - 1.0) < 1e-6, f"Probabilities don't sum to 1: {prob_sum}"
        
        print(f"Prediction successful: {prediction['prediction']} (confidence: {prediction['confidence']:.3f})")
        return True
        
    except Exception as e:
        print(f"Prediction failed: {e}")
        return False

async def test_model_save_load():
    """Test model saving and loading"""
    print("Testing Model Save/Load...")
    
    try:
        # Generate data and train models
        mock_data = generate_mock_baseline_data(1000)
        trainer = BaselineModelTrainer()
        trainer.create_baseline_models()
        
        X, y = trainer.prepare_training_data(mock_data)
        trainer.train_models(X, y)
        
        # Select best model
        trainer.select_best_model()
        
        # Save model
        save_path = "test_baseline_model.joblib"
        save_success = trainer.save_best_model(save_path)
        assert save_success, "Model save failed"
        assert os.path.exists(save_path), "Saved model file not found"
        
        # Load model
        load_success = trainer.load_model(save_path)
        assert load_success, "Model load failed"
        assert 'loaded_model' in trainer.models, "Loaded model not in models dict"
        
        # Test loaded model prediction
        test_text = "Package damaged in transit, need refund"
        prediction = trainer.predict(test_text, 'loaded_model')
        assert 'prediction' in prediction, "Loaded model prediction failed"
        
        # Clean up
        if os.path.exists(save_path):
            os.remove(save_path)
        
        print("Model save/load successful")
        return True
        
    except Exception as e:
        print(f"Model save/load failed: {e}")
        return False

async def run_all_tests():
    """Run all baseline model tests"""
    print("Running Baseline Model Tests (Step 1)...")
    print("=" * 60)
    
    tests = [
        test_baseline_model_creation,
        test_data_preparation,
        test_model_training,
        test_best_model_selection,
        test_performance_summary,
        test_prediction,
        test_model_save_load
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        try:
            result = await test()
            if result:
                passed += 1
            print()
        except Exception as e:
            print(f"Test {test.__name__} crashed: {e}")
            print()
    
    print("=" * 60)
    print(f"Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("All baseline model tests passed! Ready for Step 2.")
    else:
        print("Some tests failed. Please review the errors above.")
    
    return passed == total

if __name__ == "__main__":
    # Run tests
    success = asyncio.run(run_all_tests())
    sys.exit(0 if success else 1)


