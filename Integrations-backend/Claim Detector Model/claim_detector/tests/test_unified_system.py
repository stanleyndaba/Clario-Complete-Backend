"""
Comprehensive test suite for the unified Claim Detector Model
"""
import pytest
import pandas as pd
import numpy as np
from pathlib import Path
import tempfile
import shutil
import sys

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.models.unified_model import UnifiedClaimDetectorModel
from src.preprocessing.pipeline import PreprocessingPipeline
from src.database.models import Base, Feedback, Metrics, Prediction
from src.database.session import get_db, engine, create_tables, drop_tables
from src.security.auth import authenticate_user, create_access_token, verify_password
from src.security.rate_limiter import check_rate_limit, get_remaining_requests

class TestUnifiedModel:
    """Test the unified model functionality"""
    
    @pytest.fixture
    def sample_data(self):
        """Generate sample data for testing"""
        np.random.seed(42)
        n_samples = 100
        
        data = {
            'claim_id': [f"claim_{i:03d}" for i in range(n_samples)],
            'seller_id': [f"seller_{np.random.randint(1, 100):03d}" for _ in range(n_samples)],
            'order_id': [f"order_{np.random.randint(1, 1000):03d}" for _ in range(n_samples)],
            'category': np.random.choice(['Electronics', 'Clothing', 'Books'], n_samples),
            'subcategory': np.random.choice(['Smartphones', 'T-Shirts', 'Fiction'], n_samples),
            'reason_code': np.random.choice(['FBA_LOST', 'FBA_DAMAGED'], n_samples),
            'marketplace': np.random.choice(['US', 'CA', 'UK'], n_samples),
            'fulfillment_center': np.random.choice(['SDF1', 'SDF2'], n_samples),
            'amount': np.random.uniform(10, 200, n_samples),
            'quantity': np.random.randint(1, 5, n_samples),
            'order_value': np.random.uniform(20, 500, n_samples),
            'shipping_cost': np.random.uniform(0, 30, n_samples),
            'days_since_order': np.random.randint(1, 100, n_samples),
            'days_since_delivery': np.random.randint(0, 30, n_samples),
            'description': [f"Product {i}" for i in range(n_samples)],
            'reason': [f"Reason {i}" for i in range(n_samples)],
            'notes': [f"Note {i}" for i in range(n_samples)],
            'claim_date': pd.date_range(start='2023-01-01', periods=n_samples, freq='D').strftime('%Y-%m-%d')
        }
        
        df = pd.DataFrame(data)
        df['claimable'] = (
            (df['amount'] > 50) & 
            (df['days_since_order'] > 30) & 
            (df['reason_code'] == 'FBA_LOST')
        ).astype(int)
        
        return df
    
    @pytest.fixture
    def temp_dir(self):
        """Create temporary directory for testing"""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    def test_model_initialization(self):
        """Test model initialization"""
        model = UnifiedClaimDetectorModel()
        assert model is not None
        assert not model.is_trained
        assert len(model.models) == 0
        assert len(model.weights) == 0
    
    def test_model_training(self, sample_data, temp_dir):
        """Test model training"""
        model = UnifiedClaimDetectorModel()
        
        # Prepare data
        feature_columns = [col for col in sample_data.columns if col not in ['claimable', 'claim_id']]
        X = sample_data[feature_columns]
        y = sample_data['claimable']
        
        # Train model
        training_results = model.train(X, y)
        
        assert model.is_trained
        assert len(model.models) > 0
        assert len(model.weights) > 0
        assert training_results['feature_count'] > 0
        assert 'performance_metrics' in training_results
    
    def test_model_prediction(self, sample_data, temp_dir):
        """Test model prediction"""
        model = UnifiedClaimDetectorModel()
        
        # Prepare data
        feature_columns = [col for col in sample_data.columns if col not in ['claimable', 'claim_id']]
        X = sample_data[feature_columns]
        y = sample_data['claimable']
        
        # Train model
        model.train(X, y)
        
        # Make predictions
        predictions = model.predict(X.head(5))
        
        assert 'predictions' in predictions
        assert 'probabilities' in predictions
        assert 'confidence' in predictions
        assert len(predictions['predictions']) == 5
        assert len(predictions['probabilities']) == 5
    
    def test_model_save_load(self, sample_data, temp_dir):
        """Test model saving and loading"""
        model = UnifiedClaimDetectorModel()
        
        # Prepare data
        feature_columns = [col for col in sample_data.columns if col not in ['claimable', 'claim_id']]
        X = sample_data[feature_columns]
        y = sample_data['claimable']
        
        # Train model
        model.train(X, y)
        
        # Save model
        model_path = Path(temp_dir) / "test_model.pkl"
        model.save_model(str(model_path))
        
        # Load model
        loaded_model = UnifiedClaimDetectorModel(str(model_path))
        
        assert loaded_model.is_trained
        assert len(loaded_model.models) == len(model.models)
        assert loaded_model.feature_names == model.feature_names
    
    def test_feature_importance(self, sample_data, temp_dir):
        """Test feature importance extraction"""
        model = UnifiedClaimDetectorModel()
        
        # Prepare data
        feature_columns = [col for col in sample_data.columns if col not in ['claimable', 'claim_id']]
        X = sample_data[feature_columns]
        y = sample_data['claimable']
        
        # Train model
        model.train(X, y)
        
        # Get feature importance
        importance = model.get_feature_importance(top_n=10)
        
        assert len(importance) <= 10
        assert all('feature' in item for item in importance)
        assert all('importance' in item for item in importance)
    
    def test_explanation(self, sample_data, temp_dir):
        """Test prediction explanation"""
        model = UnifiedClaimDetectorModel()
        
        # Prepare data
        feature_columns = [col for col in sample_data.columns if col not in ['claimable', 'claim_id']]
        X = sample_data[feature_columns]
        y = sample_data['claimable']
        
        # Train model
        model.train(X, y)
        
        # Get explanation
        explanation = model.explain_prediction(X.head(1))
        
        assert 'prediction' in explanation
        assert 'probability' in explanation
        assert 'feature_contributions' in explanation
        assert len(explanation['feature_contributions']) > 0

class TestPreprocessingPipeline:
    """Test the preprocessing pipeline"""
    
    @pytest.fixture
    def sample_data(self):
        """Generate sample data for testing"""
        np.random.seed(42)
        n_samples = 50
        
        data = {
            'category': np.random.choice(['A', 'B', 'C'], n_samples),
            'subcategory': np.random.choice(['X', 'Y', 'Z'], n_samples),
            'amount': np.random.uniform(10, 200, n_samples),
            'quantity': np.random.randint(1, 5, n_samples),
            'description': [f"Text {i}" for i in range(n_samples)],
            'claimable': np.random.choice([0, 1], n_samples)
        }
        
        return pd.DataFrame(data)
    
    def test_pipeline_initialization(self):
        """Test pipeline initialization"""
        pipeline = PreprocessingPipeline()
        assert pipeline is not None
        assert len(pipeline.feature_names) == 0
    
    def test_pipeline_fit_transform(self, sample_data):
        """Test pipeline fit and transform"""
        pipeline = PreprocessingPipeline()
        
        # Fit and transform
        X = sample_data.drop('claimable', axis=1)
        X_transformed = pipeline.fit_transform(X)
        
        assert len(pipeline.feature_names) > 0
        assert X_transformed.shape[1] == len(pipeline.feature_names)
        assert not X_transformed.isnull().any().any()
    
    def test_pipeline_save_load(self, sample_data, temp_dir):
        """Test pipeline saving and loading"""
        pipeline = PreprocessingPipeline()
        
        # Fit pipeline
        X = sample_data.drop('claimable', axis=1)
        pipeline.fit_transform(X)
        
        # Save pipeline
        pipeline_path = Path(temp_dir) / "test_pipeline.pkl"
        pipeline.save_pipeline(str(pipeline_path))
        
        # Load pipeline
        loaded_pipeline = PreprocessingPipeline(str(pipeline_path))
        
        assert len(loaded_pipeline.feature_names) == len(pipeline.feature_names)
        assert loaded_pipeline.feature_names == pipeline.feature_names

class TestDatabase:
    """Test database functionality"""
    
    @pytest.fixture(autouse=True)
    def setup_database(self):
        """Setup test database"""
        create_tables()
        yield
        drop_tables()
    
    def test_feedback_crud(self):
        """Test feedback CRUD operations"""
        from src.database.crud import FeedbackCRUD
        
        # Create feedback
        feedback = FeedbackCRUD.create_feedback(
            db=next(get_db()),
            claim_id="test_claim_001",
            actual_claimable=True,
            predicted_claimable=False,
            predicted_probability=0.3,
            confidence=0.8,
            user_notes="Test feedback"
        )
        
        assert feedback.claim_id == "test_claim_001"
        assert feedback.actual_claimable == True
        assert feedback.predicted_claimable == False
    
    def test_metrics_crud(self):
        """Test metrics CRUD operations"""
        from src.database.crud import MetricsCRUD
        
        # Create metric
        metric = MetricsCRUD.create_metric(
            db=next(get_db()),
            metric_name="accuracy",
            metric_value=0.85,
            metric_type="production",
            model_version="1.0.0",
            metadata={"test": True}
        )
        
        assert metric.metric_name == "accuracy"
        assert metric.metric_value == 0.85
        assert metric.metric_type == "production"
    
    def test_prediction_crud(self):
        """Test prediction CRUD operations"""
        from src.database.crud import MetricsCRUD
        
        # Create prediction
        prediction = MetricsCRUD.create_metric(
            db=next(get_db()),
            metric_name="prediction_count",
            metric_value=100,
            metric_type="production",
            model_version="1.0.0"
        )
        
        assert prediction.metric_name == "prediction_count"
        assert prediction.metric_value == 100

class TestSecurity:
    """Test security functionality"""
    
    def test_password_hashing(self):
        """Test password hashing and verification"""
        from src.security.auth import get_password_hash, verify_password
        
        password = "test_password_123"
        hashed = get_password_hash(password)
        
        assert hashed != password
        assert verify_password(password, hashed)
        assert not verify_password("wrong_password", hashed)
    
    def test_rate_limiting(self):
        """Test rate limiting functionality"""
        # Test rate limit check
        assert check_rate_limit("127.0.0.1", "predict")
        
        # Test remaining requests
        remaining = get_remaining_requests("127.0.0.1", "predict")
        assert remaining >= 0
    
    def test_jwt_token(self):
        """Test JWT token creation"""
        from src.security.auth import create_access_token
        
        token = create_access_token({"sub": "test_user"})
        assert token is not None
        assert len(token) > 0

class TestIntegration:
    """Test integration between components"""
    
    def test_end_to_end_workflow(self, sample_data, temp_dir):
        """Test complete end-to-end workflow"""
        # 1. Initialize model
        model = UnifiedClaimDetectorModel()
        
        # 2. Prepare data
        feature_columns = [col for col in sample_data.columns if col not in ['claimable', 'claim_id']]
        X = sample_data[feature_columns]
        y = sample_data['claimable']
        
        # 3. Train model
        training_results = model.train(X, y)
        assert model.is_trained
        
        # 4. Make predictions
        predictions = model.predict(X.head(10))
        assert len(predictions['predictions']) == 10
        
        # 5. Get explanations
        explanation = model.explain_prediction(X.head(1))
        assert 'feature_contributions' in explanation
        
        # 6. Save and load
        model_path = Path(temp_dir) / "integration_model.pkl"
        model.save_model(str(model_path))
        
        loaded_model = UnifiedClaimDetectorModel(str(model_path))
        assert loaded_model.is_trained
        
        # 7. Verify predictions match
        new_predictions = loaded_model.predict(X.head(5))
        assert np.array_equal(predictions['predictions'][:5], new_predictions['predictions'])

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
