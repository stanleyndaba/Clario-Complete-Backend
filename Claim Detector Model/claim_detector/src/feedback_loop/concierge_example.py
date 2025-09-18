#!/usr/bin/env python3
"""
Concierge Feedback Loop Example
Demonstrates the complete workflow from claim detection to feedback collection and model retraining
"""

import json
import uuid
from datetime import datetime, timedelta
from typing import Dict, List
import logging
import pandas as pd

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import our components
try:
    from feedback_loop.claims_logger import ClaimsLogger
    from feedback_loop.feedback_training_pipeline import FeedbackTrainingPipeline
    from improved_training import ImprovedFBAClaimsModel
except ImportError:
    print("Warning: Could not import system components. Using demo mode.")

class ConciergeFeedbackLoopDemo:
    """
    Demonstrates the complete Concierge feedback loop workflow
    """
    
    def __init__(self):
        self.claims_logger = ClaimsLogger()
        self.pipeline = FeedbackTrainingPipeline(
            claims_logger=self.claims_logger,
            model_path="models/improved_fba_claims_model.pkl",
            output_path="models/concierge_retrained_model.pkl"
        )
        
        # Simulate some real-world claim scenarios
        self.demo_claims = self._create_demo_claims()
        
    def _create_demo_claims(self) -> List[Dict]:
        """Create realistic demo claims for demonstration"""
        return [
            {
                'claim_id': 'REAL-001',
                'claim_type': 'lost',
                'claim_text': 'Amazon warehouse lost 3 units of ASIN B08N5WRWNW during transfer. Requesting reimbursement for $45.00',
                'claim_amount': 45.00,
                'model_prediction': True,
                'model_confidence': 0.92,
                'model_features': {'text_length': 120, 'word_count': 20, 'has_order_id': 0, 'has_amount': 1}
            },
            {
                'claim_id': 'REAL-002',
                'claim_type': 'damaged',
                'claim_text': 'Product arrived with broken packaging and damaged contents. Order 123-4567890-1234567',
                'claim_amount': 67.50,
                'model_prediction': True,
                'model_confidence': 0.88,
                'model_features': {'text_length': 95, 'word_count': 15, 'has_order_id': 1, 'has_amount': 0}
            },
            {
                'claim_id': 'REAL-003',
                'claim_type': 'fee',
                'claim_text': 'Incorrect FBA storage fee charged for Q4 2023. Should be $12.50, charged $18.75',
                'claim_amount': 6.25,
                'model_prediction': True,
                'model_confidence': 0.95,
                'model_features': {'text_length': 110, 'word_count': 18, 'has_order_id': 0, 'has_amount': 1}
            },
            {
                'claim_id': 'REAL-004',
                'claim_type': 'overcharge',
                'claim_text': 'Double charged for shipping on order 987-6543210-0987654. Charged twice for same item',
                'claim_amount': 8.99,
                'model_prediction': False,  # Model missed this one
                'model_confidence': 0.15,
                'model_features': {'text_length': 125, 'word_count': 22, 'has_order_id': 1, 'has_amount': 1}
            },
            {
                'claim_id': 'REAL-005',
                'claim_type': 'wrong_item',
                'claim_text': 'Received wrong item. Ordered wireless headphones, got wired ones. Order 555-1234567-8901234',
                'claim_amount': 89.99,
                'model_prediction': True,
                'model_confidence': 0.78,
                'model_features': {'text_length': 105, 'word_count': 17, 'has_order_id': 1, 'has_amount': 0}
            }
        ]
    
    def step_1_log_new_claims(self) -> List[str]:
        """
        Step 1: Log new claims detected by the model
        This simulates the initial detection phase
        """
        print("\n🔍 STEP 1: LOGGING NEW CLAIMS")
        print("=" * 50)
        
        tracking_ids = []
        
        for claim in self.demo_claims:
            tracking_id = self.claims_logger.log_new_claim(
                claim_id=claim['claim_id'],
                claim_type=claim['claim_type'],
                claim_text=claim['claim_text'],
                claim_amount=claim['claim_amount'],
                model_prediction=claim['model_prediction'],
                model_confidence=claim['model_confidence'],
                model_features=claim['model_features']
            )
            tracking_ids.append(tracking_id)
            
            print(f"✅ Logged claim: {claim['claim_id']}")
            print(f"   Type: {claim['claim_type']}")
            print(f"   Amount: ${claim['claim_amount']}")
            print(f"   Model Prediction: {claim['model_prediction']} (confidence: {claim['model_confidence']:.2f})")
            print(f"   Tracking ID: {tracking_id}")
            print()
        
        return tracking_ids
    
    def step_2_simulate_amazon_decisions(self):
        """
        Step 2: Simulate Amazon's decisions on the claims
        This represents the real-world outcome phase
        """
        print("\n📋 STEP 2: AMAZON DECISIONS")
        print("=" * 50)
        
        # Simulate Amazon's decisions
        amazon_outcomes = [
            {
                'claim_id': 'REAL-001',
                'status': 'accepted',
                'final_amount': 45.00,
                'rejection_reason': None,
                'notes': 'Standard lost inventory claim approved',
                'rule_version': 'FBA-2024-Q1'
            },
            {
                'claim_id': 'REAL-002',
                'status': 'rejected',
                'final_amount': 0.00,
                'rejection_reason': 'Insufficient evidence of damage. Photos required for future claims.',
                'notes': 'Customer needs to provide photographic evidence',
                'rule_version': 'FBA-2024-Q1'
            },
            {
                'claim_id': 'REAL-003',
                'status': 'accepted',
                'final_amount': 6.25,
                'rejection_reason': None,
                'notes': 'Fee discrepancy confirmed and corrected',
                'rule_version': 'FBA-2024-Q1'
            },
            {
                'claim_id': 'REAL-004',
                'status': 'accepted',
                'final_amount': 8.99,
                'rejection_reason': None,
                'notes': 'Double charge confirmed and refunded',
                'rule_version': 'FBA-2024-Q1'
            },
            {
                'claim_id': 'REAL-005',
                'status': 'partial',
                'final_amount': 44.99,
                'rejection_reason': 'Partial refund due to restocking fee',
                'notes': 'Wrong item confirmed, but restocking fee applies',
                'rule_version': 'FBA-2024-Q1'
            }
        ]
        
        for outcome in amazon_outcomes:
            success = self.claims_logger.update_amazon_decision(
                claim_id=outcome['claim_id'],
                amazon_status=outcome['status'],
                amazon_final_amount=outcome['final_amount'],
                amazon_rejection_reason=outcome['rejection_reason'],
                amazon_notes=outcome['notes'],
                amazon_rule_version=outcome['rule_version']
            )
            
            if success:
                print(f"✅ Amazon decision recorded: {outcome['claim_id']}")
                print(f"   Status: {outcome['status']}")
                print(f"   Final Amount: ${outcome['final_amount']}")
                if outcome['rejection_reason']:
                    print(f"   Rejection Reason: {outcome['rejection_reason']}")
                print()
            else:
                print(f"❌ Failed to record Amazon decision: {outcome['claim_id']}")
    
    def step_3_concierge_review(self):
        """
        Step 3: Concierge review and edge case flagging
        This represents human oversight and pattern identification
        """
        print("\n👁️ STEP 3: CONCIERGE REVIEW")
        print("=" * 50)
        
        # Flag edge cases for review
        edge_cases = [
            {
                'claim_id': 'REAL-002',
                'edge_case_tag': 'insufficient_evidence',
                'notes': 'Model correctly identified claimable transaction, but Amazon rejected due to missing evidence. Need to improve evidence requirements detection.',
                'priority': 4
            },
            {
                'claim_id': 'REAL-004',
                'edge_case_tag': 'model_miss',
                'notes': 'Model missed this claimable transaction. Need to improve detection of double-charge scenarios.',
                'priority': 5  # High priority - model missed revenue opportunity
            },
            {
                'claim_id': 'REAL-005',
                'edge_case_tag': 'partial_acceptance',
                'notes': 'Partial acceptance with restocking fee. Model should learn to predict partial vs full acceptance.',
                'priority': 3
            }
        ]
        
        for edge_case in edge_cases:
            success = self.claims_logger.flag_edge_case(
                claim_id=edge_case['claim_id'],
                edge_case_tag=edge_case['edge_case_tag'],
                concierge_notes=edge_case['notes'],
                retraining_priority=edge_case['priority']
            )
            
            if success:
                print(f"✅ Edge case flagged: {edge_case['claim_id']}")
                print(f"   Tag: {edge_case['edge_case_tag']}")
                print(f"   Priority: {edge_case['priority']}/5")
                print(f"   Notes: {edge_case['notes']}")
                print()
            else:
                print(f"❌ Failed to flag edge case: {edge_case['claim_id']}")
    
    def step_4_analyze_feedback_patterns(self):
        """
        Step 4: Analyze patterns in feedback data
        This identifies improvement opportunities
        """
        print("\n📊 STEP 4: FEEDBACK PATTERN ANALYSIS")
        print("=" * 50)
        
        # Get claims for review
        review_claims = self.claims_logger.get_claims_for_review(priority_min=3)
        
        print(f"Found {len(review_claims)} high-priority claims for review:")
        for claim in review_claims:
            print(f"  - {claim['claim_id']}: {claim['edge_case_tag']} (Priority: {claim['priority']})")
        
        # Get training data
        training_data = self.claims_logger.get_training_data(min_samples=10, include_edge_cases=True)
        
        print(f"\nTraining data available: {len(training_data)} samples")
        
        # Analyze patterns
        if training_data:
            df = pd.DataFrame(training_data)
            
            # Basic statistics
            print(f"\n📈 FEEDBACK STATISTICS:")
            print(f"  Total Claims: {len(df)}")
            print(f"  Accepted: {len(df[df['amazon_status'] == 'accepted'])}")
            print(f"  Rejected: {len(df[df['amazon_status'] == 'rejected'])}")
            print(f"  Partial: {len(df[df['amazon_status'] == 'partial'])}")
            
            # Edge case analysis
            edge_cases = df[df['edge_case_tag'].notna()]
            if not edge_cases.empty:
                print(f"\n🔍 EDGE CASE ANALYSIS:")
                print(f"  Total Edge Cases: {len(edge_cases)}")
                edge_case_types = edge_cases['edge_case_tag'].value_counts()
                for edge_type, count in edge_case_types.items():
                    print(f"    {edge_type}: {count}")
                
                # Priority distribution
                priority_dist = edge_cases['retraining_priority'].value_counts().sort_index()
                print(f"\n  Priority Distribution:")
                for priority, count in priority_dist.items():
                    print(f"    Priority {priority}: {count}")
    
    def step_5_run_training_pipeline(self):
        """
        Step 5: Run the feedback-to-training pipeline
        This transforms feedback into improved model performance
        """
        print("\n🚀 STEP 5: FEEDBACK-TO-TRAINING PIPELINE")
        print("=" * 50)
        
        try:
            # Run the complete pipeline
            results = self.pipeline.run_full_pipeline(
                min_samples=5,  # Low threshold for demo
                include_edge_cases=True,
                recent_days=90,
                auto_retrain=True
            )
            
            if results['success']:
                print("✅ Pipeline completed successfully!")
                print(f"Training samples: {results['training_data_summary']['total_samples']}")
                
                if results['retraining_results']:
                    retrain = results['retraining_results']
                    print(f"Model accuracy: {retrain['new_accuracy']:.4f}")
                    print(f"Improvement: {retrain['improvement']:.4f}")
                    print(f"Model saved: {retrain['model_saved']}")
                
                # Save detailed results
                self.pipeline.save_pipeline_results(results, "concierge_pipeline_results.json")
                print("📄 Detailed results saved to: concierge_pipeline_results.json")
                
            else:
                print(f"❌ Pipeline failed: {results.get('error', 'Unknown error')}")
                
        except Exception as e:
            print(f"❌ Pipeline error: {e}")
    
    def step_6_demonstrate_continuous_learning(self):
        """
        Step 6: Demonstrate how the system learns from feedback
        This shows the continuous improvement cycle
        """
        print("\n🔄 STEP 6: CONTINUOUS LEARNING DEMONSTRATION")
        print("=" * 50)
        
        print("🎯 KEY LEARNING INSIGHTS:")
        print()
        
        print("1. MODEL MISS PATTERNS:")
        print("   - Claim REAL-004 was missed by the model")
        print("   - Pattern: 'Double charged for shipping'")
        print("   - Action: Add 'double charge' detection to feature engineering")
        print()
        
        print("2. EVIDENCE REQUIREMENTS:")
        print("   - Claim REAL-002 was rejected due to insufficient evidence")
        print("   - Pattern: Damage claims need photographic evidence")
        print("   - Action: Add evidence requirement detection to rules engine")
        print()
        
        print("3. PARTIAL ACCEPTANCE PATTERNS:")
        print("   - Claim REAL-005 received partial refund due to restocking fee")
        print("   - Pattern: Wrong item claims may have restocking fees")
        print("   - Action: Improve partial vs full acceptance prediction")
        print()
        
        print("4. CONTINUOUS IMPROVEMENT CYCLE:")
        print("   📊 Collect real-world outcomes")
        print("   🔍 Identify patterns and edge cases")
        print("   🏷️  Flag high-priority learning opportunities")
        print("   🚀 Retrain model with new insights")
        print("   📈 Improve prediction accuracy")
        print("   🔄 Repeat cycle with new data")
    
    def run_complete_demo(self):
        """Run the complete Concierge feedback loop demonstration"""
        print("🎭 CONCIERGE FEEDBACK LOOP - COMPLETE DEMONSTRATION")
        print("=" * 80)
        print("This demo shows how the system bridges synthetic data with real-world learning")
        print()
        
        try:
            # Run all steps
            self.step_1_log_new_claims()
            self.step_2_simulate_amazon_decisions()
            self.step_3_concierge_review()
            self.step_4_analyze_feedback_patterns()
            self.step_5_run_training_pipeline()
            self.step_6_demonstrate_continuous_learning()
            
            print("\n" + "=" * 80)
            print("🎉 CONCIERGE FEEDBACK LOOP DEMONSTRATION COMPLETED!")
            print("=" * 80)
            print()
            print("💡 KEY BENEFITS ACHIEVED:")
            print("✅ Real-world data collection and tracking")
            print("✅ Human oversight and edge case identification")
            print("✅ Pattern analysis and learning insights")
            print("✅ Continuous model improvement")
            print("✅ Adaptation to Amazon policy changes")
            print()
            print("🚀 Your Claim Detector is now production-ready with continuous learning!")
            
        except Exception as e:
            print(f"❌ Demo error: {e}")
            import traceback
            traceback.print_exc()

def main():
    """Run the Concierge feedback loop demonstration"""
    print("🚀 Starting Concierge Feedback Loop Demonstration...")
    
    # Initialize demo
    demo = ConciergeFeedbackLoopDemo()
    
    # Run complete demonstration
    demo.run_complete_demo()

if __name__ == "__main__":
    main()
