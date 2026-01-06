#!/usr/bin/env python3
"""
Claims Logger for Concierge Feedback Loop
Handles logging new claims and updating their status based on Amazon's decisions
"""

import json
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Union
from dataclasses import dataclass, asdict
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class ClaimFeedback:
    """Data structure for claim feedback"""
    claim_id: str
    claim_type: str
    claim_text: str
    claim_amount: float
    claim_currency: str = 'USD'
    
    # Model prediction data
    model_prediction: bool
    model_confidence: float
    model_features: Dict
    
    # Amazon decision (initially None)
    amazon_status: str = 'submitted'
    amazon_decision_date: Optional[datetime] = None
    amazon_rejection_reason: Optional[str] = None
    amazon_final_amount: Optional[float] = None
    amazon_notes: Optional[str] = None
    
    # Concierge oversight
    concierge_reviewed: bool = False
    concierge_notes: Optional[str] = None
    edge_case_tag: Optional[str] = None
    retraining_priority: int = 1
    
    # Metadata
    amazon_rule_version: Optional[str] = None

class ClaimsLogger:
    """Manages logging and tracking of claims through the feedback loop"""
    
    def __init__(self, db_connection=None):
        self.db_connection = db_connection
        self.pending_claims = {}  # In-memory cache for pending claims
        
    def log_new_claim(self, 
                      claim_id: str,
                      claim_type: str, 
                      claim_text: str,
                      claim_amount: float,
                      model_prediction: bool,
                      model_confidence: float,
                      model_features: Dict,
                      **kwargs) -> str:
        """
        Log a new claim detected by the model
        
        Args:
            claim_id: Unique identifier for the claim
            claim_type: Type of claim (lost, damaged, fee, overcharge, etc.)
            claim_text: Description of the claim
            claim_amount: Amount being claimed
            model_prediction: What our model predicted (True=claimable)
            model_confidence: Model's confidence score (0.0-1.0)
            model_features: Features used for prediction
            **kwargs: Additional fields like currency, notes, etc.
        
        Returns:
            str: Internal tracking ID for the claim
        """
        try:
            # Create feedback record
            feedback = ClaimFeedback(
                claim_id=claim_id,
                claim_type=claim_type,
                claim_text=claim_text,
                claim_amount=claim_amount,
                model_prediction=model_prediction,
                model_confidence=model_confidence,
                model_features=model_features,
                **kwargs
            )
            
            # Generate internal tracking ID
            tracking_id = str(uuid.uuid4())
            
            # Store in database if available, otherwise cache in memory
            if self.db_connection:
                self._store_in_database(feedback)
            else:
                self.pending_claims[tracking_id] = feedback
                logger.info(f"Claim cached in memory: {tracking_id}")
            
            logger.info(f"New claim logged: {claim_id} (Type: {claim_type}, Amount: ${claim_amount})")
            return tracking_id
            
        except Exception as e:
            logger.error(f"Error logging new claim: {e}")
            raise
    
    def update_amazon_decision(self, 
                              claim_id: str,
                              amazon_status: str,
                              amazon_final_amount: Optional[float] = None,
                              amazon_rejection_reason: Optional[str] = None,
                              amazon_notes: Optional[str] = None,
                              amazon_rule_version: Optional[str] = None) -> bool:
        """
        Update claim with Amazon's decision
        
        Args:
            claim_id: The claim ID to update
            amazon_status: Amazon's decision (accepted, rejected, partial)
            amazon_final_amount: Final amount approved by Amazon
            amazon_rejection_reason: Reason for rejection if applicable
            amazon_notes: Additional Amazon feedback
            amazon_rule_version: Version of Amazon policy that applied
        
        Returns:
            bool: True if update successful, False otherwise
        """
        try:
            # Validate status
            valid_statuses = ['accepted', 'rejected', 'partial']
            if amazon_status not in valid_statuses:
                raise ValueError(f"Invalid status: {amazon_status}. Must be one of {valid_statuses}")
            
            # Update database if available
            if self.db_connection:
                return self._update_database_decision(
                    claim_id, amazon_status, amazon_final_amount, 
                    amazon_rejection_reason, amazon_notes, amazon_rule_version
                )
            else:
                # Update in-memory cache
                return self._update_memory_decision(
                    claim_id, amazon_status, amazon_final_amount,
                    amazon_rejection_reason, amazon_notes, amazon_rule_version
                )
                
        except Exception as e:
            logger.error(f"Error updating Amazon decision: {e}")
            return False
    
    def flag_edge_case(self, 
                      claim_id: str,
                      edge_case_tag: str,
                      concierge_notes: str,
                      retraining_priority: int = 3) -> bool:
        """
        Flag a claim as an edge case requiring human review
        
        Args:
            claim_id: The claim ID to flag
            edge_case_tag: Category of edge case
            concierge_notes: Human reviewer notes
            retraining_priority: Priority for retraining (1-5, 5 being highest)
        
        Returns:
            bool: True if flagging successful, False otherwise
        """
        try:
            # Validate priority
            if not 1 <= retraining_priority <= 5:
                raise ValueError("Retraining priority must be between 1 and 5")
            
            # Update database if available
            if self.db_connection:
                return self._flag_database_edge_case(
                    claim_id, edge_case_tag, concierge_notes, retraining_priority
                )
            else:
                # Update in-memory cache
                return self._flag_memory_edge_case(
                    claim_id, edge_case_tag, concierge_notes, retraining_priority
                )
                
        except Exception as e:
            logger.error(f"Error flagging edge case: {e}")
            return False
    
    def get_claims_for_review(self, 
                             status_filter: Optional[str] = None,
                             priority_min: int = 1) -> List[Dict]:
        """
        Get claims that need human review
        
        Args:
            status_filter: Filter by Amazon status (optional)
            priority_min: Minimum retraining priority to include
        
        Returns:
            List[Dict]: Claims requiring review
        """
        try:
            if self.db_connection:
                return self._get_database_claims_for_review(status_filter, priority_min)
            else:
                return self._get_memory_claims_for_review(status_filter, priority_min)
                
        except Exception as e:
            logger.error(f"Error getting claims for review: {e}")
            return []
    
    def get_training_data(self, 
                         min_samples: int = 100,
                         include_edge_cases: bool = True) -> List[Dict]:
        """
        Get claims ready for model retraining
        
        Args:
            min_samples: Minimum number of samples to return
            include_edge_cases: Whether to include edge case claims
        
        Returns:
            List[Dict]: Claims ready for training
        """
        try:
            if self.db_connection:
                return self._get_database_training_data(min_samples, include_edge_cases)
            else:
                return self._get_memory_training_data(min_samples, include_edge_cases)
                
        except Exception as e:
            logger.error(f"Error getting training data: {e}")
            return []
    
    def _store_in_database(self, feedback: ClaimFeedback) -> bool:
        """Store claim feedback in database"""
        try:
            # This would be implemented with actual database connection
            # For now, we'll simulate database storage
            query = """
            INSERT INTO claims_feedback (
                claim_id, claim_type, claim_text, claim_amount, claim_currency,
                model_prediction, model_confidence, model_features,
                amazon_status, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            
            # Execute query with database connection
            # cursor.execute(query, (
            #     feedback.claim_id, feedback.claim_type, feedback.claim_text,
            #     feedback.claim_amount, feedback.claim_currency,
            #     feedback.model_prediction, feedback.model_confidence,
            #     json.dumps(feedback.model_features), feedback.amazon_status,
            #     datetime.now()
            # ))
            
            logger.info(f"Claim stored in database: {feedback.claim_id}")
            return True
            
        except Exception as e:
            logger.error(f"Database storage error: {e}")
            return False
    
    def _update_database_decision(self, claim_id: str, status: str, 
                                final_amount: Optional[float], rejection_reason: Optional[str],
                                notes: Optional[str], rule_version: Optional[str]) -> bool:
        """Update Amazon decision in database"""
        try:
            query = """
            UPDATE claims_feedback 
            SET amazon_status = %s, amazon_decision_date = %s, 
                amazon_final_amount = %s, amazon_rejection_reason = %s,
                amazon_notes = %s, amazon_rule_version = %s
            WHERE claim_id = %s
            """
            
            # Execute query with database connection
            # cursor.execute(query, (
            #     status, datetime.now(), final_amount, rejection_reason,
            #     notes, rule_version, claim_id
            # ))
            
            logger.info(f"Amazon decision updated in database: {claim_id} -> {status}")
            return True
            
        except Exception as e:
            logger.error(f"Database update error: {e}")
            return False
    
    def _flag_database_edge_case(self, claim_id: str, edge_tag: str, 
                                notes: str, priority: int) -> bool:
        """Flag edge case in database"""
        try:
            query = """
            UPDATE claims_feedback 
            SET edge_case_tag = %s, concierge_notes = %s, 
                retraining_priority = %s, concierge_reviewed = TRUE
            WHERE claim_id = %s
            """
            
            # Execute query with database connection
            # cursor.execute(query, (edge_tag, notes, priority, claim_id))
            
            logger.info(f"Edge case flagged in database: {claim_id} -> {edge_tag}")
            return True
            
        except Exception as e:
            logger.error(f"Database flagging error: {e}")
            return False
    
    def _get_database_claims_for_review(self, status_filter: Optional[str], 
                                       priority_min: int) -> List[Dict]:
        """Get claims for review from database"""
        try:
            query = """
            SELECT * FROM claims_feedback 
            WHERE retraining_priority >= %s
            """
            params = [priority_min]
            
            if status_filter:
                query += " AND amazon_status = %s"
                params.append(status_filter)
            
            query += " ORDER BY retraining_priority DESC, created_at DESC"
            
            # Execute query and return results
            # cursor.execute(query, params)
            # return cursor.fetchall()
            
            # Placeholder return
            return []
            
        except Exception as e:
            logger.error(f"Database query error: {e}")
            return []
    
    def _get_database_training_data(self, min_samples: int, 
                                   include_edge_cases: bool) -> List[Dict]:
        """Get training data from database"""
        try:
            query = """
            SELECT * FROM claims_training_data
            WHERE training_label IS NOT NULL
            """
            
            if include_edge_cases:
                query += " AND edge_case_tag IS NOT NULL"
            
            query += " ORDER BY retraining_priority DESC, created_at DESC"
            
            # Execute query and return results
            # cursor.execute(query)
            # results = cursor.fetchall()
            
            # Ensure minimum samples
            # if len(results) < min_samples:
            #     logger.warning(f"Only {len(results)} samples available, requested {min_samples}")
            
            # return results
            
            # Placeholder return
            return []
            
        except Exception as e:
            logger.error(f"Database training data error: {e}")
            return []
    
    # Memory-based fallback methods
    def _update_memory_decision(self, claim_id: str, status: str, 
                               final_amount: Optional[float], rejection_reason: Optional[str],
                               notes: Optional[str], rule_version: Optional[str]) -> bool:
        """Update decision in memory cache"""
        for tracking_id, feedback in self.pending_claims.items():
            if feedback.claim_id == claim_id:
                feedback.amazon_status = status
                feedback.amazon_decision_date = datetime.now()
                feedback.amazon_final_amount = final_amount
                feedback.amazon_rejection_reason = rejection_reason
                feedback.amazon_notes = notes
                feedback.amazon_rule_version = rule_version
                logger.info(f"Claim updated in memory: {claim_id} -> {status}")
                return True
        return False
    
    def _flag_memory_edge_case(self, claim_id: str, edge_tag: str, 
                              notes: str, priority: int) -> bool:
        """Flag edge case in memory cache"""
        for tracking_id, feedback in self.pending_claims.items():
            if feedback.claim_id == claim_id:
                feedback.edge_case_tag = edge_tag
                feedback.concierge_notes = notes
                feedback.retraining_priority = priority
                feedback.concierge_reviewed = True
                logger.info(f"Edge case flagged in memory: {claim_id} -> {edge_tag}")
                return True
        return False
    
    def _get_memory_claims_for_review(self, status_filter: Optional[str], 
                                     priority_min: int) -> List[Dict]:
        """Get claims for review from memory cache"""
        review_claims = []
        for tracking_id, feedback in self.pending_claims.items():
            if (feedback.retraining_priority >= priority_min and
                (not status_filter or feedback.amazon_status == status_filter)):
                review_claims.append(asdict(feedback))
        
        return sorted(review_claims, 
                     key=lambda x: (x['retraining_priority'], x['created_at']), 
                     reverse=True)
    
    def _get_memory_training_data(self, min_samples: int, 
                                 include_edge_cases: bool) -> List[Dict]:
        """Get training data from memory cache"""
        training_data = []
        for tracking_id, feedback in self.pending_claims.items():
            if (feedback.amazon_status in ['accepted', 'rejected', 'partial'] and
                (not include_edge_cases or feedback.edge_case_tag)):
                training_data.append(asdict(feedback))
        
        return training_data[:min_samples] if min_samples > 0 else training_data
