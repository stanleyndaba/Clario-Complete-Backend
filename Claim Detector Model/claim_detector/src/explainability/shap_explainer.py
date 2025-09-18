"""
SHAP explainability module for FBA reimbursement claim detection
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional, Any
import logging
import shap
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import json

logger = logging.getLogger(__name__)

class SHAPExplainer:
    """SHAP-based explainability for the ensemble model"""
    
    def __init__(self, model=None):
        """
        Initialize SHAP explainer
        
        Args:
            model: Trained ensemble model
        """
        self.model = model
        self.explainer = None
        self.feature_names = []
        self.baseline_values = {}
        
    def initialize_explainer(self, model, feature_names: List[str]):
        """
        Initialize SHAP explainer with the model
        
        Args:
            model: Trained ensemble model
            feature_names: List of feature names
        """
        self.model = model
        self.feature_names = feature_names
        
        # Initialize explainer for LightGBM (most interpretable)
        if hasattr(model, 'models') and 'lightgbm' in model.models:
            self.explainer = shap.TreeExplainer(model.models['lightgbm'])
            logger.info("SHAP TreeExplainer initialized for LightGBM")
        else:
            logger.warning("LightGBM model not found, SHAP explainer not initialized")
    
    def explain_prediction(self, sample: pd.DataFrame, top_n: int = 10) -> Dict[str, Any]:
        """
        Explain a single prediction
        
        Args:
            sample: Single sample DataFrame
            top_n: Number of top features to return
            
        Returns:
            Dictionary with explanation details
        """
        if self.explainer is None:
            raise ValueError("SHAP explainer not initialized")
        
        # Get SHAP values
        shap_values = self.explainer.shap_values(sample)
        
        # For binary classification, use positive class values
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # Positive class
        
        # Get feature contributions
        feature_contributions = []
        for i, feature in enumerate(self.feature_names):
            if i < len(shap_values[0]):
                contribution = shap_values[0][i]
                feature_contributions.append({
                    'feature_name': feature,
                    'contribution': float(contribution),
                    'abs_contribution': abs(contribution)
                })
        
        # Sort by absolute contribution
        feature_contributions.sort(key=lambda x: x['abs_contribution'], reverse=True)
        
        # Get prediction details
        prediction = self.model.predict(sample)
        probability = prediction['probabilities'][0] if 'probabilities' in prediction else 0.5
        
        explanation = {
            'prediction': bool(prediction['predictions'][0]) if 'predictions' in prediction else False,
            'probability': float(probability),
            'base_value': float(self.explainer.expected_value[1]) if hasattr(self.explainer, 'expected_value') else 0.0,
            'feature_contributions': feature_contributions[:top_n],
            'total_contribution': sum(abs(fc['contribution']) for fc in feature_contributions),
            'positive_contributions': [fc for fc in feature_contributions[:top_n] if fc['contribution'] > 0],
            'negative_contributions': [fc for fc in feature_contributions[:top_n] if fc['contribution'] < 0]
        }
        
        return explanation
    
    def explain_batch_predictions(self, samples: pd.DataFrame, top_n: int = 10) -> Dict[str, Any]:
        """
        Explain multiple predictions
        
        Args:
            samples: DataFrame with multiple samples
            top_n: Number of top features to return
            
        Returns:
            Dictionary with batch explanation details
        """
        if self.explainer is None:
            raise ValueError("SHAP explainer not initialized")
        
        # Get SHAP values for all samples
        shap_values = self.explainer.shap_values(samples)
        
        # For binary classification, use positive class values
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # Positive class
        
        # Calculate feature importance across all samples
        feature_importance = {}
        for i, feature in enumerate(self.feature_names):
            if i < shap_values.shape[1]:
                importance = np.mean(np.abs(shap_values[:, i]))
                feature_importance[feature] = float(importance)
        
        # Sort features by importance
        sorted_features = sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
        
        # Get predictions
        predictions = self.model.predict(samples)
        
        batch_explanation = {
            'sample_count': len(samples),
            'avg_probability': np.mean(predictions['probabilities']) if 'probabilities' in predictions else 0.5,
            'feature_importance': sorted_features[:top_n],
            'prediction_distribution': {
                'claimable_count': sum(predictions['predictions']) if 'predictions' in predictions else 0,
                'not_claimable_count': len(samples) - sum(predictions['predictions']) if 'predictions' in predictions else len(samples)
            },
            'shap_values_summary': {
                'mean_abs_shap': float(np.mean(np.abs(shap_values))),
                'std_shap': float(np.std(shap_values)),
                'max_shap': float(np.max(shap_values)),
                'min_shap': float(np.min(shap_values))
            }
        }
        
        return batch_explanation
    
    def generate_feature_importance_plot(self, samples: pd.DataFrame, 
                                       output_path: str = None) -> Dict[str, Any]:
        """
        Generate feature importance plot
        
        Args:
            samples: DataFrame with samples
            output_path: Path to save the plot
            
        Returns:
            Dictionary with plot information
        """
        if self.explainer is None:
            raise ValueError("SHAP explainer not initialized")
        
        # Get SHAP values
        shap_values = self.explainer.shap_values(samples)
        
        # For binary classification, use positive class values
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # Positive class
        
        # Create summary plot
        plt.figure(figsize=(12, 8))
        shap.summary_plot(shap_values, samples, feature_names=self.feature_names, show=False)
        
        if output_path:
            plt.savefig(output_path, bbox_inches='tight', dpi=300)
            logger.info(f"Feature importance plot saved to {output_path}")
        
        plt.close()
        
        return {
            'plot_generated': True,
            'output_path': output_path,
            'sample_count': len(samples),
            'feature_count': len(self.feature_names)
        }
    
    def generate_waterfall_plot(self, sample: pd.DataFrame, sample_index: int = 0,
                               output_path: str = None) -> Dict[str, Any]:
        """
        Generate waterfall plot for a single prediction
        
        Args:
            sample: DataFrame with samples
            sample_index: Index of sample to explain
            output_path: Path to save the plot
            
        Returns:
            Dictionary with plot information
        """
        if self.explainer is None:
            raise ValueError("SHAP explainer not initialized")
        
        # Get SHAP values for the specific sample
        shap_values = self.explainer.shap_values(sample.iloc[sample_index:sample_index+1])
        
        # For binary classification, use positive class values
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # Positive class
        
        # Create waterfall plot
        plt.figure(figsize=(12, 8))
        shap.waterfall_plot(
            shap.Explanation(
                values=shap_values[0],
                base_values=self.explainer.expected_value[1] if hasattr(self.explainer, 'expected_value') else 0,
                data=sample.iloc[sample_index:sample_index+1].values,
                feature_names=self.feature_names
            ),
            show=False
        )
        
        if output_path:
            plt.savefig(output_path, bbox_inches='tight', dpi=300)
            logger.info(f"Waterfall plot saved to {output_path}")
        
        plt.close()
        
        return {
            'plot_generated': True,
            'output_path': output_path,
            'sample_index': sample_index,
            'shap_values': shap_values[0].tolist()
        }
    
    def generate_dependence_plots(self, samples: pd.DataFrame, 
                                 top_features: int = 5, output_dir: str = None) -> Dict[str, Any]:
        """
        Generate dependence plots for top features
        
        Args:
            samples: DataFrame with samples
            top_features: Number of top features to plot
            output_dir: Directory to save plots
            
        Returns:
            Dictionary with plot information
        """
        if self.explainer is None:
            raise ValueError("SHAP explainer not initialized")
        
        # Get SHAP values
        shap_values = self.explainer.shap_values(samples)
        
        # For binary classification, use positive class values
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # Positive class
        
        # Calculate feature importance
        feature_importance = {}
        for i, feature in enumerate(self.feature_names):
            if i < shap_values.shape[1]:
                importance = np.mean(np.abs(shap_values[:, i]))
                feature_importance[feature] = float(importance)
        
        # Get top features
        top_features_list = sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)[:top_features]
        
        plots_generated = []
        
        for feature_name, importance in top_features_list:
            try:
                plt.figure(figsize=(10, 6))
                shap.dependence_plot(
                    feature_name, shap_values, samples,
                    feature_names=self.feature_names, show=False
                )
                
                if output_dir:
                    output_path = Path(output_dir) / f"dependence_{feature_name}.png"
                    plt.savefig(output_path, bbox_inches='tight', dpi=300)
                    plots_generated.append(str(output_path))
                
                plt.close()
                
            except Exception as e:
                logger.warning(f"Error generating dependence plot for {feature_name}: {e}")
        
        return {
            'plots_generated': len(plots_generated),
            'output_paths': plots_generated,
            'top_features': top_features_list
        }
    
    def explain_model_behavior(self, samples: pd.DataFrame) -> Dict[str, Any]:
        """
        Provide comprehensive model behavior explanation
        
        Args:
            samples: DataFrame with samples
            
        Returns:
            Dictionary with model behavior explanation
        """
        if self.explainer is None:
            raise ValueError("SHAP explainer not initialized")
        
        # Get SHAP values
        shap_values = self.explainer.shap_values(samples)
        
        # For binary classification, use positive class values
        if isinstance(shap_values, list):
            shap_values = shap_values[1]  # Positive class
        
        # Calculate comprehensive statistics
        feature_stats = {}
        for i, feature in enumerate(self.feature_names):
            if i < shap_values.shape[1]:
                feature_values = shap_values[:, i]
                feature_stats[feature] = {
                    'mean_contribution': float(np.mean(feature_values)),
                    'std_contribution': float(np.std(feature_values)),
                    'abs_mean_contribution': float(np.mean(np.abs(feature_values))),
                    'max_contribution': float(np.max(feature_values)),
                    'min_contribution': float(np.min(feature_values)),
                    'positive_contribution_rate': float(np.mean(feature_values > 0))
                }
        
        # Overall model behavior
        model_behavior = {
            'total_samples': len(samples),
            'avg_prediction_contribution': float(np.mean(np.abs(shap_values))),
            'prediction_variance': float(np.var(shap_values)),
            'feature_importance_ranking': sorted(
                feature_stats.items(), 
                key=lambda x: x[1]['abs_mean_contribution'], 
                reverse=True
            ),
            'most_positive_features': sorted(
                feature_stats.items(), 
                key=lambda x: x[1]['mean_contribution'], 
                reverse=True
            )[:5],
            'most_negative_features': sorted(
                feature_stats.items(), 
                key=lambda x: x[1]['mean_contribution']
            )[:5],
            'most_variable_features': sorted(
                feature_stats.items(), 
                key=lambda x: x[1]['std_contribution'], 
                reverse=True
            )[:5]
        }
        
        return model_behavior
    
    def save_explanation_report(self, samples: pd.DataFrame, output_path: str):
        """
        Save comprehensive explanation report
        
        Args:
            samples: DataFrame with samples
            output_path: Path to save the report
        """
        logger.info("Generating comprehensive explanation report")
        
        # Get various explanations
        batch_explanation = self.explain_batch_predictions(samples)
        model_behavior = self.explain_model_behavior(samples)
        
        # Combine into comprehensive report
        report = {
            'timestamp': pd.Timestamp.now().isoformat(),
            'sample_count': len(samples),
            'feature_count': len(self.feature_names),
            'batch_explanation': batch_explanation,
            'model_behavior': model_behavior,
            'feature_importance': batch_explanation['feature_importance'],
            'prediction_distribution': batch_explanation['prediction_distribution']
        }
        
        # Save report
        with open(output_path, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        logger.info(f"Explanation report saved to {output_path}")
        
        return report 