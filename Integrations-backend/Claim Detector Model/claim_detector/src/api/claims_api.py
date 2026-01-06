#!/usr/bin/env python3
"""
API Interface for FBA Claims System
Provides REST API endpoints for claim detection and management
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import json
from datetime import datetime
from typing import Dict, List, Any, Optional
import sys
import os
from pathlib import Path

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Global variables for system components
rules_engine = None
claims_detector = None
feedback_loop = None
data_collector = None

def initialize_system():
    """Initialize all system components"""
    global rules_engine, claims_detector, feedback_loop, data_collector
    
    try:
        # Initialize rules engine
        from rules_engine.rules_engine import RulesEngine
        rules_engine = RulesEngine()
        logger.info("✅ Rules engine initialized")
        
        # Initialize feedback loop
        from feedback_loop.feedback_system import FeedbackLoop
        feedback_loop = FeedbackLoop(rules_engine)
        logger.info("✅ Feedback loop initialized")
        
        # Initialize data collector (optional - for data collection endpoints)
        try:
            from data_collection.data_collector import DataCollectionOrchestrator
            data_collector = DataCollectionOrchestrator(db_connection=None)
            logger.info("✅ Data collector initialized")
        except Exception as e:
            logger.warning(f"⚠️ Data collector not initialized: {e}")
        
        # Initialize claims detector (optional - for ML predictions)
        try:
            from ml_detector.enhanced_ml_detector import EnhancedMLDetector, ClaimsDetector
            ml_detector = EnhancedMLDetector(
                model_path="models/improved_fba_claims_model.pkl",
                rules_engine=rules_engine
            )
            claims_detector = ClaimsDetector(ml_detector, rules_engine)
            logger.info("✅ Claims detector initialized")
        except Exception as e:
            logger.warning(f"⚠️ Claims detector not initialized: {e}")
        
        logger.info("🎉 System initialization completed")
        return True
        
    except Exception as e:
        logger.error(f"❌ System initialization failed: {e}")
        return False

# API Routes

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "components": {
            "rules_engine": rules_engine is not None,
            "claims_detector": claims_detector is not None,
            "feedback_loop": feedback_loop is not None,
            "data_collector": data_collector is not None
        }
    })

@app.route('/claims/detect', methods=['POST'])
def detect_claim():
    """Detect and evaluate a potential claim"""
    try:
        # Parse request data
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        # Validate required fields
        required_fields = ['sku', 'claim_type', 'quantity_affected', 'amount_requested']
        missing_fields = [field for field in required_fields if field not in data]
        if missing_fields:
            return jsonify({"error": f"Missing required fields: {missing_fields}"}), 400
        
        # Create claim data structure
        from rules_engine.rules_engine import ClaimData
        
        claim_data = ClaimData(
            sku=data['sku'],
            asin=data.get('asin', ''),
            claim_type=data['claim_type'],
            quantity_affected=data['quantity_affected'],
            amount_requested=float(data['amount_requested']),
            shipment_date=datetime.fromisoformat(data['shipment_date']) if data.get('shipment_date') else None,
            received_date=datetime.fromisoformat(data['received_date']) if data.get('received_date') else None,
            warehouse_location=data.get('warehouse_location'),
            marketplace=data.get('marketplace', 'US'),
            cost_per_unit=float(data['cost_per_unit']) if data.get('cost_per_unit') else None,
            evidence_attached=data.get('evidence_attached', False)
        )
        
        # Detect claim using rules engine
        if rules_engine:
            rule_results = rules_engine.evaluate_claim(claim_data)
            rules_decision = rules_engine.get_claim_decision(rule_results)
        else:
            rule_results = []
            rules_decision = {"decision": "ERROR", "can_proceed": False, "reason": "Rules engine not available"}
        
        # Get ML prediction if available
        ml_prediction = None
        if claims_detector:
            try:
                combined_decision = claims_detector.detect_claim(claim_data)
                ml_prediction = {
                    "prediction_class": combined_decision.ml_prediction.prediction_class,
                    "probability": combined_decision.ml_prediction.claimable_probability,
                    "confidence": combined_decision.ml_prediction.confidence_score,
                    "feature_importance": combined_decision.ml_prediction.feature_importance
                }
                final_decision = combined_decision.final_decision
                can_proceed = combined_decision.can_proceed
                reasoning = combined_decision.reasoning
            except Exception as e:
                logger.error(f"❌ ML detection failed: {e}")
                ml_prediction = None
                final_decision = "RULES_ONLY"
                can_proceed = rules_decision.get('can_proceed', False)
                reasoning = f"ML detection failed: {str(e)}"
        else:
            final_decision = "RULES_ONLY"
            can_proceed = rules_decision.get('can_proceed', False)
            reasoning = "ML detector not available"
        
        # Prepare response
        response = {
            "claim_id": f"claim_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "sku": claim_data.sku,
            "final_decision": final_decision,
            "can_proceed": can_proceed,
            "reasoning": reasoning,
            "rules_evaluation": {
                "decision": rules_decision.get('decision'),
                "can_proceed": rules_decision.get('can_proceed'),
                "reason": rules_decision.get('reason'),
                "rules_applied": [r.rule_name for r in rule_results if r.passed]
            },
            "ml_prediction": ml_prediction,
            "recommendations": _generate_recommendations(claim_data, rules_decision, ml_prediction),
            "timestamp": datetime.now().isoformat()
        }
        
        # Add additional info if available
        if rules_decision.get('recommended_amount'):
            response['recommended_amount'] = rules_decision['recommended_amount']
        
        logger.info(f"✅ Claim detection completed for SKU: {claim_data.sku}")
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"❌ Error in claim detection: {e}")
        return jsonify({"error": f"Claim detection failed: {str(e)}"}), 500

@app.route('/claims/batch-detect', methods=['POST'])
def batch_detect_claims():
    """Detect multiple claims in batch"""
    try:
        data = request.get_json()
        if not data or 'claims' not in data:
            return jsonify({"error": "No claims data provided"}), 400
        
        claims_data = data['claims']
        if not isinstance(claims_data, list):
            return jsonify({"error": "Claims must be a list"}), 400
        
        results = []
        for i, claim_data in enumerate(claims_data):
            try:
                # Create individual request for each claim
                individual_request = request.copy()
                individual_request._cached_json = claim_data
                
                # Process individual claim
                from rules_engine.rules_engine import ClaimData
                
                claim = ClaimData(
                    sku=claim_data['sku'],
                    asin=claim_data.get('asin', ''),
                    claim_type=claim_data['claim_type'],
                    quantity_affected=claim_data['quantity_affected'],
                    amount_requested=float(claim_data['amount_requested']),
                    shipment_date=datetime.fromisoformat(claim_data['shipment_date']) if claim_data.get('shipment_date') else None,
                    received_date=datetime.fromisoformat(claim_data['received_date']) if claim_data.get('received_date') else None,
                    warehouse_location=claim_data.get('warehouse_location'),
                    marketplace=claim_data.get('marketplace', 'US'),
                    cost_per_unit=float(claim_data['cost_per_unit']) if claim_data.get('cost_per_unit') else None,
                    evidence_attached=claim_data.get('evidence_attached', False)
                )
                
                # Evaluate using rules engine
                if rules_engine:
                    rule_results = rules_engine.evaluate_claim(claim)
                    rules_decision = rules_engine.get_claim_decision(rule_results)
                else:
                    rules_decision = {"decision": "ERROR", "can_proceed": False}
                
                result = {
                    "sku": claim.sku,
                    "decision": rules_decision.get('decision'),
                    "can_proceed": rules_decision.get('can_proceed'),
                    "reason": rules_decision.get('reason'),
                    "status": "processed"
                }
                
                results.append(result)
                
            except Exception as e:
                logger.error(f"❌ Error processing claim {i}: {e}")
                results.append({
                    "sku": claim_data.get('sku', f"unknown_{i}"),
                    "decision": "ERROR",
                    "can_proceed": False,
                    "reason": f"Processing failed: {str(e)}",
                    "status": "error"
                })
        
        response = {
            "batch_id": f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "total_claims": len(claims_data),
            "processed": len([r for r in results if r['status'] == 'processed']),
            "errors": len([r for r in results if r['status'] == 'error']),
            "results": results,
            "timestamp": datetime.now().isoformat()
        }
        
        logger.info(f"✅ Batch detection completed: {len(claims_data)} claims processed")
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"❌ Error in batch detection: {e}")
        return jsonify({"error": f"Batch detection failed: {str(e)}"}), 500

@app.route('/rules', methods=['GET'])
def get_rules():
    """Get all active rules"""
    try:
        if not rules_engine:
            return jsonify({"error": "Rules engine not available"}), 503
        
        rules_summary = rules_engine.get_rules_summary()
        active_rules = [rule for rule in rules_engine.rules if rule.get('is_active', True)]
        
        response = {
            "rules_summary": rules_summary,
            "active_rules": active_rules,
            "timestamp": datetime.now().isoformat()
        }
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"❌ Error getting rules: {e}")
        return jsonify({"error": f"Failed to get rules: {str(e)}"}), 500

@app.route('/rules/<rule_id>', methods=['PUT'])
def update_rule(rule_id):
    """Update an existing rule"""
    try:
        if not rules_engine:
            return jsonify({"error": "Rules engine not available"}), 503
        
        data = request.get_json()
        if not data:
            return jsonify({"error": "No update data provided"}), 400
        
        success = rules_engine.update_rule(rule_id, data)
        if success:
            return jsonify({"message": f"Rule {rule_id} updated successfully"})
        else:
            return jsonify({"error": f"Rule {rule_id} not found"}), 404
        
    except Exception as e:
        logger.error(f"❌ Error updating rule {rule_id}: {e}")
        return jsonify({"error": f"Failed to update rule: {str(e)}"}), 500

@app.route('/rules', methods=['POST'])
def add_rule():
    """Add a new rule"""
    try:
        if not rules_engine:
            return jsonify({"error": "Rules engine not available"}), 503
        
        data = request.get_json()
        if not data:
            return jsonify({"error": "No rule data provided"}), 400
        
        success = rules_engine.add_rule(data)
        if success:
            return jsonify({"message": "Rule added successfully"})
        else:
            return jsonify({"error": "Failed to add rule"}), 400
        
    except Exception as e:
        logger.error(f"❌ Error adding rule: {e}")
        return jsonify({"error": f"Failed to add rule: {str(e)}"}), 500

@app.route('/feedback', methods=['POST'])
def capture_feedback():
    """Capture feedback on a claim outcome"""
    try:
        if not feedback_loop:
            return jsonify({"error": "Feedback loop not available"}), 503
        
        data = request.get_json()
        if not data:
            return jsonify({"error": "No feedback data provided"}), 400
        
        # Validate required fields
        required_fields = ['claim_id', 'sku', 'outcome']
        missing_fields = [field for field in required_fields if field not in data]
        if missing_fields:
            return jsonify({"error": f"Missing required fields: {missing_fields}"}), 400
        
        # Create Amazon outcome
        from feedback_loop.feedback_system import AmazonOutcome
        
        amazon_outcome = AmazonOutcome(
            claim_id=data['claim_id'],
            sku=data['sku'],
            asin=data.get('asin', ''),
            outcome=data['outcome'],
            amount_approved=data.get('amount_approved'),
            amount_requested=data.get('amount_requested'),
            decision_date=datetime.fromisoformat(data['decision_date']) if data.get('decision_date') else None,
            amazon_case_id=data.get('amazon_case_id'),
            amazon_reason=data.get('amazon_reason'),
            notes=data.get('notes')
        )
        
        # For now, we'll create a mock original decision since we don't have the full context
        # In production, this would come from the stored claim detection result
        
        from dataclasses import dataclass
        
        @dataclass
        class MockMLPrediction:
            prediction_class: str
            claimable_probability: float
            confidence_score: float
        
        @dataclass
        class MockCombinedDecision:
            ml_prediction: MockMLPrediction
            rules_decision: Dict[str, Any]
        
        mock_decision = MockCombinedDecision(
            ml_prediction=MockMLPrediction(
                prediction_class="claimable" if data['outcome'] == 'approved' else "not_claimable",
                claimable_probability=0.8 if data['outcome'] == 'approved' else 0.3,
                confidence_score=0.7
            ),
            rules_decision={
                'decision': 'ALLOWED',
                'can_proceed': True
            }
        )
        
        # Create mock claim data
        from rules_engine.rules_engine import ClaimData
        
        mock_claim_data = ClaimData(
            sku=data['sku'],
            asin=data.get('asin', ''),
            claim_type=data.get('claim_type', 'unknown'),
            quantity_affected=data.get('quantity_affected', 1),
            amount_requested=data.get('amount_requested', 0.0)
        )
        
        # Capture feedback
        feedback_data = feedback_loop.capture_outcome(mock_claim_data, amazon_outcome, mock_decision)
        
        if feedback_data:
            response = {
                "message": "Feedback captured successfully",
                "accuracy_score": feedback_data.accuracy_score,
                "drift_detected": feedback_data.drift_detected,
                "timestamp": datetime.now().isoformat()
            }
            
            # Check if retraining is needed
            should_retrain, reason = feedback_loop.should_retrain()
            response['retraining_needed'] = should_retrain
            response['retraining_reason'] = reason
            
            logger.info(f"✅ Feedback captured for claim: {data['claim_id']}")
            return jsonify(response)
        else:
            return jsonify({"error": "Failed to capture feedback"}), 500
        
    except Exception as e:
        logger.error(f"❌ Error capturing feedback: {e}")
        return jsonify({"error": f"Failed to capture feedback: {str(e)}"}), 500

@app.route('/feedback/summary', methods=['GET'])
def get_feedback_summary():
    """Get feedback summary and statistics"""
    try:
        if not feedback_loop:
            return jsonify({"error": "Feedback loop not available"}), 503
        
        summary = feedback_loop.get_feedback_summary()
        return jsonify(summary)
        
    except Exception as e:
        logger.error(f"❌ Error getting feedback summary: {e}")
        return jsonify({"error": f"Failed to get feedback summary: {str(e)}"}), 500

@app.route('/data/collect', methods=['POST'])
def collect_data():
    """Trigger data collection from all sources"""
    try:
        if not data_collector:
            return jsonify({"error": "Data collector not available"}), 503
        
        # Run data collection
        success = data_collector.run_collection_pipeline()
        
        if success:
            return jsonify({
                "message": "Data collection completed successfully",
                "timestamp": datetime.now().isoformat()
            })
        else:
            return jsonify({"error": "Data collection failed"}), 500
        
    except Exception as e:
        logger.error(f"❌ Error in data collection: {e}")
        return jsonify({"error": f"Data collection failed: {str(e)}"}), 500

@app.route('/system/status', methods=['GET'])
def get_system_status():
    """Get overall system status"""
    try:
        status = {
            "timestamp": datetime.now().isoformat(),
            "components": {
                "rules_engine": {
                    "status": "active" if rules_engine else "inactive",
                    "rules_count": len(rules_engine.rules) if rules_engine else 0,
                    "active_rules": len([r for r in rules_engine.rules if r.get('is_active', True)]) if rules_engine else 0
                },
                "claims_detector": {
                    "status": "active" if claims_detector else "inactive",
                    "ml_model_loaded": claims_detector.ml_detector.is_loaded if claims_detector else False
                },
                "feedback_loop": {
                    "status": "active" if feedback_loop else "inactive",
                    "feedback_samples": len(feedback_loop.feedback_data) if feedback_loop else 0
                },
                "data_collector": {
                    "status": "active" if data_collector else "inactive"
                }
            },
            "system_health": "healthy" if all([
                rules_engine, feedback_loop
            ]) else "degraded"
        }
        
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"❌ Error getting system status: {e}")
        return jsonify({"error": f"Failed to get system status: {str(e)}"}), 500

def _generate_recommendations(claim_data, rules_decision, ml_prediction):
    """Generate recommendations based on claim evaluation"""
    recommendations = []
    
    # Rules-based recommendations
    if rules_decision.get('decision') == 'DENIED':
        recommendations.append("Claim denied by rules - review eligibility criteria")
    elif rules_decision.get('decision') == 'EVIDENCE_REQUIRED':
        recommendations.append("Additional evidence required before proceeding")
    elif rules_decision.get('decision') == 'LIMITED':
        recommendations.append(f"Consider reducing claim amount to ${rules_decision.get('recommended_amount', 0):.2f}")
    
    # ML-based recommendations
    if ml_prediction:
        if ml_prediction['probability'] > 0.8:
            recommendations.append("High confidence claim - strong candidate for submission")
        elif ml_prediction['probability'] < 0.3:
            recommendations.append("Low confidence claim - consider additional review")
    
    # General recommendations
    if claim_data.amount_requested < 5.0:
        recommendations.append("Claim amount below $5 threshold - may not be eligible")
    
    if claim_data.shipment_date and (datetime.now() - claim_data.shipment_date).days > 270:
        recommendations.append("Claim approaching 9-month deadline - submit soon")
    
    if not claim_data.evidence_attached and claim_data.claim_type == 'damaged_goods':
        recommendations.append("Photographic evidence required for damaged goods claims")
    
    return recommendations if recommendations else ["No specific recommendations at this time"]

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500

# Main execution
if __name__ == '__main__':
    # Initialize system
    if initialize_system():
        logger.info("🚀 Starting FBA Claims API server...")
        
        # Run the Flask app
        app.run(
            host='0.0.0.0',
            port=5000,
            debug=True
        )
    else:
        logger.error("❌ Failed to initialize system. Exiting.")
        sys.exit(1)

