#!/usr/bin/env python3
"""
Concierge Feedback Update System - Complete Example
Demonstrates the full workflow from rejection logging to system updates
"""

import json
import uuid
from datetime import datetime, timedelta
from typing import Dict, List
import logging

# Import our components
from rejection_logger import RejectionLogger, RejectionReasonNormalizer
from knowledge_base_sync import KnowledgeBaseSync
from detector_feedback_loop import DetectorFeedbackLoop

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ConciergeFeedbackUpdateDemo:
    """Complete demonstration of the Concierge Feedback Update System"""
    
    def __init__(self):
        # Initialize components
        self.rejection_logger = RejectionLogger()
        self.knowledge_base_sync = KnowledgeBaseSync()
        self.feedback_loop = DetectorFeedbackLoop(
            rejection_logger=self.rejection_logger,
            knowledge_base_sync=self.knowledge_base_sync
        )
        
        # Demo data
        self.demo_rejections = self._create_demo_rejections()
        
    def run_complete_demo(self):
        """Run the complete demonstration workflow"""
        logger.info("🚀 Starting Concierge Feedback Update System Demo")
        
        # Step 1: Log multiple rejections
        logger.info("\n📝 Step 1: Logging Rejections")
        rejection_ids = self._log_demo_rejections()
        
        # Step 2: Analyze patterns
        logger.info("\n🔍 Step 2: Analyzing Rejection Patterns")
        analysis = self._analyze_patterns()
        
        # Step 3: Process feedback
        logger.info("\n⚙️ Step 3: Processing Feedback")
        feedback_results = self._process_feedback(rejection_ids)
        
        # Step 4: Update systems
        logger.info("\n🔄 Step 4: Updating Systems")
        system_updates = self._update_systems(feedback_results)
        
        # Step 5: Generate report
        logger.info("\n📊 Step 5: Generating Report")
        report = self._generate_report(analysis, feedback_results, system_updates)
        
        # Save results
        self._save_demo_results(report)
        
        logger.info("\n✅ Demo completed successfully!")
        return report
    
    def _create_demo_rejections(self) -> List[Dict]:
        """Create realistic demo rejection data"""
        return [
            {
                'claim_id': 'CLM-001',
                'sku': 'SKU-12345',
                'asin': 'B08N5WRWNW',
                'claim_type': 'lost',
                'claim_amount': 45.99,
                'claim_text': 'Item was lost during inbound shipment. Tracking shows delivered to Amazon but not received.',
                'amazon_rejection_reason': 'Documentation missing. Please provide proof of delivery and item value.',
                'amazon_case_id': 'CASE-001',
                'model_prediction': True,
                'model_confidence': 0.87
            },
            {
                'claim_id': 'CLM-002',
                'sku': 'SKU-67890',
                'asin': 'B07XYZ1234',
                'claim_type': 'damaged',
                'claim_amount': 129.99,
                'claim_text': 'Item arrived damaged. Photos attached showing damage.',
                'amazon_rejection_reason': 'Item is older than 18 months. Not eligible for damage claim.',
                'amazon_case_id': 'CASE-002',
                'model_prediction': True,
                'model_confidence': 0.92
            },
            {
                'claim_id': 'CLM-003',
                'sku': 'SKU-11111',
                'asin': 'B06ABC1234',
                'claim_type': 'fee',
                'claim_amount': 15.50,
                'claim_text': 'Incorrect FBA storage fee charged. Item was removed within 30 days.',
                'amazon_rejection_reason': 'Fee calculation is correct based on current policy. No adjustment needed.',
                'amazon_case_id': 'CASE-003',
                'model_prediction': True,
                'model_confidence': 0.78
            },
            {
                'claim_id': 'CLM-004',
                'sku': 'SKU-22222',
                'asin': 'B05DEF5678',
                'claim_type': 'overcharge',
                'claim_amount': 25.00,
                'claim_text': 'Overcharged for shipping. Invoice shows different amount.',
                'amazon_rejection_reason': 'Documentation missing. Please provide original invoice and shipping receipt.',
                'amazon_case_id': 'CASE-004',
                'model_prediction': True,
                'model_confidence': 0.85
            },
            {
                'claim_id': 'CLM-005',
                'sku': 'SKU-33333',
                'asin': 'B04GHI9012',
                'claim_type': 'wrong_item',
                'claim_amount': 89.99,
                'claim_text': 'Received wrong item. Expected SKU-33333 but got different item.',
                'amazon_rejection_reason': 'Item is older than 18 months. Not eligible for wrong item claim.',
                'amazon_case_id': 'CASE-005',
                'model_prediction': True,
                'model_confidence': 0.91
            }
        ]
    
    def _log_demo_rejections(self) -> List[str]:
        """Log all demo rejections and return their IDs"""
        rejection_ids = []
        
        for rejection in self.demo_rejections:
            rejection_id = self.rejection_logger.log_rejection(
                claim_id=rejection['claim_id'],
                amazon_rejection_reason=rejection['amazon_rejection_reason'],
                sku=rejection['sku'],
                asin=rejection['asin'],
                claim_type=rejection['claim_type'],
                claim_amount=rejection['claim_amount'],
                claim_text=rejection['claim_text'],
                amazon_case_id=rejection['amazon_case_id'],
                model_prediction=rejection['model_prediction'],
                model_confidence=rejection['model_confidence']
            )
            rejection_ids.append(rejection_id)
            
            logger.info(f"Logged rejection {rejection_id} for claim {rejection['claim_id']}")
        
        return rejection_ids
    
    def _analyze_patterns(self) -> Dict:
        """Analyze rejection patterns"""
        analysis = self.feedback_loop.analyze_rejection_patterns()
        
        logger.info(f"Analysis Results:")
        logger.info(f"  - Total rejections: {analysis.get('total_rejections', 0)}")
        logger.info(f"  - Fixable count: {analysis.get('fixable_count', 0)}")
        logger.info(f"  - Unclaimable count: {analysis.get('unclaimable_count', 0)}")
        logger.info(f"  - Model misses: {analysis.get('model_misses', 0)}")
        
        if analysis.get('recommendations'):
            logger.info("  - Recommendations:")
            for rec in analysis['recommendations']:
                logger.info(f"    * {rec['priority'].upper()}: {rec['message']}")
        
        return analysis
    
    def _process_feedback(self, rejection_ids: List[str]) -> Dict:
        """Process feedback for all rejections"""
        results = {
            'total_processed': 0,
            'rule_updates': [],
            'knowledge_updates': [],
            'model_retrained': False
        }
        
        for rejection_id in rejection_ids:
            # Process individual rejection
            result = self.feedback_loop.process_rejection_feedback(rejection_id)
            
            results['total_processed'] += 1
            
            if result.get('rule_updates'):
                results['rule_updates'].extend(result['rule_updates'])
            
            if result.get('knowledge_base_updated'):
                results['knowledge_updates'].append(rejection_id)
            
            if result.get('model_retrained'):
                results['model_retrained'] = True
        
        logger.info(f"Feedback Processing Results:")
        logger.info(f"  - Processed: {results['total_processed']} rejections")
        logger.info(f"  - Rule updates: {len(results['rule_updates'])}")
        logger.info(f"  - Knowledge updates: {len(results['knowledge_updates'])}")
        logger.info(f"  - Model retrained: {results['model_retrained']}")
        
        return results
    
    def _update_systems(self, feedback_results: Dict) -> Dict:
        """Update systems based on feedback results"""
        updates = {
            'rules_updated': 0,
            'templates_created': 0,
            'edge_cases_added': 0
        }
        
        # Update knowledge base with successful templates
        if feedback_results.get('knowledge_updates'):
            template_id = self.knowledge_base_sync.update_successful_template(
                claim_type='lost',
                claim_text='Item lost during inbound shipment with proper documentation',
                evidence_used=['tracking_proof', 'invoice', 'photos'],
                template_name='Lost Item Template'
            )
            updates['templates_created'] += 1
            
            edge_case_id = self.knowledge_base_sync.update_edge_case(
                claim_type='damaged',
                description='Items older than 18 months not eligible for damage claims',
                is_success=False,
                special_requirements='Check item age before filing damage claim',
                patterns=['older than 18 months', 'not eligible']
            )
            updates['edge_cases_added'] += 1
        
        # Count rule updates
        updates['rules_updated'] = len(feedback_results.get('rule_updates', []))
        
        logger.info(f"System Updates:")
        logger.info(f"  - Rules updated: {updates['rules_updated']}")
        logger.info(f"  - Templates created: {updates['templates_created']}")
        logger.info(f"  - Edge cases added: {updates['edge_cases_added']}")
        
        return updates
    
    def _generate_report(self, analysis: Dict, feedback_results: Dict, system_updates: Dict) -> Dict:
        """Generate comprehensive report"""
        report = {
            'demo_timestamp': datetime.now().isoformat(),
            'summary': {
                'total_rejections_processed': feedback_results['total_processed'],
                'fixable_rejections': analysis.get('fixable_count', 0),
                'unclaimable_rejections': analysis.get('unclaimable_count', 0),
                'system_improvements': system_updates
            },
            'detailed_results': {
                'analysis': analysis,
                'feedback_processing': feedback_results,
                'system_updates': system_updates
            },
            'recommendations': analysis.get('recommendations', []),
            'next_actions': self._generate_next_actions(analysis, feedback_results)
        }
        
        return report
    
    def _generate_next_actions(self, analysis: Dict, feedback_results: Dict) -> List[str]:
        """Generate next action items"""
        actions = []
        
        if analysis.get('fixable_count', 0) > 5:
            actions.append("Schedule model retraining with fixable rejections")
        
        if analysis.get('unclaimable_count', 0) > 2:
            actions.append("Review and update rules engine with new unclaimable patterns")
        
        if feedback_results.get('model_retrained'):
            actions.append("Monitor new model performance for next 30 days")
        
        if not actions:
            actions.append("Continue monitoring rejection patterns")
        
        return actions
    
    def _save_demo_results(self, report: Dict):
        """Save demo results to file"""
        filename = f"concierge_demo_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        with open(filename, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        logger.info(f"Demo results saved to: {filename}")
    
    def show_code_examples(self):
        """Show example code snippets for common operations"""
        examples = {
            'logging_rejection': '''
# Log a new rejection
rejection_id = rejection_logger.log_rejection(
    claim_id="CLM-123",
    amazon_rejection_reason="Documentation missing. Please provide proof of delivery.",
    sku="SKU-12345",
    asin="B08N5WRWNW",
    claim_type="lost",
    claim_amount=45.99,
    claim_text="Item was lost during inbound shipment.",
    model_prediction=True,
    model_confidence=0.87
)
''',
            'processing_feedback': '''
# Process feedback for a rejection
result = feedback_loop.process_rejection_feedback(rejection_id)

# Check results
if result.get('rule_updates'):
    print(f"Rules updated: {len(result['rule_updates'])}")
if result.get('model_retrained'):
    print("Model was retrained")
if result.get('knowledge_base_updated'):
    print("Knowledge base updated")
''',
            'batch_processing': '''
# Process multiple rejections in batch
batch_result = feedback_loop.batch_process_rejections(max_rejections=50)

print(f"Processed {batch_result['total_processed']} rejections")
print(f"Rule updates: {len(batch_result['rule_updates'])}")
print(f"Model retrained: {batch_result['model_retrained']}")
''',
            'analyzing_patterns': '''
# Analyze rejection patterns
analysis = feedback_loop.analyze_rejection_patterns()

print(f"Total rejections: {analysis['total_rejections']}")
print(f"Fixable: {analysis['fixable_count']}")
print(f"Unclaimable: {analysis['unclaimable_count']}")

for rec in analysis['recommendations']:
    print(f"{rec['priority']}: {rec['message']}")
''',
            'updating_knowledge_base': '''
# Update successful template
template_id = knowledge_base_sync.update_successful_template(
    claim_type="lost",
    claim_text="Item lost with proper documentation",
    evidence_used=["tracking_proof", "invoice"],
    template_name="Lost Item Template"
)

# Update edge case
edge_case_id = knowledge_base_sync.update_edge_case(
    claim_type="damaged",
    description="Items older than 18 months not eligible",
    is_success=False,
    special_requirements="Check item age before filing"
)
'''
        }
        
        logger.info("\n📋 Code Examples:")
        for title, code in examples.items():
            logger.info(f"\n{title.upper()}:")
            logger.info(code)

def main():
    """Main demo function"""
    demo = ConciergeFeedbackUpdateDemo()
    
    # Run the complete demo
    report = demo.run_complete_demo()
    
    # Show code examples
    demo.show_code_examples()
    
    # Print final summary
    print("\n" + "="*60)
    print("🎯 CONCIERGE FEEDBACK UPDATE SYSTEM DEMO COMPLETE")
    print("="*60)
    print(f"📊 Summary:")
    print(f"   • Total rejections processed: {report['summary']['total_rejections_processed']}")
    print(f"   • Fixable rejections: {report['summary']['fixable_rejections']}")
    print(f"   • Unclaimable rejections: {report['summary']['unclaimable_rejections']}")
    print(f"   • Rules updated: {report['summary']['system_improvements']['rules_updated']}")
    print(f"   • Templates created: {report['summary']['system_improvements']['templates_created']}")
    print(f"   • Edge cases added: {report['summary']['system_improvements']['edge_cases_added']}")
    
    if report['recommendations']:
        print(f"\n💡 Recommendations:")
        for rec in report['recommendations']:
            print(f"   • {rec['priority'].upper()}: {rec['message']}")
    
    if report['next_actions']:
        print(f"\n🚀 Next Actions:")
        for action in report['next_actions']:
            print(f"   • {action}")
    
    print("\n✅ The Concierge is now actively learning from every Amazon rejection!")
    print("   Every rejection automatically strengthens the AI through retraining or rule updates.")

if __name__ == "__main__":
    main()

