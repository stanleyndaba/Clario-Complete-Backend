"""
Baseline Models for Claim Detector v1.0
Binary classification: Approved vs Rejected claims
"""

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    precision_score, recall_score, f1_score, accuracy_score,
    confusion_matrix, classification_report, roc_auc_score
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import joblib
import logging
from datetime import datetime
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional, Any
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class BaselineMetrics:
    """Baseline model performance metrics"""
    model_name: str
    precision: float
    recall: float
    f1_score: float
    accuracy: float
    roc_auc: float
    confusion_matrix: np.ndarray
    classification_report: str
    timestamp: datetime
    training_samples: int
    validation_samples: int
    cross_val_scores: List[float] = field(default_factory=list)

@dataclass
class BaselineModel:
    """Baseline model with performance tracking"""
    name: str
    model: Any
    vectorizer: Optional[Any] = None
    pipeline: Optional[Any] = None
    metrics: Optional[BaselineMetrics] = None
    is_trained: bool = False

class BaselineModelTrainer:
    """Trains and validates baseline models for binary classification"""
    
    def __init__(self):
        self.models: Dict[str, BaselineModel] = {}
        self.best_model: Optional[BaselineModel] = None
        self.baseline_metrics: Dict[str, BaselineMetrics] = {}
        
    def create_baseline_models(self) -> None:
        """Create baseline models for binary classification"""
        logger.info("Creating baseline models...")
        
        # 1. Logistic Regression with TF-IDF
        lr_tfidf = Pipeline([
            ('tfidf', TfidfVectorizer(
                max_features=5000,
                ngram_range=(1, 2),
                stop_words='english',
                min_df=2,
                max_df=0.95
            )),
            ('classifier', LogisticRegression(
                random_state=42,
                max_iter=1000,
                C=1.0
            ))
        ])
        
        self.models['logistic_regression_tfidf'] = BaselineModel(
            name='Logistic Regression + TF-IDF',
            model=lr_tfidf,
            pipeline=lr_tfidf
        )
        
        # 2. Logistic Regression with TF-IDF + StandardScaler
        lr_tfidf_scaled = Pipeline([
            ('tfidf', TfidfVectorizer(
                max_features=5000,
                ngram_range=(1, 2),
                stop_words='english',
                min_df=2,
                max_df=0.95
            )),
            ('scaler', StandardScaler(with_mean=False)),  # TF-IDF is sparse
            ('classifier', LogisticRegression(
                random_state=42,
                max_iter=1000,
                C=0.1  # L2 regularization
            ))
        ])
        
        self.models['logistic_regression_tfidf_scaled'] = BaselineModel(
            name='Logistic Regression + TF-IDF + Scaled',
            model=lr_tfidf_scaled,
            pipeline=lr_tfidf_scaled
        )
        
        # 3. Simple TF-IDF + Logistic Regression (baseline)
        simple_lr = Pipeline([
            ('tfidf', TfidfVectorizer(
                max_features=2000,
                ngram_range=(1, 1),
                stop_words='english',
                min_df=5,
                max_df=0.9
            )),
            ('classifier', LogisticRegression(
                random_state=42,
                max_iter=500,
                C=1.0
            ))
        ])
        
        self.models['simple_logistic_regression'] = BaselineModel(
            name='Simple Logistic Regression + TF-IDF',
            model=simple_lr,
            pipeline=simple_lr
        )
        
        logger.info(f"Created {len(self.models)} baseline models")
        
    def prepare_training_data(self, claims_data: List[Dict]) -> Tuple[np.ndarray, np.ndarray]:
        """Prepare training data from claims data"""
        logger.info("Preparing training data...")
        
        # Extract text and labels
        texts = []
        labels = []
        
        for claim in claims_data:
            # Combine relevant text fields
            text_parts = []
            
            if 'claim_description' in claim:
                text_parts.append(str(claim['claim_description']))
            if 'rejection_reason' in claim:
                text_parts.append(str(claim['rejection_reason']))
            if 'evidence_submitted' in claim:
                text_parts.append(str(claim['evidence_submitted']))
            if 'amazon_response' in claim:
                text_parts.append(str(claim['amazon_response']))
                
            # Combine all text parts
            combined_text = ' '.join(text_parts) if text_parts else 'no_text'
            texts.append(combined_text)
            
            # Binary label: 1 for approved, 0 for rejected
            if claim.get('status') == 'approved':
                labels.append(1)
            else:
                labels.append(0)
        
        logger.info(f"Prepared {len(texts)} samples with {sum(labels)} approved claims")
        return np.array(texts), np.array(labels)
    
    def train_models(self, X: np.ndarray, y: np.ndarray, 
                    test_size: float = 0.2, random_state: int = 42) -> None:
        """Train all baseline models"""
        logger.info("Training baseline models...")
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state, stratify=y
        )
        
        logger.info(f"Training set: {len(X_train)} samples, Test set: {len(X_test)} samples")
        
        for model_name, baseline_model in self.models.items():
            try:
                logger.info(f"Training {model_name}...")
                
                # Train the model
                baseline_model.pipeline.fit(X_train, y_train)
                baseline_model.is_trained = True
                
                # Make predictions
                y_pred = baseline_model.pipeline.predict(X_test)
                y_pred_proba = baseline_model.pipeline.predict_proba(X_test)[:, 1]
                
                # Calculate metrics
                precision = precision_score(y_test, y_pred, zero_division=0)
                recall = recall_score(y_test, y_pred, zero_division=0)
                f1 = f1_score(y_test, y_pred, zero_division=0)
                accuracy = accuracy_score(y_test, y_pred)
                roc_auc = roc_auc_score(y_test, y_pred_proba)
                
                # Confusion matrix
                cm = confusion_matrix(y_test, y_pred)
                
                # Classification report
                cr = classification_report(y_test, y_pred, output_dict=False)
                
                # Cross-validation scores
                cv_scores = cross_val_score(
                    baseline_model.pipeline, X_train, y_train, 
                    cv=5, scoring='f1', n_jobs=-1
                )
                
                # Store metrics
                baseline_model.metrics = BaselineMetrics(
                    model_name=baseline_model.name,
                    precision=precision,
                    recall=recall,
                    f1_score=f1,
                    accuracy=accuracy,
                    roc_auc=roc_auc,
                    confusion_matrix=cm,
                    classification_report=cr,
                    timestamp=datetime.now(),
                    training_samples=len(X_train),
                    validation_samples=len(X_test),
                    cross_val_scores=cv_scores.tolist()
                )
                
                self.baseline_metrics[model_name] = baseline_model.metrics
                
                logger.info(f"{model_name} trained successfully")
                logger.info(f"   Precision: {precision:.3f}, Recall: {recall:.3f}, F1: {f1:.3f}")
                
            except Exception as e:
                logger.error(f"Error training {model_name}: {e}")
                baseline_model.is_trained = False
    
    def select_best_model(self) -> Optional[BaselineModel]:
        """Select the best performing model based on F1 score"""
        if not self.baseline_metrics:
            logger.warning("No models have been trained yet")
            return None
        
        # Find model with highest F1 score
        best_model_name = max(
            self.baseline_metrics.keys(),
            key=lambda x: self.baseline_metrics[x].f1_score
        )
        
        self.best_model = self.models[best_model_name]
        
        logger.info(f"Best model selected: {best_model_name}")
        logger.info(f"   F1 Score: {self.best_model.metrics.f1_score:.3f}")
        logger.info(f"   Precision: {self.best_model.metrics.precision:.3f}")
        logger.info(f"   Recall: {self.best_model.metrics.recall:.3f}")
        
        return self.best_model
    
    def get_model_performance_summary(self) -> Dict[str, Any]:
        """Get comprehensive performance summary of all models"""
        if not self.baseline_metrics:
            return {"error": "No models trained yet"}
        
        summary = {
            "total_models": len(self.baseline_metrics),
            "models": {},
            "best_model": None,
            "overall_stats": {}
        }
        
        # Individual model performance
        for model_name, metrics in self.baseline_metrics.items():
            summary["models"][model_name] = {
                "precision": metrics.precision,
                "recall": metrics.recall,
                "f1_score": metrics.f1_score,
                "accuracy": metrics.accuracy,
                "roc_auc": metrics.roc_auc,
                "training_samples": metrics.training_samples,
                "validation_samples": metrics.validation_samples,
                "cv_mean": np.mean(metrics.cross_val_scores),
                "cv_std": np.std(metrics.cross_val_scores)
            }
        
        # Best model info
        if self.best_model:
            summary["best_model"] = {
                "name": self.best_model.name,
                "f1_score": self.best_model.metrics.f1_score,
                "precision": self.best_model.metrics.precision,
                "recall": self.best_model.metrics.recall
            }
        
        # Overall statistics
        f1_scores = [m.f1_score for m in self.baseline_metrics.values()]
        precision_scores = [m.precision for m in self.baseline_metrics.values()]
        recall_scores = [m.recall for m in self.baseline_metrics.values()]
        
        summary["overall_stats"] = {
            "avg_f1": np.mean(f1_scores),
            "avg_precision": np.mean(precision_scores),
            "avg_recall": np.mean(recall_scores),
            "std_f1": np.std(f1_scores),
            "std_precision": np.std(precision_scores),
            "std_recall": np.std(recall_scores)
        }
        
        return summary
    
    def save_best_model(self, filepath: str) -> bool:
        """Save the best performing model"""
        if not self.best_model or not self.best_model.is_trained:
            logger.error("No trained best model to save")
            return False
        
        try:
            joblib.dump(self.best_model.pipeline, filepath)
            logger.info(f"Best model saved to {filepath}")
            return True
        except Exception as e:
            logger.error(f"Error saving model: {e}")
            return False
    
    def load_model(self, filepath: str) -> bool:
        """Load a saved model"""
        try:
            loaded_pipeline = joblib.load(filepath)
            
            # Create a new baseline model with loaded pipeline
            loaded_model = BaselineModel(
                name="Loaded Model",
                model=loaded_pipeline,
                pipeline=loaded_pipeline,
                is_trained=True
            )
            
            self.models['loaded_model'] = loaded_model
            logger.info(f"Model loaded from {filepath}")
            return True
            
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            return False
    
    def predict(self, text: str, model_name: str = None) -> Dict[str, Any]:
        """Make prediction using specified model or best model"""
        if model_name and model_name in self.models:
            model = self.models[model_name]
        elif self.best_model:
            model = self.best_model
        else:
            raise ValueError("No trained model available for prediction")
        
        if not model.is_trained:
            raise ValueError(f"Model {model.name} is not trained")
        
        try:
            # Make prediction
            prediction = model.pipeline.predict([text])[0]
            probability = model.pipeline.predict_proba([text])[0]
            
            return {
                "prediction": "approved" if prediction == 1 else "rejected",
                "confidence": float(max(probability)),
                "approved_probability": float(probability[1]),
                "rejected_probability": float(probability[0]),
                "model_used": model.name
            }
            
        except Exception as e:
            logger.error(f"Error making prediction: {e}")
            return {"error": str(e)}

def generate_mock_baseline_data(n_samples: int = 1000) -> List[Dict]:
    """Generate mock data for baseline model training"""
    np.random.seed(42)
    
    # Mock rejection reasons
    rejection_reasons = [
        "Missing invoice documentation",
        "Insufficient evidence of damage",
        "Claim filed outside time limit",
        "Incorrect claim amount",
        "Missing tracking information",
        "Incomplete claim form",
        "Evidence not legible",
        "Claim already processed",
        "Insufficient proof of loss",
        "Missing carrier confirmation"
    ]
    
    # Mock claim descriptions
    claim_descriptions = [
        "Inventory lost during shipment",
        "Package damaged in transit",
        "Incorrect fee charged",
        "Missing reimbursement for return",
        "Product arrived damaged",
        "Wrong item received",
        "Shipping delay compensation",
        "Storage fee dispute",
        "Handling fee error",
        "Missing refund for cancellation"
    ]
    
    claims_data = []
    
    for i in range(n_samples):
        # Randomly decide if claim will be approved
        will_approve = np.random.random() < 0.3  # 30% approval rate
        
        claim = {
            "claim_id": f"CLM_{i:06d}",
            "claim_description": np.random.choice(claim_descriptions),
            "evidence_submitted": "invoice, photos, tracking" if np.random.random() < 0.7 else "partial evidence",
            "amazon_response": "Under review" if will_approve else np.random.choice(rejection_reasons),
            "status": "approved" if will_approve else "rejected",
            "claim_amount": round(np.random.uniform(10, 500), 2),
            "filing_date": datetime.now().strftime("%Y-%m-%d")
        }
        
        claims_data.append(claim)
    
    return claims_data

if __name__ == "__main__":
    # Test the baseline model trainer
    print("Testing Baseline Model Trainer...")
    
    # Generate mock data
    mock_data = generate_mock_baseline_data(1000)
    print(f"Generated {len(mock_data)} mock claims")
    
    # Create trainer
    trainer = BaselineModelTrainer()
    trainer.create_baseline_models()
    
    # Prepare data
    X, y = trainer.prepare_training_data(mock_data)
    
    # Train models
    trainer.train_models(X, y)
    
    # Select best model
    best_model = trainer.select_best_model()
    
    # Get performance summary
    summary = trainer.get_model_performance_summary()
    print("\nPerformance Summary:")
    print(f"Best Model: {summary['best_model']['name']}")
    print(f"F1 Score: {summary['best_model']['f1_score']:.3f}")
    
    # Test prediction
    test_text = "Inventory lost during shipment, need reimbursement for $150"
    prediction = trainer.predict(test_text)
    print(f"\nTest Prediction: {prediction}")
