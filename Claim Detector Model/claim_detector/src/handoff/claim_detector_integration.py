# -*- coding: utf-8 -*-
"""
Claim Detector Integration Layer for MCDE Handoff

This module integrates the existing Claim Detector components with the
structured handoff system, ensuring every flagged claim is automatically
transformed into the standardized format for MCDE consumption.
"""

import asyncio
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
import json

# Import existing Claim Detector components
from ..ml_detector.fine_grained_classifier import FineGrainedClassifier
from ..ml_detector.confidence_calibrator import ConfidenceCalibrator
from ..data_collection.enhanced_rejection_logger import EnhancedRejectionLogger
from ..ml_detector.evaluation_system import EvaluationSystem

# Import structured handoff components
from .structured_claim import (
    ClaimHandoffFormatter, 
    StructuredClaim, 
    ClaimType,
    create_mock_structured_claim
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ClaimDetectorMCDEIntegration:
    """
    Integration layer that transforms Claim Detector outputs into
    structured claims for MCDE consumption
    """
    
    def __init__(self):
        self.classifier = FineGrainedClassifier()
        self.calibrator = ConfidenceCalibrator()
        self.rejection_logger = EnhancedRejectionLogger()
        self.evaluator = EvaluationSystem()
        self.handoff_formatter = ClaimHandoffFormatter()
        
        # Track processed claims
        self.processed_claims: List[StructuredClaim] = []
        self.handoff_queue: List[StructuredClaim] = []
        
    async def process_rejection_for_mcde(self, 
                                       rejection_data: Dict[str, Any]) -> Optional[StructuredClaim]:
        """
        Process a rejection through the full Claim Detector pipeline
        and output a structured claim for MCDE
        """
        try:
            logger.info(f"Processing rejection for MCDE handoff: {rejection_data.get('id', 'unknown')}")
            
            # Step 1: Classify the claim
            classification_result = await self._classify_rejection(rejection_data)
            
            # Step 2: Calibrate confidence scores
            calibrated_result = await self._calibrate_confidence(classification_result)
            
            # Step 3: Format for MCDE handoff
            structured_claim = self.handoff_formatter.format_claim(
                rejection_data, 
                calibrated_result
            )
            
            # Step 4: Validate the structured claim
            if not structured_claim.validate():
                logger.error(f"Invalid structured claim generated: {structured_claim.claim_id}")
                return None
            
            # Step 5: Add to handoff queue
            self.handoff_queue.append(structured_claim)
            self.processed_claims.append(structured_claim)
            
            logger.info(f"Successfully processed claim {structured_claim.claim_id} for MCDE")
            logger.info(f"Claim type: {structured_claim.claim_type.value}")
            logger.info(f"Evidence sources: {structured_claim.evidence_sources}")
            
            return structured_claim
            
        except Exception as e:
            logger.error(f"Error processing rejection for MCDE: {e}")
            return None
    
    async def _classify_rejection(self, rejection_data: Dict[str, Any]) -> Dict[str, Any]:
        """Classify the rejection using the fine-grained classifier"""
        try:
            # Extract text for classification
            text_parts = []
            
            if 'rejection_reason' in rejection_data:
                text_parts.append(str(rejection_data['rejection_reason']))
            if 'description' in rejection_data:
                text_parts.append(str(rejection_data['description']))
            if 'notes' in rejection_data:
                text_parts.append(str(rejection_data['notes']))
            
            combined_text = ' '.join(text_parts) if text_parts else 'no_text'
            
            # Classify the claim
            classification = self.classifier.classify_claim(combined_text)
            
            logger.info(f"Classification result: {classification['claim_type']} with confidence {classification['confidence']}")
            
            return classification
            
        except Exception as e:
            logger.error(f"Error in claim classification: {e}")
            # Return default classification
            return {
                'claim_type': 'other',
                'confidence': 0.5,
                'required_evidence': [],
                'claimability_score': 0.5,
                'risk_factors': ['Classification error'],
                'recommendations': ['Manual review required']
            }
    
    async def _calibrate_confidence(self, classification_result: Dict[str, Any]) -> Dict[str, Any]:
        """Calibrate confidence scores using the confidence calibrator"""
        try:
            # Extract raw probability
            raw_prob = classification_result.get('confidence', 0.5)
            
            # Calibrate the probability
            calibrated_probs = self.calibrator.calibrate_probabilities([raw_prob])
            
            if calibrated_probs and len(calibrated_probs) > 0:
                calibrated_confidence = calibrated_probs[0]
                
                # Update the classification result
                classification_result['confidence'] = calibrated_confidence
                classification_result['calibrated_confidence'] = calibrated_confidence
                
                logger.info(f"Calibrated confidence: {raw_prob:.3f} -> {calibrated_confidence:.3f}")
            
            return classification_result
            
        except Exception as e:
            logger.error(f"Error in confidence calibration: {e}")
            # Return original result if calibration fails
            return classification_result
    
    def get_mcde_ready_claims(self, 
                             claim_type: Optional[str] = None,
                             min_confidence: float = 0.0,
                             limit: Optional[int] = None) -> List[StructuredClaim]:
        """
        Get claims ready for MCDE consumption with optional filtering
        
        Args:
            claim_type: Filter by specific claim type
            min_confidence: Minimum confidence score threshold
            limit: Maximum number of claims to return
            
        Returns:
            List of structured claims ready for MCDE
        """
        filtered_claims = []
        
        for claim in self.handoff_queue:
            # Apply filters
            if claim_type and claim.claim_type.value != claim_type:
                continue
                
            if claim.confidence_score < min_confidence:
                continue
                
            filtered_claims.append(claim)
            
            # Apply limit if specified
            if limit and len(filtered_claims) >= limit:
                break
        
        logger.info(f"Retrieved {len(filtered_claims)} claims for MCDE (filtered from {len(self.handoff_queue)} total)")
        return filtered_claims
    
    def export_claims_for_mcde(self, 
                              filepath: str,
                              claim_type: Optional[str] = None,
                              min_confidence: float = 0.0) -> bool:
        """
        Export claims to JSON file for MCDE consumption
        
        Args:
            filepath: Path to export file
            claim_type: Filter by claim type
            min_confidence: Minimum confidence threshold
            
        Returns:
            True if export successful
        """
        try:
            # Get filtered claims
            claims = self.get_mcde_ready_claims(claim_type, min_confidence)
            
            if not claims:
                logger.warning("No claims to export")
                return False
            
            # Convert to JSON-serializable format
            export_data = {
                "export_timestamp": datetime.now().isoformat(),
                "total_claims": len(claims),
                "filters_applied": {
                    "claim_type": claim_type,
                    "min_confidence": min_confidence
                },
                "claims": [claim.to_dict() for claim in claims]
            }
            
            # Write to file
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=2, default=str)
            
            logger.info(f"Exported {len(claims)} claims to {filepath}")
            return True
            
        except Exception as e:
            logger.error(f"Error exporting claims: {e}")
            return False
    
    def get_handoff_summary(self) -> Dict[str, Any]:
        """Get summary of handoff status"""
        if not self.processed_claims:
            return {"status": "no_claims_processed"}
        
        # Count by claim type
        type_counts = {}
        confidence_ranges = {
            "high": 0,      # 0.8+
            "medium": 0,    # 0.6-0.79
            "low": 0        # <0.6
        }
        
        for claim in self.processed_claims:
            # Count by type
            claim_type = claim.claim_type.value
            type_counts[claim_type] = type_counts.get(claim_type, 0) + 1
            
            # Count by confidence
            if claim.confidence_score >= 0.8:
                confidence_ranges["high"] += 1
            elif claim.confidence_score >= 0.6:
                confidence_ranges["medium"] += 1
            else:
                confidence_ranges["low"] += 1
        
        return {
            "status": "active",
            "total_processed": len(self.processed_claims),
            "in_handoff_queue": len(self.handoff_queue),
            "claim_type_distribution": type_counts,
            "confidence_distribution": confidence_ranges,
            "last_processed": self.processed_claims[-1].timestamp if self.processed_claims else None
        }
    
    def clear_handoff_queue(self) -> int:
        """Clear the handoff queue and return number of cleared claims"""
        cleared_count = len(self.handoff_queue)
        self.handoff_queue.clear()
        logger.info(f"Cleared {cleared_count} claims from handoff queue")
        return cleared_count
    
    async def batch_process_rejections(self, 
                                     rejections_batch: List[Dict[str, Any]]) -> List[StructuredClaim]:
        """Process multiple rejections in batch"""
        logger.info(f"Processing batch of {len(rejections_batch)} rejections")
        
        structured_claims = []
        
        for rejection in rejections_batch:
            try:
                structured_claim = await self.process_rejection_for_mcde(rejection)
                if structured_claim:
                    structured_claims.append(structured_claim)
            except Exception as e:
                logger.error(f"Error processing rejection in batch: {e}")
                continue
        
        logger.info(f"Successfully processed {len(structured_claims)} out of {len(rejections_batch)} rejections")
        return structured_claims

class MCDEHandoffMonitor:
    """Monitors the handoff process and provides health metrics"""
    
    def __init__(self, integration: ClaimDetectorMCDEIntegration):
        self.integration = integration
        self.handoff_metrics = {
            "total_handoffs": 0,
            "successful_handoffs": 0,
            "failed_handoffs": 0,
            "avg_processing_time": 0.0,
            "last_handoff_time": None
        }
    
    async def monitor_handoff_health(self) -> Dict[str, Any]:
        """Monitor the health of the handoff system"""
        try:
            # Get current status
            summary = self.integration.get_handoff_summary()
            
            # Calculate health metrics
            health_score = self._calculate_health_score(summary)
            
            # Check for potential issues
            issues = self._identify_issues(summary)
            
            return {
                "health_score": health_score,
                "status": summary.get("status", "unknown"),
                "metrics": summary,
                "issues": issues,
                "recommendations": self._generate_recommendations(issues, summary)
            }
            
        except Exception as e:
            logger.error(f"Error monitoring handoff health: {e}")
            return {"error": str(e)}
    
    def _calculate_health_score(self, summary: Dict[str, Any]) -> float:
        """Calculate overall health score (0-100)"""
        if summary.get("status") == "no_claims_processed":
            return 0.0
        
        score = 0.0
        
        # Base score for having claims
        if summary.get("total_processed", 0) > 0:
            score += 30.0
        
        # Score for queue health
        queue_size = summary.get("in_handoff_queue", 0)
        if 0 < queue_size <= 100:  # Healthy queue size
            score += 25.0
        elif queue_size > 100:  # Queue too large
            score += 10.0
        
        # Score for confidence distribution
        confidence_dist = summary.get("confidence_distribution", {})
        high_conf = confidence_dist.get("high", 0)
        total = sum(confidence_dist.values())
        
        if total > 0:
            high_conf_ratio = high_conf / total
            score += min(25.0, high_conf_ratio * 25.0)
        
        # Score for recent activity
        if summary.get("last_processed"):
            score += 20.0
        
        return min(100.0, score)
    
    def _identify_issues(self, summary: Dict[str, Any]) -> List[str]:
        """Identify potential issues in the handoff system"""
        issues = []
        
        # Check for no activity
        if summary.get("status") == "no_claims_processed":
            issues.append("No claims have been processed")
        
        # Check for large queue
        queue_size = summary.get("in_handoff_queue", 0)
        if queue_size > 100:
            issues.append(f"Handoff queue is large ({queue_size} claims)")
        
        # Check for low confidence claims
        confidence_dist = summary.get("confidence_distribution", {})
        low_conf = confidence_dist.get("low", 0)
        total = sum(confidence_dist.values())
        
        if total > 0 and (low_conf / total) > 0.5:
            issues.append("High proportion of low-confidence claims")
        
        return issues
    
    def _generate_recommendations(self, 
                                 issues: List[str], 
                                 summary: Dict[str, Any]) -> List[str]:
        """Generate recommendations based on identified issues"""
        recommendations = []
        
        if "No claims have been processed" in issues:
            recommendations.append("Check Claim Detector pipeline for data flow issues")
        
        if "Handoff queue is large" in issues:
            recommendations.append("Consider increasing MCDE processing capacity")
            recommendations.append("Review handoff queue processing frequency")
        
        if "High proportion of low-confidence claims" in issues:
            recommendations.append("Review classification model performance")
            recommendations.append("Consider retraining with recent data")
        
        if not issues:
            recommendations.append("System is healthy - continue monitoring")
        
        return recommendations

# Test the integration
async def test_integration():
    """Test the Claim Detector MCDE integration"""
    print("Testing Claim Detector MCDE Integration...")
    
    # Create integration
    integration = ClaimDetectorMCDEIntegration()
    
    # Create mock rejection data
    mock_rejection = {
        "id": "REJ_001",
        "rejection_reason": "Inventory lost during shipment",
        "description": "Package never arrived at destination",
        "order_id": "123-4567890-1234567",
        "sku": "B07ABC1234",
        "claim_amount": 150.00
    }
    
    # Process the rejection
    structured_claim = await integration.process_rejection_for_mcde(mock_rejection)
    
    if structured_claim:
        print(f"✅ Successfully created structured claim: {structured_claim.claim_id}")
        print(f"   Type: {structured_claim.claim_type.value}")
        print(f"   Confidence: {structured_claim.confidence_score:.3f}")
        print(f"   Evidence sources: {structured_claim.evidence_sources}")
        
        # Test export
        export_success = integration.export_claims_for_mcde("test_mcde_export.json")
        print(f"   Export test: {'PASS' if export_success else 'FAIL'}")
        
        # Test monitoring
        monitor = MCDEHandoffMonitor(integration)
        health = await monitor.monitor_handoff_health()
        print(f"   Health score: {health['health_score']:.1f}/100")
        
    else:
        print("❌ Failed to create structured claim")
    
    print("\n✅ Integration Test Complete!")

if __name__ == "__main__":
    # Run the test
    asyncio.run(test_integration())




