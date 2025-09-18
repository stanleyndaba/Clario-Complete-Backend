#!/usr/bin/env python3
"""
Stress Testing Script for Evidence Validator with ACG Integration
Tests the complete pipeline from EV validation to ACG filing
"""
import argparse
import json
import logging
import time
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.ev.service import EvidenceValidatorService
from src.acg.service import AutoClaimsGeneratorService

# Optional database imports
try:
    from src.database import get_db, ClaimCRUD, ValidationCRUD, FilingCRUD
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False
    get_db = None
    ClaimCRUD = None
    ValidationCRUD = None
    FilingCRUD = None

logger = logging.getLogger(__name__)

class StressTestEVWithACG:
    """Stress testing class for EV + ACG integration"""
    
    def __init__(self, max_claims: int = 100, strict_mode: bool = False, 
                 use_mock_sp_api: bool = True, ev_model_path: Optional[str] = None):
        """
        Initialize stress testing
        
        Args:
            max_claims: Maximum number of claims to process
            strict_mode: Use strict validation rules
            use_mock_sp_api: Use mock SP-API instead of real integration
            ev_model_path: Path to EV ML model (optional)
        """
        self.max_claims = max_claims
        self.strict_mode = strict_mode
        self.use_mock_sp_api = use_mock_sp_api
        self.ev_model_path = ev_model_path
        
        # Initialize services
        self.ev_service = EvidenceValidatorService(ml_model_path=ev_model_path)
        self.acg_service = AutoClaimsGeneratorService(
            use_mock_sp_api=use_mock_sp_api,
            ev_model_path=ev_model_path
        )
        
        # Results tracking
        self.results = {
            'start_time': None,
            'end_time': None,
            'total_claims': 0,
            'ev_results': {
                'valid': 0,
                'invalid': 0,
                'review': 0,
                'errors': 0
            },
            'acg_results': {
                'filed': 0,
                'rejected': 0,
                'review': 0,
                'errors': 0
            },
            'detailed_results': [],
            'performance_metrics': {}
        }
        
        logger.info(f"Stress test initialized: max_claims={max_claims}, strict={strict_mode}")
    
    def load_test_data(self) -> List[Dict[str, Any]]:
        """Load test data from database or fixtures"""
        if not DATABASE_AVAILABLE:
            logger.warning("Database not available, using fixtures or synthetic data")
        
        try:
            # Try to load from database first
            if DATABASE_AVAILABLE:
                db = next(get_db())
                claims = ClaimCRUD.get_claims_for_validation(db, limit=self.max_claims)
                
                if claims:
                    logger.info(f"Loaded {len(claims)} claims from database")
                    return claims
            
        except Exception as e:
            logger.warning(f"Could not load from database: {e}")
        
        # Load from fixtures
        fixtures_path = Path("data/test_claims_fixtures.json")
        if fixtures_path.exists():
            with open(fixtures_path, 'r') as f:
                claims = json.load(f)
                logger.info(f"Loaded {len(claims)} claims from fixtures")
                return claims[:self.max_claims]
        
        # Generate synthetic data
        logger.info("Generating synthetic test data")
        return self._generate_synthetic_data()
    
    def _generate_synthetic_data(self) -> List[Dict[str, Any]]:
        """Generate synthetic test data"""
        claims = []
        
        for i in range(self.max_claims):
            claim_id = f"CLM-{i+1:06d}"
            
            # Generate claim metadata
            metadata = {
                'claim_id': claim_id,
                'seller_id': f"SELLER-{i % 10 + 1:03d}",
                'shipment_id': f"SHIP-{i+1:06d}",
                'sku': f"SKU-{i+1:06d}",
                'asin': f"B0{i+1:08d}",
                'claim_type': ['lost_inventory', 'damaged_goods', 'fee_error'][i % 3],
                'amount': round(10.0 + (i * 5.5), 2),
                'quantity': i % 10 + 1,
                'marketplace': ['US', 'CA', 'UK'][i % 3],
                'claim_date': datetime.now().isoformat(),
                'description': f"Test claim {i+1} for stress testing"
            }
            
            # Generate documents
            documents = self._generate_synthetic_documents(i)
            
            claims.append({
                'claim_id': claim_id,
                'metadata': metadata,
                'documents': documents
            })
        
        return claims
    
    def _generate_synthetic_documents(self, claim_index: int) -> List[Dict[str, Any]]:
        """Generate synthetic documents for a claim"""
        documents = []
        
        # Generate invoice
        invoice = {
            'metadata': {
                'document_type': 'invoice',
                'document_date': datetime.now().isoformat(),
                'file_path': f'/tmp/invoice_{claim_index}.pdf',
                'file_size_mb': 2.5,
                'file_quality': 0.9,
                'hash': f'hash_invoice_{claim_index}',
                'hash_verified': True,
                'shipment_id': f"SHIP-{claim_index+1:06d}",
                'quantity': claim_index % 10 + 1,
                'amount': round(10.0 + (claim_index * 5.5), 2)
            },
            'extracted_text': self._generate_synthetic_text('invoice', claim_index)
        }
        documents.append(invoice)
        
        # Generate shipping document
        shipping = {
            'metadata': {
                'document_type': 'shipping_label',
                'document_date': datetime.now().isoformat(),
                'file_path': f'/tmp/shipping_{claim_index}.pdf',
                'file_size_mb': 1.8,
                'file_quality': 0.85,
                'hash': f'hash_shipping_{claim_index}',
                'hash_verified': True,
                'shipment_id': f"SHIP-{claim_index+1:06d}"
            },
            'extracted_text': self._generate_synthetic_text('shipping', claim_index)
        }
        documents.append(shipping)
        
        return documents
    
    def _generate_synthetic_text(self, doc_type: str, claim_index: int) -> str:
        """Generate synthetic document text"""
        if doc_type == 'invoice':
            return f"""
INVOICE
Invoice #: INV-{claim_index+1:06d}
Date: {datetime.now().strftime('%m/%d/%Y')}
Shipment ID: SHIP-{claim_index+1:06d}
SKU: SKU-{claim_index+1:06d}
Quantity: {claim_index % 10 + 1}
Unit Price: ${round(10.0 + (claim_index * 5.5), 2)}
Total Amount: ${round((10.0 + (claim_index * 5.5)) * (claim_index % 10 + 1), 2)}
            """.strip()
        else:
            return f"""
SHIPPING LABEL
Tracking #: TRK-{claim_index+1:06d}
Shipment ID: SHIP-{claim_index+1:06d}
Destination: Test Address {claim_index+1}
Weight: {claim_index % 5 + 1} lbs
Service: Standard Shipping
            """.strip()
    
    def run_stress_test(self) -> Dict[str, Any]:
        """Run the complete stress test"""
        logger.info("Starting EV + ACG stress test")
        self.results['start_time'] = datetime.now().isoformat()
        
        # Load test data
        claims = self.load_test_data()
        self.results['total_claims'] = len(claims)
        
        logger.info(f"Processing {len(claims)} claims")
        
        # Process each claim
        for i, claim in enumerate(claims):
            try:
                logger.info(f"Processing claim {i+1}/{len(claims)}: {claim['claim_id']}")
                
                # Step 1: EV Validation
                ev_result = self.ev_service.validate_claim(claim)
                self._record_ev_result(ev_result)
                
                # Step 2: ACG Processing (only if EV passes)
                if ev_result.status == 'valid':
                    acg_result = self.acg_service.process_claim(claim)
                    self._record_acg_result(acg_result)
                else:
                    # Record ACG skip
                    self.results['acg_results']['rejected'] += 1
                    acg_result = None
                
                # Record detailed result
                self._record_detailed_result(claim, ev_result, acg_result)
                
            except Exception as e:
                logger.error(f"Error processing claim {claim['claim_id']}: {e}")
                self.results['ev_results']['errors'] += 1
                self.results['acg_results']['errors'] += 1
        
        # Calculate final statistics
        self.results['end_time'] = datetime.now().isoformat()
        self._calculate_final_stats()
        
        logger.info("Stress test completed")
        return self.results
    
    def _record_ev_result(self, ev_result):
        """Record EV validation result"""
        if ev_result.status == 'valid':
            self.results['ev_results']['valid'] += 1
        elif ev_result.status == 'invalid':
            self.results['ev_results']['invalid'] += 1
        elif ev_result.status == 'review':
            self.results['ev_results']['review'] += 1
    
    def _record_acg_result(self, acg_result):
        """Record ACG filing result"""
        if acg_result.success:
            self.results['acg_results']['filed'] += 1
        elif acg_result.status == 'rejected':
            self.results['acg_results']['rejected'] += 1
        elif acg_result.status == 'review':
            self.results['acg_results']['review'] += 1
    
    def _record_detailed_result(self, claim: Dict[str, Any], ev_result, acg_result):
        """Record detailed result for a claim"""
        result = {
            'claim_id': claim['claim_id'],
            'ev_status': ev_result.status,
            'ev_confidence': ev_result.final_confidence,
            'ev_ml_score': ev_result.ml_score,
            'acg_status': acg_result.status if acg_result else 'skipped',
            'acg_success': acg_result.success if acg_result else False,
            'amazon_case_id': acg_result.amazon_case_id if acg_result else None,
            'timestamp': datetime.now().isoformat()
        }
        self.results['detailed_results'].append(result)
    
    def _calculate_final_stats(self):
        """Calculate final performance statistics"""
        start_time = datetime.fromisoformat(self.results['start_time'])
        end_time = datetime.fromisoformat(self.results['end_time'])
        processing_time = (end_time - start_time).total_seconds()
        
        total_claims = self.results['total_claims']
        
        self.results['performance_metrics'] = {
            'total_processing_time_seconds': processing_time,
            'claims_per_second': total_claims / processing_time if processing_time > 0 else 0,
            'ev_pass_rate': (self.results['ev_results']['valid'] / total_claims * 100) if total_claims > 0 else 0,
            'ev_rejection_rate': (self.results['ev_results']['invalid'] / total_claims * 100) if total_claims > 0 else 0,
            'ev_review_rate': (self.results['ev_results']['review'] / total_claims * 100) if total_claims > 0 else 0,
            'acg_filing_rate': (self.results['acg_results']['filed'] / total_claims * 100) if total_claims > 0 else 0,
            'acg_rejection_rate': (self.results['acg_results']['rejected'] / total_claims * 100) if total_claims > 0 else 0,
            'pipeline_efficiency': (self.results['acg_results']['filed'] / self.results['ev_results']['valid'] * 100) if self.results['ev_results']['valid'] > 0 else 0
        }
    
    def save_results(self, output_file: Optional[str] = None):
        """Save results to file and optionally database"""
        # Save to file
        if not output_file:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_file = f"stress_test_results_ev_acg_{timestamp}.json"
        
        with open(output_file, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        logger.info(f"Results saved to {output_file}")
        
        # Save to database if available
        self._save_to_database()
    
    def _save_to_database(self):
        """Save results to database"""
        if not DATABASE_AVAILABLE:
            logger.warning("Database not available, skipping database save")
            return
            
        try:
            db = next(get_db())
            
            # Save validation results
            for result in self.results['detailed_results']:
                validation_data = {
                    'validation_id': f"stress_test_{result['claim_id']}",
                    'claim_id': result['claim_id'],
                    'status': result['ev_status'],
                    'rules_passed': [],  # Would need to get from actual validation
                    'rules_failed': [],
                    'ml_score': result['ev_ml_score'],
                    'final_confidence': result['ev_confidence'],
                    'validation_details': {
                        'stress_test': True,
                        'strict_mode': self.strict_mode
                    },
                    'timestamp': result['timestamp']
                }
                
                ValidationCRUD.create_validation(db, validation_data)
                
                # Save filing result if available
                if result['acg_status'] != 'skipped':
                    filing_data = {
                        'filing_id': f"stress_test_{result['claim_id']}",
                        'claim_id': result['claim_id'],
                        'amazon_case_id': result['amazon_case_id'],
                        'status': result['acg_status'],
                        'success': result['acg_success'],
                        'validation_id': validation_data['validation_id'],
                        'timestamp': result['timestamp']
                    }
                    
                    FilingCRUD.create_filing(db, filing_data)
                    
        except Exception as e:
            logger.error(f"Error saving to database: {e}")
    
    def print_summary(self):
        """Print summary of stress test results"""
        metrics = self.results['performance_metrics']
        
        print("\n" + "=" * 60)
        print("EV + ACG STRESS TEST SUMMARY")
        print("=" * 60)
        print(f"Total Claims Processed: {self.results['total_claims']}")
        print(f"Processing Time: {metrics['total_processing_time_seconds']:.2f} seconds")
        print(f"Claims per Second: {metrics['claims_per_second']:.1f}")
        print()
        
        print("EVIDENCE VALIDATOR RESULTS:")
        print(f"  Valid: {self.results['ev_results']['valid']} ({metrics['ev_pass_rate']:.1f}%)")
        print(f"  Invalid: {self.results['ev_results']['invalid']} ({metrics['ev_rejection_rate']:.1f}%)")
        print(f"  Review: {self.results['ev_results']['review']} ({metrics['ev_review_rate']:.1f}%)")
        print(f"  Errors: {self.results['ev_results']['errors']}")
        print()
        
        print("AUTO-CLAIMS GENERATOR RESULTS:")
        print(f"  Filed: {self.results['acg_results']['filed']} ({metrics['acg_filing_rate']:.1f}%)")
        print(f"  Rejected: {self.results['acg_results']['rejected']} ({metrics['acg_rejection_rate']:.1f}%)")
        print(f"  Review: {self.results['acg_results']['review']}")
        print(f"  Errors: {self.results['acg_results']['errors']}")
        print()
        
        print("PIPELINE EFFICIENCY:")
        print(f"  EV → ACG Success Rate: {metrics['pipeline_efficiency']:.1f}%")
        print()
        
        print("CONFIGURATION:")
        print(f"  Strict Mode: {self.strict_mode}")
        print(f"  Mock SP-API: {self.use_mock_sp_api}")
        print(f"  EV Model Path: {self.ev_model_path or 'Default'}")
        print("=" * 60)

def main():
    """Main function for stress testing"""
    parser = argparse.ArgumentParser(description="Stress test EV + ACG integration")
    parser.add_argument("--max-claims", type=int, default=50, help="Maximum claims to process")
    parser.add_argument("--strict", action="store_true", help="Use strict validation mode")
    parser.add_argument("--real-sp-api", action="store_true", help="Use real SP-API instead of mock")
    parser.add_argument("--ev-model", type=str, help="Path to EV ML model")
    parser.add_argument("--output", type=str, help="Output file for results")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    
    args = parser.parse_args()
    
    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=log_level, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    # Run stress test
    stress_test = StressTestEVWithACG(
        max_claims=args.max_claims,
        strict_mode=args.strict,
        use_mock_sp_api=not args.real_sp_api,
        ev_model_path=args.ev_model
    )
    
    results = stress_test.run_stress_test()
    stress_test.save_results(args.output)
    stress_test.print_summary()

if __name__ == "__main__":
    main()
