"""
Unified Evidence Agent Service
Orchestrates document generation, parsing, matching, and validation
to produce evidence_package.json for each claim.

Standalone mode - no database dependencies, all in-memory.
"""

import json
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
from pathlib import Path
import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from .mock_document_generator import MockDocumentGenerator
from .evidence_engine import EvidenceEngine, EvidenceBundle

# Import parser if available
try:
    from src.parsers.pdf_parser import PDFParser
    PARSER_AVAILABLE = True
except ImportError:
    PARSER_AVAILABLE = False
    PDFParser = None

logger = logging.getLogger(__name__)


class EvidenceAgentService:
    """
    Unified Evidence Agent Service
    
    Processes claims from Discovery Agent:
    1. Generates mock documents (invoices, receipts, shipping logs)
    2. Parses documents to extract structured data
    3. Matches evidence to claims
    4. Validates evidence completeness
    5. Produces evidence_package.json
    """
    
    def __init__(self, seed: Optional[int] = None):
        """Initialize Evidence Agent Service"""
        self.document_generator = MockDocumentGenerator(seed=seed)
        self.evidence_engine = EvidenceEngine()
        
        if PARSER_AVAILABLE:
            self.parser = PDFParser()
        else:
            self.parser = None
            logger.warning("PDFParser not available - using mock parsing")
        
        # Track processed claims
        self.processed_claims: List[Dict[str, Any]] = []
    
    def process_claim_for_evidence(self, claim_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a single claim through the Evidence Agent pipeline
        
        Args:
            claim_data: Claim data from Discovery Agent (from claimable_claims.csv)
            
        Returns:
            evidence_package.json structure
        """
        claim_id = claim_data.get('claim_id', 'UNKNOWN')
        logger.info(f"Processing claim {claim_id} through Evidence Agent")
        
        try:
            # Step 1: Generate mock documents
            logger.debug(f"  [1/4] Generating mock documents for {claim_id}")
            documents = self.document_generator.generate_evidence_documents(claim_data)
            
            # Step 2: Parse documents (extract structured data)
            logger.debug(f"  [2/4] Parsing documents for {claim_id}")
            parsed_documents = self._parse_documents(documents)
            
            # Step 3: Match evidence to claim
            logger.debug(f"  [3/4] Matching evidence to claim {claim_id}")
            match_results = self._match_evidence_to_claim(claim_data, parsed_documents)
            
            # Step 4: Validate evidence bundle
            logger.debug(f"  [4/4] Validating evidence bundle for {claim_id}")
            required_evidence = self._get_required_evidence_types(claim_data)
            
            # Convert documents to evidence_items format expected by EvidenceEngine
            evidence_items = []
            for doc in parsed_documents:
                evidence_item = {
                    'evidence_type': doc.get('document_type', 'unknown'),
                    'file_type': doc.get('metadata', {}).get('file_type', 'pdf'),
                    'file_size_mb': doc.get('metadata', {}).get('file_size_mb', 1.0),
                    'fields': list(doc.get('parsed_metadata', {}).keys()),
                    'description': doc.get('extracted_text', '')[:200],
                    'label': doc.get('document_type', '').replace('_', ' ').title(),
                    'quality_met': doc.get('parsing_confidence', 0.0) >= 0.7,
                    'evidence_date': doc.get('metadata', {}).get('created_at', datetime.now().isoformat())
                }
                evidence_items.append(evidence_item)
            
            evidence_bundle = self.evidence_engine.validate_evidence_bundle(
                claim_id=claim_id,
                evidence_items=evidence_items,
                required_evidence=required_evidence
            )
            
            # Step 5: Build evidence package
            evidence_package = self._build_evidence_package(
                claim_data=claim_data,
                documents=parsed_documents,
                match_results=match_results,
                evidence_bundle=evidence_bundle
            )
            
            # Track processed claim
            self.processed_claims.append({
                'claim_id': claim_id,
                'processed_at': datetime.now().isoformat(),
                'evidence_package': evidence_package
            })
            
            logger.info(f"✅ Successfully processed claim {claim_id}")
            return evidence_package
            
        except Exception as e:
            logger.error(f"❌ Error processing claim {claim_id}: {e}")
            return self._build_error_package(claim_id, str(e))
    
    def _parse_documents(self, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Parse documents to extract structured data"""
        parsed_docs = []
        
        for doc in documents:
            # If document already has parsed_metadata, use it
            if 'parsed_metadata' in doc and doc['parsed_metadata']:
                parsed_doc = doc.copy()
                parsed_doc['parsing_method'] = 'mock_generator'
                parsed_docs.append(parsed_doc)
                continue
            
            # Otherwise, try to parse with PDFParser
            if self.parser and doc.get('extracted_text'):
                try:
                    # Create a temporary text file for parsing
                    text = doc['extracted_text']
                    result = self.parser._extract_with_regex(text)
                    
                    if result.success and result.data:
                        parsed_doc = doc.copy()
                        parsed_doc['parsed_metadata'] = {
                            'supplier_name': result.data.supplier_name,
                            'invoice_number': result.data.invoice_number,
                            'invoice_date': result.data.invoice_date,
                            'total_amount': result.data.total_amount,
                            'currency': result.data.currency,
                            'line_items': [
                                {
                                    'sku': item.sku,
                                    'description': item.description,
                                    'quantity': item.quantity,
                                    'unit_price': item.unit_price,
                                    'total': item.total
                                }
                                for item in result.data.line_items
                            ] if result.data.line_items else []
                        }
                        parsed_doc['parsing_method'] = 'pdf_parser'
                        parsed_doc['parsing_confidence'] = result.confidence
                        parsed_docs.append(parsed_doc)
                    else:
                        # Fallback to mock metadata
                        parsed_doc = doc.copy()
                        parsed_doc['parsed_metadata'] = doc.get('metadata', {})
                        parsed_doc['parsing_method'] = 'fallback'
                        parsed_docs.append(parsed_doc)
                except Exception as e:
                    logger.warning(f"Parsing failed for document {doc.get('document_id')}: {e}")
                    # Fallback to mock metadata
                    parsed_doc = doc.copy()
                    parsed_doc['parsed_metadata'] = doc.get('metadata', {})
                    parsed_doc['parsing_method'] = 'fallback'
                    parsed_docs.append(parsed_doc)
            else:
                # Use mock metadata directly
                parsed_doc = doc.copy()
                parsed_doc['parsed_metadata'] = doc.get('metadata', {})
                parsed_doc['parsing_method'] = 'mock_generator'
                parsed_docs.append(parsed_doc)
        
        return parsed_docs
    
    def _match_evidence_to_claim(self, claim_data: Dict[str, Any], 
                                documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Match evidence documents to claim using rule-based matching"""
        match_results = []
        
        for doc in documents:
            parsed_metadata = doc.get('parsed_metadata', {})
            if not parsed_metadata:
                continue
            
            # Calculate match score
            match_score = 0.0
            matched_fields = []
            reasoning_parts = []
            
            # 1. SKU match
            if parsed_metadata.get('sku') and claim_data.get('sku'):
                if parsed_metadata['sku'] == claim_data['sku']:
                    match_score = max(match_score, 0.90)
                    matched_fields.append('sku')
                    reasoning_parts.append("Exact SKU match")
            
            # 2. ASIN match
            if parsed_metadata.get('asin') and claim_data.get('asin'):
                if parsed_metadata['asin'] == claim_data['asin']:
                    match_score = max(match_score, 0.85)
                    matched_fields.append('asin')
                    reasoning_parts.append("Exact ASIN match")
            
            # 3. Order ID match
            if parsed_metadata.get('order_id') and claim_data.get('order_id'):
                if parsed_metadata['order_id'] == claim_data['order_id']:
                    match_score = max(match_score, 0.95)
                    matched_fields.append('order_id')
                    reasoning_parts.append("Exact Order ID match")
            
            # 4. Amount match (within 5%)
            if parsed_metadata.get('total_amount') and claim_data.get('amount'):
                claim_amount = float(claim_data['amount'])
                doc_amount = float(parsed_metadata['total_amount'])
                if claim_amount > 0:
                    ratio = min(claim_amount, doc_amount) / max(claim_amount, doc_amount)
                    if ratio >= 0.95:
                        match_score = max(match_score, 0.80)
                        matched_fields.append('amount')
                        reasoning_parts.append(f"Amount match (ratio: {ratio:.2f})")
            
            # 5. Date proximity (within 30 days)
            if parsed_metadata.get('invoice_date') and claim_data.get('order_date'):
                try:
                    from datetime import datetime
                    doc_date = datetime.strptime(parsed_metadata['invoice_date'], '%Y-%m-%d')
                    order_date_str = claim_data['order_date']
                    if 'T' in order_date_str:
                        order_date = datetime.fromisoformat(order_date_str.replace('Z', '+00:00'))
                    else:
                        order_date = datetime.strptime(order_date_str, '%Y-%m-%d')
                    
                    days_diff = abs((doc_date - order_date).days)
                    if days_diff <= 30:
                        match_score = max(match_score, 0.70)
                        matched_fields.append('date')
                        reasoning_parts.append(f"Date proximity match ({days_diff} days)")
                except:
                    pass
            
            if match_score > 0.3:  # Minimum threshold
                match_results.append({
                    'document_id': doc.get('document_id', 'UNKNOWN'),
                    'document_type': doc.get('document_type', 'unknown'),
                    'match_score': match_score,
                    'matched_fields': matched_fields,
                    'reasoning': '; '.join(reasoning_parts) if reasoning_parts else 'Partial match',
                    'confidence': match_score
                })
        
        # Sort by match score
        match_results.sort(key=lambda x: x['match_score'], reverse=True)
        
        return match_results
    
    def _get_required_evidence_types(self, claim_data: Dict[str, Any]) -> List[str]:
        """Get required evidence types based on claim type"""
        claim_type = claim_data.get('claim_type', '').lower()
        
        required = ['invoice']  # Always require invoice
        
        if 'lost' in claim_type:
            required.extend(['shipping_log', 'tracking_proof'])
        elif 'damaged' in claim_type:
            required.extend(['photos', 'damage_report'])
        elif 'overcharge' in claim_type or 'fee' in claim_type:
            required.extend(['receipt', 'invoice'])
        
        return list(set(required))  # Remove duplicates
    
    def _build_evidence_package(self, claim_data: Dict[str, Any],
                               documents: List[Dict[str, Any]],
                               match_results: List[Dict[str, Any]],
                               evidence_bundle: EvidenceBundle) -> Dict[str, Any]:
        """Build final evidence_package.json structure"""
        
        # Get best match
        best_match = match_results[0] if match_results else None
        
        # Determine action based on confidence
        if best_match and best_match['confidence'] >= 0.85:
            action = 'auto_submit'
        elif best_match and best_match['confidence'] >= 0.50:
            action = 'smart_prompt'
        else:
            action = 'manual_review'
        
        # Handle NaN values from pandas
        import math
        order_id_raw = claim_data.get('order_id', '')
        order_id = None if (isinstance(order_id_raw, float) and math.isnan(order_id_raw)) else order_id_raw
        
        evidence_package = {
            "claim_id": claim_data.get('claim_id', 'UNKNOWN'),
            "claim_metadata": {
                "sku": claim_data.get('sku'),
                "asin": claim_data.get('asin'),
                "order_id": order_id,
                "amount": float(claim_data.get('amount', 0)),
                "quantity": int(claim_data.get('quantity', 1)),
                "claim_type": claim_data.get('claim_type'),
                "marketplace": claim_data.get('marketplace'),
                "fulfillment_center": claim_data.get('fulfillment_center'),
                "order_date": claim_data.get('order_date'),
                "claim_date": claim_data.get('claim_date', datetime.now().isoformat())
            },
            "evidence_documents": [
                {
                    "document_id": doc.get('document_id'),
                    "document_type": doc.get('document_type'),
                    "metadata": doc.get('metadata', {}),
                    "parsed_metadata": doc.get('parsed_metadata', {}),
                    "parsing_method": doc.get('parsing_method', 'unknown'),
                    "parsing_confidence": doc.get('parsing_confidence', doc.get('confidence', 0.0)),
                    "extracted_text": doc.get('extracted_text', '')[:500]  # Truncate for JSON
                }
                for doc in documents
            ],
            "match_results": match_results,
            "best_match": best_match,
            "evidence_bundle": {
                "total_evidence_count": evidence_bundle.total_evidence_count,
                "required_evidence_count": evidence_bundle.required_evidence_count,
                "optional_evidence_count": evidence_bundle.optional_evidence_count,
                "validation_score": evidence_bundle.validation_score,
                "missing_required": evidence_bundle.missing_required,
                "bundle_status": evidence_bundle.bundle_status
            },
            "action": action,
            "confidence": best_match['confidence'] if best_match else 0.0,
            "processing_timestamp": datetime.now().isoformat(),
            "agent_version": "1.0.0"
        }
        
        return evidence_package
    
    def _build_error_package(self, claim_id: str, error_message: str) -> Dict[str, Any]:
        """Build error evidence package"""
        return {
            "claim_id": claim_id,
            "error": error_message,
            "evidence_documents": [],
            "match_results": [],
            "evidence_bundle": {
                "total_evidence_count": 0,
                "required_evidence_count": 0,
                "optional_evidence_count": 0,
                "validation_score": 0.0,
                "missing_required": [],
                "bundle_status": "error"
            },
            "action": "error",
            "confidence": 0.0,
            "processing_timestamp": datetime.now().isoformat(),
            "agent_version": "1.0.0"
        }
    
    def process_batch_claims(self, claims: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Process multiple claims in batch"""
        logger.info(f"Processing batch of {len(claims)} claims")
        
        evidence_packages = []
        for claim in claims:
            package = self.process_claim_for_evidence(claim)
            evidence_packages.append(package)
        
        logger.info(f"✅ Processed {len(evidence_packages)} claims")
        return evidence_packages
    
    def export_evidence_packages(self, evidence_packages: List[Dict[str, Any]], 
                                 output_dir: Path) -> Dict[str, Any]:
        """
        Export evidence packages to JSON files
        
        Args:
            evidence_packages: List of evidence packages
            output_dir: Directory to save files
            
        Returns:
            Summary of exported files
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        
        exported_files = []
        
        for package in evidence_packages:
            claim_id = package.get('claim_id', 'UNKNOWN')
            filepath = output_dir / f"evidence_package_{claim_id}.json"
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(package, f, indent=2, default=str)
            
            exported_files.append(str(filepath))
        
        # Also create a batch file
        batch_filepath = output_dir / "evidence_packages_batch.json"
        with open(batch_filepath, 'w', encoding='utf-8') as f:
            json.dump({
                "export_timestamp": datetime.now().isoformat(),
                "total_packages": len(evidence_packages),
                "packages": evidence_packages
            }, f, indent=2, default=str)
        
        logger.info(f"✅ Exported {len(exported_files)} evidence packages to {output_dir}")
        
        return {
            "exported_files": exported_files,
            "batch_file": str(batch_filepath),
            "total_packages": len(evidence_packages)
        }
    
    def get_processing_summary(self) -> Dict[str, Any]:
        """Get summary of processed claims"""
        if not self.processed_claims:
            return {"status": "no_claims_processed"}
        
        # Count by action
        action_counts = {}
        confidence_scores = []
        
        for claim in self.processed_claims:
            package = claim.get('evidence_package', {})
            action = package.get('action', 'unknown')
            action_counts[action] = action_counts.get(action, 0) + 1
            confidence_scores.append(package.get('confidence', 0.0))
        
        return {
            "status": "active",
            "total_processed": len(self.processed_claims),
            "action_distribution": action_counts,
            "avg_confidence": sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0.0,
            "min_confidence": min(confidence_scores) if confidence_scores else 0.0,
            "max_confidence": max(confidence_scores) if confidence_scores else 0.0
        }

