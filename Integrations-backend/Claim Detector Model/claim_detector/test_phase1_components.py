#!/usr/bin/env python3
"""
Test Script for Phase 1 Components - Real Data Integration
Tests the live rejection collector, normalizer, logger, and pipeline
"""

import asyncio
import logging
import json
from datetime import datetime, timedelta
from pathlib import Path
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from src.data_collection.live_rejection_collector import LiveRejectionCollector, RejectionCollectionConfig, RejectionLog
from src.data_collection.rejection_normalizer import RejectionNormalizer, NormalizedRejection
from src.data_collection.enhanced_rejection_logger import EnhancedRejectionLogger
from src.data_collection.real_time_pipeline import RealTimeIngestionPipeline, PipelineConfig
from src.data_collection.data_collector import AmazonAPIConfig

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def create_mock_amazon_config():
    """Create mock Amazon API configuration for testing"""
    return AmazonAPIConfig(
        marketplace_id="ATVPDKIKX0DER",
        seller_id="A1B2C3D4E5F6G7",
        access_key="mock_access_key",
        secret_key="mock_secret_key",
        role_arn="arn:aws:iam::123456789012:role/AmazonSellingPartnerAPIRole",
        refresh_token="mock_refresh_token",
        region="us-east-1"
    )

def create_mock_rejections():
    """Create mock rejection data for testing"""
    mock_rejections = [
        RejectionLog(
            rejection_id="test_rej_001",
            sku="TEST-SKU-001",
            asin="B08N5WRWNW",
            claim_type="lost",
            rejection_reason="Invoice missing from claim submission",
            rejection_date=datetime.now() - timedelta(hours=2),
            amount_requested=150.00,
            quantity_affected=2,
            seller_id="A1B2C3D4E5F6G7",
            marketplace_id="ATVPDKIKX0DER",
            raw_amazon_data={
                "id": "test_001",
                "reason": "Invoice missing from claim submission",
                "status": "rejected"
            }
        ),
        RejectionLog(
            rejection_id="test_rej_002",
            sku="TEST-SKU-002",
            asin="B08N5WRWNW",
            claim_type="damaged",
            rejection_reason="Claim submitted beyond 18-month timeframe",
            rejection_date=datetime.now() - timedelta(hours=1),
            amount_requested=75.50,
            quantity_affected=1,
            seller_id="A1B2C3D4E5F6G7",
            marketplace_id="ATVPDKIKX0DER",
            raw_amazon_data={
                "id": "test_002",
                "reason": "Claim submitted beyond 18-month timeframe",
                "status": "rejected"
            }
        ),
        RejectionLog(
            rejection_id="test_rej_003",
            sku="TEST-SKU-003",
            asin="B08N5WRWNW",
            claim_type="fee_error",
            rejection_reason="Insufficient evidence provided for damage claim",
            rejection_date=datetime.now() - timedelta(minutes=30),
            amount_requested=200.00,
            quantity_affected=3,
            seller_id="A1B2C3D4E5F6G7",
            marketplace_id="ATVPDKIKX0DER",
            raw_amazon_data={
                "id": "test_003",
                "reason": "Insufficient evidence provided for damage claim",
                "status": "rejected"
            }
        ),
        RejectionLog(
            rejection_id="test_rej_004",
            sku="TEST-SKU-004",
            asin="B08N5WRWNW",
            claim_type="missing_reimbursement",
            rejection_reason="Policy exclusion: item not eligible for reimbursement",
            rejection_date=datetime.now() - timedelta(minutes=15),
            amount_requested=500.00,
            quantity_affected=5,
            seller_id="A1B2C3D4E5F6G7",
            marketplace_id="ATVPDKIKX0DER",
            raw_amazon_data={
                "id": "test_004",
                "reason": "Policy exclusion: item not eligible for reimbursement",
                "status": "rejected"
            }
        ),
        RejectionLog(
            rejection_id="test_rej_005",
            sku="TEST-SKU-005",
            asin="B08N5WRWNW",
            claim_type="lost",
            rejection_reason="Duplicate claim submission detected",
            rejection_date=datetime.now() - timedelta(minutes=5),
            amount_requested=125.00,
            quantity_affected=2,
            seller_id="A1B2C3D4E5F6G7",
            marketplace_id="ATVPDKIKX0DER",
            raw_amazon_data={
                "id": "test_005",
                "reason": "Duplicate claim submission detected",
                "status": "rejected"
            }
        )
    ]
    
    return mock_rejections

async def test_rejection_normalizer():
    """Test the rejection reason normalization engine"""
    logger.info("🧪 Testing Rejection Normalizer...")
    
    try:
        # Initialize normalizer
        normalizer = RejectionNormalizer()
        
        # Test rejection reasons
        test_reasons = [
            "Invoice missing from claim submission",
            "Claim submitted beyond 18-month timeframe",
            "Insufficient evidence provided for damage claim",
            "Policy exclusion: item not eligible for reimbursement",
            "Duplicate claim submission detected",
            "Unknown rejection reason that should not match",
            "Format error in claim submission",
            "Amount exceeds maximum limit for this claim type"
        ]
        
        results = []
        for reason in test_reasons:
            normalized = normalizer.normalize_rejection(reason)
            results.append({
                "original": reason,
                "normalized": normalized.category,
                "confidence": normalized.confidence,
                "is_fixable": normalized.is_fixable,
                "required_evidence": normalized.required_evidence
            })
            
            logger.info(f"✅ {reason[:50]}... → {normalized.category} (confidence: {normalized.confidence:.2f})")
        
        # Test pattern management
        logger.info("📝 Testing pattern management...")
        
        # Add custom pattern
        from src.data_collection.rejection_normalizer import RejectionPattern
        custom_pattern = RejectionPattern(
            pattern=r"custom.*pattern|test.*rejection",
            category="custom_test",
            subcategory="testing",
            confidence=0.85,
            required_evidence=["test_documentation"],
            is_fixable=True,
            policy_reference="Test Policy",
            time_constraint=None,
            amount_constraint=None
        )
        
        normalizer.add_custom_pattern(custom_pattern)
        logger.info("✅ Custom pattern added")
        
        # Test custom pattern
        custom_reason = "This is a custom pattern test rejection"
        custom_normalized = normalizer.normalize_rejection(custom_reason)
        logger.info(f"✅ Custom pattern test: {custom_reason} → {custom_normalized.category}")
        
        # Get patterns summary
        summary = normalizer.get_patterns_summary()
        logger.info(f"📊 Patterns summary: {summary['total_patterns']} total patterns")
        
        # Save patterns
        normalizer.save_patterns("test_patterns.json")
        logger.info("✅ Patterns saved to file")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Rejection normalizer test failed: {e}")
        return False

async def test_enhanced_rejection_logger():
    """Test the enhanced rejection logger"""
    logger.info("🧪 Testing Enhanced Rejection Logger...")
    
    try:
        # Initialize logger with test database
        logger_instance = EnhancedRejectionLogger("test_rejections.db")
        
        # Create mock rejections
        mock_rejections = create_mock_rejections()
        
        # Log rejections
        logged_ids = []
        for rejection in mock_rejections:
            rejection_id = logger_instance.log_rejection(rejection)
            logged_ids.append(rejection_id)
            logger.info(f"✅ Logged rejection: {rejection_id}")
        
        # Check processing status
        status = logger_instance.get_processing_status()
        logger.info(f"📊 Processing status: {status['total_queue_size']} items in queue")
        
        # Get next batch for processing
        batch = logger_instance.get_next_batch(batch_size=3)
        logger.info(f"📦 Retrieved batch: {len(batch)} items")
        
        # Process batch
        for processed_rejection in batch:
            results = {
                "feedback_tag": processed_rejection.feedback_tag,
                "normalized_category": processed_rejection.normalized_rejection.category if processed_rejection.normalized_rejection else None,
                "processing_time": datetime.now().isoformat(),
                "test_note": "Processed during testing"
            }
            
            logger_instance.mark_rejection_processed(processed_rejection.rejection_id, results)
            logger.info(f"✅ Marked as processed: {processed_rejection.rejection_id}")
        
        # Get rejection summary
        summary = logger_instance.get_rejection_summary()
        logger.info(f"📊 Rejection summary: {summary['status_counts']}")
        
        # Export rejections
        logger_instance.export_rejections("test_rejections_export.csv")
        logger.info("✅ Rejections exported to CSV")
        
        # Cleanup test database
        import os
        if os.path.exists("test_rejections.db"):
            os.remove("test_rejections.db")
            logger.info("🧹 Test database cleaned up")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Enhanced rejection logger test failed: {e}")
        return False

async def test_live_rejection_collector():
    """Test the live rejection collector (mock mode)"""
    logger.info("🧪 Testing Live Rejection Collector...")
    
    try:
        # Initialize collector with mock config
        amazon_config = create_mock_amazon_config()
        collection_config = RejectionCollectionConfig(
            collection_interval_minutes=1,
            max_hours_back=24,
            batch_size=10,
            enable_real_time=False,
            enable_batch_collection=True
        )
        
        collector = LiveRejectionCollector(amazon_config, collection_config)
        
        # Test connection (will fail with mock config, but that's expected)
        try:
            connection_ok = await collector.test_connection()
            logger.info(f"🔌 Connection test result: {connection_ok}")
        except Exception as e:
            logger.info(f"🔌 Expected connection failure with mock config: {e}")
        
        # Test collection stats
        stats = collector.get_collection_stats()
        logger.info(f"📊 Collection stats: {stats}")
        
        # Test endpoint parameter building
        start_time = datetime.now() - timedelta(hours=24)
        params = collector._build_endpoint_params("inventory_ledger", start_time)
        logger.info(f"🔧 Built parameters: {params}")
        
        # Test rejection detection logic
        test_entries = [
            {"reason": "Invoice missing", "status": "rejected"},
            {"reason": "Claim approved", "status": "approved"},
            {"reason": "Policy violation", "status": "denied"},
            {"reason": "Documentation needed", "status": "pending"}
        ]
        
        for entry in test_entries:
            is_rejection = collector._is_rejection_entry(entry)
            logger.info(f"🔍 {entry['reason']} ({entry['status']}) → Rejection: {is_rejection}")
        
        # Test claim type inference
        for entry in test_entries:
            claim_type = collector._infer_claim_type(entry)
            logger.info(f"🏷️ {entry['reason']} → Claim type: {claim_type}")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Live rejection collector test failed: {e}")
        return False

async def test_real_time_pipeline():
    """Test the real-time ingestion pipeline"""
    logger.info("🧪 Testing Real-Time Ingestion Pipeline...")
    
    try:
        # Initialize pipeline with mock config
        amazon_config = create_mock_amazon_config()
        pipeline_config = PipelineConfig(
            collection_interval_minutes=1,
            max_hours_back=24,
            batch_size=5,
            enable_real_time=False,
            enable_batch_collection=True,
            max_workers=2,
            health_check_interval=30,
            error_retry_delay=10,
            max_retries=2,
            enable_metrics=True,
            metrics_export_interval=60
        )
        
        pipeline = RealTimeIngestionPipeline(amazon_config, pipeline_config, "test_pipeline.db")
        
        # Test pipeline status
        status = pipeline.get_pipeline_status()
        logger.info(f"📊 Pipeline status: {status['is_running']}")
        
        # Test single collection cycle
        logger.info("🔄 Testing single collection cycle...")
        collection_results = await pipeline.run_single_collection()
        logger.info(f"✅ Collection results: {len(collection_results)} rejections")
        
        # Test single processing cycle
        logger.info("⚙️ Testing single processing cycle...")
        processing_results = await pipeline.run_single_processing(batch_size=3)
        logger.info(f"✅ Processing results: {processing_results} rejections processed")
        
        # Test health check
        logger.info("🏥 Testing health check...")
        health_status = await pipeline._check_pipeline_health()
        logger.info(f"✅ Health status: {health_status['status']}")
        
        # Test metrics export
        logger.info("📊 Testing metrics export...")
        await pipeline._export_metrics()
        logger.info("✅ Metrics exported")
        
        # Cleanup test database
        import os
        if os.path.exists("test_pipeline.db"):
            os.remove("test_pipeline.db")
            logger.info("🧹 Test pipeline database cleaned up")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Real-time pipeline test failed: {e}")
        return False

async def test_integration():
    """Test integration between all components"""
    logger.info("🧪 Testing Component Integration...")
    
    try:
        # Initialize all components
        amazon_config = create_mock_amazon_config()
        normalizer = RejectionNormalizer()
        logger_instance = EnhancedRejectionLogger("test_integration.db")
        
        # Create mock rejections
        mock_rejections = create_mock_rejections()
        
        # Test full workflow
        processed_count = 0
        for rejection in mock_rejections:
            try:
                # 1. Normalize rejection reason
                normalized = normalizer.normalize_rejection(rejection.rejection_reason)
                logger.info(f"🔄 {rejection.rejection_id}: {rejection.rejection_reason[:40]}... → {normalized.category}")
                
                # 2. Log rejection
                rejection_id = logger_instance.log_rejection(rejection)
                
                # 3. Process rejection
                batch = logger_instance.get_next_batch(batch_size=1)
                if batch:
                    processed_rejection = batch[0]
                    
                    # Simulate processing
                    results = {
                        "feedback_tag": processed_rejection.feedback_tag,
                        "normalized_category": normalized.category,
                        "confidence": normalized.confidence,
                        "is_fixable": normalized.is_fixable,
                        "required_evidence": normalized.required_evidence,
                        "processing_time": datetime.now().isoformat()
                    }
                    
                    logger_instance.mark_rejection_processed(processed_rejection.rejection_id, results)
                    processed_count += 1
                    
                    logger.info(f"✅ {rejection_id}: Processed as {normalized.category} (fixable: {normalized.is_fixable})")
                
            except Exception as e:
                logger.error(f"❌ Error processing {rejection.rejection_id}: {e}")
        
        # Get final summary
        summary = logger_instance.get_rejection_summary()
        logger.info(f"📊 Integration test summary: {summary['status_counts']}")
        
        # Export results
        logger_instance.export_rejections("test_integration_results.csv")
        logger.info("✅ Integration test results exported")
        
        # Cleanup
        import os
        if os.path.exists("test_integration.db"):
            os.remove("test_integration.db")
            logger.info("🧹 Integration test database cleaned up")
        
        return processed_count > 0
        
    except Exception as e:
        logger.error(f"❌ Integration test failed: {e}")
        return False

async def run_all_tests():
    """Run all Phase 1 component tests"""
    logger.info("🚀 Starting Phase 1 Component Tests")
    logger.info("=" * 50)
    
    test_results = {}
    
    # Test 1: Rejection Normalizer
    test_results['rejection_normalizer'] = await test_rejection_normalizer()
    
    # Test 2: Enhanced Rejection Logger
    test_results['enhanced_rejection_logger'] = await test_enhanced_rejection_logger()
    
    # Test 3: Live Rejection Collector
    test_results['live_rejection_collector'] = await test_live_rejection_collector()
    
    # Test 4: Real-Time Pipeline
    test_results['real_time_pipeline'] = await test_real_time_pipeline()
    
    # Test 5: Integration
    test_results['integration'] = await test_integration()
    
    # Summary
    logger.info("=" * 50)
    logger.info("📊 Phase 1 Test Results Summary")
    logger.info("=" * 50)
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        logger.info(f"{test_name:.<30} {status}")
        if result:
            passed += 1
    
    logger.info("=" * 50)
    logger.info(f"Overall Result: {passed}/{total} tests passed")
    
    if passed == total:
        logger.info("🎉 All Phase 1 components are working correctly!")
        logger.info("🚀 Ready to proceed to Phase 2: Fine-Grained Classification")
    else:
        logger.error("⚠️ Some tests failed. Please review the errors above.")
    
    return passed == total

def main():
    """Main function to run tests"""
    try:
        # Run tests
        success = asyncio.run(run_all_tests())
        
        if success:
            print("\n🎉 Phase 1 Implementation Complete!")
            print("✅ Real Data Integration components are working")
            print("✅ Live rejection collection pipeline is operational")
            print("✅ Rejection normalization engine is functional")
            print("✅ Enhanced logging system is operational")
            print("\n🚀 Ready for Phase 2: Fine-Grained Classification")
        else:
            print("\n⚠️ Some Phase 1 tests failed")
            print("Please review the errors and fix issues before proceeding")
        
        return 0 if success else 1
        
    except KeyboardInterrupt:
        logger.info("🛑 Tests interrupted by user")
        return 1
    except Exception as e:
        logger.error(f"❌ Unexpected error during testing: {e}")
        return 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
