#!/usr/bin/env python3
"""
Probability Calibration System for Claim Detector v2.0
Uses Platt scaling, isotonic regression, and temperature scaling for well-calibrated confidence scores
"""

import logging
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple, Union
from dataclasses import dataclass
import pickle
import json
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class CalibrationResult:
    """Result of probability calibration"""
    calibrated_probabilities: np.ndarray
    calibration_method: str
    calibration_quality: Dict[str, float]
    calibration_model: Any
    calibration_timestamp: datetime
    training_samples: int
    validation_samples: int

@dataclass
class CalibrationMetrics:
    """Metrics for evaluating calibration quality"""
    expected_calibration_error: float
    reliability_diagram: Dict[str, Any]
    confidence_quality: Dict[str, float]
    brier_score: float
    log_loss: float
    calibration_curve: Dict[str, Any]

class PlattScaling:
    """Platt scaling for probability calibration"""
    
    def __init__(self, max_iter: int = 100, learning_rate: float = 0.01):
        self.max_iter = max_iter
        self.learning_rate = learning_rate
        self.a = 1.0
        self.b = 0.0
        self.is_fitted = False
    
    def fit(self, raw_probs: np.ndarray, true_labels: np.ndarray) -> 'PlattScaling':
        """Fit Platt scaling parameters using gradient descent"""
        try:
            # Ensure inputs are numpy arrays
            raw_probs = np.array(raw_probs).flatten()
            true_labels = np.array(true_labels).flatten()
            
            # Convert to binary if needed
            if len(np.unique(true_labels)) > 2:
                # Multi-class: use one-vs-rest approach
                self._fit_multiclass(raw_probs, true_labels)
            else:
                # Binary classification
                self._fit_binary(raw_probs, true_labels)
            
            self.is_fitted = True
            logger.info(f"✅ Platt scaling fitted with {len(raw_probs)} samples")
            return self
            
        except Exception as e:
            logger.error(f"❌ Error fitting Platt scaling: {e}")
            raise
    
    def _fit_binary(self, raw_probs: np.ndarray, true_labels: np.ndarray):
        """Fit binary classification Platt scaling"""
        # Initialize parameters
        self.a = 1.0
        self.b = 0.0
        
        # Gradient descent optimization
        for iteration in range(self.max_iter):
            # Forward pass - calculate calibrated probs directly without calling predict
            logits = self.a * raw_probs + self.b
            calibrated_probs = 1 / (1 + np.exp(-logits))
            
            # Calculate gradients
            grad_a, grad_b = self._calculate_gradients(raw_probs, true_labels, calibrated_probs)
            
            # Update parameters
            self.a -= self.learning_rate * grad_a
            self.b -= self.learning_rate * grad_b
            
            # Early stopping if gradients are small
            if abs(grad_a) < 1e-6 and abs(grad_b) < 1e-6:
                break
    
    def _fit_multiclass(self, raw_probs: np.ndarray, true_labels: np.ndarray):
        """Fit multi-class Platt scaling using one-vs-rest"""
        unique_labels = np.unique(true_labels)
        self.class_models = {}
        
        for label in unique_labels:
            # Create binary labels for this class
            binary_labels = (true_labels == label).astype(int)
            
            # Fit binary model for this class
            model = PlattScaling(self.max_iter, self.learning_rate)
            model._fit_binary(raw_probs, binary_labels)
            self.class_models[label] = model
    
    def _calculate_gradients(self, raw_probs: np.ndarray, true_labels: np.ndarray, calibrated_probs: np.ndarray) -> Tuple[float, float]:
        """Calculate gradients for parameter updates"""
        # Clip probabilities to avoid log(0)
        calibrated_probs = np.clip(calibrated_probs, 1e-15, 1 - 1e-15)
        
        # Calculate gradients
        grad_a = np.mean((calibrated_probs - true_labels) * raw_probs)
        grad_b = np.mean(calibrated_probs - true_labels)
        
        return grad_a, grad_b
    
    def predict(self, raw_probs: np.ndarray) -> np.ndarray:
        """Predict calibrated probabilities"""
        if not self.is_fitted:
            raise ValueError("Model must be fitted before prediction")
        
        try:
            raw_probs = np.array(raw_probs).flatten()
            
            if hasattr(self, 'class_models'):
                # Multi-class prediction
                calibrated_probs = np.zeros_like(raw_probs)
                for label, model in self.class_models.items():
                    calibrated_probs += model.predict(raw_probs)
                return calibrated_probs / len(self.class_models)
            else:
                # Binary prediction
                # Apply Platt scaling: P(y=1|x) = 1 / (1 + exp(a * f(x) + b))
                logits = self.a * raw_probs + self.b
                calibrated_probs = 1 / (1 + np.exp(-logits))
                return calibrated_probs
                
        except Exception as e:
            logger.error(f"❌ Error in Platt scaling prediction: {e}")
            return raw_probs

class IsotonicRegression:
    """Isotonic regression for probability calibration"""
    
    def __init__(self, out_of_bounds: str = 'clip'):
        self.out_of_bounds = out_of_bounds
        self.is_fitted = False
        self.calibration_map = {}
    
    def fit(self, raw_probs: np.ndarray, true_labels: np.ndarray) -> 'IsotonicRegression':
        """Fit isotonic regression calibration"""
        try:
            raw_probs = np.array(raw_probs).flatten()
            true_labels = np.array(true_labels).flatten()
            
            # Sort by raw probabilities
            sorted_indices = np.argsort(raw_probs)
            sorted_probs = raw_probs[sorted_indices]
            sorted_labels = true_labels[sorted_indices]
            
            # Calculate cumulative mean (isotonic regression)
            cumulative_sum = np.cumsum(sorted_labels)
            cumulative_count = np.arange(1, len(sorted_labels) + 1)
            isotonic_probs = cumulative_sum / cumulative_count
            
            # Create calibration map
            self.calibration_map = dict(zip(sorted_probs, isotonic_probs))
            self.is_fitted = True
            
            logger.info(f"✅ Isotonic regression fitted with {len(raw_probs)} samples")
            return self
            
        except Exception as e:
            logger.error(f"❌ Error fitting isotonic regression: {e}")
            raise
    
    def predict(self, raw_probs: np.ndarray) -> np.ndarray:
        """Predict calibrated probabilities using isotonic regression"""
        if not self.is_fitted:
            raise ValueError("Model must be fitted before prediction")
        
        try:
            raw_probs = np.array(raw_probs).flatten()
            calibrated_probs = np.zeros_like(raw_probs)
            
            for i, prob in enumerate(raw_probs):
                # Find closest calibration point
                closest_prob = min(self.calibration_map.keys(), key=lambda x: abs(x - prob))
                calibrated_probs[i] = self.calibration_map[closest_prob]
            
            return calibrated_probs
            
        except Exception as e:
            logger.error(f"❌ Error in isotonic regression prediction: {e}")
            return raw_probs

class TemperatureScaling:
    """Temperature scaling for probability calibration"""
    
    def __init__(self, max_iter: int = 100, learning_rate: float = 0.01):
        self.max_iter = max_iter
        self.learning_rate = learning_rate
        self.temperature = 1.0
        self.is_fitted = False
    
    def fit(self, raw_probs: np.ndarray, true_labels: np.ndarray) -> 'TemperatureScaling':
        """Fit temperature scaling parameter"""
        try:
            raw_probs = np.array(raw_probs).flatten()
            true_labels = np.array(true_labels).flatten()
            
            # Convert probabilities to logits
            logits = np.log(np.clip(raw_probs / (1 - raw_probs), 1e-15, 1 - 1e-15))
            
            # Optimize temperature using gradient descent
            for iteration in range(self.max_iter):
                # Forward pass
                scaled_logits = logits / self.temperature
                scaled_probs = 1 / (1 + np.exp(-scaled_logits))
                
                # Calculate gradient
                grad_temp = self._calculate_temperature_gradient(scaled_probs, true_labels, scaled_logits)
                
                # Update temperature
                self.temperature -= self.learning_rate * grad_temp
                
                # Early stopping
                if abs(grad_temp) < 1e-6:
                    break
            
            self.is_fitted = True
            logger.info(f"✅ Temperature scaling fitted with temperature {self.temperature:.3f}")
            return self
            
        except Exception as e:
            logger.error(f"❌ Error fitting temperature scaling: {e}")
            raise
    
    def _calculate_temperature_gradient(self, scaled_probs: np.ndarray, true_labels: np.ndarray, scaled_logits: np.ndarray) -> float:
        """Calculate gradient for temperature parameter"""
        # Clip probabilities
        scaled_probs = np.clip(scaled_probs, 1e-15, 1 - 1e-15)
        
        # Calculate gradient
        grad_temp = np.mean((scaled_probs - true_labels) * scaled_logits) / (self.temperature ** 2)
        return grad_temp
    
    def predict(self, raw_probs: np.ndarray) -> np.ndarray:
        """Predict calibrated probabilities using temperature scaling"""
        if not self.is_fitted:
            raise ValueError("Model must be fitted before prediction")
        
        try:
            raw_probs = np.array(raw_probs).flatten()
            
            # Convert to logits
            logits = np.log(np.clip(raw_probs / (1 - raw_probs), 1e-15, 1 - 1e-15))
            
            # Apply temperature scaling
            scaled_logits = logits / self.temperature
            calibrated_probs = 1 / (1 + np.exp(-scaled_logits))
            
            return calibrated_probs
            
        except Exception as e:
            logger.error(f"❌ Error in temperature scaling prediction: {e}")
            return raw_probs

class ConfidenceCalibrator:
    """Main confidence calibration system"""
    
    def __init__(self, calibration_method: str = "platt"):
        self.calibration_method = calibration_method
        self.calibration_methods = {
            "platt": PlattScaling(),
            "isotonic": IsotonicRegression(),
            "temperature": TemperatureScaling()
        }
        self.current_method = calibration_method
        self.calibration_model = None
        self.calibration_history = []
        
        # Calibration quality thresholds
        self.quality_thresholds = {
            "excellent": 0.05,
            "good": 0.10,
            "acceptable": 0.15,
            "poor": 0.20
        }
    
    def calibrate_probabilities(self, raw_probs: np.ndarray, true_labels: np.ndarray, 
                               method: Optional[str] = None) -> CalibrationResult:
        """Calibrate raw probabilities to well-calibrated confidence scores"""
        try:
            if method:
                self.current_method = method
            
            if self.current_method not in self.calibration_methods:
                raise ValueError(f"Unknown calibration method: {self.current_method}")
            
            # Get calibration method
            calibration_method = self.calibration_methods[self.current_method]
            
            # Split data for validation
            split_idx = int(len(raw_probs) * 0.8)
            train_probs = raw_probs[:split_idx]
            train_labels = true_labels[:split_idx]
            val_probs = raw_probs[split_idx:]
            val_labels = true_labels[split_idx:]
            
            # Fit calibration model
            calibration_method.fit(train_probs, train_labels)
            
            # Make predictions on validation set for quality evaluation
            val_calibrated_probs = calibration_method.predict(val_probs)
            
            # Make predictions on entire dataset for production use
            all_calibrated_probs = calibration_method.predict(raw_probs)
            
            # Evaluate calibration quality on validation set
            calibration_quality = self._evaluate_calibration_quality(val_probs, val_labels, val_calibrated_probs)
            
            # Store result with all calibrated probabilities
            result = CalibrationResult(
                calibrated_probabilities=all_calibrated_probs,  # Return all calibrated probabilities
                calibration_method=self.current_method,
                calibration_quality=calibration_quality,
                calibration_model=calibration_method,
                calibration_timestamp=datetime.now(),
                training_samples=len(train_probs),
                validation_samples=len(val_probs)
            )
            
            # Update current model
            self.calibration_model = calibration_method
            
            # Store in history
            self.calibration_history.append(result)
            
            logger.info(f"✅ Probabilities calibrated using {self.current_method} method")
            logger.info(f"   Calibration quality: {calibration_quality['expected_calibration_error']:.3f}")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error during probability calibration: {e}")
            raise
    
    def _evaluate_calibration_quality(self, raw_probs: np.ndarray, true_labels: np.ndarray, 
                                    calibrated_probs: np.ndarray) -> Dict[str, float]:
        """Evaluate the quality of calibration"""
        try:
            # Expected Calibration Error (ECE)
            ece = self._expected_calibration_error(calibrated_probs, true_labels)
            
            # Brier Score
            brier_score = self._brier_score(calibrated_probs, true_labels)
            
            # Log Loss
            log_loss = self._log_loss(calibrated_probs, true_labels)
            
            # Reliability diagram data
            reliability_data = self._reliability_diagram(calibrated_probs, true_labels)
            
            # Confidence quality metrics
            confidence_quality = self._confidence_quality_metrics(calibrated_probs, true_labels)
            
            return {
                "expected_calibration_error": ece,
                "brier_score": brier_score,
                "log_loss": log_loss,
                "reliability_diagram": reliability_data,
                "confidence_quality": confidence_quality
            }
            
        except Exception as e:
            logger.error(f"❌ Error evaluating calibration quality: {e}")
            return {
                "expected_calibration_error": float('inf'),
                "brier_score": float('inf'),
                "log_loss": float('inf'),
                "reliability_diagram": {},
                "confidence_quality": {}
            }
    
    def _expected_calibration_error(self, calibrated_probs: np.ndarray, true_labels: np.ndarray) -> float:
        """Calculate Expected Calibration Error"""
        try:
            # Bin probabilities into 10 equal-width bins
            n_bins = 10
            bin_boundaries = np.linspace(0, 1, n_bins + 1)
            bin_lowers = bin_boundaries[:-1]
            bin_uppers = bin_boundaries[1:]
            
            ece = 0.0
            for bin_lower, bin_upper in zip(bin_lowers, bin_uppers):
                # Find samples in this bin
                in_bin = np.logical_and(calibrated_probs > bin_lower, calibrated_probs <= bin_upper)
                bin_size = np.sum(in_bin)
                
                if bin_size > 0:
                    # Calculate accuracy and confidence for this bin
                    bin_acc = np.mean(true_labels[in_bin])
                    bin_conf = np.mean(calibrated_probs[in_bin])
                    
                    # Add to ECE
                    ece += (bin_size / len(calibrated_probs)) * abs(bin_acc - bin_conf)
            
            return ece
            
        except Exception as e:
            logger.error(f"❌ Error calculating ECE: {e}")
            return float('inf')
    
    def _brier_score(self, calibrated_probs: np.ndarray, true_labels: np.ndarray) -> float:
        """Calculate Brier Score"""
        try:
            return np.mean((calibrated_probs - true_labels) ** 2)
        except Exception as e:
            logger.error(f"❌ Error calculating Brier score: {e}")
            return float('inf')
    
    def _log_loss(self, calibrated_probs: np.ndarray, true_labels: np.ndarray) -> float:
        """Calculate Log Loss"""
        try:
            # Clip probabilities to avoid log(0)
            clipped_probs = np.clip(calibrated_probs, 1e-15, 1 - 1e-15)
            return -np.mean(true_labels * np.log(clipped_probs) + (1 - true_labels) * np.log(1 - clipped_probs))
        except Exception as e:
            logger.error(f"❌ Error calculating log loss: {e}")
            return float('inf')
    
    def _reliability_diagram(self, calibrated_probs: np.ndarray, true_labels: np.ndarray) -> Dict[str, Any]:
        """Generate reliability diagram data"""
        try:
            n_bins = 10
            bin_boundaries = np.linspace(0, 1, n_bins + 1)
            bin_lowers = bin_boundaries[:-1]
            bin_uppers = bin_boundaries[1:]
            
            bin_accuracies = []
            bin_confidences = []
            bin_sizes = []
            
            for bin_lower, bin_upper in zip(bin_lowers, bin_uppers):
                in_bin = np.logical_and(calibrated_probs > bin_lower, calibrated_probs <= bin_upper)
                bin_size = np.sum(in_bin)
                
                if bin_size > 0:
                    bin_acc = np.mean(true_labels[in_bin])
                    bin_conf = np.mean(calibrated_probs[in_bin])
                    
                    bin_accuracies.append(bin_acc)
                    bin_confidences.append(bin_conf)
                    bin_sizes.append(bin_size)
                else:
                    bin_accuracies.append(0.0)
                    bin_confidences.append((bin_lower + bin_upper) / 2)
                    bin_sizes.append(0)
            
            return {
                "bin_accuracies": bin_accuracies,
                "bin_confidences": bin_confidences,
                "bin_sizes": bin_sizes,
                "bin_centers": [(l + u) / 2 for l, u in zip(bin_lowers, bin_uppers)]
            }
            
        except Exception as e:
            logger.error(f"❌ Error generating reliability diagram: {e}")
            return {}
    
    def _confidence_quality_metrics(self, calibrated_probs: np.ndarray, true_labels: np.ndarray) -> Dict[str, float]:
        """Calculate confidence quality metrics"""
        try:
            # Confidence-accuracy correlation
            confidence_accuracy_corr = np.corrcoef(calibrated_probs, true_labels)[0, 1]
            
            # Overconfidence measure
            overconfidence = np.mean(np.maximum(0, calibrated_probs - true_labels))
            
            # Underconfidence measure
            underconfidence = np.mean(np.maximum(0, true_labels - calibrated_probs))
            
            return {
                "confidence_accuracy_correlation": confidence_accuracy_corr if not np.isnan(confidence_accuracy_corr) else 0.0,
                "overconfidence": overconfidence,
                "underconfidence": underconfidence
            }
            
        except Exception as e:
            logger.error(f"❌ Error calculating confidence quality metrics: {e}")
            return {
                "confidence_accuracy_correlation": 0.0,
                "overconfidence": 0.0,
                "underconfidence": 0.0
            }
    
    def get_calibration_summary(self) -> Dict[str, Any]:
        """Get summary of calibration performance"""
        if not self.calibration_history:
            return {"status": "No calibration performed yet"}
        
        latest_result = self.calibration_history[-1]
        
        # Determine quality level
        ece = latest_result.calibration_quality["expected_calibration_error"]
        quality_level = "poor"
        for level, threshold in self.quality_thresholds.items():
            if ece <= threshold:
                quality_level = level
                break
        
        return {
            "current_method": self.current_method,
            "latest_calibration": {
                "timestamp": latest_result.calibration_timestamp.isoformat(),
                "method": latest_result.calibration_method,
                "quality_level": quality_level,
                "expected_calibration_error": ece,
                "training_samples": latest_result.training_samples,
                "validation_samples": latest_result.validation_samples
            },
            "calibration_history": [
                {
                    "timestamp": result.calibration_timestamp.isoformat(),
                    "method": result.calibration_method,
                    "ece": result.calibration_quality["expected_calibration_error"]
                }
                for result in self.calibration_history
            ],
            "available_methods": list(self.calibration_methods.keys())
        }
    
    def save_calibration_model(self, filepath: str):
        """Save calibration model to file"""
        try:
            if self.calibration_model:
                model_data = {
                    "calibration_method": self.current_method,
                    "model": self.calibration_model,
                    "calibration_timestamp": datetime.now().isoformat(),
                    "calibration_summary": self.get_calibration_summary()
                }
                
                with open(filepath, 'wb') as f:
                    pickle.dump(model_data, f)
                
                logger.info(f"✅ Calibration model saved to {filepath}")
            else:
                logger.warning("⚠️ No calibration model to save")
                
        except Exception as e:
            logger.error(f"❌ Error saving calibration model: {e}")
    
    def load_calibration_model(self, filepath: str) -> bool:
        """Load calibration model from file"""
        try:
            if Path(filepath).exists():
                with open(filepath, 'rb') as f:
                    model_data = pickle.load(f)
                
                self.calibration_model = model_data["model"]
                self.current_method = model_data["calibration_method"]
                
                logger.info(f"✅ Calibration model loaded from {filepath}")
                return True
            else:
                logger.warning(f"⚠️ Calibration model file not found: {filepath}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error loading calibration model: {e}")
            return False
