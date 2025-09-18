#!/usr/bin/env python3
"""
Enhanced Rejection Logger for Concierge Feedback Update System
Captures every Amazon rejection and transforms it into actionable intelligence
"""

import json
import uuid
import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class RejectionData:
    """Data structure for Amazon rejection"""
    claim_id: str
    sku: Optional[str] = None
    asin: Optional[str] = None
    claim_type: str = ""
    claim_amount: float = 0.0
    claim_text: str = ""
    
    # Amazon's rejection details
    amazon_rejection_reason: str = ""
    rejection_date: datetime = None
    amazon_case_id: Optional[str] = None
    amazon_rule_version: Optional[str] = None
    
    # Model performance data
    model_prediction: Optional[bool] = None
    model_confidence: Optional[float] = None
    model_features: Optional[Dict] = None

@dataclass
class NormalizedRejection:
    """Normalized rejection with analysis"""
    rejection_data: RejectionData
    normalized_reason: str
    reason_category: str
    confidence_score: float
    feedback_tag: str  # 'fixable' or 'unclaimable'
    fixable_reason: Optional[str] = None
    unclaimable_reason: Optional[str] = None
    action_required: str = ""
    priority_level: int = 3

class RejectionReasonNormalizer:
    """Normalizes Amazon's rejection reasons into standard categories"""
    
    def __init__(self):
        # Default reason mappings (can be loaded from database)
        self.reason_mappings = {
            # Documentation Issues (Fixable)
            r'insufficient evidence|photos required|missing documentation|documentation incomplete':
                ('Documentation Missing', 'documentation', 'fixable', 4, 'Add evidence requirements to claim template'),
            
            # Policy Issues (Unclaimable)
            r'policy not claimable|not eligible for reimbursement|outside of policy|policy restriction':
                ('Policy Restriction', 'policy', 'unclaimable', 5, 'Add policy rule to block similar claims'),
            
            # Timing Issues (Unclaimable)
            r'timeframe expired|past deadline|too old|claim window closed|timeline exceeded':
                ('Time Limit Exceeded', 'timing', 'unclaimable', 3, 'Add time limit validation'),
            
            # Format Issues (Fixable)
            r'incorrect format|wrong format|invalid format|format error|submission format':
                ('Format Error', 'format', 'fixable', 3, 'Update claim submission format'),
            
            # Amount Issues (Fixable)
            r'amount incorrect|wrong amount|overcharged|calculation error|price discrepancy':
                ('Amount Error', 'calculation', 'fixable', 3, 'Add amount validation logic'),
            
            # Evidence Issues (Fixable)
            r'evidence insufficient|better evidence needed|more evidence required|evidence quality':
                ('Evidence Insufficient', 'evidence', 'fixable', 4, 'Add evidence quality checks'),
            
            # Verification Issues (Fixable)
            r'verification required|need verification|unable to verify|verification failed':
                ('Verification Required', 'verification', 'fixable', 4, 'Add verification requirements'),
            
            # Process Issues (Fixable)
            r'process error|submission error|system error|technical issue':
                ('Process Error', 'process', 'fixable', 2, 'Fix submission process'),
            
            # Unknown/Uncategorized
            r'.*':
                ('Unknown Reason', 'unknown', 'fixable', 1, 'Manual review required')
        }
    
    def normalize_reason(self, amazon_reason: str) -> Tuple[str, str, str, int, str]:
        """
        Normalize Amazon's rejection reason into standard categories
        
        Args:
            amazon_reason: Amazon's exact rejection text
            
        Returns:
            Tuple of (normalized_reason, category, feedback_tag, priority, action_required)
        """
        amazon_reason_lower = amazon_reason.lower()
        
        for pattern, (normalized, category, tag, priority, action) in self.reason_mappings.items():
            if re.search(pattern, amazon_reason_lower):
                return (normalized, category, tag, priority, action)
        
        # Fallback to unknown
        return ('Unknown Reason', 'unknown', 'fixable', 1, 'Manual review required')
    
    def calculate_confidence(self, amazon_reason: str, normalized_reason: str) -> float:
        """Calculate confidence score for normalization"""
        # Simple heuristic - can be enhanced with ML
        amazon_words = set(amazon_reason.lower().split())
        normalized_words = set(normalized_reason.lower().split())
        
        if not amazon_words:
            return 0.0
        
        overlap = len(amazon_words.intersection(normalized_words))
        confidence = overlap / len(amazon_words)
        
        # Boost confidence for exact matches
        if amazon_reason.lower() in normalized_reason.lower():
            confidence = min(confidence + 0.3, 1.0)
        
        return round(confidence, 2)

class RejectionLogger:
    """Enhanced rejection logger with normalization and tagging"""
    
    def __init__(self, db_connection=None):
        self.db_connection = db_connection
        self.normalizer = RejectionReasonNormalizer()
        self.pending_rejections = {}  # In-memory cache
        
        # Pattern recognition tracking
        self.rejection_patterns = {}
        self.pattern_confidence_history = []
        
        # Processing metrics
        self.total_rejections_processed = 0
        self.learning_improvements = []
        
    def log_rejection(self, 
                     claim_id: str,
                     amazon_rejection_reason: str,
                     sku: Optional[str] = None,
                     asin: Optional[str] = None,
                     claim_type: str = "",
                     claim_amount: float = 0.0,
                     claim_text: str = "",
                     amazon_case_id: Optional[str] = None,
                     amazon_rule_version: Optional[str] = None,
                     model_prediction: Optional[bool] = None,
                     model_confidence: Optional[float] = None,
                     model_features: Optional[Dict] = None,
                     rejection_date: Optional[datetime] = None) -> str:
        """
        Log a new Amazon rejection with automatic normalization and tagging
        
        Args:
            claim_id: Original claim identifier
            amazon_rejection_reason: Amazon's exact rejection text
            sku: Product SKU
            asin: Amazon ASIN
            claim_type: Type of claim
            claim_amount: Original claim amount
            claim_text: Original claim description
            amazon_case_id: Amazon's internal case ID
            amazon_rule_version: Amazon policy version
            model_prediction: What our model predicted
            model_confidence: Model's confidence score
            model_features: Features used for prediction
            rejection_date: Date of rejection (defaults to now)
            
        Returns:
            str: Internal rejection tracking ID
        """
        try:
            # Create rejection data
            rejection_data = RejectionData(
                claim_id=claim_id,
                sku=sku,
                asin=asin,
                claim_type=claim_type,
                claim_amount=claim_amount,
                claim_text=claim_text,
                amazon_rejection_reason=amazon_rejection_reason,
                rejection_date=rejection_date or datetime.now(),
                amazon_case_id=amazon_case_id,
                amazon_rule_version=amazon_rule_version,
                model_prediction=model_prediction,
                model_confidence=model_confidence,
                model_features=model_features
            )
            
            # Normalize the rejection reason
            normalized_reason, category, feedback_tag, priority, action = self.normalizer.normalize_reason(amazon_rejection_reason)
            confidence_score = self.normalizer.calculate_confidence(amazon_rejection_reason, normalized_reason)
            
            # Track pattern recognition
            self._update_pattern_recognition(amazon_rejection_reason, normalized_reason, confidence_score)
            
            # Create normalized rejection
            normalized_rejection = NormalizedRejection(
                rejection_data=rejection_data,
                normalized_reason=normalized_reason,
                reason_category=category,
                confidence_score=confidence_score,
                feedback_tag=feedback_tag,
                action_required=action,
                priority_level=priority
            )
            
            # Generate tracking ID
            tracking_id = str(uuid.uuid4())
            
            # Store in database or memory
            if self.db_connection:
                self._store_in_database(normalized_rejection)
            else:
                # Add processing status to rejection data
                normalized_rejection.processed = False
                normalized_rejection.processing_results = None
                normalized_rejection.processed_at = None
                self.pending_rejections[tracking_id] = normalized_rejection
            
            logger.info(f"Rejection logged: {claim_id}")
            logger.info(f"  Normalized: {normalized_reason} ({category})")
            logger.info(f"  Tag: {feedback_tag} (Priority: {priority})")
            logger.info(f"  Action: {action}")
            
            return tracking_id
            
        except Exception as e:
            logger.error(f"Error logging rejection: {e}")
            raise
    
    def tag_rejection(self, 
                     tracking_id: str,
                     feedback_tag: str,
                     fixable_reason: Optional[str] = None,
                     unclaimable_reason: Optional[str] = None,
                     concierge_notes: Optional[str] = None,
                     reviewed_by: Optional[str] = None) -> bool:
        """
        Tag a rejection with human review
        
        Args:
            tracking_id: Rejection tracking ID
            feedback_tag: 'fixable' or 'unclaimable'
            fixable_reason: Specific reason if fixable
            unclaimable_reason: Specific reason if unclaimable
            concierge_notes: Human reviewer notes
            reviewed_by: Name of reviewer
            
        Returns:
            bool: True if tagging successful
        """
        try:
            if feedback_tag not in ['fixable', 'unclaimable']:
                raise ValueError("Feedback tag must be 'fixable' or 'unclaimable'")
            
            if self.db_connection:
                return self._tag_database_rejection(
                    tracking_id, feedback_tag, fixable_reason, 
                    unclaimable_reason, concierge_notes, reviewed_by
                )
            else:
                return self._tag_memory_rejection(
                    tracking_id, feedback_tag, fixable_reason,
                    unclaimable_reason, concierge_notes, reviewed_by
                )
                
        except Exception as e:
            logger.error(f"Error tagging rejection: {e}")
            return False
    
    def get_fixable_rejections(self, priority_min: int = 1) -> List[Dict]:
        """Get fixable rejections for training data"""
        try:
            if self.db_connection:
                return self._get_database_fixable_rejections(priority_min)
            else:
                return self._get_memory_fixable_rejections(priority_min)
        except Exception as e:
            logger.error(f"Error getting fixable rejections: {e}")
            return []
    
    def get_unclaimable_patterns(self) -> List[Dict]:
        """Get unclaimable patterns for rule updates"""
        try:
            if self.db_connection:
                return self._get_database_unclaimable_patterns()
            else:
                return self._get_memory_unclaimable_patterns()
        except Exception as e:
            logger.error(f"Error getting unclaimable patterns: {e}")
            return []
    
    def get_rejection_analytics(self) -> Dict:
        """Get analytics on rejections"""
        try:
            if self.db_connection:
                return self._get_database_analytics()
            else:
                return self._get_memory_analytics()
        except Exception as e:
            logger.error(f"Error getting analytics: {e}")
            return {}
    
    def update_reason_mappings(self, new_mappings: List[Dict]) -> bool:
        """
        Update reason mappings from database or external source
        
        Args:
            new_mappings: List of mapping dictionaries
            
        Returns:
            bool: True if update successful
        """
        try:
            for mapping in new_mappings:
                pattern = mapping['amazon_text_pattern']
                normalized = mapping['normalized_reason']
                category = mapping['reason_category']
                tag = mapping['feedback_tag']
                priority = mapping.get('priority_level', 3)
                action = mapping.get('action_required', '')
                
                self.normalizer.reason_mappings[pattern] = (
                    normalized, category, tag, priority, action
                )
            
            logger.info(f"Updated {len(new_mappings)} reason mappings")
            return True
            
        except Exception as e:
            logger.error(f"Error updating reason mappings: {e}")
            return False
    
    def _store_in_database(self, normalized_rejection: NormalizedRejection) -> bool:
        """Store rejection in database"""
        try:
            # This would be implemented with actual database connection
            query = """
            INSERT INTO claim_rejections (
                claim_id, sku, asin, claim_type, claim_amount, claim_text,
                amazon_rejection_reason, rejection_date, amazon_case_id, amazon_rule_version,
                normalized_reason, reason_category, confidence_score, feedback_tag,
                action_required, priority_level, model_prediction, model_confidence, model_features
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            
            # Execute query with database connection
            # cursor.execute(query, (
            #     normalized_rejection.rejection_data.claim_id,
            #     normalized_rejection.rejection_data.sku,
            #     normalized_rejection.rejection_data.asin,
            #     normalized_rejection.rejection_data.claim_type,
            #     normalized_rejection.rejection_data.claim_amount,
            #     normalized_rejection.rejection_data.claim_text,
            #     normalized_rejection.rejection_data.amazon_rejection_reason,
            #     normalized_rejection.rejection_data.rejection_date,
            #     normalized_rejection.rejection_data.amazon_case_id,
            #     normalized_rejection.rejection_data.amazon_rule_version,
            #     normalized_rejection.normalized_reason,
            #     normalized_rejection.reason_category,
            #     normalized_rejection.confidence_score,
            #     normalized_rejection.feedback_tag,
            #     normalized_rejection.action_required,
            #     normalized_rejection.priority_level,
            #     normalized_rejection.rejection_data.model_prediction,
            #     normalized_rejection.rejection_data.model_confidence,
            #     json.dumps(normalized_rejection.rejection_data.model_features) if normalized_rejection.rejection_data.model_features else None
            # ))
            
            logger.info(f"Rejection stored in database: {normalized_rejection.rejection_data.claim_id}")
            return True
            
        except Exception as e:
            logger.error(f"Database storage error: {e}")
            return False
    
    def _tag_database_rejection(self, tracking_id: str, feedback_tag: str,
                              fixable_reason: Optional[str], unclaimable_reason: Optional[str],
                              concierge_notes: Optional[str], reviewed_by: Optional[str]) -> bool:
        """Tag rejection in database"""
        try:
            query = """
            UPDATE claim_rejections 
            SET feedback_tag = %s, fixable_reason = %s, unclaimable_reason = %s,
                concierge_notes = %s, reviewed_by = %s, reviewed_at = %s
            WHERE id = %s
            """
            
            # Execute query with database connection
            # cursor.execute(query, (
            #     feedback_tag, fixable_reason, unclaimable_reason,
            #     concierge_notes, reviewed_by, datetime.now(), tracking_id
            # ))
            
            logger.info(f"Rejection tagged in database: {tracking_id} -> {feedback_tag}")
            return True
            
        except Exception as e:
            logger.error(f"Database tagging error: {e}")
            return False
    
    def _get_database_fixable_rejections(self, priority_min: int) -> List[Dict]:
        """Get fixable rejections from database"""
        try:
            query = """
            SELECT * FROM fixable_rejections 
            WHERE priority_level >= %s
            ORDER BY priority_level DESC, rejection_date DESC
            """
            
            # Execute query and return results
            # cursor.execute(query, [priority_min])
            # return cursor.fetchall()
            
            # Placeholder return
            return []
            
        except Exception as e:
            logger.error(f"Database query error: {e}")
            return []
    
    def _get_database_unclaimable_patterns(self) -> List[Dict]:
        """Get unclaimable patterns from database"""
        try:
            query = """
            SELECT * FROM unclaimable_patterns
            ORDER BY pattern_count DESC
            """
            
            # Execute query and return results
            # cursor.execute(query)
            # return cursor.fetchall()
            
            # Placeholder return
            return []
            
        except Exception as e:
            logger.error(f"Database query error: {e}")
            return []
    
    def _get_database_analytics(self) -> Dict:
        """Get analytics from database"""
        try:
            query = """
            SELECT * FROM rejection_analytics
            """
            
            # Execute query and return results
            # cursor.execute(query)
            # results = cursor.fetchall()
            
            # Process results into analytics dict
            analytics = {
                'total_rejections': 0,
                'fixable_count': 0,
                'unclaimable_count': 0,
                'by_category': {},
                'by_reason': {},
                'model_misses': 0,
                'rules_updated': 0,
                'model_retrained': 0
            }
            
            # Process results...
            
            return analytics
            
        except Exception as e:
            logger.error(f"Database analytics error: {e}")
            return {}
    
    def _update_pattern_recognition(self, amazon_reason: str, normalized_reason: str, confidence_score: float):
        """Update pattern recognition tracking"""
        try:
            # Track confidence history
            self.pattern_confidence_history.append({
                'amazon_reason': amazon_reason,
                'normalized_reason': normalized_reason,
                'confidence_score': confidence_score,
                'timestamp': datetime.now()
            })
            
            # Update pattern counts
            if normalized_reason not in self.rejection_patterns:
                self.rejection_patterns[normalized_reason] = {
                    'count': 0,
                    'confidence_scores': [],
                    'amazon_reasons': set(),
                    'first_seen': datetime.now(),
                    'last_seen': datetime.now()
                }
            
            pattern = self.rejection_patterns[normalized_reason]
            pattern['count'] += 1
            pattern['confidence_scores'].append(confidence_score)
            pattern['amazon_reasons'].add(amazon_reason)
            pattern['last_seen'] = datetime.now()
            
            # Keep only last 100 confidence scores for memory efficiency
            if len(pattern['confidence_scores']) > 100:
                pattern['confidence_scores'] = pattern['confidence_scores'][-100:]
            
            logger.info(f"Pattern recognition updated: {normalized_reason} (count: {pattern['count']}, confidence: {confidence_score:.2f})")
            
        except Exception as e:
            logger.error(f"Error updating pattern recognition: {e}")
    
    def get_pattern_analytics(self) -> Dict:
        """Get detailed pattern analytics"""
        try:
            analytics = {
                'total_patterns': len(self.rejection_patterns),
                'pattern_details': {},
                'confidence_trends': {},
                'learning_insights': []
            }
            
            for reason, pattern in self.rejection_patterns.items():
                avg_confidence = sum(pattern['confidence_scores']) / len(pattern['confidence_scores']) if pattern['confidence_scores'] else 0
                
                analytics['pattern_details'][reason] = {
                    'occurrence_count': pattern['count'],
                    'average_confidence': round(avg_confidence, 3),
                    'confidence_trend': 'improving' if len(pattern['confidence_scores']) > 1 and pattern['confidence_scores'][-1] > pattern['confidence_scores'][0] else 'stable',
                    'first_seen': pattern['first_seen'],
                    'last_seen': pattern['last_seen'],
                    'unique_amazon_reasons': len(pattern['amazon_reasons'])
                }
                
                # Generate learning insights
                if pattern['count'] >= 3:
                    if avg_confidence < 0.7:
                        analytics['learning_insights'].append({
                            'pattern': reason,
                            'insight': f"Low confidence pattern ({avg_confidence:.2f}) - consider improving normalization rules",
                            'priority': 'medium'
                        })
                    elif pattern['count'] >= 10:
                        analytics['learning_insights'].append({
                            'pattern': reason,
                            'insight': f"Frequent pattern ({pattern['count']} occurrences) - consider rule optimization",
                            'priority': 'high'
                        })
            
            return analytics
            
        except Exception as e:
            logger.error(f"Error getting pattern analytics: {e}")
            return {'error': str(e)}
    
    def get_learning_metrics(self) -> Dict:
        """Get comprehensive learning metrics"""
        try:
            metrics = {
                'total_rejections_processed': self.total_rejections_processed,
                'pattern_recognition_accuracy': 0.0,
                'confidence_improvement': 0.0,
                'learning_progress': 'initial'
            }
            
            if self.pattern_confidence_history:
                # Calculate average confidence
                avg_confidence = sum(h['confidence_score'] for h in self.pattern_confidence_history) / len(self.pattern_confidence_history)
                metrics['pattern_recognition_accuracy'] = round(avg_confidence, 3)
                
                # Calculate confidence improvement over time
                if len(self.pattern_confidence_history) >= 10:
                    recent_confidence = sum(h['confidence_score'] for h in self.pattern_confidence_history[-10:]) / 10
                    early_confidence = sum(h['confidence_score'] for h in self.pattern_confidence_history[:10]) / 10
                    metrics['confidence_improvement'] = round(recent_confidence - early_confidence, 3)
                
                # Determine learning progress
                if metrics['total_rejections_processed'] >= 50:
                    metrics['learning_progress'] = 'advanced'
                elif metrics['total_rejections_processed'] >= 20:
                    metrics['learning_progress'] = 'intermediate'
                elif metrics['total_rejections_processed'] >= 5:
                    metrics['learning_progress'] = 'beginning'
            
            return metrics
            
        except Exception as e:
            logger.error(f"Error getting learning metrics: {e}")
            return {'error': str(e)}
    
    def mark_rejection_processed(self, tracking_id: str, processing_results: Dict) -> bool:
        """Mark a rejection as processed with results"""
        try:
            if tracking_id in self.pending_rejections:
                rejection = self.pending_rejections[tracking_id]
                rejection.processed = True
                rejection.processing_results = processing_results
                rejection.processed_at = datetime.now()
                logger.info(f"Marked rejection {tracking_id} as processed")
                return True
            return False
        except Exception as e:
            logger.error(f"Error marking rejection as processed: {e}")
            return False
    
    def get_processing_status(self) -> Dict:
        """Get current processing status of all rejections"""
        try:
            status = {
                'total_rejections': len(self.pending_rejections),
                'processed': 0,
                'unprocessed': 0,
                'processing_queue': [],
                'recent_activity': []
            }
            
            current_time = datetime.now()
            
            for tracking_id, rejection in self.pending_rejections.items():
                if rejection.processed:
                    status['processed'] += 1
                else:
                    status['unprocessed'] += 1
                    status['processing_queue'].append({
                        'tracking_id': tracking_id,
                        'claim_id': rejection.rejection_data.claim_id,
                        'feedback_tag': rejection.feedback_tag,
                        'priority': rejection.priority_level,
                        'waiting_time': (current_time - rejection.rejection_data.rejection_date).total_seconds() / 3600  # hours
                    })
                
                # Track recent activity (last 24 hours)
                if (current_time - rejection.rejection_data.rejection_date).days <= 1:
                    status['recent_activity'].append({
                        'tracking_id': tracking_id,
                        'claim_id': rejection.rejection_data.claim_id,
                        'action': 'processed' if rejection.processed else 'queued',
                        'timestamp': rejection.rejection_data.rejection_date
                    })
            
            # Sort processing queue by priority and waiting time
            status['processing_queue'].sort(key=lambda x: (x['priority'], x['waiting_time']), reverse=True)
            
            return status
            
        except Exception as e:
            logger.error(f"Error getting processing status: {e}")
            return {'error': str(e)}
    
    # Memory-based fallback methods
    def _tag_memory_rejection(self, tracking_id: str, feedback_tag: str,
                             fixable_reason: Optional[str], unclaimable_reason: Optional[str],
                             concierge_notes: Optional[str], reviewed_by: Optional[str]) -> bool:
        """Tag rejection in memory cache"""
        if tracking_id in self.pending_rejections:
            rejection = self.pending_rejections[tracking_id]
            rejection.feedback_tag = feedback_tag
            rejection.fixable_reason = fixable_reason
            rejection.unclaimable_reason = unclaimable_reason
            # Add concierge_notes and reviewed_by to the data structure
            logger.info(f"Rejection tagged in memory: {tracking_id} -> {feedback_tag}")
            return True
        return False
    
    def _get_memory_fixable_rejections(self, priority_min: int) -> List[Dict]:
        """Get fixable rejections from memory cache"""
        fixable_rejections = []
        for tracking_id, rejection in self.pending_rejections.items():
            if (rejection.feedback_tag == 'fixable' and 
                rejection.priority_level >= priority_min):
                fixable_rejections.append(asdict(rejection))
        
        return sorted(fixable_rejections, 
                     key=lambda x: (x['priority_level'], x['rejection_data']['rejection_date']), 
                     reverse=True)
    
    def _get_memory_unclaimable_patterns(self) -> List[Dict]:
        """Get unclaimable patterns from memory cache"""
        patterns = {}
        for tracking_id, rejection in self.pending_rejections.items():
            if rejection.feedback_tag == 'unclaimable':
                reason = rejection.normalized_reason
                if reason not in patterns:
                    patterns[reason] = {
                        'normalized_reason': reason,
                        'reason_category': rejection.reason_category,
                        'pattern_count': 0,
                        'example_reasons': set(),
                        'latest_occurrence': rejection.rejection_data.rejection_date
                    }
                
                patterns[reason]['pattern_count'] += 1
                patterns[reason]['example_reasons'].add(rejection.rejection_data.amazon_rejection_reason)
        
        # Convert to list format
        pattern_list = []
        for reason, data in patterns.items():
            pattern_list.append({
                'normalized_reason': data['normalized_reason'],
                'reason_category': data['reason_category'],
                'pattern_count': data['pattern_count'],
                'example_reasons': ' | '.join(data['example_reasons']),
                'latest_occurrence': data['latest_occurrence']
            })
        
        return sorted(pattern_list, key=lambda x: x['pattern_count'], reverse=True)
    
    def _get_memory_analytics(self) -> Dict:
        """Get analytics from memory cache"""
        analytics = {
            'total_rejections': len(self.pending_rejections),
            'fixable_count': 0,
            'unclaimable_count': 0,
            'by_category': {},
            'by_reason': {},
            'model_misses': 0,
            'rules_updated': 0,
            'model_retrained': 0,
            'processed_count': 0,
            'unprocessed_count': 0,
            'recent_rejections_24h': 0,
            'processing_efficiency': 0.0
        }
        
        current_time = datetime.now()
        
        for tracking_id, rejection in self.pending_rejections.items():
            if rejection.feedback_tag == 'fixable':
                analytics['fixable_count'] += 1
            else:
                analytics['unclaimable_count'] += 1
            
            # Count by category
            category = rejection.reason_category
            analytics['by_category'][category] = analytics['by_category'].get(category, 0) + 1
            
            # Count by reason
            reason = rejection.normalized_reason
            analytics['by_reason'][reason] = analytics['by_reason'].get(reason, 0) + 1
            
            # Count model misses
            if rejection.rejection_data.model_prediction:
                analytics['model_misses'] += 1
            
            # Count recent rejections (last 24 hours)
            rejection_date = rejection.rejection_data.rejection_date
            if (current_time - rejection_date).days <= 1:
                analytics['recent_rejections_24h'] += 1
        
        # Calculate processing efficiency
        if analytics['total_rejections'] > 0:
            analytics['processing_efficiency'] = round(
                (analytics['processed_count'] / analytics['total_rejections']) * 100, 2
            )
        
        return analytics
