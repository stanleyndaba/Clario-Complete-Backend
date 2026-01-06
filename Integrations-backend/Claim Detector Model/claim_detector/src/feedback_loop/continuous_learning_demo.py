#!/usr/bin/env python3
"""
Continuous Learning Demo for Concierge Feedback Update System
Demonstrates how every Amazon rejection immediately strengthens the AI system
"""

import json
import time
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

class ContinuousLearningDemo:
    """Demonstrates continuous learning capabilities"""
    
    def __init__(self):
        # Initialize components
        self.rejection_logger = RejectionLogger()
        self.knowledge_base_sync = KnowledgeBaseSync()
        self.feedback_loop = DetectorFeedbackLoop(
            rejection_logger=self.rejection_logger,
            knowledge_base_sync=self.knowledge_base_sync
        )
        
        # Demo data with realistic Amazon rejection scenarios
        self.demo_rejections = self._create_realistic_rejections()
        
    def run_continuous_learning_demo(self):
        """Run the complete continuous learning demonstration"""
        logger.info("🚀 Starting Continuous Learning Demo")
        logger.info("Goal: Show how every rejection immediately strengthens the AI system")
        
        # Phase 1: Initial System State
        logger.info("\n📊 Phase 1: Initial System State")
        self._show_initial_state()
        
        # Phase 2: Log Multiple Rejections
        logger.info("\n📝 Phase 2: Logging Multiple Rejections")
        rejection_ids = self._log_demo_rejections()
        
        # Phase 3: Demonstrate Continuous Learning
        logger.info("\n🔄 Phase 3: Demonstrating Continuous Learning")
        self._demonstrate_continuous_learning(rejection_ids)
        
        # Phase 4: Show System Improvements
        logger.info("\n📈 Phase 4: System Improvements & Learning")
        self._show_system_improvements()
        
        # Phase 5: Automated Processing
        logger.info("\n⚙️ Phase 5: Automated Processing & Monitoring")
        self._demonstrate_automation()
        
        # Phase 6: Final Summary
        logger.info("\n🎯 Phase 6: Continuous Learning Summary")
        summary = self._generate_final_summary()
        
        # Save results
        self._save_demo_results(summary)
        
        logger.info("\n✅ Continuous Learning Demo completed successfully!")
        return summary
    
    def _create_realistic_rejections(self) -> List[Dict]:
        """Create realistic Amazon rejection scenarios"""
        return [
            # Fixable rejections (AI can learn from these)
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
                'model_confidence': 0.87,
                'expected_tag': 'fixable'
            },
            {
                'claim_id': 'CLM-002',
                'sku': 'SKU-67890',
                'asin': 'B07XYZ1234',
                'claim_type': 'damaged',
                'claim_amount': 129.99,
                'claim_text': 'Item arrived damaged. Photos attached showing damage.',
                'amazon_rejection_reason': 'Evidence insufficient. Please provide additional photos and damage assessment.',
                'amazon_case_id': 'CASE-002',
                'model_prediction': True,
                'model_confidence': 0.92,
                'expected_tag': 'fixable'
            },
            {
                'claim_id': 'CLM-003',
                'sku': 'SKU-11111',
                'asin': 'B06ABC1234',
                'claim_type': 'fee',
                'claim_amount': 15.50,
                'claim_text': 'Incorrect FBA storage fee charged. Item was removed within 30 days.',
                'amazon_rejection_reason': 'Format error. Please use correct claim form and include invoice details.',
                'amazon_case_id': 'CASE-003',
                'model_prediction': True,
                'model_confidence': 0.78,
                'expected_tag': 'fixable'
            },
            # Unclaimable rejections (Rules should be updated)
            {
                'claim_id': 'CLM-004',
                'sku': 'SKU-22222',
                'asin': 'B05DEF5678',
                'claim_type': 'overcharge',
                'claim_amount': 25.00,
                'claim_text': 'Overcharged for shipping. Invoice shows different amount.',
                'amazon_rejection_reason': 'Item is older than 18 months. Not eligible for overcharge claim.',
                'amazon_case_id': 'CASE-004',
                'model_prediction': True,
                'model_confidence': 0.85,
                'expected_tag': 'unclaimable'
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
                'model_confidence': 0.91,
                'expected_tag': 'unclaimable'
            },
            # Additional fixable rejections to trigger retraining
            {
                'claim_id': 'CLM-006',
                'sku': 'SKU-44444',
                'asin': 'B03JKL3456',
                'claim_type': 'missing',
                'claim_amount': 67.50,
                'claim_text': 'Item missing from shipment. Packing list shows 10 items, only 9 received.',
                'amazon_rejection_reason': 'Documentation missing. Please provide packing list and photos of received items.',
                'amazon_case_id': 'CASE-006',
                'model_prediction': True,
                'model_confidence': 0.88,
                'expected_tag': 'fixable'
            },
            {
                'claim_id': 'CLM-007',
                'sku': 'SKU-55555',
                'asin': 'B02MNO7890',
                'claim_type': 'defective',
                'claim_amount': 199.99,
                'claim_text': 'Item arrived defective. Multiple photos showing manufacturing defects.',
                'amazon_rejection_reason': 'Evidence insufficient. Please provide detailed defect description and quality control report.',
                'amazon_case_id': 'CASE-007',
                'model_prediction': True,
                'model_confidence': 0.94,
                'expected_tag': 'fixable'
            }
        ]
    
    def _show_initial_state(self):
        """Show initial system state"""
        logger.info("Initial System State:")
        logger.info("  - No rejections logged")
        logger.info("  - No patterns identified")
        logger.info("  - No rules updated")
        logger.info("  - No model retraining")
        
        # Show initial analytics
        analytics = self.rejection_logger.get_rejection_analytics()
        logger.info(f"  - Analytics: {analytics}")
        
        # Show initial health status
        health = self.feedback_loop.monitor_system_health()
        logger.info(f"  - Health Status: {health['status']}")
    
    def _log_demo_rejections(self) -> List[str]:
        """Log all demo rejections and return their IDs"""
        rejection_ids = []
        
        logger.info("Logging rejections with automatic normalization and tagging...")
        
        for i, rejection in enumerate(self.demo_rejections, 1):
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
            
            logger.info(f"  {i}. Logged rejection {rejection_id} for claim {rejection['claim_id']}")
            logger.info(f"     Expected tag: {rejection['expected_tag']}")
            
            # Small delay to simulate real-time processing
            time.sleep(0.1)
        
        logger.info(f"Total rejections logged: {len(rejection_ids)}")
        return rejection_ids
    
    def _demonstrate_continuous_learning(self, rejection_ids: List[str]):
        """Demonstrate how each rejection contributes to learning"""
        logger.info("Demonstrating continuous learning process...")
        
        # Process rejections one by one to show learning
        for i, rejection_id in enumerate(rejection_ids, 1):
            logger.info(f"\n  Processing rejection {i}/{len(rejection_ids)}...")
            
            # Process the rejection
            result = self.feedback_loop.process_rejection_feedback(rejection_id)
            
            # Show what was learned
            if result.get('rule_updates'):
                logger.info(f"    ✅ Rules updated: {len(result['rule_updates'])}")
                for rule_update in result['rule_updates']:
                    logger.info(f"       - {rule_update['rule_name']}: {rule_update['new_value']}")
            
            if result.get('knowledge_base_updated'):
                logger.info(f"    ✅ Knowledge base updated")
            
            if result.get('model_retrained'):
                logger.info(f"    ✅ Model retrained")
            
            # Show current learning progress
            analytics = self.rejection_logger.get_rejection_analytics()
            logger.info(f"    📊 Progress: {analytics['total_rejections']} rejections processed")
            
            time.sleep(0.2)  # Small delay for demonstration
    
    def _show_system_improvements(self):
        """Show how the system has improved"""
        logger.info("System Improvements After Learning:")
        
        # Get current analytics
        analytics = self.rejection_logger.get_rejection_analytics()
        logger.info(f"  📊 Total rejections learned: {analytics['total_rejections']}")
        logger.info(f"  🔧 Fixable patterns identified: {analytics['fixable_count']}")
        logger.info(f"  🚫 Unclaimable patterns blocked: {analytics['unclaimable_count']}")
        logger.info(f"  📈 Processing efficiency: {analytics.get('processing_efficiency', 0)}%")
        
        # Show pattern analysis
        unclaimable_patterns = self.rejection_logger.get_unclaimable_patterns()
        if unclaimable_patterns:
            logger.info("  🚫 Unclaimable patterns identified:")
            for pattern in unclaimable_patterns:
                logger.info(f"     - {pattern['normalized_reason']}: {pattern['pattern_count']} occurrences")
        
        # Show knowledge base growth
        logger.info("  📚 Knowledge base growth:")
        logger.info(f"     - Templates: Ready to store successful claim templates")
        logger.info(f"     - Edge cases: Ready to store exception patterns")
    
    def _demonstrate_automation(self):
        """Demonstrate automated processing and monitoring"""
        logger.info("Demonstrating automated processing...")
        
        # Show current processing status
        processing_status = self.rejection_logger.get_processing_status()
        logger.info(f"  📋 Processing Status:")
        logger.info(f"     - Total rejections: {processing_status['total_rejections']}")
        logger.info(f"     - Processed: {processing_status['processed']}")
        logger.info(f"     - Unprocessed: {processing_status['unprocessed']}")
        
        # Show processing queue
        if processing_status.get('processing_queue'):
            logger.info(f"  ⏳ Processing Queue:")
            for item in processing_status['processing_queue'][:3]:  # Show first 3
                logger.info(f"     - {item['claim_id']}: {item['feedback_tag']} (Priority: {item['priority']})")
        
        # Demonstrate automated processing
        logger.info("  🤖 Running automated processing...")
        auto_result = self.feedback_loop.auto_process_rejections(max_rejections=10)
        logger.info(f"     - Auto-processed: {auto_result['total_processed']} rejections")
        logger.info(f"     - Alerts generated: {auto_result['alerts_generated']}")
        
        # Show system health monitoring
        logger.info("  🏥 System Health Monitoring:")
        health_status = self.feedback_loop.monitor_system_health()
        logger.info(f"     - Status: {health_status['status']}")
        logger.info(f"     - Alerts: {len(health_status['alerts'])}")
        
        if health_status.get('alerts'):
            for alert in health_status['alerts'][:2]:  # Show first 2 alerts
                logger.info(f"       - {alert['level'].upper()}: {alert['message']}")
    
    def _generate_final_summary(self) -> Dict:
        """Generate comprehensive summary of continuous learning"""
        logger.info("Generating continuous learning summary...")
        
        # Get all system metrics
        analytics = self.rejection_logger.get_rejection_analytics()
        processing_status = self.rejection_logger.get_processing_status()
        health_status = self.feedback_loop.monitor_system_health()
        learning_summary = self.feedback_loop.get_continuous_learning_summary()
        
        summary = {
            'demo_timestamp': datetime.now().isoformat(),
            'continuous_learning_results': {
                'total_rejections_learned': analytics.get('total_rejections', 0),
                'fixable_patterns_identified': analytics.get('fixable_count', 0),
                'unclaimable_patterns_blocked': analytics.get('unclaimable_count', 0),
                'processing_efficiency': analytics.get('processing_efficiency', 0),
                'system_health': health_status.get('status', 'unknown')
            },
            'learning_impact': {
                'rules_ready_for_update': len(self.rejection_logger.get_unclaimable_patterns()),
                'model_retraining_ready': analytics.get('fixable_count', 0) >= 5,
                'knowledge_base_growth': 'Ready for templates and edge cases',
                'automation_status': 'Active and monitoring'
            },
            'system_improvements': {
                'pattern_recognition': 'Enhanced with rejection data',
                'rule_engine': 'Ready for automatic updates',
                'model_accuracy': 'Ready for retraining with fixable rejections',
                'knowledge_management': 'Ready for template and edge case storage'
            },
            'continuous_learning_metrics': learning_summary.get('learning_metrics', {}),
            'next_actions': learning_summary.get('next_actions', []),
            'alerts_and_recommendations': health_status.get('alerts', [])
        }
        
        return summary
    
    def _save_demo_results(self, summary: Dict):
        """Save demo results to file"""
        filename = f"continuous_learning_demo_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        with open(filename, 'w') as f:
            json.dump(summary, f, indent=2, default=str)
        
        logger.info(f"Demo results saved to: {filename}")
    
    def show_continuous_learning_features(self):
        """Show key continuous learning features"""
        features = {
            'automatic_processing': '''
# Automatically process rejections
auto_result = feedback_loop.auto_process_rejections(max_rejections=50)
print(f"Processed: {auto_result['total_processed']}")
print(f"Alerts: {auto_result['alerts_generated']}")
''',
            'health_monitoring': '''
# Monitor system health
health = feedback_loop.monitor_system_health()
print(f"Status: {health['status']}")
for alert in health['alerts']:
    print(f"{alert['level']}: {alert['message']}")
''',
            'learning_summary': '''
# Get continuous learning summary
summary = feedback_loop.get_continuous_learning_summary()
print(f"Rejections learned: {summary['learning_metrics']['total_rejections_learned']}")
print(f"Next actions: {summary['next_actions']}")
''',
            'processing_status': '''
# Check processing status
status = rejection_logger.get_processing_status()
print(f"Processed: {status['processed']}")
print(f"Unprocessed: {status['unprocessed']}")
print(f"Queue: {len(status['processing_queue'])} items")
'''
        }
        
        logger.info("\n🔧 Continuous Learning Features:")
        for title, code in features.items():
            logger.info(f"\n{title.upper()}:")
            logger.info(code)

def main():
    """Main demo function"""
    demo = ContinuousLearningDemo()
    
    # Run the complete continuous learning demo
    summary = demo.run_continuous_learning_demo()
    
    # Show continuous learning features
    demo.show_continuous_learning_features()
    
    # Print final summary
    print("\n" + "="*70)
    print("🎯 CONTINUOUS LEARNING DEMO COMPLETE")
    print("="*70)
    print(f"📊 Continuous Learning Results:")
    print(f"   • Total rejections learned: {summary['continuous_learning_results']['total_rejections_learned']}")
    print(f"   • Fixable patterns identified: {summary['continuous_learning_results']['fixable_patterns_identified']}")
    print(f"   • Unclaimable patterns blocked: {summary['continuous_learning_results']['unclaimable_patterns_blocked']}")
    print(f"   • Processing efficiency: {summary['continuous_learning_results']['processing_efficiency']}%")
    print(f"   • System health: {summary['continuous_learning_results']['system_health']}")
    
    print(f"\n🚀 Learning Impact:")
    print(f"   • Rules ready for update: {summary['learning_impact']['rules_ready_for_update']}")
    print(f"   • Model retraining ready: {summary['learning_impact']['model_retraining_ready']}")
    print(f"   • Knowledge base growth: {summary['learning_impact']['knowledge_base_growth']}")
    print(f"   • Automation status: {summary['learning_impact']['automation_status']}")
    
    if summary['next_actions']:
        print(f"\n💡 Next Actions:")
        for action in summary['next_actions']:
            print(f"   • {action}")
    
    if summary['alerts_and_recommendations']:
        print(f"\n⚠️ Alerts & Recommendations:")
        for alert in summary['alerts_and_recommendations'][:3]:  # Show first 3
            print(f"   • {alert['level'].upper()}: {alert['message']}")
    
    print("\n✅ The Concierge is now continuously learning from every Amazon rejection!")
    print("   Every rejection automatically strengthens the AI system through:")
    print("   • Rule engine updates for unclaimable patterns")
    print("   • Model retraining with fixable rejection data")
    print("   • Knowledge base growth with templates and edge cases")
    print("   • Automated monitoring and alerting")

if __name__ == "__main__":
    main()

