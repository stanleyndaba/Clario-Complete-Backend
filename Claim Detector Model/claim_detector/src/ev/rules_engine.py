"""
Rules Engine for Evidence Validation
Validates claims against business rules and compliance requirements
"""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class RulesEngine:
    """Business rules engine for claim validation"""
    
    def __init__(self):
        """Initialize the rules engine"""
        self.critical_rules = {
            'matching_case': 'Critical: Must have matching shipment_id, SKU/ASIN, and time window',
            'documentation': 'Critical: Must have at least one invoice or shipping document',
            'compliance': 'Critical: Files must be valid types (pdf/image/json) with proper hashes'
        }
        
        self.important_rules = {
            'evidence_quantity': 'Important: Invoice quantity should match shipment quantity',
            'multiple_docs': 'Important: Should have at least 2 supporting documents'
        }
        
        self.warning_rules = {
            'document_freshness': 'Warning: Documents should be within 30 days of claim',
            'file_size': 'Warning: Files should be under 10MB each'
        }
    
    def validate_claim(self, claim_metadata: Dict[str, Any], docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Validate a claim against all business rules
        
        Args:
            claim_metadata: Claim information including shipment_id, SKU, ASIN, etc.
            docs: List of document metadata and content
            
        Returns:
            Validation result with rules passed/failed and overall status
        """
        logger.info(f"Validating claim {claim_metadata.get('claim_id', 'unknown')}")
        
        rules_passed = []
        rules_failed = []
        missing_fields = []
        
        # Rule 1: Matching case validation
        matching_result = self._validate_matching_case(claim_metadata, docs)
        if matching_result['passed']:
            rules_passed.append('matching_case')
        else:
            rules_failed.append('matching_case')
            missing_fields.extend(matching_result['missing'])
        
        # Rule 2: Documentation validation
        doc_result = self._validate_documentation(docs)
        if doc_result['passed']:
            rules_passed.append('documentation')
        else:
            rules_failed.append('documentation')
            missing_fields.extend(doc_result['missing'])
        
        # Rule 3: Compliance validation
        compliance_result = self._validate_compliance(docs)
        if compliance_result['passed']:
            rules_passed.append('compliance')
        else:
            rules_failed.append('compliance')
            missing_fields.extend(compliance_result['missing'])
        
        # Rule 4: Evidence validation
        evidence_result = self._validate_evidence(claim_metadata, docs)
        if evidence_result['passed']:
            rules_passed.append('evidence_quantity')
        else:
            rules_failed.append('evidence_quantity')
        
        # Rule 5: Multiple documents
        if len(docs) >= 2:
            rules_passed.append('multiple_docs')
        else:
            rules_failed.append('multiple_docs')
        
        # Rule 6: Document freshness
        freshness_result = self._validate_document_freshness(docs)
        if freshness_result['passed']:
            rules_passed.append('document_freshness')
        else:
            rules_failed.append('document_freshness')
        
        # Rule 7: File size validation
        size_result = self._validate_file_sizes(docs)
        if size_result['passed']:
            rules_passed.append('file_size')
        else:
            rules_failed.append('file_size')
        
        # Determine overall status
        status = self._determine_status(rules_passed, rules_failed)
        
        return {
            "rules_passed": rules_passed,
            "rules_failed": rules_failed,
            "missing_fields": list(set(missing_fields)),  # Remove duplicates
            "status": status,
            "validation_details": {
                "matching_case": matching_result,
                "documentation": doc_result,
                "compliance": compliance_result,
                "evidence": evidence_result,
                "freshness": freshness_result,
                "file_size": size_result
            }
        }
    
    def _validate_matching_case(self, metadata: Dict[str, Any], docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate that case details match across claim and documents"""
        missing = []
        passed = True
        
        # Check required fields in metadata
        required_fields = ['shipment_id', 'sku', 'asin', 'claim_date']
        for field in required_fields:
            if not metadata.get(field):
                missing.append(f"metadata.{field}")
                passed = False
        
        # Check if documents contain matching shipment_id
        if docs:
            shipment_ids_in_docs = set()
            for doc in docs:
                if doc.get('metadata', {}).get('shipment_id'):
                    shipment_ids_in_docs.add(doc['metadata']['shipment_id'])
            
            claim_shipment_id = metadata.get('shipment_id')
            if claim_shipment_id and claim_shipment_id not in shipment_ids_in_docs:
                missing.append("matching_shipment_id_in_docs")
                passed = False
        
        return {
            "passed": passed,
            "missing": missing,
            "details": {
                "claim_shipment_id": metadata.get('shipment_id'),
                "doc_shipment_ids": list(shipment_ids_in_docs) if docs else []
            }
        }
    
    def _validate_documentation(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate that required documentation is present"""
        missing = []
        passed = False
        
        if not docs:
            missing.append("any_documents")
            return {"passed": False, "missing": missing}
        
        # Check for invoice or shipping documents
        has_invoice = False
        has_shipping = False
        
        for doc in docs:
            doc_type = doc.get('metadata', {}).get('document_type', '').lower()
            if 'invoice' in doc_type:
                has_invoice = True
            elif 'shipping' in doc_type or 'packing' in doc_type or 'delivery' in doc_type:
                has_shipping = True
        
        if has_invoice or has_shipping:
            passed = True
        else:
            missing.append("invoice_or_shipping_document")
        
        return {
            "passed": passed,
            "missing": missing,
            "details": {
                "has_invoice": has_invoice,
                "has_shipping": has_shipping,
                "total_docs": len(docs)
            }
        }
    
    def _validate_compliance(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate file compliance (type, hash, etc.)"""
        missing = []
        passed = True
        
        valid_extensions = {'.pdf', '.jpg', '.jpeg', '.png', '.json', '.xml'}
        
        for i, doc in enumerate(docs):
            # Check file type
            file_path = doc.get('metadata', {}).get('file_path', '')
            file_ext = Path(file_path).suffix.lower()
            
            if file_ext not in valid_extensions:
                missing.append(f"doc_{i}_invalid_file_type")
                passed = False
            
            # Check hash validation
            if not doc.get('metadata', {}).get('hash') or not doc.get('metadata', {}).get('hash_verified'):
                missing.append(f"doc_{i}_hash_validation")
                passed = False
        
        return {
            "passed": passed,
            "missing": missing,
            "details": {
                "valid_extensions": list(valid_extensions),
                "docs_checked": len(docs)
            }
        }
    
    def _validate_evidence(self, metadata: Dict[str, Any], docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate evidence consistency (quantities, amounts, etc.)"""
        missing = []
        passed = True
        
        claim_quantity = metadata.get('quantity', 0)
        claim_amount = metadata.get('amount', 0)
        
        # Check if invoice quantities match claim quantities
        for i, doc in enumerate(docs):
            doc_type = doc.get('metadata', {}).get('document_type', '').lower()
            
            if 'invoice' in doc_type:
                doc_quantity = doc.get('metadata', {}).get('quantity', 0)
                doc_amount = doc.get('metadata', {}).get('amount', 0)
                
                # Allow 5% tolerance for quantity/amount differences
                quantity_tolerance = claim_quantity * 0.05
                amount_tolerance = claim_amount * 0.05
                
                if abs(doc_quantity - claim_quantity) > quantity_tolerance:
                    missing.append(f"doc_{i}_quantity_mismatch")
                    passed = False
                
                if abs(doc_amount - claim_amount) > amount_tolerance:
                    missing.append(f"doc_{i}_amount_mismatch")
                    passed = False
        
        return {
            "passed": passed,
            "missing": missing,
            "details": {
                "claim_quantity": claim_quantity,
                "claim_amount": claim_amount,
                "docs_checked": len(docs)
            }
        }
    
    def _validate_document_freshness(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate that documents are reasonably recent"""
        missing = []
        passed = True
        
        cutoff_date = datetime.now() - timedelta(days=30)
        
        for i, doc in enumerate(docs):
            doc_date_str = doc.get('metadata', {}).get('document_date')
            if doc_date_str:
                try:
                    doc_date = datetime.fromisoformat(doc_date_str.replace('Z', '+00:00'))
                    if doc_date < cutoff_date:
                        missing.append(f"doc_{i}_too_old")
                        passed = False
                except ValueError:
                    missing.append(f"doc_{i}_invalid_date_format")
                    passed = False
        
        return {
            "passed": passed,
            "missing": missing,
            "details": {
                "cutoff_date": cutoff_date.isoformat(),
                "docs_checked": len(docs)
            }
        }
    
    def _validate_file_sizes(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validate that files are within size limits"""
        missing = []
        passed = True
        max_size_mb = 10
        
        for i, doc in enumerate(docs):
            file_size_mb = doc.get('metadata', {}).get('file_size_mb', 0)
            if file_size_mb > max_size_mb:
                missing.append(f"doc_{i}_file_too_large")
                passed = False
        
        return {
            "passed": passed,
            "missing": missing,
            "details": {
                "max_size_mb": max_size_mb,
                "docs_checked": len(docs)
            }
        }
    
    def _determine_status(self, rules_passed: List[str], rules_failed: List[str]) -> str:
        """Determine overall validation status"""
        # Check if any critical rules failed
        critical_failed = any(rule in rules_failed for rule in self.critical_rules.keys())
        if critical_failed:
            return "invalid"
        
        # Check if all rules passed
        all_rules = list(self.critical_rules.keys()) + list(self.important_rules.keys()) + list(self.warning_rules.keys())
        all_passed = all(rule in rules_passed for rule in all_rules)
        if all_passed:
            return "valid"
        
        # Otherwise, needs review
        return "review"

