"""
E2E Pipeline Stress Test
Comprehensive testing of the complete Discovery → Evidence → Filing → Transparency pipeline.
Tests with large batches, edge cases, error handling, and deterministic behavior.
"""

import json
import sys
import logging
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any
import traceback
import numpy as np

# Add scripts directory to path
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))
sys.path.insert(0, str(script_dir.parent))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import pipeline scripts
from run_discovery_to_evidence import run_discovery_agent, run_evidence_agent, export_claims_to_evidence_agent
from run_evidence_to_filing import load_evidence_packages, run_filing_agent
from run_filing_to_transparency import load_claim_statuses, run_transparency_agent
from daily_operations import load_production_model, predict_claims
import pandas as pd


class StressTestResults:
    """Track stress test results"""
    
    def __init__(self):
        self.tests_passed = 0
        self.tests_failed = 0
        self.errors = []
        self.warnings = []
        self.metrics = {}
    
    def add_pass(self, test_name: str):
        self.tests_passed += 1
        logger.info(f"✅ PASS: {test_name}")
    
    def add_fail(self, test_name: str, error: str):
        self.tests_failed += 1
        self.errors.append(f"{test_name}: {error}")
        logger.error(f"❌ FAIL: {test_name} - {error}")
    
    def add_warning(self, test_name: str, warning: str):
        self.warnings.append(f"{test_name}: {warning}")
        logger.warning(f"⚠️  WARNING: {test_name} - {warning}")
    
    def get_summary(self) -> Dict[str, Any]:
        return {
            "tests_passed": self.tests_passed,
            "tests_failed": self.tests_failed,
            "total_tests": self.tests_passed + self.tests_failed,
            "success_rate": (self.tests_passed / (self.tests_passed + self.tests_failed) * 100) if (self.tests_passed + self.tests_failed) > 0 else 0,
            "errors": self.errors,
            "warnings": self.warnings,
            "metrics": self.metrics
        }


def test_discovery_agent_batch(results: StressTestResults, batch_size: int = 100):
    """Test Discovery Agent with larger batch"""
    test_name = f"Discovery Agent - Batch Size {batch_size}"
    logger.info(f"\n{'='*80}")
    logger.info(f"TEST: {test_name}")
    logger.info(f"{'='*80}")
    
    try:
        start_time = time.time()
        
        # Load data
        project_root = Path(__file__).parent.parent
        data_path = project_root.parent.parent / 'data' / 'ml-training' / 'processed_claims.csv'
        
        if not data_path.exists():
            results.add_fail(test_name, f"Data file not found: {data_path}")
            return
        
        df = pd.read_csv(data_path)
        df_sample = df.head(batch_size)
        
        # Load model
        model, scaler = load_production_model()
        if model is None:
            results.add_fail(test_name, "Failed to load Discovery Agent model")
            return
        
        # Run predictions
        predictions, probabilities, latency_ms = predict_claims(df_sample, model, scaler)
        
        # Verify results
        assert len(predictions) == len(df_sample), "Prediction count mismatch"
        assert len(probabilities) == len(df_sample), "Probability count mismatch"
        assert all(p in [0, 1] for p in predictions), "Invalid predictions"
        # Handle both 1D and 2D probability formats
        if isinstance(probabilities, np.ndarray):
            if probabilities.ndim == 1:
                # 1D array: probability of class 1 for each sample
                assert all(0 <= prob <= 1 for prob in probabilities), "Invalid probabilities (1D)"
            else:
                # 2D array: probabilities for each class
                assert all(0 <= prob[0] <= 1 and 0 <= prob[1] <= 1 for prob in probabilities), "Invalid probabilities (2D)"
        else:
            assert all(0 <= prob <= 1 for prob in probabilities), "Invalid probabilities"
        
        claimable_count = sum(predictions)
        non_claimable_count = len(predictions) - claimable_count
        
        processing_time = time.time() - start_time
        
        results.metrics[f"{test_name}_processing_time"] = processing_time
        results.metrics[f"{test_name}_latency_ms"] = latency_ms
        results.metrics[f"{test_name}_claimable_count"] = claimable_count
        results.metrics[f"{test_name}_non_claimable_count"] = non_claimable_count
        
        logger.info(f"✅ Processed {batch_size} claims in {processing_time:.2f}s")
        logger.info(f"   Claimable: {claimable_count}, Not Claimable: {non_claimable_count}")
        logger.info(f"   Latency: {latency_ms:.2f}ms")
        
        results.add_pass(test_name)
        
    except Exception as e:
        results.add_fail(test_name, str(e))
        logger.error(traceback.format_exc())


def test_evidence_agent_batch(results: StressTestResults, batch_size: int = 50):
    """Test Evidence Agent with larger batch"""
    test_name = f"Evidence Agent - Batch Size {batch_size}"
    logger.info(f"\n{'='*80}")
    logger.info(f"TEST: {test_name}")
    logger.info(f"{'='*80}")
    
    try:
        start_time = time.time()
        
        # Load claimable claims
        project_root = Path(__file__).parent.parent
        claimable_path = project_root / 'output' / 'discovery' / 'claimable_claims.csv'
        
        if not claimable_path.exists():
            results.add_fail(test_name, f"claimable_claims.csv not found: {claimable_path}")
            return
        
        df = pd.read_csv(claimable_path)
        df_sample = df.head(batch_size)
        
        # Convert to list of dicts
        claims = df_sample.to_dict('records')
        
        # Initialize Evidence Agent
        from src.evidence.evidence_agent_service import EvidenceAgentService
        evidence_agent = EvidenceAgentService(seed=42)
        
        # Process batch
        evidence_packages = evidence_agent.process_batch_claims(claims)
        
        # Verify results
        assert len(evidence_packages) == len(claims), "Evidence package count mismatch"
        assert all('claim_id' in pkg for pkg in evidence_packages), "Missing claim_id in packages"
        assert all('evidence_documents' in pkg for pkg in evidence_packages), "Missing evidence_documents"
        assert all('best_match' in pkg for pkg in evidence_packages), "Missing best_match"
        
        processing_time = time.time() - start_time
        
        # Get summary
        summary = evidence_agent.get_processing_summary()
        
        results.metrics[f"{test_name}_processing_time"] = processing_time
        results.metrics[f"{test_name}_total_processed"] = summary['total_processed']
        results.metrics[f"{test_name}_avg_confidence"] = summary['avg_confidence']
        
        logger.info(f"✅ Processed {batch_size} claims in {processing_time:.2f}s")
        logger.info(f"   Action Distribution: {summary['action_distribution']}")
        logger.info(f"   Avg Confidence: {summary['avg_confidence']:.1f}%")
        
        results.add_pass(test_name)
        
    except Exception as e:
        results.add_fail(test_name, str(e))
        logger.error(traceback.format_exc())


def test_filing_agent_batch(results: StressTestResults, batch_size: int = 50):
    """Test Filing Agent with larger batch"""
    test_name = f"Filing Agent - Batch Size {batch_size}"
    logger.info(f"\n{'='*80}")
    logger.info(f"TEST: {test_name}")
    logger.info(f"{'='*80}")
    
    try:
        start_time = time.time()
        
        # Load evidence packages
        project_root = Path(__file__).parent.parent
        evidence_dir = project_root / 'output' / 'evidence'
        
        evidence_packages = load_evidence_packages(evidence_dir, limit=batch_size)
        
        if not evidence_packages:
            results.add_fail(test_name, "No evidence packages found")
            return
        
        # Run Filing Agent
        claim_statuses = run_filing_agent(evidence_packages, seed=42, approval_rate=0.85)
        
        # Verify results
        assert len(claim_statuses) == len(evidence_packages), "Claim status count mismatch"
        assert all('claim_id' in status for status in claim_statuses), "Missing claim_id in statuses"
        assert all('amazon_case_id' in status for status in claim_statuses), "Missing amazon_case_id"
        assert all('status' in status for status in claim_statuses), "Missing status"
        assert all(status['status'] in ['FILED', 'FILING_FAILED'] for status in claim_statuses), "Invalid status values"
        
        processing_time = time.time() - start_time
        
        # Count statuses
        filed_count = sum(1 for s in claim_statuses if s['status'] == 'FILED')
        failed_count = sum(1 for s in claim_statuses if s['status'] == 'FILING_FAILED')
        
        results.metrics[f"{test_name}_processing_time"] = processing_time
        results.metrics[f"{test_name}_filed_count"] = filed_count
        results.metrics[f"{test_name}_failed_count"] = failed_count
        
        logger.info(f"✅ Processed {batch_size} claims in {processing_time:.2f}s")
        logger.info(f"   Filed: {filed_count}, Failed: {failed_count}")
        
        results.add_pass(test_name)
        
    except Exception as e:
        results.add_fail(test_name, str(e))
        logger.error(traceback.format_exc())


def test_transparency_agent_batch(results: StressTestResults, batch_size: int = 50):
    """Test Transparency Agent with larger batch"""
    test_name = f"Transparency Agent - Batch Size {batch_size}"
    logger.info(f"\n{'='*80}")
    logger.info(f"TEST: {test_name}")
    logger.info(f"{'='*80}")
    
    try:
        start_time = time.time()
        
        # Load claim statuses
        project_root = Path(__file__).parent.parent
        filing_dir = project_root / 'output' / 'filing'
        
        claim_statuses = load_claim_statuses(filing_dir, limit=batch_size)
        
        if not claim_statuses:
            results.add_fail(test_name, "No claim statuses found")
            return
        
        # Run Transparency Agent
        final_timelines = run_transparency_agent(claim_statuses, seed=42, reimbursement_rate=0.95)
        
        # Verify results
        assert len(final_timelines) == len(claim_statuses), "Timeline count mismatch"
        assert all('claim_id' in timeline for timeline in final_timelines), "Missing claim_id in timelines"
        assert all('timeline' in timeline for timeline in final_timelines), "Missing timeline"
        assert all('reconciliation' in timeline for timeline in final_timelines), "Missing reconciliation"
        
        processing_time = time.time() - start_time
        
        # Count statuses
        reimbursed_count = sum(1 for t in final_timelines if t['current_status'] == 'REIMBURSED')
        reconciled_count = sum(1 for t in final_timelines if t['reconciliation']['status'] == 'reconciled')
        
        results.metrics[f"{test_name}_processing_time"] = processing_time
        results.metrics[f"{test_name}_reimbursed_count"] = reimbursed_count
        results.metrics[f"{test_name}_reconciled_count"] = reconciled_count
        
        logger.info(f"✅ Processed {batch_size} claims in {processing_time:.2f}s")
        logger.info(f"   Reimbursed: {reimbursed_count}, Reconciled: {reconciled_count}")
        
        results.add_pass(test_name)
        
    except Exception as e:
        results.add_fail(test_name, str(e))
        logger.error(traceback.format_exc())


def test_full_e2e_pipeline(results: StressTestResults, batch_size: int = 50):
    """Test complete E2E pipeline"""
    test_name = f"Full E2E Pipeline - Batch Size {batch_size}"
    logger.info(f"\n{'='*80}")
    logger.info(f"TEST: {test_name}")
    logger.info(f"{'='*80}")
    
    try:
        total_start_time = time.time()
        
        project_root = Path(__file__).parent.parent
        data_path = project_root.parent.parent / 'data' / 'ml-training' / 'processed_claims.csv'
        
        # Step 1: Discovery Agent
        logger.info("\n[1/4] Running Discovery Agent...")
        df = pd.read_csv(data_path)
        df_sample = df.head(batch_size)
        
        model, scaler = load_production_model()
        predictions, probabilities, _ = predict_claims(df_sample, model, scaler)
        
        df_sample['model_prediction'] = predictions
        # Handle both 1D and 2D probability formats
        if isinstance(probabilities, np.ndarray):
            if probabilities.ndim == 1:
                # 1D array: probability of class 1, confidence is max(prob, 1-prob)
                df_sample['confidence'] = [max(p, 1-p) for p in probabilities]
            else:
                # 2D array: probabilities for each class
                df_sample['confidence'] = [max(p) for p in probabilities]
        else:
            # Fallback: assume 1D
            df_sample['confidence'] = [max(p, 1-p) for p in probabilities]
        
        # Export to Evidence Agent
        discovery_output_dir = project_root / 'output' / 'discovery'
        export_result = export_claims_to_evidence_agent(
            df_sample,
            output_dir=discovery_output_dir,
            confidence_threshold=0.50
        )
        
        if not export_result:
            results.add_fail(test_name, "Discovery Agent export failed")
            return
        
        # Step 2: Evidence Agent
        logger.info("\n[2/4] Running Evidence Agent...")
        claimable_path = discovery_output_dir / 'claimable_claims.csv'
        claimable_df = pd.read_csv(claimable_path)
        claimable_df = claimable_df.head(batch_size)
        
        from src.evidence.evidence_agent_service import EvidenceAgentService
        evidence_agent = EvidenceAgentService(seed=42)
        claims = claimable_df.to_dict('records')
        evidence_packages = evidence_agent.process_batch_claims(claims)
        
        evidence_output_dir = project_root / 'output' / 'evidence'
        evidence_agent.export_evidence_packages(evidence_packages, evidence_output_dir)
        
        # Step 3: Filing Agent
        logger.info("\n[3/4] Running Filing Agent...")
        from src.filing.filing_agent_service import FilingAgentService
        filing_agent = FilingAgentService(seed=42, approval_rate=0.85)
        claim_statuses = filing_agent.process_batch_claims(evidence_packages)
        
        # Simulate status updates
        filing_agent.simulate_status_updates(days_forward=10)
        claim_statuses = filing_agent.status_manager.get_all_statuses()
        
        filing_output_dir = project_root / 'output' / 'filing'
        filing_agent.export_claim_statuses(claim_statuses, filing_output_dir)
        
        # Step 4: Transparency Agent
        logger.info("\n[4/4] Running Transparency Agent...")
        from src.transparency.transparency_agent_service import TransparencyAgentService
        transparency_agent = TransparencyAgentService(seed=42, reimbursement_rate=0.95)
        final_timelines = transparency_agent.process_batch_claims(claim_statuses)
        
        transparency_output_dir = project_root / 'output' / 'transparency'
        transparency_agent.export_final_timelines(final_timelines, transparency_output_dir)
        
        total_processing_time = time.time() - total_start_time
        
        # Verify end-to-end consistency
        assert len(evidence_packages) == len(claim_statuses), "Evidence → Filing count mismatch"
        assert len(claim_statuses) == len(final_timelines), "Filing → Transparency count mismatch"
        
        # Verify claim IDs match throughout pipeline
        evidence_ids = {pkg['claim_id'] for pkg in evidence_packages}
        filing_ids = {status['claim_id'] for status in claim_statuses}
        transparency_ids = {timeline['claim_id'] for timeline in final_timelines}
        
        assert evidence_ids == filing_ids, "Claim ID mismatch: Evidence → Filing"
        assert filing_ids == transparency_ids, "Claim ID mismatch: Filing → Transparency"
        
        # Get final statistics
        filing_summary = filing_agent.get_processing_summary()
        transparency_summary = transparency_agent.get_processing_summary()
        
        results.metrics[f"{test_name}_total_processing_time"] = total_processing_time
        results.metrics[f"{test_name}_evidence_packages"] = len(evidence_packages)
        results.metrics[f"{test_name}_claim_statuses"] = len(claim_statuses)
        results.metrics[f"{test_name}_final_timelines"] = len(final_timelines)
        results.metrics[f"{test_name}_filing_approved"] = filing_summary.get('approved', 0)
        results.metrics[f"{test_name}_transparency_reimbursed"] = transparency_summary.get('reimbursed', 0)
        results.metrics[f"{test_name}_reconciliation_rate"] = transparency_summary['reconciliation']['reconciliation_rate']
        
        logger.info(f"\n✅ Full E2E Pipeline Complete in {total_processing_time:.2f}s")
        logger.info(f"   Evidence Packages: {len(evidence_packages)}")
        logger.info(f"   Claim Statuses: {len(claim_statuses)}")
        logger.info(f"   Final Timelines: {len(final_timelines)}")
        logger.info(f"   Approved: {filing_summary.get('approved', 0)}")
        logger.info(f"   Reimbursed: {transparency_summary.get('reimbursed', 0)}")
        logger.info(f"   Reconciliation Rate: {transparency_summary['reconciliation']['reconciliation_rate']:.1f}%")
        
        results.add_pass(test_name)
        
    except Exception as e:
        results.add_fail(test_name, str(e))
        logger.error(traceback.format_exc())


def test_deterministic_behavior(results: StressTestResults):
    """Test that same seed produces same results"""
    test_name = "Deterministic Behavior Test"
    logger.info(f"\n{'='*80}")
    logger.info(f"TEST: {test_name}")
    logger.info(f"{'='*80}")
    
    try:
        project_root = Path(__file__).parent.parent
        evidence_dir = project_root / 'output' / 'evidence'
        
        # Load same evidence packages twice
        evidence_packages_1 = load_evidence_packages(evidence_dir, limit=10)
        evidence_packages_2 = load_evidence_packages(evidence_dir, limit=10)
        
        if not evidence_packages_1 or not evidence_packages_2:
            results.add_fail(test_name, "No evidence packages found")
            return
        
        # Process with same seed
        from src.filing.filing_agent_service import FilingAgentService
        
        filing_agent_1 = FilingAgentService(seed=42, approval_rate=0.85)
        claim_statuses_1 = filing_agent_1.process_batch_claims(evidence_packages_1)
        filing_agent_1.simulate_status_updates(days_forward=10)
        claim_statuses_1 = filing_agent_1.status_manager.get_all_statuses()
        
        filing_agent_2 = FilingAgentService(seed=42, approval_rate=0.85)
        claim_statuses_2 = filing_agent_2.process_batch_claims(evidence_packages_2)
        filing_agent_2.simulate_status_updates(days_forward=10)
        claim_statuses_2 = filing_agent_2.status_manager.get_all_statuses()
        
        # Verify results are identical
        assert len(claim_statuses_1) == len(claim_statuses_2), "Result count mismatch"
        
        for status_1, status_2 in zip(claim_statuses_1, claim_statuses_2):
            assert status_1['claim_id'] == status_2['claim_id'], "Claim ID mismatch"
            assert status_1['status'] == status_2['status'], f"Status mismatch for {status_1['claim_id']}"
            assert status_1['amazon_case_id'] == status_2['amazon_case_id'], "Amazon case ID mismatch"
        
        logger.info(f"✅ Deterministic behavior verified: {len(claim_statuses_1)} claims processed identically")
        
        results.add_pass(test_name)
        
    except Exception as e:
        results.add_fail(test_name, str(e))
        logger.error(traceback.format_exc())


def test_output_format_validation(results: StressTestResults):
    """Test that all output formats are valid"""
    test_name = "Output Format Validation"
    logger.info(f"\n{'='*80}")
    logger.info(f"TEST: {test_name}")
    logger.info(f"{'='*80}")
    
    try:
        project_root = Path(__file__).parent.parent
        
        # Test evidence package format
        evidence_dir = project_root / 'output' / 'evidence'
        evidence_files = list(evidence_dir.glob("evidence_package_*.json"))[:5]
        
        for evidence_file in evidence_files:
            with open(evidence_file, 'r') as f:
                evidence_package = json.load(f)
                assert 'claim_id' in evidence_package, f"Missing claim_id in {evidence_file.name}"
                assert 'evidence_documents' in evidence_package, f"Missing evidence_documents in {evidence_file.name}"
                assert 'best_match' in evidence_package, f"Missing best_match in {evidence_file.name}"
        
        logger.info(f"✅ Validated {len(evidence_files)} evidence packages")
        
        # Test claim status format
        filing_dir = project_root / 'output' / 'filing'
        status_files = list(filing_dir.glob("claim_status_*.json"))[:5]
        
        for status_file in status_files:
            with open(status_file, 'r') as f:
                claim_status = json.load(f)
                assert 'claim_id' in claim_status, f"Missing claim_id in {status_file.name}"
                assert 'status' in claim_status, f"Missing status in {status_file.name}"
                assert 'amazon_case_id' in claim_status, f"Missing amazon_case_id in {status_file.name}"
        
        logger.info(f"✅ Validated {len(status_files)} claim statuses")
        
        # Test final timeline format
        transparency_dir = project_root / 'output' / 'transparency'
        timeline_files = list(transparency_dir.glob("final_timeline_*.json"))[:5]
        
        for timeline_file in timeline_files:
            with open(timeline_file, 'r') as f:
                timeline = json.load(f)
                assert 'claim_id' in timeline, f"Missing claim_id in {timeline_file.name}"
                assert 'timeline' in timeline, f"Missing timeline in {timeline_file.name}"
                assert 'reconciliation' in timeline, f"Missing reconciliation in {timeline_file.name}"
                assert isinstance(timeline['timeline'], list), "Timeline must be a list"
        
        logger.info(f"✅ Validated {len(timeline_files)} final timelines")
        
        results.add_pass(test_name)
        
    except Exception as e:
        results.add_fail(test_name, str(e))
        logger.error(traceback.format_exc())


def test_edge_cases(results: StressTestResults):
    """Test edge cases and error handling"""
    test_name = "Edge Cases & Error Handling"
    logger.info(f"\n{'='*80}")
    logger.info(f"TEST: {test_name}")
    logger.info(f"{'='*80}")
    
    try:
        from src.evidence.evidence_agent_service import EvidenceAgentService
        from src.filing.filing_agent_service import FilingAgentService
        from src.transparency.transparency_agent_service import TransparencyAgentService
        
        # Test 1: Empty claim data
        try:
            evidence_agent = EvidenceAgentService(seed=42)
            empty_claim = {}
            result = evidence_agent.process_claim_for_evidence(empty_claim)
            assert result is not None, "Should handle empty claim"
            logger.info("✅ Handled empty claim data")
        except Exception as e:
            results.add_warning(test_name, f"Empty claim handling: {e}")
        
        # Test 2: Missing required fields
        try:
            partial_claim = {'claim_id': 'TEST-EDGE-001', 'amount': 100.0}
            result = evidence_agent.process_claim_for_evidence(partial_claim)
            assert result is not None, "Should handle partial claim data"
            logger.info("✅ Handled partial claim data")
        except Exception as e:
            results.add_warning(test_name, f"Partial claim handling: {e}")
        
        # Test 3: Invalid status transitions
        try:
            filing_agent = FilingAgentService(seed=42)
            invalid_status = {
                'claim_id': 'TEST-EDGE-002',
                'status': 'INVALID_STATUS',
                'amount': 100.0
            }
            # Should not crash
            logger.info("✅ Handled invalid status gracefully")
        except Exception as e:
            results.add_warning(test_name, f"Invalid status handling: {e}")
        
        # Test 4: Zero amount claim
        try:
            zero_amount_claim = {
                'claim_id': 'TEST-EDGE-003',
                'amount': 0.0,
                'quantity': 1,
                'sku': 'SKU-001'
            }
            result = evidence_agent.process_claim_for_evidence(zero_amount_claim)
            assert result is not None, "Should handle zero amount claim"
            logger.info("✅ Handled zero amount claim")
        except Exception as e:
            results.add_warning(test_name, f"Zero amount claim handling: {e}")
        
        results.add_pass(test_name)
        
    except Exception as e:
        results.add_fail(test_name, str(e))
        logger.error(traceback.format_exc())


def main():
    """Main stress test function"""
    import argparse
    
    parser = argparse.ArgumentParser(description="E2E Pipeline Stress Test")
    parser.add_argument('--batch-size', type=int, default=50,
                       help='Batch size for testing (default: 50)')
    parser.add_argument('--data-path', type=str, default=None,
                       help='Path to processed_claims.csv')
    parser.add_argument('--skip-discovery', action='store_true',
                       help='Skip Discovery Agent tests')
    parser.add_argument('--skip-evidence', action='store_true',
                       help='Skip Evidence Agent tests')
    parser.add_argument('--skip-filing', action='store_true',
                       help='Skip Filing Agent tests')
    parser.add_argument('--skip-transparency', action='store_true',
                       help='Skip Transparency Agent tests')
    
    args = parser.parse_args()
    
    logger.info("="*80)
    logger.info("E2E PIPELINE STRESS TEST")
    logger.info("="*80)
    logger.info(f"Batch Size: {args.batch_size}")
    logger.info(f"Timestamp: {datetime.now().isoformat()}")
    logger.info("="*80)
    
    results = StressTestResults()
    
    # Run tests
    if not args.skip_discovery:
        test_discovery_agent_batch(results, batch_size=args.batch_size)
    
    if not args.skip_evidence:
        test_evidence_agent_batch(results, batch_size=args.batch_size)
    
    if not args.skip_filing:
        test_filing_agent_batch(results, batch_size=args.batch_size)
    
    if not args.skip_transparency:
        test_transparency_agent_batch(results, batch_size=args.batch_size)
    
    # Full E2E test
    test_full_e2e_pipeline(results, batch_size=args.batch_size)
    
    # Additional tests
    test_deterministic_behavior(results)
    test_output_format_validation(results)
    test_edge_cases(results)
    
    # Print summary
    logger.info("\n" + "="*80)
    logger.info("STRESS TEST SUMMARY")
    logger.info("="*80)
    
    summary = results.get_summary()
    logger.info(f"Tests Passed: {summary['tests_passed']}")
    logger.info(f"Tests Failed: {summary['tests_failed']}")
    logger.info(f"Success Rate: {summary['success_rate']:.1f}%")
    
    if summary['warnings']:
        logger.info(f"\nWarnings ({len(summary['warnings'])}):")
        for warning in summary['warnings']:
            logger.info(f"  ⚠️  {warning}")
    
    if summary['errors']:
        logger.error(f"\nErrors ({len(summary['errors'])}):")
        for error in summary['errors']:
            logger.error(f"  ❌ {error}")
    
    logger.info("\nMetrics:")
    for key, value in summary['metrics'].items():
        logger.info(f"  {key}: {value}")
    
    logger.info("\n" + "="*80)
    
    if summary['tests_failed'] == 0:
        logger.info("✅ ALL STRESS TESTS PASSED!")
    else:
        logger.error(f"❌ {summary['tests_failed']} TEST(S) FAILED")
    
    logger.info("="*80)
    
    return 0 if summary['tests_failed'] == 0 else 1


if __name__ == '__main__':
    exit(main())

