"""
Heuristic Scoring Engine for Claim Detector
Calculates claim probabilities based on reason code, category, recency, financial ratios, 
logistics metadata, quantities, and keyword signals.
"""

import logging
from typing import Dict, Any, List
from datetime import datetime
import re

logger = logging.getLogger(__name__)


class HeuristicScorer:
    """Heuristic scoring engine for claim probability calculation"""
    
    # Reason code weights (higher = more claimable)
    REASON_CODE_WEIGHTS = {
        # Lowercase variants
        'lost_inventory': 0.85,
        'damaged_inventory': 0.80,
        'fee_overcharge': 0.90,
        'missing_reimbursement': 0.85,
        'warehouse_error': 0.75,
        'shipping_delay': 0.60,
        'quality_issue': 0.50,
        'packaging_damage': 0.70,
        'expired_product': 0.40,
        'recalled_item': 0.30,
        'counterfeit_item': 0.20,
        'inventory_adjustment': 0.75,
        'processing_error': 0.65,
        'inventory_discrepancy': 0.80,
        'refund_mismatch': 0.75,
        'lost_shipment': 0.85,
        # Uppercase variants (from Node.js Agent 2)
        'INCORRECT_FEE': 0.90,
        'DAMAGED_INVENTORY': 0.80,
        'MISSING_UNIT': 0.85,
        'DUPLICATE_CHARGE': 0.95,
        'OVERCHARGE': 0.90,
        'POTENTIAL_FEE_OVERCHARGE': 0.85,
        'INVENTORY_DISCREPANCY': 0.80,
        'POTENTIAL_REFUND_DISCREPANCY': 0.75,
        'LOST_SHIPMENT': 0.85,
        'SETTLEMENT_FEE_ERROR': 0.80,
        'SETTLEMENT_DISCREPANCY': 0.75,
        'FEE_OVERCHARGE': 0.90,
        'MISSING_REIMBURSEMENT': 0.85
    }
    
    # Category weights
    CATEGORY_WEIGHTS = {
        'fee_error': 0.90,
        'inventory_loss': 0.85,
        'damaged_goods': 0.80,
        'overcharge': 0.90,
        'duplicate': 0.95,
        'missing_unit': 0.85,
        'adjustment': 0.70,
        'return_discrepancy': 0.75,
        'settlement_error': 0.80,
        'settlement_discrepancy': 0.75
    }
    
    # High-confidence keywords
    HIGH_CONFIDENCE_KEYWORDS = [
        'lost', 'damaged', 'missing', 'overcharge', 'duplicate', 'error',
        'incorrect', 'wrong', 'fault', 'defect', 'broken', 'destroyed',
        'discrepancy', 'potential', 'fee', 'refund', 'inventory', 'shipment',
        'settlement', 'reimbursement', 'claim', 'adjustment'
    ]
    
    # Low-confidence keywords
    LOW_CONFIDENCE_KEYWORDS = [
        'pending', 'under review', 'unclear', 'maybe', 'possibly', 'uncertain'
    ]
    
    def calculate_probability(self, claim: Dict[str, Any]) -> float:
        """Calculate claim probability using heuristic scoring"""
        try:
            base_score = 0.55  # Start with 55% base probability (slightly above threshold)
            
            # 1. Reason code scoring - check both uppercase and lowercase
            reason_code = claim.get('reason_code', '')
            reason_weight = self.REASON_CODE_WEIGHTS.get(reason_code.upper(), 
                           self.REASON_CODE_WEIGHTS.get(reason_code.lower(), 0.5))
            # Use weighted average that favors higher scores
            base_score = (base_score * 0.4 + reason_weight * 0.6)
            
            # 2. Category scoring
            category = claim.get('category', '').lower()
            category_weight = self.CATEGORY_WEIGHTS.get(category, 0.5)
            # Use weighted average that favors higher scores
            base_score = (base_score * 0.5 + category_weight * 0.5)
            
            # 3. Recency scoring (days since order/delivery)
            days_since_order = claim.get('days_since_order', 365)
            days_since_delivery = claim.get('days_since_delivery', 365)
            
            # More recent = higher probability (Amazon has 60-day window)
            if days_since_order <= 30:
                base_score += 0.15
            elif days_since_order <= 60:
                base_score += 0.10
            elif days_since_order <= 90:
                base_score += 0.05
            elif days_since_order > 365:
                base_score -= 0.20  # Too old, less likely
            
            # 4. Financial ratio scoring
            amount = claim.get('amount', 0)
            order_value = claim.get('order_value', 0)
            shipping_cost = claim.get('shipping_cost', 0)
            
            if order_value > 0:
                amount_ratio = amount / order_value
                # Small percentage of order = more likely valid
                if 0.01 <= amount_ratio <= 0.10:
                    base_score += 0.10
                elif amount_ratio > 0.50:
                    base_score -= 0.10  # Very high ratio might be suspicious
                
                # Amount tier scoring
                if 10 <= amount <= 500:
                    base_score += 0.05  # Sweet spot for claims
                elif amount > 5000:
                    base_score -= 0.05  # Very large amounts scrutinized more
            
            # 5. Logistics metadata scoring
            fulfillment_center = claim.get('fulfillment_center', '').upper()
            marketplace = claim.get('marketplace', '').upper()
            
            # US marketplace and known fulfillment centers = higher confidence
            if marketplace == 'US' or marketplace == 'ATVPDKIKX0DER':
                base_score += 0.05
            
            # 6. Quantity scoring
            quantity = claim.get('quantity', 1)
            if 1 <= quantity <= 10:
                base_score += 0.05  # Small quantities more believable
            elif quantity > 100:
                base_score -= 0.05  # Very large quantities might be errors
            
            # 7. Keyword signal scoring
            description = str(claim.get('description', '')).lower()
            reason = str(claim.get('reason', '')).lower()
            notes = str(claim.get('notes', '')).lower()
            text = f"{description} {reason} {notes}"
            
            # Count high-confidence keywords
            high_conf_count = sum(1 for keyword in self.HIGH_CONFIDENCE_KEYWORDS if keyword in text)
            if high_conf_count >= 2:
                base_score += 0.10
            elif high_conf_count == 1:
                base_score += 0.05
            
            # Count low-confidence keywords
            low_conf_count = sum(1 for keyword in self.LOW_CONFIDENCE_KEYWORDS if keyword in text)
            if low_conf_count >= 2:
                base_score -= 0.10
            elif low_conf_count == 1:
                base_score -= 0.05
            
            # 8. Subcategory scoring
            subcategory = claim.get('subcategory', '').lower()
            if 'fee' in subcategory or 'charge' in subcategory:
                base_score += 0.05
            if 'lost' in subcategory or 'missing' in subcategory:
                base_score += 0.05
            if 'damaged' in subcategory:
                base_score += 0.05
            
            # Normalize to 0-1 range
            probability = max(0.0, min(1.0, base_score))
            
            return probability
            
        except Exception as e:
            logger.error(f"Error calculating probability: {e}")
            return 0.5  # Default to 50% on error
    
    def calculate_confidence(self, claim: Dict[str, Any], probability: float) -> float:
        """Calculate confidence score based on data quality and probability"""
        try:
            confidence = 0.5  # Base confidence
            
            # Higher probability = higher confidence (up to a point)
            if probability >= 0.85:
                confidence = 0.95
            elif probability >= 0.70:
                confidence = 0.85
            elif probability >= 0.60:
                confidence = 0.75
            elif probability >= 0.50:
                confidence = 0.65
            else:
                confidence = 0.55
            
            # Data quality adjustments
            has_order_id = bool(claim.get('order_id'))
            has_amount = bool(claim.get('amount', 0) > 0)
            has_reason_code = bool(claim.get('reason_code'))
            has_description = bool(claim.get('description'))
            
            data_quality_score = sum([has_order_id, has_amount, has_reason_code, has_description]) / 4.0
            confidence = (confidence + data_quality_score) / 2
            
            # Recency affects confidence (recent = more confident)
            days_since_order = claim.get('days_since_order', 365)
            if days_since_order <= 60:
                confidence += 0.10
            elif days_since_order > 365:
                confidence -= 0.10
            
            # Normalize to 0-1 range
            confidence = max(0.0, min(1.0, confidence))
            
            return confidence
            
        except Exception as e:
            logger.error(f"Error calculating confidence: {e}")
            return 0.5
    
    def get_feature_contributions(self, claim: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Get feature contributions for explainability"""
        contributions = []
        
        try:
            # Reason code contribution
            reason_code = claim.get('reason_code', '').upper()
            reason_weight = self.REASON_CODE_WEIGHTS.get(reason_code, 0.5)
            contributions.append({
                'feature': 'reason_code',
                'value': reason_code,
                'contribution': reason_weight - 0.5,
                'weight': 'high' if reason_weight >= 0.8 else 'medium' if reason_weight >= 0.6 else 'low'
            })
            
            # Category contribution
            category = claim.get('category', '').lower()
            category_weight = self.CATEGORY_WEIGHTS.get(category, 0.5)
            contributions.append({
                'feature': 'category',
                'value': category,
                'contribution': category_weight - 0.5,
                'weight': 'high' if category_weight >= 0.8 else 'medium' if category_weight >= 0.6 else 'low'
            })
            
            # Recency contribution
            days_since_order = claim.get('days_since_order', 365)
            if days_since_order <= 60:
                contributions.append({
                    'feature': 'recency',
                    'value': f'{days_since_order} days',
                    'contribution': 0.15,
                    'weight': 'high'
                })
            elif days_since_order > 365:
                contributions.append({
                    'feature': 'recency',
                    'value': f'{days_since_order} days',
                    'contribution': -0.20,
                    'weight': 'low'
                })
            
            # Amount contribution
            amount = claim.get('amount', 0)
            if 10 <= amount <= 500:
                contributions.append({
                    'feature': 'amount',
                    'value': f'${amount}',
                    'contribution': 0.05,
                    'weight': 'medium'
                })
            
            # Keyword contribution
            description = str(claim.get('description', '')).lower()
            high_conf_count = sum(1 for keyword in self.HIGH_CONFIDENCE_KEYWORDS if keyword in description)
            if high_conf_count > 0:
                contributions.append({
                    'feature': 'keyword_signals',
                    'value': f'{high_conf_count} high-confidence keywords',
                    'contribution': 0.05 * high_conf_count,
                    'weight': 'medium'
                })
            
        except Exception as e:
            logger.error(f"Error calculating feature contributions: {e}")
        
        return contributions
    
    def get_model_components(self, claim: Dict[str, Any], probability: float) -> Dict[str, float]:
        """Get model component weights for explainability"""
        return {
            'reason_code_weight': 0.25,
            'category_weight': 0.20,
            'recency_weight': 0.15,
            'financial_ratio_weight': 0.15,
            'logistics_metadata_weight': 0.10,
            'quantity_weight': 0.05,
            'keyword_signals_weight': 0.10
        }


# Global scorer instance
_scorer = HeuristicScorer()


def score_claim(claim: Dict[str, Any]) -> Dict[str, Any]:
    """Score a single claim and return prediction result"""
    start_time = datetime.utcnow()
    
    # Calculate probability
    probability = _scorer.calculate_probability(claim)
    
    # Calculate confidence
    confidence = _scorer.calculate_confidence(claim, probability)
    
    # Determine if claimable (threshold: 0.5)
    claimable = probability >= 0.5
    
    # Get feature contributions
    feature_contributions = _scorer.get_feature_contributions(claim)
    
    # Get model components
    model_components = _scorer.get_model_components(claim, probability)
    
    # Calculate processing time
    processing_time_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
    
    return {
        'claim_id': claim.get('claim_id', ''),
        'claimable': claimable,
        'probability': round(probability, 4),
        'confidence': round(confidence, 4),
        'feature_contributions': feature_contributions,
        'model_components': model_components,
        'processing_time_ms': round(processing_time_ms, 2)
    }


def score_claims_batch(claims: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Score a batch of claims and return predictions with metrics"""
    predictions = []
    claimable_count = 0
    high_confidence_count = 0
    probabilities = []
    confidences = []
    
    for claim in claims:
        result = score_claim(claim)
        predictions.append(result)
        
        if result['claimable']:
            claimable_count += 1
        
        if result['confidence'] >= 0.85:
            high_confidence_count += 1
        
        probabilities.append(result['probability'])
        confidences.append(result['confidence'])
    
    # Calculate batch metrics
    avg_probability = sum(probabilities) / len(probabilities) if probabilities else 0.5
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.5
    
    batch_metrics = {
        'total_claims': len(predictions),
        'claimable_count': claimable_count,
        'high_confidence_count': high_confidence_count,
        'avg_probability': round(avg_probability, 4),
        'avg_confidence': round(avg_confidence, 4),
        'claimable_rate': round(claimable_count / len(predictions), 4) if predictions else 0.0
    }
    
    return {
        'predictions': predictions,
        'batch_metrics': batch_metrics
    }

