"""
ML Validity Classifier for MCDE Evidence Validator (EV)

Lightweight ML classifier for document completeness/validity assessment.
Complements hard compliance checks with intelligent pattern recognition.
"""

import logging
import numpy as np
from typing import Dict, List, Any, Tuple, Optional
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
import joblib
import os
import json

logger = logging.getLogger(__name__)


class MLValidityClassifier:
    """
    ML-based classifier for assessing evidence validity and completeness
    """
    
    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path or "models/validity_classifier.pkl"
        self.vectorizer_path = model_path.replace('.pkl', '_vectorizer.pkl') if model_path else "models/validity_vectorizer.pkl"
        
        # Initialize components
        self.text_vectorizer = None
        self.numerical_scaler = None
        self.classifier = None
        
        # Load or initialize models
        self._load_or_initialize_models()
        
        # Feature importance mapping
        self.feature_names = [
            'text_length', 'has_invoice_number', 'has_date', 'has_amount',
            'has_vendor', 'has_sku', 'has_order_id', 'has_tracking',
            'document_quality', 'ocr_confidence', 'file_size_mb',
            'days_since_incident', 'claim_amount', 'evidence_count'
        ]
    
    def _load_or_initialize_models(self):
        """Load existing models or initialize new ones"""
        try:
            if os.path.exists(self.model_path) and os.path.exists(self.vectorizer_path):
                self.classifier = joblib.load(self.model_path)
                self.text_vectorizer = joblib.load(self.vectorizer_path)
                self.numerical_scaler = StandardScaler()
                logger.info("✅ Loaded existing ML validity models")
            else:
                self._initialize_models()
                logger.info("✅ Initialized new ML validity models")
        except Exception as e:
            logger.warning(f"⚠️ Error loading models, initializing new ones: {e}")
            self._initialize_models()
    
    def _initialize_models(self):
        """Initialize new ML models"""
        # Text vectorizer for claim descriptions
        self.text_vectorizer = TfidfVectorizer(
            max_features=100,
            stop_words='english',
            ngram_range=(1, 2)
        )
        
        # Numerical feature scaler
        self.numerical_scaler = StandardScaler()
        
        # Random Forest classifier
        self.classifier = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            class_weight='balanced'
        )
    
    def extract_features(self, claim: Dict[str, Any], evidence: List[Dict[str, Any]]) -> np.ndarray:
        """
        Extract features from claim and evidence for ML classification
        """
        features = []
        
        # Text features
        text_features = self._extract_text_features(claim, evidence)
        features.extend(text_features)
        
        # Numerical features
        numerical_features = self._extract_numerical_features(claim, evidence)
        features.extend(numerical_features)
        
        # Categorical features (one-hot encoded)
        categorical_features = self._extract_categorical_features(claim, evidence)
        features.extend(categorical_features)
        
        return np.array(features).reshape(1, -1)
    
    def _extract_text_features(self, claim: Dict[str, Any], evidence: List[Dict[str, Any]]) -> List[float]:
        """Extract text-based features"""
        # Combine all text
        all_text = []
        
        # Claim text
        if claim.get('raw_text'):
            all_text.append(claim['raw_text'])
        
        # Evidence descriptions
        for ev in evidence:
            if ev.get('description'):
                all_text.append(ev['description'])
        
        combined_text = ' '.join(all_text)
        
        # Text length (normalized)
        text_length = len(combined_text) / 1000  # Normalize to 0-1 range
        
        # Text vectorization (if vectorizer is fitted)
        if self.text_vectorizer and hasattr(self.text_vectorizer, 'vocabulary_'):
            try:
                text_vector = self.text_vectorizer.transform([combined_text]).toarray()[0]
                # Take mean of vector values
                text_vector_mean = np.mean(text_vector)
            except:
                text_vector_mean = 0.0
        else:
            text_vector_mean = 0.0
        
        return [text_length, text_vector_mean]
    
    def _extract_numerical_features(self, claim: Dict[str, Any], evidence: List[Dict[str, Any]]) -> List[float]:
        """Extract numerical features"""
        metadata = claim.get('metadata', {})
        
        # Basic numerical features
        claim_amount = float(metadata.get('claim_amount', 0))
        evidence_count = len(evidence)
        
        # Days since incident
        days_since_incident = 0
        if claim.get('timestamp'):
            try:
                claim_date = claim['timestamp']
                if isinstance(claim_date, str):
                    claim_date = claim_date.split('T')[0]  # Extract date part
                    from datetime import datetime
                    incident_date = datetime.strptime(claim_date, '%Y-%m-%d')
                    days_since_incident = (datetime.now() - incident_date).days
            except:
                days_since_incident = 0
        
        # Evidence quality metrics
        total_file_size = sum(ev.get('file_size_mb', 0) for ev in evidence)
        avg_ocr_confidence = np.mean([ev.get('ocr_confidence', 0.8) for ev in evidence]) if evidence else 0.8
        
        # Normalize values
        normalized_amount = min(claim_amount / 1000, 1.0)  # Cap at $1000 for normalization
        normalized_days = min(days_since_incident / 365, 1.0)  # Cap at 1 year
        normalized_file_size = min(total_file_size / 100, 1.0)  # Cap at 100MB
        
        return [
            normalized_amount,
            evidence_count / 10,  # Normalize to 0-1 (assuming max 10 evidence items)
            normalized_days,
            normalized_file_size,
            avg_ocr_confidence
        ]
    
    def _extract_categorical_features(self, claim: Dict[str, Any], evidence: List[Dict[str, Any]]) -> List[float]:
        """Extract categorical features (one-hot encoded)"""
        metadata = claim.get('metadata', {})
        
        # Binary features
        has_invoice_number = 1.0 if metadata.get('invoice_number') else 0.0
        has_date = 1.0 if metadata.get('date') or metadata.get('shipment_date') else 0.0
        has_amount = 1.0 if metadata.get('claim_amount') else 0.0
        has_vendor = 1.0 if metadata.get('vendor') else 0.0
        has_sku = 1.0 if metadata.get('sku') else 0.0
        has_order_id = 1.0 if metadata.get('order_id') else 0.0
        has_tracking = 1.0 if metadata.get('tracking_number') else 0.0
        
        # Document quality (based on evidence)
        document_quality = 0.0
        if evidence:
            quality_scores = []
            for ev in evidence:
                score = 0.0
                if ev.get('file_type') in ['pdf', 'doc', 'docx']:
                    score += 0.3
                if ev.get('ocr_confidence', 0) > 0.8:
                    score += 0.3
                if ev.get('file_size_mb', 0) > 0.1:  # Not too small
                    score += 0.2
                if ev.get('width', 0) > 800 and ev.get('height', 0) > 600:
                    score += 0.2
                quality_scores.append(score)
            document_quality = np.mean(quality_scores) if quality_scores else 0.0
        
        return [
            has_invoice_number,
            has_date,
            has_amount,
            has_vendor,
            has_sku,
            has_order_id,
            has_tracking,
            document_quality
        ]
    
    def predict_validity(self, claim: Dict[str, Any], evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Predict evidence validity and completeness
        """
        try:
            # Extract features
            features = self.extract_features(claim, evidence)
            
            # Make prediction
            if self.classifier and hasattr(self.classifier, 'predict_proba'):
                # Get probability scores
                proba = self.classifier.predict_proba(features)[0]
                validity_score = proba[1] if len(proba) > 1 else 0.5
                
                # Get feature importance if available
                feature_importance = self._get_feature_importance(features[0])
            else:
                # Fallback to rule-based scoring
                validity_score = self._rule_based_scoring(claim, evidence)
                feature_importance = {}
            
            # Determine validity level
            if validity_score >= 0.8:
                validity_level = "high"
            elif validity_score >= 0.6:
                validity_level = "medium"
            else:
                validity_level = "low"
            
            return {
                'validity_score': validity_score,
                'validity_level': validity_level,
                'confidence': min(validity_score * 1.2, 1.0),  # Boost confidence slightly
                'feature_importance': feature_importance,
                'recommendations': self._generate_recommendations(validity_score, feature_importance)
            }
            
        except Exception as e:
            logger.error(f"Error in ML validity prediction: {e}")
            return {
                'validity_score': 0.5,
                'validity_level': "unknown",
                'confidence': 0.0,
                'feature_importance': {},
                'recommendations': ["ML validation failed - using fallback scoring"],
                'error': str(e)
            }
    
    def _rule_based_scoring(self, claim: Dict[str, Any], evidence: List[Dict[str, Any]]) -> float:
        """Fallback rule-based scoring when ML model is not available"""
        score = 0.5  # Start with neutral score
        
        metadata = claim.get('metadata', {})
        
        # Boost score for good evidence
        if evidence:
            score += 0.2
        
        # Boost for required fields
        required_fields = ['sku', 'claim_amount', 'order_id']
        for field in required_fields:
            if metadata.get(field):
                score += 0.1
        
        # Boost for recent claims
        if claim.get('timestamp'):
            try:
                from datetime import datetime
                claim_date = claim['timestamp'].split('T')[0]
                incident_date = datetime.strptime(claim_date, '%Y-%m-%d')
                days_old = (datetime.now() - incident_date).days
                if days_old < 30:
                    score += 0.1
                elif days_old < 90:
                    score += 0.05
            except:
                pass
        
        return min(score, 1.0)
    
    def _get_feature_importance(self, features: np.ndarray) -> Dict[str, float]:
        """Get feature importance scores"""
        if not self.classifier or not hasattr(self.classifier, 'feature_importances_'):
            return {}
        
        importance_dict = {}
        for i, importance in enumerate(self.classifier.feature_importances_):
            feature_name = f"feature_{i}" if i < len(self.feature_names) else f"feature_{i}"
            importance_dict[feature_name] = float(importance)
        
        return importance_dict
    
    def _generate_recommendations(self, validity_score: float, feature_importance: Dict[str, float]) -> List[str]:
        """Generate recommendations based on validity score and feature importance"""
        recommendations = []
        
        if validity_score < 0.6:
            recommendations.append("Evidence package needs significant improvement before filing")
            recommendations.append("Consider adding more supporting documentation")
        
        if validity_score < 0.8:
            recommendations.append("Evidence package could be strengthened")
            recommendations.append("Review missing required fields")
        
        # Add specific recommendations based on feature importance
        if feature_importance:
            # Find lowest scoring features
            sorted_features = sorted(feature_importance.items(), key=lambda x: x[1])
            if sorted_features:
                lowest_feature = sorted_features[0][0]
                recommendations.append(f"Focus on improving {lowest_feature}")
        
        return recommendations
    
    def train_model(self, training_data: List[Tuple[Dict[str, Any], List[Dict[str, Any]], int]]):
        """
        Train the ML model with labeled data
        
        Args:
            training_data: List of (claim, evidence, label) tuples
                          where label is 0 (invalid) or 1 (valid)
        """
        try:
            # Extract features and labels
            X = []
            y = []
            
            for claim, evidence, label in training_data:
                features = self.extract_features(claim, evidence)
                X.append(features[0])  # Remove extra dimension
                y.append(label)
            
            X = np.array(X)
            y = np.array(y)
            
            # Fit text vectorizer
            if training_data:
                all_text = []
                for claim, evidence, _ in training_data:
                    if claim.get('raw_text'):
                        all_text.append(claim['raw_text'])
                    for ev in evidence:
                        if ev.get('description'):
                            all_text.append(ev['description'])
                
                if all_text:
                    self.text_vectorizer.fit(all_text)
            
            # Scale numerical features
            self.numerical_scaler.fit(X)
            X_scaled = self.numerical_scaler.transform(X)
            
            # Train classifier
            self.classifier.fit(X_scaled, y)
            
            # Save models
            if self.model_path:
                os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
                joblib.dump(self.classifier, self.model_path)
                joblib.dump(self.text_vectorizer, self.vectorizer_path)
            
            logger.info(f"✅ ML validity model trained with {len(training_data)} samples")
            
        except Exception as e:
            logger.error(f"Error training ML validity model: {e}")
            raise
