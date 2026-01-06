#!/usr/bin/env python3
"""
Feedback-to-Training Pipeline for Concierge Feedback Loop
Transforms real-world Amazon claim outcomes into training data for continuous learning
"""

import pandas as pd
import numpy as np
import pickle
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
from pathlib import Path
import logging
import json

# Add src to path for imports
sys.path.append(str(Path(__file__).parent.parent))

try:
    from feedback_loop.claims_logger import ClaimsLogger
    from ml_detector.enhanced_ml_detector import ClaimsDetector
except ImportError:
    print("Warning: Could not import system components. Using basic pipeline only.")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class FeedbackTrainingPipeline:
    """
    Pipeline that transforms feedback data into training data and retrains the model
    """
    
    def __init__(self, 
                 claims_logger: ClaimsLogger,
                 model_path: str = "models/improved_fba_claims_model.pkl",
                 output_path: str = "models/retrained_fba_claims_model.pkl"):
        self.claims_logger = claims_logger
        self.model_path = model_path
        self.output_path = output_path
        self.current_model = None
        self.retraining_history = []
        
    def load_current_model(self) -> bool:
        """Load the current trained model"""
        try:
            if os.path.exists(self.model_path):
                with open(self.model_path, 'rb') as f:
                    self.current_model = pickle.load(f)
                logger.info(f"Loaded current model: {self.model_path}")
                return True
            else:
                logger.warning(f"Model not found: {self.model_path}")
                return False
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            return False
    
    def prepare_feedback_training_data(self, 
                                     min_samples: int = 100,
                                     include_edge_cases: bool = True,
                                     recent_days: int = 90) -> pd.DataFrame:
        """
        Prepare feedback data for training
        
        Args:
            min_samples: Minimum number of samples required
            include_edge_cases: Whether to include edge case claims
            recent_days: Only include feedback from last N days
        
        Returns:
            pd.DataFrame: Prepared training data
        """
        try:
            logger.info("Preparing feedback training data...")
            
            # Get feedback data from claims logger
            feedback_data = self.claims_logger.get_training_data(
                min_samples=min_samples,
                include_edge_cases=include_edge_cases
            )
            
            if not feedback_data:
                logger.warning("No feedback data available for training")
                return pd.DataFrame()
            
            # Convert to DataFrame
            df = pd.DataFrame(feedback_data)
            
            # Filter by recent data if specified
            if recent_days > 0:
                cutoff_date = datetime.now() - timedelta(days=recent_days)
                df['created_at'] = pd.to_datetime(df['created_at'])
                df = df[df['created_at'] >= cutoff_date]
                logger.info(f"Filtered to {len(df)} recent samples (last {recent_days} days)")
            
            # Create training labels
            df['training_label'] = df.apply(self._create_training_label, axis=1)
            df['training_confidence'] = df.apply(self._create_training_confidence, axis=1)
            
            # Prepare features
            df = self._prepare_features(df)
            
            # Remove rows with missing labels
            df = df.dropna(subset=['training_label'])
            
            logger.info(f"Prepared {len(df)} samples for training")
            return df
            
        except Exception as e:
            logger.error(f"Error preparing training data: {e}")
            return pd.DataFrame()
    
    def _create_training_label(self, row: pd.Series) -> Optional[int]:
        """Create binary training label from Amazon status"""
        try:
            status = row.get('amazon_status', '')
            if status == 'accepted':
                return 1
            elif status == 'rejected':
                return 0
            elif status == 'partial':
                return 1  # Partial acceptance counts as valid
            else:
                return None
        except Exception as e:
            logger.error(f"Error creating training label: {e}")
            return None
    
    def _create_training_confidence(self, row: pd.Series) -> Optional[float]:
        """Create confidence score for training"""
        try:
            status = row.get('amazon_status', '')
            if status == 'accepted':
                return 1.0
            elif status == 'rejected':
                return 0.0
            elif status == 'partial':
                return 0.7  # Partial acceptance gets lower confidence
            else:
                return None
        except Exception as e:
            logger.error(f"Error creating training confidence: {e}")
            return None
    
    def _prepare_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Prepare features for training"""
        try:
            # Text-based features
            df['text_length'] = df['claim_text'].str.len()
            df['word_count'] = df['claim_text'].str.split().str.len()
            
            # Claim type encoding
            claim_type_mapping = {
                'lost': 1, 'damaged': 2, 'fee': 3, 'overcharge': 4,
                'wrong_item': 5, 'defective': 6, 'missing': 7
            }
            df['claim_type_encoded'] = df['claim_type'].map(claim_type_mapping).fillna(0)
            
            # Amount features
            df['amount_log'] = np.log1p(df['claim_amount'].fillna(0))
            df['has_amount'] = (df['claim_amount'] > 0).astype(int)
            
            # Model prediction features
            df['model_prediction_encoded'] = df['model_prediction'].astype(int)
            df['model_confidence_scaled'] = df['model_confidence'].fillna(0.5)
            
            # Edge case features
            df['is_edge_case'] = df['edge_case_tag'].notna().astype(int)
            df['retraining_priority_scaled'] = df['retraining_priority'].fillna(1) / 5.0
            
            # Keyword features
            claim_keywords = ['damaged', 'lost', 'missing', 'wrong', 'defective', 'broken', 'leaking']
            for keyword in claim_keywords:
                df[f'has_{keyword}'] = df['claim_text'].str.lower().str.contains(keyword).astype(int)
            
            # Rejection reason features
            df['has_rejection_reason'] = df['amazon_rejection_reason'].notna().astype(int)
            df['rejection_reason_length'] = df['amazon_rejection_reason'].str.len().fillna(0)
            
            return df
            
        except Exception as e:
            logger.error(f"Error preparing features: {e}")
            return df
    
    def analyze_feedback_patterns(self, df: pd.DataFrame) -> Dict:
        """
        Analyze patterns in feedback data to identify improvement opportunities
        
        Args:
            df: Training data DataFrame
            
        Returns:
            Dict: Analysis results
        """
        try:
            logger.info("Analyzing feedback patterns...")
            
            analysis = {
                'total_samples': len(df),
                'label_distribution': {},
                'claim_type_distribution': {},
                'edge_case_analysis': {},
                'model_performance_analysis': {},
                'rejection_patterns': {},
                'recommendations': []
            }
            
            if df.empty:
                return analysis
            
            # Label distribution
            analysis['label_distribution'] = df['training_label'].value_counts().to_dict()
            
            # Claim type distribution
            analysis['claim_type_distribution'] = df['claim_type'].value_counts().to_dict()
            
            # Edge case analysis
            edge_cases = df[df['is_edge_case'] == 1]
            analysis['edge_case_analysis'] = {
                'total_edge_cases': len(edge_cases),
                'edge_case_types': edge_cases['edge_case_tag'].value_counts().to_dict(),
                'priority_distribution': edge_cases['retraining_priority'].value_counts().to_dict()
            }
            
            # Model performance analysis
            if 'model_prediction' in df.columns:
                model_accuracy = (df['model_prediction_encoded'] == df['training_label']).mean()
                analysis['model_performance_analysis'] = {
                    'accuracy': model_accuracy,
                    'false_positives': len(df[(df['model_prediction_encoded'] == 1) & (df['training_label'] == 0)]),
                    'false_negatives': len(df[(df['model_prediction_encoded'] == 0) & (df['training_label'] == 1)])
                }
            
            # Rejection patterns
            rejected_claims = df[df['amazon_status'] == 'rejected']
            if not rejected_claims.empty:
                analysis['rejection_patterns'] = {
                    'total_rejections': len(rejected_claims),
                    'common_rejection_reasons': rejected_claims['amazon_rejection_reason'].value_counts().head(5).to_dict(),
                    'rejection_by_claim_type': rejected_claims.groupby('claim_type').size().to_dict()
                }
            
            # Generate recommendations
            analysis['recommendations'] = self._generate_analysis_recommendations(analysis)
            
            return analysis
            
        except Exception as e:
            logger.error(f"Error analyzing feedback patterns: {e}")
            return {}
    
    def _generate_analysis_recommendations(self, analysis: Dict) -> List[str]:
        """Generate actionable recommendations based on analysis"""
        recommendations = []
        
        try:
            # Check for class imbalance
            if 'label_distribution' in analysis:
                labels = analysis['label_distribution']
                total = sum(labels.values())
                if total > 0:
                    positive_rate = labels.get(1, 0) / total
                    if positive_rate < 0.3:
                        recommendations.append("Class imbalance detected: Too few positive examples. Consider oversampling or adjusting thresholds.")
                    elif positive_rate > 0.8:
                        recommendations.append("Class imbalance detected: Too many positive examples. Review labeling criteria.")
            
            # Check edge case distribution
            if 'edge_case_analysis' in analysis:
                edge_cases = analysis['edge_case_analysis']
                if edge_cases.get('total_edge_cases', 0) > 0:
                    high_priority = edge_cases.get('priority_distribution', {}).get(5, 0)
                    if high_priority > 0:
                        recommendations.append(f"Found {high_priority} high-priority edge cases. Immediate model retraining recommended.")
            
            # Check model performance
            if 'model_performance_analysis' in analysis:
                perf = analysis['model_performance_analysis']
                if perf.get('accuracy', 0) < 0.8:
                    recommendations.append("Model accuracy below 80%. Retraining with new feedback data recommended.")
                
                if perf.get('false_negatives', 0) > perf.get('false_positives', 0):
                    recommendations.append("More false negatives than false positives. Focus on improving recall.")
                else:
                    recommendations.append("More false positives than false negatives. Focus on improving precision.")
            
            # Check rejection patterns
            if 'rejection_patterns' in analysis:
                rejections = analysis['rejection_patterns']
                if rejections.get('total_rejections', 0) > 0:
                    recommendations.append("Analyze rejection patterns to identify common failure modes.")
            
            if not recommendations:
                recommendations.append("Feedback data looks balanced. Continue monitoring for patterns.")
                
        except Exception as e:
            logger.error(f"Error generating recommendations: {e}")
            recommendations.append("Error analyzing data. Check data quality.")
        
        return recommendations
    
    def retrain_model(self, 
                     training_data: pd.DataFrame,
                     validation_split: float = 0.2,
                     retrain_threshold: float = 0.8) -> Dict:
        """
        Retrain the model with new feedback data
        
        Args:
            training_data: Prepared training data
            validation_split: Fraction of data to use for validation
            retrain_threshold: Minimum accuracy improvement required to save new model
            
        Returns:
            Dict: Retraining results
        """
        try:
            logger.info("Starting model retraining...")
            
            if training_data.empty:
                logger.warning("No training data available for retraining")
                return {'success': False, 'error': 'No training data available'}
            
            # Split data
            from sklearn.model_selection import train_test_split
            
            # Prepare features and labels
            feature_columns = [col for col in training_data.columns 
                             if col not in ['claim_id', 'claim_text', 'amazon_status', 
                                          'amazon_rejection_reason', 'concierge_notes', 
                                          'edge_case_tag', 'created_at', 'updated_at']]
            
            X = training_data[feature_columns].fillna(0)
            y = training_data['training_label']
            
            # Split into train/validation
            X_train, X_val, y_train, y_val = train_test_split(
                X, y, test_size=validation_split, random_state=42, stratify=y
            )
            
            logger.info(f"Training on {len(X_train)} samples, validating on {len(X_val)} samples")
            
            # Train new model (using the improved training approach)
            from improved_training import ImprovedFBAClaimsModel
            
            new_model = ImprovedFBAClaimsModel()
            new_model.train_improved_model(X_train, y_train)
            
            # Evaluate new model
            new_accuracy = new_model.evaluate_model(X_val, y_val)['accuracy']
            
            # Compare with current model if available
            current_accuracy = 0.0
            if self.current_model and hasattr(self.current_model, 'evaluate_model'):
                current_accuracy = self.current_model.evaluate_model(X_val, y_val)['accuracy']
            
            improvement = new_accuracy - current_accuracy
            
            # Decide whether to save new model
            should_save = improvement >= (retrain_threshold - current_accuracy)
            
            if should_save:
                # Save new model
                with open(self.output_path, 'wb') as f:
                    pickle.dump(new_model, f)
                
                logger.info(f"New model saved: {self.output_path}")
                logger.info(f"Accuracy improvement: {improvement:.4f} ({current_accuracy:.4f} -> {new_accuracy:.4f})")
                
                # Update retraining history
                retraining_record = {
                    'timestamp': datetime.now().isoformat(),
                    'training_samples': len(training_data),
                    'old_accuracy': current_accuracy,
                    'new_accuracy': new_accuracy,
                    'improvement': improvement,
                    'model_path': self.output_path
                }
                self.retraining_history.append(retraining_record)
                
                return {
                    'success': True,
                    'new_accuracy': new_accuracy,
                    'improvement': improvement,
                    'model_saved': True,
                    'retraining_record': retraining_record
                }
            else:
                logger.info(f"Accuracy improvement ({improvement:.4f}) below threshold. Keeping current model.")
                return {
                    'success': True,
                    'new_accuracy': new_accuracy,
                    'improvement': improvement,
                    'model_saved': False
                }
                
        except Exception as e:
            logger.error(f"Error during model retraining: {e}")
            return {'success': False, 'error': str(e)}
    
    def run_full_pipeline(self, 
                         min_samples: int = 100,
                         include_edge_cases: bool = True,
                         recent_days: int = 90,
                         auto_retrain: bool = True) -> Dict:
        """
        Run the complete feedback-to-training pipeline
        
        Args:
            min_samples: Minimum samples required for training
            include_edge_cases: Whether to include edge cases
            recent_days: Only use recent feedback data
            auto_retrain: Whether to automatically retrain the model
            
        Returns:
            Dict: Pipeline results
        """
        try:
            logger.info("Starting feedback-to-training pipeline...")
            
            # Load current model
            self.load_current_model()
            
            # Prepare training data
            training_data = self.prepare_feedback_training_data(
                min_samples=min_samples,
                include_edge_cases=include_edge_cases,
                recent_days=recent_days
            )
            
            if training_data.empty:
                return {
                    'success': False,
                    'error': 'No training data available',
                    'pipeline_stage': 'data_preparation'
                }
            
            # Analyze patterns
            analysis = self.analyze_feedback_patterns(training_data)
            
            # Retrain model if requested and enough data
            retraining_results = None
            if auto_retrain and len(training_data) >= min_samples:
                retraining_results = self.retrain_model(training_data)
            
            # Compile results
            results = {
                'success': True,
                'pipeline_stage': 'completed',
                'training_data_summary': {
                    'total_samples': len(training_data),
                    'feature_columns': list(training_data.columns),
                    'label_distribution': analysis.get('label_distribution', {})
                },
                'pattern_analysis': analysis,
                'retraining_results': retraining_results,
                'timestamp': datetime.now().isoformat()
            }
            
            logger.info("Feedback-to-training pipeline completed successfully")
            return results
            
        except Exception as e:
            logger.error(f"Pipeline error: {e}")
            return {
                'success': False,
                'error': str(e),
                'pipeline_stage': 'failed'
            }
    
    def save_pipeline_results(self, results: Dict, output_path: str = "feedback_pipeline_results.json"):
        """Save pipeline results to file"""
        try:
            with open(output_path, 'w') as f:
                json.dump(results, f, indent=2, default=str)
            logger.info(f"Pipeline results saved to: {output_path}")
        except Exception as e:
            logger.error(f"Error saving pipeline results: {e}")

def main():
    """Example usage of the feedback training pipeline"""
    print("🚀 Starting Feedback-to-Training Pipeline...")
    
    # Initialize components
    claims_logger = ClaimsLogger()  # No database connection for demo
    
    pipeline = FeedbackTrainingPipeline(
        claims_logger=claims_logger,
        model_path="models/improved_fba_claims_model.pkl",
        output_path="models/retrained_fba_claims_model.pkl"
    )
    
    # Run pipeline
    results = pipeline.run_full_pipeline(
        min_samples=50,  # Lower threshold for demo
        include_edge_cases=True,
        recent_days=90,
        auto_retrain=True
    )
    
    # Save results
    pipeline.save_pipeline_results(results)
    
    # Print summary
    if results['success']:
        print("✅ Pipeline completed successfully!")
        print(f"Training samples: {results['training_data_summary']['total_samples']}")
        if results['retraining_results']:
            print(f"Model accuracy: {results['retraining_results']['new_accuracy']:.4f}")
            print(f"Improvement: {results['retraining_results']['improvement']:.4f}")
    else:
        print(f"❌ Pipeline failed: {results.get('error', 'Unknown error')}")

if __name__ == "__main__":
    main()
