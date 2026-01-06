"""
ML Document Validator
Uses machine learning to validate document authenticity and content
"""
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional
import logging
import joblib
from pathlib import Path

logger = logging.getLogger(__name__)

class DocValidator:
    """Machine learning document validator"""
    
    def __init__(self, model_path: Optional[str] = None, model_type: str = "sklearn"):
        """
        Initialize the document validator
        
        Args:
            model_path: Path to trained model file (optional)
            model_type: Type of model ("sklearn", "huggingface", "simulation")
        """
        self.model = None
        self.model_path = model_path
        self.model_type = model_type
        self.is_trained = False
        
        # Load model if path provided
        if model_path and Path(model_path).exists():
            self.load_model(model_path)
    
    def validate_documents(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Validate documents using ML model
        
        Args:
            docs: List of document metadata and extracted text
            
        Returns:
            ML validation results
        """
        logger.info(f"Validating {len(docs)} documents with ML ({self.model_type})")
        
        if not docs:
            return {
                "ml_score": 0.0,
                "ml_valid": False,
                "confidence": 0.0,
                "validation_details": []
            }
        
        # Route to appropriate validation method
        if self.model_type == "huggingface" and self.model:
            return self._validate_with_huggingface(docs)
        elif self.model_type == "sklearn" and self.model and self.is_trained:
            return self._validate_with_sklearn(docs)
        else:
            return self._simulate_validation(docs)
    
    def _validate_with_sklearn(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate documents using scikit-learn model"""
        validation_details = []
        total_score = 0.0
        
        for i, doc in enumerate(docs):
            # Extract features for ML model
            features = self._extract_features(doc)
            
            # Make prediction
            prediction = self.model.predict([features])[0]
            probability = self.model.predict_proba([features])[0][1] if hasattr(self.model, 'predict_proba') else 0.5
            
            validation_details.append({
                "doc_index": i,
                "doc_type": doc.get('metadata', {}).get('document_type', 'unknown'),
                "ml_score": probability,
                "ml_valid": prediction == 1,
                "confidence": probability,
                "features": features,
                "model_type": "sklearn"
            })
            
            total_score += probability
        
        avg_score = total_score / len(docs) if docs else 0.0
        overall_valid = avg_score > 0.75
        
        return {
            "ml_score": avg_score,
            "ml_valid": overall_valid,
            "confidence": avg_score,
            "validation_details": validation_details,
            "model_type": "sklearn"
        }
    
    def _validate_with_huggingface(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate documents using Hugging Face transformer model"""
        validation_details = []
        total_score = 0.0
        
        try:
            # Import transformers (optional dependency)
            from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
            
            for i, doc in enumerate(docs):
                # Get document text
                text = doc.get('extracted_text', '')
                if not text:
                    text = doc.get('metadata', {}).get('document_summary', '')
                
                # Use the model for classification
                result = self.model(text)
                
                # Extract score (assuming binary classification)
                score = result[0]['score'] if result else 0.5
                label = result[0]['label'] if result else 'LABEL_0'
                
                validation_details.append({
                    "doc_index": i,
                    "doc_type": doc.get('metadata', {}).get('document_type', 'unknown'),
                    "ml_score": score,
                    "ml_valid": label == 'LABEL_1',
                    "confidence": score,
                    "text_length": len(text),
                    "model_type": "huggingface"
                })
                
                total_score += score
            
            avg_score = total_score / len(docs) if docs else 0.0
            overall_valid = avg_score > 0.75
            
            return {
                "ml_score": avg_score,
                "ml_valid": overall_valid,
                "confidence": avg_score,
                "validation_details": validation_details,
                "model_type": "huggingface"
            }
            
        except ImportError:
            logger.warning("Transformers not available, falling back to simulation")
            return self._simulate_validation(docs)
        except Exception as e:
            logger.error(f"Error with Hugging Face validation: {e}")
            return self._simulate_validation(docs)
    
    def _simulate_validation(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Simulate ML validation for development/testing"""
        validation_details = []
        total_score = 0.0
        
        for i, doc in enumerate(docs):
            # Simulate document-specific validation
            doc_score = self._simulate_doc_score(doc)
            doc_valid = doc_score > 0.7
            
            validation_details.append({
                "doc_index": i,
                "doc_type": doc.get('metadata', {}).get('document_type', 'unknown'),
                "ml_score": doc_score,
                "ml_valid": doc_valid,
                "confidence": min(doc_score + 0.1, 1.0),
                "features": {
                    "text_length": len(doc.get('extracted_text', '')),
                    "has_dates": self._has_dates(doc.get('extracted_text', '')),
                    "has_amounts": self._has_amounts(doc.get('extracted_text', '')),
                    "has_quantities": self._has_quantities(doc.get('extracted_text', '')),
                    "file_quality": doc.get('metadata', {}).get('file_quality', 0.8)
                },
                "model_type": "simulation"
            })
            
            total_score += doc_score
        
        avg_score = total_score / len(docs) if docs else 0.0
        overall_valid = avg_score > 0.75
        
        return {
            "ml_score": avg_score,
            "ml_valid": overall_valid,
            "confidence": min(avg_score + 0.05, 1.0),
            "validation_details": validation_details,
            "model_type": "simulation"
        }
    
    def _simulate_doc_score(self, doc: Dict[str, Any]) -> float:
        """Simulate a document validation score"""
        base_score = 0.8
        
        # Adjust based on document type
        doc_type = doc.get('metadata', {}).get('document_type', '').lower()
        if 'invoice' in doc_type:
            base_score += 0.1
        elif 'shipping' in doc_type or 'packing' in doc_type:
            base_score += 0.05
        
        # Adjust based on text quality
        text = doc.get('extracted_text', '')
        if len(text) > 100:
            base_score += 0.05
        if self._has_dates(text):
            base_score += 0.05
        if self._has_amounts(text):
            base_score += 0.05
        if self._has_quantities(text):
            base_score += 0.05
        
        # Add some randomness for realistic simulation
        noise = np.random.normal(0, 0.02)
        final_score = base_score + noise
        
        return max(0.0, min(1.0, final_score))
    
    def _has_dates(self, text: str) -> bool:
        """Check if text contains date patterns"""
        import re
        date_patterns = [
            r'\d{1,2}/\d{1,2}/\d{2,4}',
            r'\d{4}-\d{2}-\d{2}',
            r'\d{1,2}-\d{1,2}-\d{2,4}'
        ]
        return any(re.search(pattern, text) for pattern in date_patterns)
    
    def _has_amounts(self, text: str) -> bool:
        """Check if text contains monetary amounts"""
        import re
        amount_patterns = [
            r'\$\d+\.\d{2}',
            r'\d+\.\d{2}',
            r'USD\s*\d+\.\d{2}'
        ]
        return any(re.search(pattern, text) for pattern in amount_patterns)
    
    def _has_quantities(self, text: str) -> bool:
        """Check if text contains quantity patterns"""
        import re
        quantity_patterns = [
            r'Qty[:\s]*\d+',
            r'Quantity[:\s]*\d+',
            r'\d+\s*(pcs|pieces|units|items)'
        ]
        return any(re.search(pattern, text, re.IGNORECASE) for pattern in quantity_patterns)
    
    def _extract_features(self, doc: Dict[str, Any]) -> List[float]:
        """Extract features from document for ML model"""
        text = doc.get('extracted_text', '')
        metadata = doc.get('metadata', {})
        
        features = [
            len(text),  # Text length
            len(text.split()),  # Word count
            len(set(text.split())),  # Unique words
            len([c for c in text if c.isdigit()]),  # Digit count
            len([c for c in text if c.isupper()]),  # Uppercase count
            float(metadata.get('file_size_mb', 0)),  # File size
            float(metadata.get('file_quality', 0.8)),  # File quality
            int(self._has_dates(text)),  # Has dates
            int(self._has_amounts(text)),  # Has amounts
            int(self._has_quantities(text)),  # Has quantities
        ]
        
        return features
    
    def load_model(self, model_path: str):
        """Load a trained model from file"""
        try:
            if self.model_type == "huggingface":
                # Load Hugging Face model
                from transformers import AutoTokenizer, AutoModelForSequenceClassification
                self.model = pipeline("text-classification", model=model_path)
            else:
                # Load scikit-learn model
                self.model = joblib.load(model_path)
            
            self.is_trained = True
            self.model_path = model_path
            logger.info(f"ML model loaded from {model_path} (type: {self.model_type})")
        except Exception as e:
            logger.error(f"Error loading ML model: {e}")
            self.model = None
            self.is_trained = False
    
    def save_model(self, model_path: str):
        """Save the trained model to file"""
        if self.model and self.is_trained:
            try:
                if self.model_type == "sklearn":
                    joblib.dump(self.model, model_path)
                # Hugging Face models are typically saved differently
                logger.info(f"ML model saved to {model_path}")
            except Exception as e:
                logger.error(f"Error saving ML model: {e}")
        else:
            logger.warning("No trained model to save")
    
    def train_model(self, training_data: List[Dict[str, Any]], labels: List[int], 
                   model_type: str = "sklearn"):
        """Train the ML model"""
        logger.info(f"Training ML model (type: {model_type})...")
        
        if model_type == "sklearn":
            self._train_sklearn_model(training_data, labels)
        elif model_type == "huggingface":
            self._train_huggingface_model(training_data, labels)
        else:
            logger.warning(f"Unknown model type: {model_type}")
    
    def _train_sklearn_model(self, training_data: List[Dict[str, Any]], labels: List[int]):
        """Train scikit-learn model"""
        # Extract features
        X = [self._extract_features(doc) for doc in training_data]
        y = labels
        
        # Train a simple model
        try:
            from sklearn.linear_model import LogisticRegression
            from sklearn.ensemble import RandomForestClassifier
            
            # Use Random Forest for better performance
            self.model = RandomForestClassifier(n_estimators=100, random_state=42)
            self.model.fit(X, y)
            self.model_type = "sklearn"
            self.is_trained = True
            
            logger.info("Scikit-learn model training completed")
        except ImportError:
            logger.error("Scikit-learn not available")
    
    def _train_huggingface_model(self, training_data: List[Dict[str, Any]], labels: List[int]):
        """Train Hugging Face transformer model (placeholder)"""
        try:
            # This would require more complex training setup
            logger.info("Hugging Face model training not implemented yet")
        except Exception as e:
            logger.error(f"Error training Hugging Face model: {e}")

