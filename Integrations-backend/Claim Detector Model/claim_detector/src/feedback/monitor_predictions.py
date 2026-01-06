"""
Prediction monitoring and feedback collection for FBA reimbursement claim detection
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional, Any
import logging
import json
from datetime import datetime, timedelta
from pathlib import Path
import uuid

logger = logging.getLogger(__name__)

class PredictionMonitor:
    """Monitor predictions and collect feedback for model improvement"""
    
    def __init__(self, feedback_dir: str = "data/feedback"):
        """
        Initialize prediction monitor
        
        Args:
            feedback_dir: Directory to store feedback data
        """
        self.feedback_dir = Path(feedback_dir)
        self.feedback_dir.mkdir(parents=True, exist_ok=True)
        
        self.predictions_log = []
        self.feedback_data = []
        self.monitoring_metrics = {}
        
    def log_prediction(self, claim_id: str, prediction: Dict[str, Any], 
                      input_data: Dict[str, Any]) -> str:
        """
        Log a prediction for monitoring
        
        Args:
            claim_id: Claim identifier
            prediction: Prediction results
            input_data: Input data used for prediction
            
        Returns:
            Prediction log ID
        """
        log_id = str(uuid.uuid4())
        
        prediction_log = {
            'log_id': log_id,
            'claim_id': claim_id,
            'timestamp': datetime.now().isoformat(),
            'prediction': {
                'claimable': prediction.get('claimable', False),
                'probability': prediction.get('probability', 0.0),
                'confidence': prediction.get('confidence', 0.0)
            },
            'input_data': input_data,
            'feature_contributions': prediction.get('feature_contributions', []),
            'model_components': prediction.get('model_components', {}),
            'feedback_received': False,
            'feedback_data': None
        }
        
        self.predictions_log.append(prediction_log)
        
        # Save to file
        self._save_prediction_log(prediction_log)
        
        logger.info(f"Prediction logged for claim {claim_id} with log ID {log_id}")
        
        return log_id
    
    def submit_feedback(self, claim_id: str, actual_claimable: bool, 
                       confidence: Optional[float] = None, notes: Optional[str] = None,
                       user_id: Optional[str] = None) -> str:
        """
        Submit feedback for a prediction
        
        Args:
            claim_id: Claim identifier
            actual_claimable: Actual claimability
            confidence: User confidence in feedback
            notes: Additional notes
            user_id: User identifier
            
        Returns:
            Feedback ID
        """
        feedback_id = str(uuid.uuid4())
        
        # Find corresponding prediction log
        prediction_log = None
        for log in self.predictions_log:
            if log['claim_id'] == claim_id:
                prediction_log = log
                break
        
        feedback_data = {
            'feedback_id': feedback_id,
            'claim_id': claim_id,
            'timestamp': datetime.now().isoformat(),
            'actual_claimable': actual_claimable,
            'predicted_claimable': prediction_log['prediction']['claimable'] if prediction_log else None,
            'prediction_probability': prediction_log['prediction']['probability'] if prediction_log else None,
            'user_confidence': confidence,
            'notes': notes,
            'user_id': user_id,
            'prediction_log_id': prediction_log['log_id'] if prediction_log else None
        }
        
        # Update prediction log
        if prediction_log:
            prediction_log['feedback_received'] = True
            prediction_log['feedback_data'] = feedback_data
            self._update_prediction_log(prediction_log)
        
        # Store feedback
        self.feedback_data.append(feedback_data)
        self._save_feedback_data(feedback_data)
        
        logger.info(f"Feedback submitted for claim {claim_id} with feedback ID {feedback_id}")
        
        return feedback_id
    
    def get_feedback_for_retraining(self, min_samples: int = 100, 
                                   max_age_days: int = 30) -> pd.DataFrame:
        """
        Get feedback data suitable for model retraining
        
        Args:
            min_samples: Minimum number of samples required
            max_age_days: Maximum age of feedback data in days
            
        Returns:
            DataFrame with feedback data for retraining
        """
        logger.info("Preparing feedback data for retraining")
        
        # Filter feedback by age
        cutoff_date = datetime.now() - timedelta(days=max_age_days)
        recent_feedback = [
            feedback for feedback in self.feedback_data
            if datetime.fromisoformat(feedback['timestamp']) > cutoff_date
        ]
        
        if len(recent_feedback) < min_samples:
            logger.warning(f"Insufficient feedback data: {len(recent_feedback)} samples (minimum: {min_samples})")
            return pd.DataFrame()
        
        # Convert to DataFrame
        feedback_df = pd.DataFrame(recent_feedback)
        
        # Add derived features
        feedback_df['prediction_correct'] = (
            feedback_df['predicted_claimable'] == feedback_df['actual_claimable']
        )
        
        feedback_df['prediction_error'] = abs(
            feedback_df['prediction_probability'] - feedback_df['actual_claimable'].astype(float)
        )
        
        # Calculate confidence-based metrics
        feedback_df['high_confidence_correct'] = (
            (feedback_df['prediction_probability'] > 0.8) & 
            feedback_df['prediction_correct']
        )
        
        feedback_df['low_confidence_incorrect'] = (
            (feedback_df['prediction_probability'] < 0.5) & 
            ~feedback_df['prediction_correct']
        )
        
        logger.info(f"Prepared {len(feedback_df)} feedback samples for retraining")
        
        return feedback_df
    
    def calculate_feedback_metrics(self, days: int = 30) -> Dict[str, Any]:
        """
        Calculate metrics from feedback data
        
        Args:
            days: Number of days to look back
            
        Returns:
            Dictionary with feedback metrics
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        recent_feedback = [
            feedback for feedback in self.feedback_data
            if datetime.fromisoformat(feedback['timestamp']) > cutoff_date
        ]
        
        if not recent_feedback:
            return {}
        
        feedback_df = pd.DataFrame(recent_feedback)
        
        metrics = {
            'total_feedback': len(recent_feedback),
            'accuracy': (feedback_df['predicted_claimable'] == feedback_df['actual_claimable']).mean(),
            'avg_prediction_error': feedback_df['prediction_error'].mean(),
            'high_confidence_accuracy': (
                feedback_df[feedback_df['prediction_probability'] > 0.8]['prediction_correct']
            ).mean() if len(feedback_df[feedback_df['prediction_probability'] > 0.8]) > 0 else 0.0,
            'low_confidence_accuracy': (
                feedback_df[feedback_df['prediction_probability'] < 0.5]['prediction_correct']
            ).mean() if len(feedback_df[feedback_df['prediction_probability'] < 0.5]) > 0 else 0.0,
            'feedback_rate': len(recent_feedback) / max(1, len([p for p in self.predictions_log 
                                                               if datetime.fromisoformat(p['timestamp']) > cutoff_date]))
        }
        
        return metrics
    
    def detect_performance_degradation(self, window_days: int = 7) -> Dict[str, Any]:
        """
        Detect performance degradation based on feedback
        
        Args:
            window_days: Window size for degradation detection
            
        Returns:
            Dictionary with degradation analysis
        """
        logger.info("Detecting performance degradation from feedback")
        
        # Get recent feedback
        cutoff_date = datetime.now() - timedelta(days=window_days)
        recent_feedback = [
            feedback for feedback in self.feedback_data
            if datetime.fromisoformat(feedback['timestamp']) > cutoff_date
        ]
        
        if len(recent_feedback) < 10:
            return {'insufficient_data': True, 'samples': len(recent_feedback)}
        
        feedback_df = pd.DataFrame(recent_feedback)
        
        # Calculate current performance
        current_accuracy = (feedback_df['predicted_claimable'] == feedback_df['actual_claimable']).mean()
        current_error = feedback_df['prediction_error'].mean()
        
        # Compare with historical performance (assuming baseline is stored)
        baseline_accuracy = getattr(self, 'baseline_accuracy', 0.85)
        baseline_error = getattr(self, 'baseline_error', 0.15)
        
        # Detect degradation
        accuracy_degradation = baseline_accuracy - current_accuracy
        error_increase = current_error - baseline_error
        
        degradation_detected = accuracy_degradation > 0.05 or error_increase > 0.05
        
        degradation_analysis = {
            'degradation_detected': degradation_detected,
            'current_accuracy': current_accuracy,
            'baseline_accuracy': baseline_accuracy,
            'accuracy_degradation': accuracy_degradation,
            'current_error': current_error,
            'baseline_error': baseline_error,
            'error_increase': error_increase,
            'samples_analyzed': len(recent_feedback)
        }
        
        return degradation_analysis
    
    def generate_retraining_recommendations(self) -> Dict[str, Any]:
        """
        Generate recommendations for model retraining
        
        Returns:
            Dictionary with retraining recommendations
        """
        logger.info("Generating retraining recommendations")
        
        recommendations = {
            'retraining_recommended': False,
            'reasons': [],
            'urgency': 'low',
            'estimated_samples': 0
        }
        
        # Check feedback volume
        feedback_metrics = self.calculate_feedback_metrics(days=30)
        if feedback_metrics.get('total_feedback', 0) >= 1000:
            recommendations['retraining_recommended'] = True
            recommendations['reasons'].append('Sufficient feedback data available')
            recommendations['estimated_samples'] = feedback_metrics['total_feedback']
        
        # Check performance degradation
        degradation_analysis = self.detect_performance_degradation()
        if degradation_analysis.get('degradation_detected', False):
            recommendations['retraining_recommended'] = True
            recommendations['reasons'].append('Performance degradation detected')
            recommendations['urgency'] = 'high'
        
        # Check feedback accuracy
        if feedback_metrics.get('accuracy', 1.0) < 0.8:
            recommendations['retraining_recommended'] = True
            recommendations['reasons'].append('Low feedback accuracy')
            recommendations['urgency'] = 'medium'
        
        # Check confidence issues
        if (feedback_metrics.get('high_confidence_accuracy', 1.0) < 0.9 or 
            feedback_metrics.get('low_confidence_accuracy', 0.0) < 0.5):
            recommendations['retraining_recommended'] = True
            recommendations['reasons'].append('Confidence calibration issues')
        
        return recommendations
    
    def _save_prediction_log(self, prediction_log: Dict[str, Any]):
        """Save prediction log to file"""
        log_file = self.feedback_dir / f"prediction_log_{prediction_log['log_id']}.json"
        with open(log_file, 'w') as f:
            json.dump(prediction_log, f, indent=2, default=str)
    
    def _update_prediction_log(self, prediction_log: Dict[str, Any]):
        """Update prediction log file"""
        log_file = self.feedback_dir / f"prediction_log_{prediction_log['log_id']}.json"
        with open(log_file, 'w') as f:
            json.dump(prediction_log, f, indent=2, default=str)
    
    def _save_feedback_data(self, feedback_data: Dict[str, Any]):
        """Save feedback data to file"""
        feedback_file = self.feedback_dir / f"feedback_{feedback_data['feedback_id']}.json"
        with open(feedback_file, 'w') as f:
            json.dump(feedback_data, f, indent=2, default=str)
    
    def load_feedback_history(self):
        """Load feedback history from files"""
        # Load prediction logs
        for log_file in self.feedback_dir.glob("prediction_log_*.json"):
            try:
                with open(log_file, 'r') as f:
                    log_data = json.load(f)
                    self.predictions_log.append(log_data)
            except Exception as e:
                logger.warning(f"Error loading prediction log {log_file}: {e}")
        
        # Load feedback data
        for feedback_file in self.feedback_dir.glob("feedback_*.json"):
            try:
                with open(feedback_file, 'r') as f:
                    feedback_data = json.load(f)
                    self.feedback_data.append(feedback_data)
            except Exception as e:
                logger.warning(f"Error loading feedback data {feedback_file}: {e}")
        
        logger.info(f"Loaded {len(self.predictions_log)} prediction logs and {len(self.feedback_data)} feedback records")
    
    def export_feedback_summary(self, output_path: str):
        """Export feedback summary to file"""
        summary = {
            'total_predictions': len(self.predictions_log),
            'total_feedback': len(self.feedback_data),
            'feedback_rate': len(self.feedback_data) / max(1, len(self.predictions_log)),
            'recent_metrics': self.calculate_feedback_metrics(days=30),
            'degradation_analysis': self.detect_performance_degradation(),
            'retraining_recommendations': self.generate_retraining_recommendations()
        }
        
        with open(output_path, 'w') as f:
            json.dump(summary, f, indent=2, default=str)
        
        logger.info(f"Feedback summary exported to {output_path}") 