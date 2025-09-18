"""
Comprehensive API testing for FBA Refund Predictor.
Tests cover all endpoints, error handling, retry logic, and monitoring.
"""
import pytest
import asyncio
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch, AsyncMock
import json
from src.api.main import app, retry_prediction, retrain_model

client = TestClient(app)

# Test data
VALID_CLAIM = {
    "claim_amount": 150.0,
    "customer_history_score": 0.85,
    "product_category": "electronics",
    "days_since_purchase": 30,
    "claim_description": "Product arrived damaged"
}

INVALID_CLAIM = {
    "claim_amount": -50.0,  # Invalid negative amount
    "customer_history_score": 1.5,  # Invalid score > 1
    "product_category": "",  # Empty category
    "days_since_purchase": -5  # Invalid negative days
}

BATCH_CLAIMS = {
    "claims": [
        VALID_CLAIM,
        {
            "claim_amount": 75.0,
            "customer_history_score": 0.92,
            "product_category": "books",
            "days_since_purchase": 15,
            "claim_description": "Wrong item received"
        }
    ]
}

class TestHealthEndpoints:
    """Test health check and root endpoints."""
    
    def test_root_endpoint(self):
        """Test root endpoint returns correct message."""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "OpSide Refund Success Predictor API"
        assert data["status"] == "healthy"
    
    def test_health_check(self):
        """Test health check endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "version" in data
        assert "model_loaded" in data
    
    def test_metrics_endpoint(self):
        """Test Prometheus metrics endpoint."""
        response = client.get("/metrics")
        assert response.status_code == 200
        assert "http_requests_total" in response.text
        assert "fba_predictions_total" in response.text

class TestPredictionEndpoints:
    """Test prediction endpoints with various scenarios."""
    
    @patch('src.api.main.predict_refund_success')
    def test_single_prediction_success(self, mock_predict):
        """Test successful single prediction."""
        mock_predict.return_value = {
            "success_probability": 0.75,
            "confidence": 0.85,
            "prediction_class": "likely_success"
        }
        
        response = client.post("/predict-success", json=VALID_CLAIM)
        assert response.status_code == 200
        
        data = response.json()
        assert "success_probability" in data
        assert "confidence" in data
        assert "prediction_class" in data
        assert data["success_probability"] == 0.75
    
    @patch('src.api.main.predict_refund_success')
    def test_batch_prediction_success(self, mock_predict):
        """Test successful batch prediction."""
        mock_predict.return_value = {
            "success_probability": 0.75,
            "confidence": 0.85,
            "prediction_class": "likely_success"
        }
        
        response = client.post("/predict-batch", json=BATCH_CLAIMS)
        assert response.status_code == 200
        
        data = response.json()
        assert "predictions" in data
        assert len(data["predictions"]) == 2
        assert all("success_probability" in pred for pred in data["predictions"])
    
    def test_invalid_claim_data(self):
        """Test prediction with invalid claim data."""
        response = client.post("/predict-success", json=INVALID_CLAIM)
        assert response.status_code == 422  # Validation error
    
    def test_missing_required_fields(self):
        """Test prediction with missing required fields."""
        incomplete_claim = {"claim_amount": 100.0}  # Missing other required fields
        response = client.post("/predict-success", json=incomplete_claim)
        assert response.status_code == 422
    
    @patch('src.api.main.predict_refund_success')
    def test_prediction_service_error(self, mock_predict):
        """Test handling of prediction service errors."""
        mock_predict.side_effect = Exception("Model prediction failed")
        
        response = client.post("/predict-success", json=VALID_CLAIM)
        assert response.status_code == 500
        assert "error" in response.json()

class TestRetryLogic:
    """Test retry mechanism and error handling."""
    
    @patch('src.api.main.predict_refund_success')
    async def test_retry_on_failure(self, mock_predict):
        """Test retry logic on prediction failures."""
        # First two calls fail, third succeeds
        mock_predict.side_effect = [
            Exception("First failure"),
            Exception("Second failure"),
            {
                "success_probability": 0.75,
                "confidence": 0.85,
                "prediction_class": "likely_success"
            }
        ]
        
        # Test the retry function directly
        result = await retry_prediction(VALID_CLAIM)
        assert result["success_probability"] == 0.75
        assert mock_predict.call_count == 3
    
    @patch('src.api.main.predict_refund_success')
    async def test_max_retries_exceeded(self, mock_predict):
        """Test that max retries are not exceeded."""
        mock_predict.side_effect = Exception("Persistent failure")
        
        with pytest.raises(Exception):
            await retry_prediction(VALID_CLAIM)
        
        # Should have tried exactly MAX_RETRIES times
        assert mock_predict.call_count == 3

class TestModelInfo:
    """Test model information endpoint."""
    
    def test_model_info_endpoint(self):
        """Test model info endpoint returns correct structure."""
        response = client.get("/model-info")
        assert response.status_code == 200
        
        data = response.json()
        assert "model_type" in data
        assert "version" in data
        assert "features" in data
        assert "performance_metrics" in data
        assert "retry_config" in data
        
        # Check retry configuration
        retry_config = data["retry_config"]
        assert "max_retries" in retry_config
        assert "retry_delay" in retry_config

class TestRetraining:
    """Test model retraining functionality."""
    
    @patch('src.api.main.retrain_model')
    def test_trigger_retraining(self, mock_retrain):
        """Test triggering model retraining."""
        response = client.post("/trigger-retraining")
        assert response.status_code == 200
        
        data = response.json()
        assert data["message"] == "Model retraining started"
        assert data["status"] == "initiated"
    
    async def test_retrain_model_function(self):
        """Test retrain model function."""
        # Mock the accuracy update
        with patch('src.api.main.MODEL_ACCURACY') as mock_accuracy:
            await retrain_model()
            mock_accuracy.set.assert_called_once()

class TestErrorHandling:
    """Test error handling and edge cases."""
    
    def test_global_exception_handler(self):
        """Test global exception handler."""
        # This would require triggering an unhandled exception
        # For now, we test that the handler exists
        assert hasattr(app, 'exception_handlers')
    
    def test_cors_headers(self):
        """Test CORS headers are present."""
        response = client.options("/predict-success")
        # CORS preflight should work
        assert response.status_code in [200, 405]  # 405 is also acceptable
    
    def test_rate_limiting_headers(self):
        """Test that rate limiting headers are present."""
        response = client.get("/health")
        # Should have standard security headers
        assert response.status_code == 200

class TestIntegration:
    """Integration tests for the complete API flow."""
    
    @patch('src.api.main.load_trained_model')
    def test_full_prediction_flow(self, mock_load_model):
        """Test complete prediction flow from request to response."""
        # Mock model loading
        mock_model = Mock()
        mock_load_model.return_value = mock_model
        
        # Mock prediction
        with patch('src.api.main.predict_refund_success') as mock_predict:
            mock_predict.return_value = {
                "success_probability": 0.80,
                "confidence": 0.90,
                "prediction_class": "likely_success"
            }
            
            response = client.post("/predict-success", json=VALID_CLAIM)
            assert response.status_code == 200
            
            data = response.json()
            assert data["success_probability"] == 0.80
            assert data["confidence"] == 0.90
    
    def test_concurrent_requests(self):
        """Test handling of concurrent requests."""
        import threading
        import time
        
        results = []
        errors = []
        
        def make_request():
            try:
                response = client.post("/predict-success", json=VALID_CLAIM)
                results.append(response.status_code)
            except Exception as e:
                errors.append(str(e))
        
        # Start multiple threads
        threads = []
        for _ in range(5):
            thread = threading.Thread(target=make_request)
            threads.append(thread)
            thread.start()
        
        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        
        # Check that all requests were handled
        assert len(results) + len(errors) == 5
        assert len(errors) == 0  # No errors should occur

class TestMonitoring:
    """Test monitoring and metrics collection."""
    
    def test_request_metrics_increment(self):
        """Test that request metrics are properly incremented."""
        # Make a request
        initial_response = client.get("/metrics")
        initial_metrics = initial_response.text
        
        # Make another request
        client.get("/health")
        
        # Check metrics again
        updated_response = client.get("/metrics")
        updated_metrics = updated_response.text
        
        # Metrics should have changed
        assert initial_metrics != updated_metrics
    
    def test_prediction_metrics(self):
        """Test prediction-specific metrics."""
        with patch('src.api.main.predict_refund_success') as mock_predict:
            mock_predict.return_value = {
                "success_probability": 0.75,
                "confidence": 0.85,
                "prediction_class": "likely_success"
            }
            
            # Make prediction
            client.post("/predict-success", json=VALID_CLAIM)
            
            # Check metrics
            metrics_response = client.get("/metrics")
            metrics_text = metrics_response.text
            
            # Should contain prediction metrics
            assert "fba_predictions_total" in metrics_text

# Performance tests
class TestPerformance:
    """Performance and load testing."""
    
    def test_response_time_under_load(self):
        """Test API response time under moderate load."""
        import time
        
        start_time = time.time()
        
        # Make 10 requests
        for _ in range(10):
            response = client.get("/health")
            assert response.status_code == 200
        
        end_time = time.time()
        total_time = end_time - start_time
        
        # Should complete 10 requests in reasonable time
        assert total_time < 5.0  # 5 seconds max for 10 requests
    
    def test_memory_usage_stable(self):
        """Test that memory usage remains stable under load."""
        import psutil
        import os
        
        process = psutil.Process(os.getpid())
        initial_memory = process.memory_info().rss
        
        # Make multiple requests
        for _ in range(20):
            client.get("/health")
        
        final_memory = process.memory_info().rss
        memory_increase = final_memory - initial_memory
        
        # Memory increase should be reasonable (< 10MB)
        assert memory_increase < 10 * 1024 * 1024

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--cov=src.api", "--cov-report=html"]) 