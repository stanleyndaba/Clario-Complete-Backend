"""
Tests for model components
"""
import pytest
import pandas as pd
import numpy as np
from unittest.mock import Mock, patch
import sys
from pathlib import Path

# Add src to path for imports
sys.path.append(str(Path(__file__).parent.parent / "src"))

from models.ensemble import HybridEnsembleModel
from features.behavioral_features import BehavioralFeatureEngineer
from features.text_embeddings import TextEmbeddingEngineer
from features.anomaly_signals import AnomalySignalEngineer

class TestHybridEnsembleModel:
    """Test cases for HybridEnsembleModel"""
    
    def setup_method(self):
        """Setup for each test method"""
        self.model = HybridEnsembleModel()
        
        # Create sample data
        self.sample_data = pd.DataFrame({
            'claim_id': ['CLAIM_001', 'CLAIM_002', 'CLAIM_003'],
            'seller_id': ['SELLER_1', 'SELLER_2', 'SELLER_1'],
            'order_id': ['ORDER_1', 'ORDER_2', 'ORDER_3'],
            'category': ['Electronics', 'Books', 'Electronics'],
            'subcategory': ['Smartphones', 'Fiction', 'Laptops'],
            'reason_code': ['DAMAGED', 'LOST', 'DESTROYED'],
            'marketplace': ['US', 'CA', 'UK'],
            'fulfillment_center': ['FBA1', 'FBA2', 'FBA1'],
            'amount': [299.99, 15.99, 899.99],
            'quantity': [1, 2, 1],
            'order_value': [299.99, 31.98, 899.99],
            'shipping_cost': [5.99, 2.99, 8.99],
            'days_since_order': [45, 30, 60],
            'days_since_delivery': [40, 25, 55],
            'description': ['iPhone 13 Pro', 'Novel by Author', 'MacBook Pro'],
            'reason': ['Damaged during shipping', 'Lost in transit', 'Destroyed in warehouse'],
            'notes': ['Screen cracked', 'Package never arrived', 'Water damage'],
            'claim_date': ['2024-01-15', '2024-01-10', '2024-01-20'],
            'claimable': [1, 0, 1]
        })
        
        # Convert date column
        self.sample_data['claim_date'] = pd.to_datetime(self.sample_data['claim_date'])
    
    def test_model_initialization(self):
        """Test model initialization"""
        assert self.model is not None
        assert hasattr(self.model, 'models')
        assert hasattr(self.model, 'weights')
        assert hasattr(self.model, 'feature_names')
        assert hasattr(self.model, 'is_trained')
        
        # Check that models are initialized
        expected_models = ['lightgbm', 'catboost', 'text_model', 'anomaly_detector']
        for model_name in expected_models:
            assert model_name in self.model.models
    
    def test_prepare_features(self):
        """Test feature preparation"""
        feature_data, feature_columns = self.model.prepare_features(self.sample_data)
        
        assert isinstance(feature_data, pd.DataFrame)
        assert len(feature_columns) > 0
        assert len(self.model.feature_names) > 0
        
        # Check that target column is excluded
        assert 'claimable' not in feature_columns
        assert 'claim_id' not in feature_columns
    
    def test_prepare_text_features(self):
        """Test text feature preparation"""
        text_embeddings = self.model.prepare_text_features(self.sample_data)
        
        assert isinstance(text_embeddings, np.ndarray)
        assert text_embeddings.shape[0] == len(self.sample_data)
        assert text_embeddings.shape[1] > 0  # Should have embedding dimensions
    
    @patch('models.ensemble.lgb.LGBMClassifier')
    @patch('models.ensemble.cb.CatBoostClassifier')
    def test_train_ensemble(self, mock_catboost, mock_lightgbm):
        """Test ensemble training"""
        # Mock the models
        mock_lightgbm.return_value.fit.return_value = None
        mock_lightgbm.return_value.predict_proba.return_value = np.array([[0.3, 0.7], [0.6, 0.4], [0.2, 0.8]])
        
        mock_catboost.return_value.fit.return_value = None
        mock_catboost.return_value.predict_proba.return_value = np.array([[0.4, 0.6], [0.5, 0.5], [0.1, 0.9]])
        
        # Mock text model
        with patch('models.ensemble.LogisticRegression') as mock_lr:
            mock_lr.return_value.fit.return_value = None
            mock_lr.return_value.predict_proba.return_value = np.array([[0.5, 0.5], [0.3, 0.7], [0.4, 0.6]])
            
            # Mock anomaly detector
            with patch('models.ensemble.IsolationForest') as mock_if:
                mock_if.return_value.fit.return_value = None
                mock_if.return_value.score_samples.return_value = np.array([-0.1, -0.2, -0.3])
                
                # Test training
                results = self.model.train_ensemble(self.sample_data)
                
                assert isinstance(results, dict)
                assert 'test_auc' in results
                assert 'individual_predictions' in results
                assert self.model.is_trained
    
    def test_predict_before_training(self):
        """Test that prediction fails before training"""
        with pytest.raises(ValueError, match="Model must be trained"):
            self.model.predict(self.sample_data)
    
    @patch('models.ensemble.lgb.LGBMClassifier')
    @patch('models.ensemble.cb.CatBoostClassifier')
    def test_predict_after_training(self, mock_catboost, mock_lightgbm):
        """Test prediction after training"""
        # Mock training
        mock_lightgbm.return_value.fit.return_value = None
        mock_lightgbm.return_value.predict_proba.return_value = np.array([[0.3, 0.7]])
        
        mock_catboost.return_value.fit.return_value = None
        mock_catboost.return_value.predict_proba.return_value = np.array([[0.4, 0.6]])
        
        with patch('models.ensemble.LogisticRegression') as mock_lr:
            mock_lr.return_value.fit.return_value = None
            mock_lr.return_value.predict_proba.return_value = np.array([[0.5, 0.5]])
            
            with patch('models.ensemble.IsolationForest') as mock_if:
                mock_if.return_value.fit.return_value = None
                mock_if.return_value.score_samples.return_value = np.array([-0.1])
                
                # Train model
                self.model.train_ensemble(self.sample_data.iloc[:1])
                
                # Test prediction
                results = self.model.predict(self.sample_data.iloc[:1])
                
                assert isinstance(results, dict)
                assert 'predictions' in results
                assert 'probabilities' in results
                assert len(results['predictions']) == 1
    
    def test_get_feature_importance(self):
        """Test feature importance retrieval"""
        # Mock feature importances
        self.model.feature_names = ['feature1', 'feature2', 'feature3']
        self.model.models['lightgbm'].feature_importances_ = np.array([0.5, 0.3, 0.2])
        self.model.models['catboost'].feature_importances_ = np.array([0.4, 0.4, 0.2])
        
        importance = self.model.get_feature_importance(top_n=2)
        
        assert isinstance(importance, dict)
        assert 'lightgbm' in importance
        assert 'catboost' in importance
        assert len(importance['lightgbm']) == 2
        assert len(importance['catboost']) == 2
    
    def test_save_and_load_model(self, tmp_path):
        """Test model saving and loading"""
        # Mock a trained model
        self.model.is_trained = True
        self.model.feature_names = ['feature1', 'feature2']
        self.model.weights = {'lightgbm': 0.4, 'catboost': 0.3}
        
        model_path = tmp_path / "test_model.pkl"
        
        # Test saving
        self.model.save_model(str(model_path))
        assert model_path.exists()
        
        # Test loading
        new_model = HybridEnsembleModel()
        new_model.load_model(str(model_path))
        
        assert new_model.is_trained == self.model.is_trained
        assert new_model.feature_names == self.model.feature_names
        assert new_model.weights == self.model.weights

class TestBehavioralFeatureEngineer:
    """Test cases for BehavioralFeatureEngineer"""
    
    def setup_method(self):
        """Setup for each test method"""
        self.engineer = BehavioralFeatureEngineer()
        
        # Create sample data
        self.sample_data = pd.DataFrame({
            'claim_id': ['CLAIM_001', 'CLAIM_002', 'CLAIM_003'],
            'seller_id': ['SELLER_1', 'SELLER_2', 'SELLER_1'],
            'amount': [299.99, 15.99, 899.99],
            'quantity': [1, 2, 1],
            'days_since_order': [45, 30, 60],
            'claimable': [1, 0, 1],
            'claim_date': pd.to_datetime(['2024-01-15', '2024-01-10', '2024-01-20'])
        })
    
    def test_engineer_seller_behavior(self):
        """Test seller behavioral feature engineering"""
        result = self.engineer.engineer_seller_behavior(self.sample_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result.columns) > len(self.sample_data.columns)
        
        # Check for expected features
        expected_features = ['total_claims', 'avg_amount', 'claimable_rate']
        for feature in expected_features:
            assert any(col.endswith(feature) for col in result.columns)
    
    def test_engineer_marketplace_behavior(self):
        """Test marketplace behavioral feature engineering"""
        result = self.engineer.engineer_marketplace_behavior(self.sample_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result.columns) > len(self.sample_data.columns)
    
    def test_engineer_all_behavioral_features(self):
        """Test all behavioral feature engineering"""
        result = self.engineer.engineer_all_behavioral_features(self.sample_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result.columns) > len(self.sample_data.columns)

class TestTextEmbeddingEngineer:
    """Test cases for TextEmbeddingEngineer"""
    
    def setup_method(self):
        """Setup for each test method"""
        self.engineer = TextEmbeddingEngineer()
        
        # Create sample data
        self.sample_data = pd.DataFrame({
            'description': ['iPhone 13 Pro', 'Novel by Author', 'MacBook Pro'],
            'reason': ['Damaged during shipping', 'Lost in transit', 'Destroyed in warehouse'],
            'notes': ['Screen cracked', 'Package never arrived', 'Water damage']
        })
    
    def test_generate_embeddings(self):
        """Test text embedding generation"""
        texts = ['This is a test', 'Another test text', 'Third test']
        embeddings = self.engineer.generate_embeddings(texts)
        
        assert isinstance(embeddings, np.ndarray)
        assert embeddings.shape[0] == len(texts)
        assert embeddings.shape[1] > 0
    
    def test_engineer_text_features(self):
        """Test text feature engineering"""
        result = self.engineer.engineer_text_features(self.sample_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result.columns) > len(self.sample_data.columns)
    
    def test_engineer_all_text_features(self):
        """Test all text feature engineering"""
        result = self.engineer.engineer_all_text_features(self.sample_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result.columns) > len(self.sample_data.columns)

class TestAnomalySignalEngineer:
    """Test cases for AnomalySignalEngineer"""
    
    def setup_method(self):
        """Setup for each test method"""
        self.engineer = AnomalySignalEngineer()
        
        # Create sample data
        self.sample_data = pd.DataFrame({
            'amount': [299.99, 15.99, 899.99, 50.00, 1000.00],
            'quantity': [1, 2, 1, 5, 1],
            'days_since_order': [45, 30, 60, 15, 90],
            'days_since_delivery': [40, 25, 55, 10, 85]
        })
    
    def test_engineer_statistical_anomalies(self):
        """Test statistical anomaly detection"""
        result = self.engineer.engineer_statistical_anomalies(self.sample_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result.columns) > len(self.sample_data.columns)
        
        # Check for expected features
        expected_features = ['z_score', 'is_anomaly_z', 'is_anomaly_iqr']
        for feature in expected_features:
            assert any(col.endswith(feature) for col in result.columns)
    
    def test_engineer_behavioral_anomalies(self):
        """Test behavioral anomaly detection"""
        # Add seller_id for behavioral analysis
        self.sample_data['seller_id'] = ['SELLER_1', 'SELLER_2', 'SELLER_1', 'SELLER_3', 'SELLER_1']
        
        result = self.engineer.engineer_behavioral_anomalies(self.sample_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result.columns) > len(self.sample_data.columns)
    
    def test_engineer_all_anomaly_features(self):
        """Test all anomaly feature engineering"""
        result = self.engineer.engineer_all_anomaly_features(self.sample_data)
        
        assert isinstance(result, pd.DataFrame)
        assert len(result.columns) > len(self.sample_data.columns)

if __name__ == "__main__":
    pytest.main([__file__]) 