"""
Data and model drift detection for FBA reimbursement claim detection
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional, Any
import logging
from datetime import datetime, timedelta
from scipy import stats
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib
from pathlib import Path

logger = logging.getLogger(__name__)

class DriftDetector:
    """Detect data and model drift in FBA reimbursement claims"""
    
    def __init__(self, window_size: int = 30, drift_threshold: float = 0.05):
        """
        Initialize drift detector
        
        Args:
            window_size: Size of monitoring window in days
            drift_threshold: Threshold for drift detection
        """
        self.window_size = window_size
        self.drift_threshold = drift_threshold
        self.baseline_stats = {}
        self.drift_history = []
        self.scaler = StandardScaler()
        
    def compute_baseline_statistics(self, df: pd.DataFrame) -> Dict[str, Any]:
        """
        Compute baseline statistics from historical data
        
        Args:
            df: Historical data DataFrame
            
        Returns:
            Dictionary with baseline statistics
        """
        logger.info("Computing baseline statistics")
        
        baseline_stats = {}
        
        # Numerical feature statistics
        numerical_features = df.select_dtypes(include=[np.number]).columns.tolist()
        exclude_columns = ['claimable', 'claim_id']
        feature_columns = [col for col in numerical_features if col not in exclude_columns]
        
        for feature in feature_columns:
            if feature in df.columns:
                baseline_stats[feature] = {
                    'mean': df[feature].mean(),
                    'std': df[feature].std(),
                    'median': df[feature].median(),
                    'q25': df[feature].quantile(0.25),
                    'q75': df[feature].quantile(0.75),
                    'min': df[feature].min(),
                    'max': df[feature].max()
                }
        
        # Categorical feature statistics
        categorical_features = ['category', 'subcategory', 'reason_code', 'marketplace']
        for feature in categorical_features:
            if feature in df.columns:
                value_counts = df[feature].value_counts(normalize=True)
                baseline_stats[feature] = {
                    'value_counts': value_counts.to_dict(),
                    'unique_count': df[feature].nunique()
                }
        
        # Target distribution
        if 'claimable' in df.columns:
            baseline_stats['target'] = {
                'claimable_rate': df['claimable'].mean(),
                'total_samples': len(df)
            }
        
        # Temporal patterns
        if 'claim_date' in df.columns:
            df['claim_date'] = pd.to_datetime(df['claim_date'])
            baseline_stats['temporal'] = {
                'daily_avg_claims': df.groupby(df['claim_date'].dt.date).size().mean(),
                'weekly_pattern': df.groupby(df['claim_date'].dt.dayofweek).size().to_dict(),
                'monthly_pattern': df.groupby(df['claim_date'].dt.month).size().to_dict()
            }
        
        self.baseline_stats = baseline_stats
        logger.info(f"Baseline statistics computed for {len(baseline_stats)} features")
        
        return baseline_stats
    
    def detect_feature_drift(self, current_data: pd.DataFrame) -> Dict[str, Any]:
        """
        Detect drift in individual features
        
        Args:
            current_data: Current data window
            
        Returns:
            Dictionary with drift detection results
        """
        logger.info("Detecting feature drift")
        
        drift_results = {}
        
        # Check numerical features
        numerical_features = current_data.select_dtypes(include=[np.number]).columns.tolist()
        exclude_columns = ['claimable', 'claim_id']
        feature_columns = [col for col in numerical_features if col not in exclude_columns]
        
        for feature in feature_columns:
            if feature in self.baseline_stats and feature in current_data.columns:
                baseline = self.baseline_stats[feature]
                current = current_data[feature]
                
                # Statistical tests for drift
                drift_detected = False
                drift_score = 0.0
                
                # KS test for distribution drift
                if len(current) > 10:
                    try:
                        # Create synthetic baseline data for comparison
                        baseline_data = np.random.normal(
                            baseline['mean'], baseline['std'], 
                            size=min(1000, len(current))
                        )
                        
                        ks_stat, p_value = stats.ks_2samp(baseline_data, current)
                        drift_score = 1 - p_value
                        drift_detected = p_value < self.drift_threshold
                        
                    except Exception as e:
                        logger.warning(f"KS test failed for {feature}: {e}")
                        drift_score = 0.0
                        drift_detected = False
                
                # Mean shift detection
                mean_shift = abs(current.mean() - baseline['mean']) / (baseline['std'] + 1e-8)
                mean_drift = mean_shift > 2.0  # 2 standard deviations
                
                drift_results[feature] = {
                    'drift_detected': drift_detected or mean_drift,
                    'drift_score': max(drift_score, mean_shift),
                    'current_mean': current.mean(),
                    'baseline_mean': baseline['mean'],
                    'mean_shift': mean_shift,
                    'ks_p_value': p_value if 'p_value' in locals() else None
                }
        
        # Check categorical features
        categorical_features = ['category', 'subcategory', 'reason_code', 'marketplace']
        for feature in categorical_features:
            if feature in self.baseline_stats and feature in current_data.columns:
                baseline_dist = self.baseline_stats[feature]['value_counts']
                current_dist = current_data[feature].value_counts(normalize=True)
                
                # Chi-square test for categorical drift
                drift_detected = False
                drift_score = 0.0
                
                try:
                    # Align distributions
                    all_categories = set(baseline_dist.keys()) | set(current_dist.keys())
                    baseline_aligned = [baseline_dist.get(cat, 0) for cat in all_categories]
                    current_aligned = [current_dist.get(cat, 0) for cat in all_categories]
                    
                    if sum(baseline_aligned) > 0 and sum(current_aligned) > 0:
                        chi2_stat, p_value = stats.chi2_contingency([
                            baseline_aligned, current_aligned
                        ])
                        drift_score = 1 - p_value
                        drift_detected = p_value < self.drift_threshold
                    else:
                        drift_score = 0.0
                        drift_detected = False
                        
                except Exception as e:
                    logger.warning(f"Chi-square test failed for {feature}: {e}")
                    drift_score = 0.0
                    drift_detected = False
                
                drift_results[feature] = {
                    'drift_detected': drift_detected,
                    'drift_score': drift_score,
                    'current_distribution': current_dist.to_dict(),
                    'baseline_distribution': baseline_dist
                }
        
        return drift_results
    
    def detect_target_drift(self, current_data: pd.DataFrame) -> Dict[str, Any]:
        """
        Detect drift in target variable distribution
        
        Args:
            current_data: Current data window
            
        Returns:
            Dictionary with target drift results
        """
        logger.info("Detecting target drift")
        
        if 'claimable' not in current_data.columns or 'target' not in self.baseline_stats:
            return {}
        
        baseline_rate = self.baseline_stats['target']['claimable_rate']
        current_rate = current_data['claimable'].mean()
        
        # Statistical test for proportion drift
        baseline_n = self.baseline_stats['target']['total_samples']
        current_n = len(current_data)
        
        drift_detected = False
        drift_score = 0.0
        
        try:
            # Z-test for proportion difference
            pooled_p = (baseline_rate * baseline_n + current_rate * current_n) / (baseline_n + current_n)
            se = np.sqrt(pooled_p * (1 - pooled_p) * (1/baseline_n + 1/current_n))
            z_stat = (current_rate - baseline_rate) / se
            p_value = 2 * (1 - stats.norm.cdf(abs(z_stat)))
            
            drift_score = 1 - p_value
            drift_detected = p_value < self.drift_threshold
            
        except Exception as e:
            logger.warning(f"Target drift test failed: {e}")
            drift_score = 0.0
            drift_detected = False
        
        return {
            'drift_detected': drift_detected,
            'drift_score': drift_score,
            'current_rate': current_rate,
            'baseline_rate': baseline_rate,
            'rate_change': current_rate - baseline_rate,
            'z_statistic': z_stat if 'z_stat' in locals() else None,
            'p_value': p_value if 'p_value' in locals() else None
        }
    
    def detect_concept_drift(self, predictions: np.ndarray, actuals: np.ndarray) -> Dict[str, Any]:
        """
        Detect concept drift using prediction vs actual performance
        
        Args:
            predictions: Model predictions
            actuals: Actual values
            
        Returns:
            Dictionary with concept drift results
        """
        logger.info("Detecting concept drift")
        
        if len(predictions) != len(actuals) or len(predictions) < 10:
            return {}
        
        # Calculate performance metrics
        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
        
        accuracy = accuracy_score(actuals, predictions)
        precision = precision_score(actuals, predictions, zero_division=0)
        recall = recall_score(actuals, predictions, zero_division=0)
        f1 = f1_score(actuals, predictions, zero_division=0)
        
        # Compare with baseline performance (assuming baseline is stored)
        baseline_performance = getattr(self, 'baseline_performance', {
            'accuracy': 0.85,
            'precision': 0.80,
            'recall': 0.75,
            'f1': 0.77
        })
        
        # Calculate performance degradation
        performance_degradation = {
            'accuracy_degradation': baseline_performance['accuracy'] - accuracy,
            'precision_degradation': baseline_performance['precision'] - precision,
            'recall_degradation': baseline_performance['recall'] - recall,
            'f1_degradation': baseline_performance['f1'] - f1
        }
        
        # Detect significant degradation
        degradation_threshold = 0.05  # 5% degradation
        concept_drift_detected = any(
            deg > degradation_threshold for deg in performance_degradation.values()
        )
        
        return {
            'concept_drift_detected': concept_drift_detected,
            'current_performance': {
                'accuracy': accuracy,
                'precision': precision,
                'recall': recall,
                'f1': f1
            },
            'baseline_performance': baseline_performance,
            'performance_degradation': performance_degradation,
            'degradation_threshold': degradation_threshold
        }
    
    def detect_data_quality_issues(self, current_data: pd.DataFrame) -> Dict[str, Any]:
        """
        Detect data quality issues that might indicate drift
        
        Args:
            current_data: Current data window
            
        Returns:
            Dictionary with data quality issues
        """
        logger.info("Detecting data quality issues")
        
        quality_issues = {}
        
        # Missing values
        missing_rates = current_data.isnull().sum() / len(current_data)
        high_missing_features = missing_rates[missing_rates > 0.1].to_dict()
        
        if high_missing_features:
            quality_issues['high_missing_values'] = high_missing_features
        
        # Outliers detection
        numerical_features = current_data.select_dtypes(include=[np.number]).columns.tolist()
        exclude_columns = ['claimable', 'claim_id']
        feature_columns = [col for col in numerical_features if col not in exclude_columns]
        
        outlier_features = {}
        for feature in feature_columns:
            if feature in current_data.columns:
                Q1 = current_data[feature].quantile(0.25)
                Q3 = current_data[feature].quantile(0.75)
                IQR = Q3 - Q1
                outlier_mask = (current_data[feature] < Q1 - 1.5 * IQR) | (current_data[feature] > Q3 + 1.5 * IQR)
                outlier_rate = outlier_mask.sum() / len(current_data)
                
                if outlier_rate > 0.1:  # More than 10% outliers
                    outlier_features[feature] = outlier_rate
        
        if outlier_features:
            quality_issues['high_outlier_rate'] = outlier_features
        
        # Data type inconsistencies
        type_issues = {}
        for col in current_data.columns:
            if col in self.baseline_stats:
                # Check if data types are consistent
                if isinstance(self.baseline_stats[col], dict) and 'value_counts' in self.baseline_stats[col]:
                    # Categorical feature
                    if current_data[col].dtype == 'object':
                        pass  # Expected
                    else:
                        type_issues[col] = f"Expected categorical, got {current_data[col].dtype}"
                else:
                    # Numerical feature
                    if pd.api.types.is_numeric_dtype(current_data[col]):
                        pass  # Expected
                    else:
                        type_issues[col] = f"Expected numerical, got {current_data[col].dtype}"
        
        if type_issues:
            quality_issues['data_type_inconsistencies'] = type_issues
        
        return quality_issues
    
    def comprehensive_drift_analysis(self, current_data: pd.DataFrame, 
                                   predictions: np.ndarray = None, 
                                   actuals: np.ndarray = None) -> Dict[str, Any]:
        """
        Perform comprehensive drift analysis
        
        Args:
            current_data: Current data window
            predictions: Model predictions (optional)
            actuals: Actual values (optional)
            
        Returns:
            Comprehensive drift analysis results
        """
        logger.info("Performing comprehensive drift analysis")
        
        analysis_results = {
            'timestamp': datetime.now().isoformat(),
            'window_size': len(current_data),
            'feature_drift': self.detect_feature_drift(current_data),
            'target_drift': self.detect_target_drift(current_data),
            'data_quality_issues': self.detect_data_quality_issues(current_data)
        }
        
        if predictions is not None and actuals is not None:
            analysis_results['concept_drift'] = self.detect_concept_drift(predictions, actuals)
        
        # Overall drift assessment
        drift_scores = []
        for feature, result in analysis_results['feature_drift'].items():
            if 'drift_score' in result:
                drift_scores.append(result['drift_score'])
        
        if analysis_results['target_drift'] and 'drift_score' in analysis_results['target_drift']:
            drift_scores.append(analysis_results['target_drift']['drift_score'])
        
        if analysis_results.get('concept_drift') and 'concept_drift_detected' in analysis_results['concept_drift']:
            if analysis_results['concept_drift']['concept_drift_detected']:
                drift_scores.append(1.0)  # High drift score for concept drift
        
        overall_drift_score = np.mean(drift_scores) if drift_scores else 0.0
        overall_drift_detected = overall_drift_score > self.drift_threshold
        
        analysis_results['overall_assessment'] = {
            'overall_drift_score': overall_drift_score,
            'overall_drift_detected': overall_drift_detected,
            'drift_severity': 'high' if overall_drift_score > 0.7 else 'medium' if overall_drift_score > 0.3 else 'low'
        }
        
        # Store drift history
        self.drift_history.append(analysis_results)
        
        logger.info(f"Drift analysis completed. Overall drift score: {overall_drift_score:.4f}")
        
        return analysis_results
    
    def save_drift_history(self, file_path: str):
        """Save drift history to file"""
        import json
        
        # Convert numpy arrays to lists for JSON serialization
        def convert_for_json(obj):
            if isinstance(obj, np.ndarray):
                return obj.tolist()
            elif isinstance(obj, pd.Series):
                return obj.tolist()
            elif isinstance(obj, dict):
                return {k: convert_for_json(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_for_json(item) for item in obj]
            else:
                return obj
        
        serializable_history = convert_for_json(self.drift_history)
        
        with open(file_path, 'w') as f:
            json.dump(serializable_history, f, indent=2, default=str)
        
        logger.info(f"Drift history saved to {file_path}")
    
    def load_drift_history(self, file_path: str):
        """Load drift history from file"""
        import json
        
        if Path(file_path).exists():
            with open(file_path, 'r') as f:
                self.drift_history = json.load(f)
            logger.info(f"Drift history loaded from {file_path}")
        else:
            logger.warning(f"Drift history file not found: {file_path}") 