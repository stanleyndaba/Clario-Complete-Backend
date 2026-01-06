#!/usr/bin/env python3
"""
Detector Feedback Loop for Concierge Feedback Update System
Automatically updates rules engine and retrains model based on rejection feedback
"""

import json
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class RuleUpdate:
    """Data structure for rule engine update"""
    rule_name: str
    rule_type: str  # 'block', 'require', 'adjust'
    new_value: str
    old_value: Optional[str] = None
    trigger_rejection_id: Optional[str] = None
    applied_at: datetime = None
    success: bool = True
    notes: Optional[str] = None

@dataclass
class ModelRetrainingRecord:
    """Data structure for model retraining record"""
    retraining_trigger: str
    rejection_count: int
    old_accuracy: float
    new_accuracy: float
    improvement: float
    features_added: List[str]
    features_removed: List[str]
    training_samples: int
    retrained_at: Optional[datetime] = None
    model_version: Optional[str] = None

class DetectorFeedbackLoop:
    """Automatically updates rules engine and retrains model based on feedback"""
    
    def __init__(self, 
                 rejection_logger=None,
                 knowledge_base_sync=None,
                 rules_engine=None,
                 model_trainer=None,
                 db_connection=None):
        self.rejection_logger = rejection_logger
        self.knowledge_base_sync = knowledge_base_sync
        self.rules_engine = rules_engine
        self.model_trainer = model_trainer
        self.db_connection = db_connection
        
        # Configuration
        self.retraining_threshold = 10  # Minimum rejections to trigger retraining
        self.rule_update_threshold = 3  # Minimum pattern count to update rules
        self.accuracy_improvement_threshold = 0.02  # Minimum improvement to save model
        
        # Automation triggers
        self.auto_rule_updates = True
        self.auto_model_retraining = True
        self.auto_knowledge_updates = True
        
        # Monitoring thresholds
        self.high_priority_threshold = 0.4  # Alert if >40% rejections are high priority
        self.unusual_pattern_threshold = 5  # Alert if pattern appears >5 times unexpectedly
        self.processing_delay_threshold = 24  # Alert if rejections wait >24 hours
        
    def process_rejection_feedback(self, rejection_tracking_id: str) -> Dict:
        """
        Process a single rejection and update systems accordingly
        
        Args:
            rejection_tracking_id: ID of the rejection to process
            
        Returns:
            Dict: Processing results
        """
        try:
            results = {
                'rejection_id': rejection_tracking_id,
                'rule_updates': [],
                'model_retrained': False,
                'knowledge_base_updated': False,
                'processing_time': datetime.now()
            }
            
            # Get rejection details
            rejection_data = self._get_rejection_data(rejection_tracking_id)
            if not rejection_data:
                logger.error(f"Rejection data not found: {rejection_tracking_id}")
                return results
            
            # Process based on feedback tag
            if rejection_data['feedback_tag'] == 'unclaimable':
                # Update rules engine to block similar claims
                rule_updates = self._update_rules_for_unclaimable(rejection_data)
                results['rule_updates'] = rule_updates
                
            elif rejection_data['feedback_tag'] == 'fixable':
                # Update knowledge base and potentially retrain model
                knowledge_updated = self._update_knowledge_for_fixable(rejection_data)
                results['knowledge_base_updated'] = knowledge_updated
                
                # Check if enough fixable rejections to trigger retraining
                if self._should_retrain_model():
                    model_retrained = self._retrain_model_with_fixable_rejections()
                    results['model_retrained'] = model_retrained
            
            # Update rejection status
            self._mark_rejection_processed(rejection_tracking_id, results)
            
            logger.info(f"Processed rejection feedback: {rejection_tracking_id}")
            return results
            
        except Exception as e:
            logger.error(f"Error processing rejection feedback: {e}")
            return {'error': str(e)}
    
    def batch_process_rejections(self, max_rejections: int = 50) -> Dict:
        """
        Process multiple rejections in batch
        
        Args:
            max_rejections: Maximum number of rejections to process
            
        Returns:
            Dict: Batch processing results
        """
        try:
            # Get unprocessed rejections
            unprocessed_rejections = self._get_unprocessed_rejections(max_rejections)
            
            results = {
                'total_processed': 0,
                'rule_updates': [],
                'model_retrained': False,
                'knowledge_base_updated': False,
                'processing_time': datetime.now()
            }
            
            for rejection_id in unprocessed_rejections:
                rejection_result = self.process_rejection_feedback(rejection_id)
                
                results['total_processed'] += 1
                results['rule_updates'].extend(rejection_result.get('rule_updates', []))
                
                if rejection_result.get('model_retrained'):
                    results['model_retrained'] = True
                
                if rejection_result.get('knowledge_base_updated'):
                    results['knowledge_base_updated'] = True
            
            logger.info(f"Batch processed {results['total_processed']} rejections")
            return results
            
        except Exception as e:
            logger.error(f"Error in batch processing: {e}")
            return {'error': str(e)}
    
    def analyze_rejection_patterns(self) -> Dict:
        """
        Analyze rejection patterns and suggest improvements
        
        Returns:
            Dict: Analysis results and recommendations
        """
        try:
            analytics = self.rejection_logger.get_rejection_analytics()
            
            analysis = {
                'total_rejections': analytics.get('total_rejections', 0),
                'fixable_count': analytics.get('fixable_count', 0),
                'unclaimable_count': analytics.get('unclaimable_count', 0),
                'model_misses': analytics.get('model_misses', 0),
                'recommendations': []
            }
            
            # Generate recommendations
            if analytics.get('model_misses', 0) > analytics.get('total_rejections', 0) * 0.3:
                analysis['recommendations'].append({
                    'type': 'model_retraining',
                    'priority': 'high',
                    'message': 'Model missing too many claims. Immediate retraining recommended.',
                    'action': 'Trigger model retraining with fixable rejections'
                })
            
            unclaimable_patterns = self.rejection_logger.get_unclaimable_patterns()
            for pattern in unclaimable_patterns:
                if pattern['pattern_count'] >= self.rule_update_threshold:
                    analysis['recommendations'].append({
                        'type': 'rule_update',
                        'priority': 'medium',
                        'message': f"Pattern '{pattern['normalized_reason']}' appears {pattern['pattern_count']} times",
                        'action': f"Add rule to block {pattern['normalized_reason']} claims"
                    })
            
            return analysis
            
        except Exception as e:
            logger.error(f"Error analyzing rejection patterns: {e}")
            return {'error': str(e)}
    
    def _update_rules_for_unclaimable(self, rejection_data: Dict) -> List[Dict]:
        """Update rules engine to block unclaimable patterns"""
        try:
            rule_updates = []
            
            # Create rule to block similar claims
            rule_name = f"block_{rejection_data['reason_category']}_{rejection_data['normalized_reason']}"
            rule_type = "block"
            new_value = f"Claims with reason '{rejection_data['normalized_reason']}' are not eligible"
            
            rule_update = RuleUpdate(
                rule_name=rule_name,
                rule_type=rule_type,
                new_value=new_value,
                trigger_rejection_id=rejection_data.get('id'),
                applied_at=datetime.now(),
                notes=f"Auto-generated from rejection: {rejection_data['amazon_rejection_reason']}"
            )
            
            # Apply rule update
            if self.rules_engine:
                success = self._apply_rule_update(rule_update)
                rule_update.success = success
            
            # Store rule update
            self._store_rule_update(rule_update)
            rule_updates.append(asdict(rule_update))
            
            logger.info(f"Updated rules for unclaimable pattern: {rule_name}")
            return rule_updates
            
        except Exception as e:
            logger.error(f"Error updating rules for unclaimable: {e}")
            return []
    
    def _update_knowledge_for_fixable(self, rejection_data: Dict) -> bool:
        """Update knowledge base with fixable rejection patterns"""
        try:
            if not self.knowledge_base_sync:
                return False
            
            # Extract patterns from rejection
            claim_text = rejection_data['claim_text']
            claim_type = rejection_data['claim_type']
            rejection_reason = rejection_data['amazon_rejection_reason']
            
            # Create edge case for this fixable pattern
            edge_case_id = self.knowledge_base_sync.update_edge_case(
                claim_type=claim_type,
                description=f"Fixable rejection: {rejection_reason}",
                is_success=False,  # It was rejected
                special_requirements=f"Ensure {rejection_reason.lower()} is addressed",
                patterns=[rejection_reason]
            )
            
            logger.info(f"Updated knowledge base with fixable pattern: {edge_case_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error updating knowledge for fixable: {e}")
            return False
    
    def _should_retrain_model(self) -> bool:
        """Check if model should be retrained"""
        try:
            fixable_rejections = self.rejection_logger.get_fixable_rejections(priority_min=3)
            return len(fixable_rejections) >= self.retraining_threshold
            
        except Exception as e:
            logger.error(f"Error checking retraining threshold: {e}")
            return False
    
    def _retrain_model_with_fixable_rejections(self) -> bool:
        """Retrain model using fixable rejections as training data"""
        try:
            if not self.model_trainer:
                logger.warning("No model trainer available for retraining")
                return False
            
            # Get fixable rejections for training
            fixable_rejections = self.rejection_logger.get_fixable_rejections(priority_min=1)
            
            if len(fixable_rejections) < self.retraining_threshold:
                logger.info(f"Insufficient fixable rejections for retraining: {len(fixable_rejections)}")
                return False
            
            # Prepare training data
            training_data = self._prepare_training_data_from_rejections(fixable_rejections)
            
            # Get current model accuracy
            current_accuracy = self._get_current_model_accuracy()
            
            # Retrain model
            new_accuracy = self.model_trainer.retrain_model(training_data)
            
            # Calculate improvement
            improvement = new_accuracy - current_accuracy
            
            # Create retraining record
            retraining_record = ModelRetrainingRecord(
                retraining_trigger="fixable_rejections",
                rejection_count=len(fixable_rejections),
                old_accuracy=current_accuracy,
                new_accuracy=new_accuracy,
                improvement=improvement,
                features_added=self._identify_new_features(fixable_rejections),
                features_removed=[],
                training_samples=len(training_data),
                retrained_at=datetime.now(),
                model_version=f"v{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            )
            
            # Store retraining record
            self._store_retraining_record(retraining_record)
            
            # Save model if improvement is significant
            if improvement >= self.accuracy_improvement_threshold:
                self.model_trainer.save_model()
                logger.info(f"Model retrained successfully. Improvement: {improvement:.4f}")
                return True
            else:
                logger.info(f"Model retrained but improvement ({improvement:.4f}) below threshold")
                return False
            
        except Exception as e:
            logger.error(f"Error retraining model: {e}")
            return False
    
    def _prepare_training_data_from_rejections(self, fixable_rejections: List[Dict]) -> List[Dict]:
        """Prepare training data from fixable rejections"""
        try:
            training_data = []
            
            for rejection in fixable_rejections:
                # Create positive example (what should have been done)
                training_example = {
                    'text': rejection['claim_text'],
                    'claim_type': rejection['claim_type'],
                    'amount': rejection['claim_amount'],
                    'label': 1,  # Should be claimable
                    'features': {
                        'text_length': len(rejection['claim_text']),
                        'word_count': len(rejection['claim_text'].split()),
                        'has_amount': 1 if rejection['claim_amount'] > 0 else 0,
                        'claim_type_encoded': self._encode_claim_type(rejection['claim_type']),
                        'fixable_rejection': 1  # New feature
                    }
                }
                
                training_data.append(training_example)
            
            return training_data
            
        except Exception as e:
            logger.error(f"Error preparing training data: {e}")
            return []
    
    def _identify_new_features(self, fixable_rejections: List[Dict]) -> List[str]:
        """Identify new features to add based on rejection patterns"""
        try:
            new_features = []
            
            # Check for common patterns in fixable rejections
            rejection_reasons = [r['normalized_reason'] for r in fixable_rejections]
            
            if 'Documentation Missing' in rejection_reasons:
                new_features.append('requires_documentation')
            
            if 'Evidence Insufficient' in rejection_reasons:
                new_features.append('evidence_quality_score')
            
            if 'Format Error' in rejection_reasons:
                new_features.append('format_compliance_score')
            
            if 'Amount Error' in rejection_reasons:
                new_features.append('amount_validation_score')
            
            return new_features
            
        except Exception as e:
            logger.error(f"Error identifying new features: {e}")
            return []
    
    def _get_rejection_data(self, rejection_id: str) -> Optional[Dict]:
        """Get rejection data by ID"""
        try:
            # Get rejection data from the rejection logger's memory cache
            if self.rejection_logger and hasattr(self.rejection_logger, 'pending_rejections'):
                rejection = self.rejection_logger.pending_rejections.get(rejection_id)
                if rejection:
                    # Convert dataclass to dictionary format
                    return {
                        'id': rejection_id,
                        'claim_id': rejection.rejection_data.claim_id,
                        'sku': rejection.rejection_data.sku,
                        'asin': rejection.rejection_data.asin,
                        'claim_type': rejection.rejection_data.claim_type,
                        'claim_amount': rejection.rejection_data.claim_amount,
                        'claim_text': rejection.rejection_data.claim_text,
                        'amazon_rejection_reason': rejection.rejection_data.amazon_rejection_reason,
                        'rejection_date': rejection.rejection_data.rejection_date,
                        'amazon_case_id': rejection.rejection_data.amazon_case_id,
                        'amazon_rule_version': rejection.rejection_data.amazon_rule_version,
                        'model_prediction': rejection.rejection_data.model_prediction,
                        'model_confidence': rejection.rejection_data.model_confidence,
                        'model_features': rejection.rejection_data.model_features,
                        'normalized_reason': rejection.normalized_reason,
                        'reason_category': rejection.reason_category,
                        'confidence_score': rejection.confidence_score,
                        'feedback_tag': rejection.feedback_tag,
                        'fixable_reason': rejection.fixable_reason,
                        'unclaimable_reason': rejection.unclaimable_reason,
                        'action_required': rejection.action_required,
                        'priority_level': rejection.priority_level
                    }
            
            # Fallback: try to get from database if available
            if self.db_connection:
                # This would query the claim_rejections table
                # For now, return None as placeholder
                pass
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting rejection data: {e}")
            return None
    
    def _get_unprocessed_rejections(self, max_count: int) -> List[str]:
        """Get list of unprocessed rejection IDs"""
        try:
            # Get unprocessed rejections from rejection logger's cache
            if self.rejection_logger and hasattr(self.rejection_logger, 'pending_rejections'):
                unprocessed = []
                for rejection_id, rejection in self.rejection_logger.pending_rejections.items():
                    if not getattr(rejection, 'processed', False):
                        unprocessed.append(rejection_id)
                        if len(unprocessed) >= max_count:
                            break
                return unprocessed
            
            # Fallback: try to get from database if available
            if self.db_connection:
                # This would query the claim_rejections table for unprocessed rejections
                # For now, return empty list as placeholder
                pass
            
            return []
            
        except Exception as e:
            logger.error(f"Error getting unprocessed rejections: {e}")
            return []
    
    def _mark_rejection_processed(self, rejection_id: str, results: Dict):
        """Mark rejection as processed"""
        try:
            # Mark rejection as processed in memory cache
            if self.rejection_logger and hasattr(self.rejection_logger, 'pending_rejections'):
                if rejection_id in self.rejection_logger.pending_rejections:
                    rejection = self.rejection_logger.pending_rejections[rejection_id]
                    rejection.processed = True
                    rejection.processing_results = results
                    rejection.processed_at = datetime.now()
                    
                    # Also mark in rejection logger's tracking
                    self.rejection_logger.mark_rejection_processed(rejection_id, results)
            
            # Update rejection status in database if available
            if self.db_connection:
                # This would update the claim_rejections table
                # UPDATE claim_rejections SET processed = true, processing_results = %s, processed_at = %s WHERE id = %s
                pass
            
            logger.info(f"Marked rejection {rejection_id} as processed")
            
        except Exception as e:
            logger.error(f"Error marking rejection processed: {e}")
    
    def _apply_rule_update(self, rule_update: RuleUpdate) -> bool:
        """Apply rule update to rules engine"""
        try:
            if not self.rules_engine:
                return False
            
            # Apply the rule update
            # This would call the rules engine's update method
            return True
            
        except Exception as e:
            logger.error(f"Error applying rule update: {e}")
            return False
    
    def _store_rule_update(self, rule_update: RuleUpdate):
        """Store rule update in database"""
        try:
            if not self.db_connection:
                return
            
            # Store in rule_updates table
            # This would insert into the database
            
        except Exception as e:
            logger.error(f"Error storing rule update: {e}")
    
    def _store_retraining_record(self, retraining_record: ModelRetrainingRecord):
        """Store retraining record in database"""
        try:
            if not self.db_connection:
                return
            
            # Store in model_retraining_log table
            # This would insert into the database
            
        except Exception as e:
            logger.error(f"Error storing retraining record: {e}")
    
    def _get_current_model_accuracy(self) -> float:
        """Get current model accuracy"""
        try:
            # This would evaluate the current model
            # For now, return placeholder value
            return 0.85
            
        except Exception as e:
            logger.error(f"Error getting current model accuracy: {e}")
            return 0.0
    
    def _encode_claim_type(self, claim_type: str) -> int:
        """Encode claim type to numeric value"""
        encoding = {
            'lost': 1,
            'damaged': 2,
            'fee': 3,
            'overcharge': 4,
            'wrong_item': 5,
            'defective': 6,
            'missing': 7
        }
        return encoding.get(claim_type, 0)
    
    def monitor_system_health(self) -> Dict:
        """Monitor system health and generate alerts"""
        try:
            health_status = {
                'status': 'healthy',
                'alerts': [],
                'recommendations': [],
                'metrics': {}
            }
            
            # Get current analytics
            analytics = self.rejection_logger.get_rejection_analytics()
            processing_status = self.rejection_logger.get_processing_status()
            
            health_status['metrics'] = {
                'total_rejections': analytics.get('total_rejections', 0),
                'processing_efficiency': analytics.get('processing_efficiency', 0),
                'unprocessed_count': processing_status.get('unprocessed', 0),
                'recent_activity_24h': analytics.get('recent_rejections_24h', 0)
            }
            
            # Check for high priority rejections
            if analytics.get('total_rejections', 0) > 0:
                high_priority_ratio = analytics.get('fixable_count', 0) / analytics.get('total_rejections', 1)
                if high_priority_ratio > self.high_priority_threshold:
                    health_status['alerts'].append({
                        'level': 'warning',
                        'message': f"High priority rejections: {high_priority_ratio:.1%} of total",
                        'action': 'Review rejection patterns and consider rule updates'
                    })
            
            # Check for unusual patterns
            unclaimable_patterns = self.rejection_logger.get_unclaimable_patterns()
            for pattern in unclaimable_patterns:
                if pattern['pattern_count'] > self.unusual_pattern_threshold:
                    health_status['alerts'].append({
                        'level': 'critical',
                        'message': f"Unusual pattern detected: '{pattern['normalized_reason']}' appears {pattern['pattern_count']} times",
                        'action': 'Immediate rule update required'
                    })
            
            # Check for processing delays
            if processing_status.get('processing_queue'):
                for item in processing_status['processing_queue']:
                    if item['waiting_time'] > self.processing_delay_threshold:
                        health_status['alerts'].append({
                            'level': 'warning',
                            'message': f"Processing delay: Claim {item['claim_id']} waiting {item['waiting_time']:.1f} hours",
                            'action': 'Process high-priority rejections immediately'
                        })
            
            # Generate recommendations
            if health_status['alerts']:
                health_status['status'] = 'attention_required'
                health_status['recommendations'].append('Review and address alerts above')
            
            if analytics.get('fixable_count', 0) >= self.retraining_threshold:
                health_status['recommendations'].append('Trigger model retraining with fixable rejections')
            
            if unclaimable_patterns:
                health_status['recommendations'].append('Update rules engine with unclaimable patterns')
            
            return health_status
            
        except Exception as e:
            logger.error(f"Error monitoring system health: {e}")
            return {'status': 'error', 'error': str(e)}
    
    def auto_process_rejections(self, max_rejections: int = 50) -> Dict:
        """Automatically process rejections based on configuration"""
        try:
            results = {
                'total_processed': 0,
                'rule_updates': [],
                'model_retrained': False,
                'knowledge_base_updated': False,
                'alerts_generated': 0
            }
            
            # Get unprocessed rejections
            unprocessed_rejections = self._get_unprocessed_rejections(max_rejections)
            
            if not unprocessed_rejections:
                logger.info("No unprocessed rejections found")
                return results
            
            # Process each rejection
            for rejection_id in unprocessed_rejections:
                try:
                    rejection_result = self.process_rejection_feedback(rejection_id)
                    
                    results['total_processed'] += 1
                    
                    if rejection_result.get('rule_updates'):
                        results['rule_updates'].extend(rejection_result['rule_updates'])
                    
                    if rejection_result.get('model_retrained'):
                        results['model_retrained'] = True
                    
                    if rejection_result.get('knowledge_base_updated'):
                        results['knowledge_base_updated'] = True
                        
                except Exception as e:
                    logger.error(f"Error processing rejection {rejection_id}: {e}")
                    continue
            
            # Generate alerts if needed
            health_status = self.monitor_system_health()
            if health_status.get('alerts'):
                results['alerts_generated'] = len(health_status['alerts'])
                logger.warning(f"Generated {results['alerts_generated']} alerts during processing")
            
            logger.info(f"Auto-processed {results['total_processed']} rejections")
            return results
            
        except Exception as e:
            logger.error(f"Error in auto-processing: {e}")
            return {'error': str(e)}
    
    def get_continuous_learning_summary(self) -> Dict:
        """Get summary of continuous learning activities"""
        try:
            summary = {
                'system_status': 'active',
                'learning_metrics': {},
                'recent_improvements': [],
                'next_actions': [],
                'pattern_insights': [],
                'learning_progress': 'initial'
            }
            
            # Get current metrics
            analytics = self.rejection_logger.get_rejection_analytics()
            processing_status = self.rejection_logger.get_processing_status()
            health_status = self.monitor_system_health()
            
            # Get enhanced learning metrics
            learning_metrics = self.rejection_logger.get_learning_metrics()
            pattern_analytics = self.rejection_logger.get_pattern_analytics()
            
            summary['learning_metrics'] = {
                'total_rejections_learned': analytics.get('total_rejections', 0),
                'fixable_patterns_identified': analytics.get('fixable_count', 0),
                'unclaimable_patterns_blocked': analytics.get('unclaimable_count', 0),
                'processing_efficiency': analytics.get('processing_efficiency', 0),
                'system_health': health_status.get('status', 'unknown'),
                'pattern_recognition_accuracy': learning_metrics.get('pattern_recognition_accuracy', 0.0),
                'confidence_improvement': learning_metrics.get('confidence_improvement', 0.0),
                'learning_progress': learning_metrics.get('learning_progress', 'initial')
            }
            
            # Get recent improvements
            if processing_status.get('recent_activity'):
                summary['recent_improvements'] = processing_status['recent_activity'][:5]  # Last 5 activities
            
            # Get pattern insights
            if pattern_analytics.get('learning_insights'):
                summary['pattern_insights'] = pattern_analytics['learning_insights'][:5]  # Top 5 insights
            
            # Generate next actions
            if analytics.get('fixable_count', 0) >= self.retraining_threshold:
                summary['next_actions'].append('Trigger model retraining')
            
            if analytics.get('unclaimable_count', 0) >= self.rule_update_threshold:
                summary['next_actions'].append('Update rules engine')
            
            if health_status.get('alerts'):
                summary['next_actions'].append('Address system alerts')
            
            # Add pattern-based actions
            if pattern_analytics.get('learning_insights'):
                high_priority_insights = [i for i in pattern_analytics['learning_insights'] if i['priority'] == 'high']
                if high_priority_insights:
                    summary['next_actions'].append(f"Review {len(high_priority_insights)} high-priority pattern insights")
            
            if not summary['next_actions']:
                summary['next_actions'].append('Continue monitoring rejection patterns')
            
            return summary
            
        except Exception as e:
            logger.error(f"Error getting continuous learning summary: {e}")
            return {'error': str(e)}
