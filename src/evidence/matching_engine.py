"""
Evidence Matching Engine
Hybrid matching engine that combines rule-based and ML-based approaches
to match parsed documents to dispute cases
"""

import uuid
import json
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass
from difflib import SequenceMatcher
import re

from src.api.schemas import (
    DisputeCase, EvidenceDocument, ParsedInvoiceData, 
    DisputeEvidenceLink, LinkType, EvidenceMatchingResult
)
from src.common.db_postgresql import DatabaseManager

logger = logging.getLogger(__name__)

@dataclass
class MatchResult:
    """Result of evidence matching"""
    dispute_id: str
    evidence_document_id: str
    rule_score: float
    ml_score: Optional[float] = None
    final_confidence: float = 0.0
    match_type: str = ""
    matched_fields: List[str] = None
    reasoning: str = ""
    action_taken: str = ""

class EvidenceMatchingEngine:
    """Hybrid evidence matching engine"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.auto_submit_threshold = 0.85
        self.smart_prompt_threshold = 0.5
        
    async def match_evidence_for_user(self, user_id: str) -> Dict[str, Any]:
        """Match evidence documents to dispute cases for a user"""
        try:
            # Get unlinked dispute cases
            disputes = await self._get_unlinked_disputes(user_id)
            if not disputes:
                return {"matches": 0, "auto_submits": 0, "smart_prompts": 0}
            
            # Get parsed evidence documents
            evidence_docs = await self._get_parsed_evidence_documents(user_id)
            if not evidence_docs:
                return {"matches": 0, "auto_submits": 0, "smart_prompts": 0}
            
            # Process each dispute
            matches = []
            auto_submits = 0
            smart_prompts = 0
            
            for dispute in disputes:
                dispute_matches = await self._match_dispute_to_evidence(dispute, evidence_docs)
                
                if dispute_matches:
                    # Sort by confidence
                    dispute_matches.sort(key=lambda x: x.final_confidence, reverse=True)
                    best_match = dispute_matches[0]
                    
                    # Determine action based on confidence
                    if best_match.final_confidence >= self.auto_submit_threshold:
                        # Auto-submit
                        await self._create_evidence_link(dispute, best_match, LinkType.AUTO_MATCH)
                        await self._update_dispute_status(dispute['id'], 'auto_submitted', best_match.final_confidence)
                        auto_submits += 1
                        matches.append(best_match)
                        
                    elif best_match.final_confidence >= self.smart_prompt_threshold:
                        # Smart prompt
                        await self._create_evidence_link(dispute, best_match, LinkType.ML_SUGGESTED)
                        await self._create_smart_prompt(dispute, best_match)
                        await self._update_dispute_status(dispute['id'], 'smart_prompt_sent', best_match.final_confidence)
                        smart_prompts += 1
                        matches.append(best_match)
                    
                    else:
                        # No action - confidence too low
                        await self._update_dispute_status(dispute['id'], 'pending', best_match.final_confidence)
            
            return {
                "matches": len(matches),
                "auto_submits": auto_submits,
                "smart_prompts": smart_prompts,
                "results": matches
            }
            
        except Exception as e:
            logger.error(f"Evidence matching failed for user {user_id}: {e}")
            raise
    
    async def _match_dispute_to_evidence(self, dispute: Dict[str, Any], evidence_docs: List[Dict[str, Any]]) -> List[MatchResult]:
        """Match a single dispute to all evidence documents"""
        matches = []
        
        for evidence_doc in evidence_docs:
            try:
                # Rule-based matching
                rule_score, rule_reasoning = self._rule_based_match(dispute, evidence_doc)
                
                # ML-based matching (placeholder for future implementation)
                ml_score = None  # self._ml_based_match(dispute, evidence_doc)
                
                # Calculate final confidence
                final_confidence = self._calculate_final_confidence(rule_score, ml_score)
                
                if final_confidence > 0.3:  # Minimum threshold for consideration
                    match_type = self._determine_match_type(rule_reasoning)
                    matched_fields = self._extract_matched_fields(rule_reasoning)
                    
                    match = MatchResult(
                        dispute_id=dispute['id'],
                        evidence_document_id=evidence_doc['id'],
                        rule_score=rule_score,
                        ml_score=ml_score,
                        final_confidence=final_confidence,
                        match_type=match_type,
                        matched_fields=matched_fields,
                        reasoning=rule_reasoning,
                        action_taken=self._determine_action(final_confidence)
                    )
                    matches.append(match)
                    
            except Exception as e:
                logger.warning(f"Failed to match dispute {dispute['id']} to evidence {evidence_doc['id']}: {e}")
                continue
        
        return matches
    
    def _rule_based_match(self, dispute: Dict[str, Any], evidence_doc: Dict[str, Any]) -> Tuple[float, str]:
        """Rule-based matching logic"""
        parsed_metadata = evidence_doc.get('parsed_metadata', {})
        if not parsed_metadata:
            return 0.0, "No parsed metadata available"
        
        score = 0.0
        reasoning_parts = []
        
        # Very High Confidence Matches
        
        # 1. Exact invoice number + order ID match
        if parsed_metadata.get('invoice_number') and dispute.get('order_id'):
            if parsed_metadata['invoice_number'] == dispute['order_id']:
                score = max(score, 0.95)
                reasoning_parts.append("Exact invoice number and order ID match")
        
        # 2. Exact SKU/ASIN + quantity match within ±30 days
        if parsed_metadata.get('line_items') and dispute.get('sku'):
            for line_item in parsed_metadata['line_items']:
                if line_item.get('sku') == dispute['sku']:
                    # Check date proximity
                    if self._check_date_proximity(parsed_metadata.get('invoice_date'), dispute.get('order_date')):
                        score = max(score, 0.90)
                        reasoning_parts.append(f"Exact SKU match ({dispute['sku']}) with date proximity")
                        break
        
        # Medium Confidence Matches
        
        # 3. Supplier name fuzzy match + amounts within ±5%
        if parsed_metadata.get('supplier_name') and parsed_metadata.get('total_amount'):
            supplier_similarity = self._calculate_similarity(
                parsed_metadata['supplier_name'].lower(),
                self._extract_supplier_from_dispute(dispute).lower()
            )
            
            if supplier_similarity > 0.8:
                amount_match = self._check_amount_match(
                    parsed_metadata['total_amount'],
                    dispute.get('amount_claimed')
                )
                
                if amount_match:
                    score = max(score, 0.70)
                    reasoning_parts.append(f"Supplier name fuzzy match ({supplier_similarity:.2f}) with amount match")
        
        # 4. ASIN match in line items
        if parsed_metadata.get('line_items') and dispute.get('asin'):
            for line_item in parsed_metadata['line_items']:
                if line_item.get('sku') == dispute['asin']:
                    score = max(score, 0.60)
                    reasoning_parts.append(f"ASIN match in line items ({dispute['asin']})")
                    break
        
        # 5. Date proximity match
        if self._check_date_proximity(parsed_metadata.get('invoice_date'), dispute.get('dispute_date')):
            score = max(score, 0.40)
            reasoning_parts.append("Date proximity match")
        
        # 6. Amount range match
        if parsed_metadata.get('total_amount') and dispute.get('amount_claimed'):
            amount_ratio = min(parsed_metadata['total_amount'], dispute['amount_claimed']) / max(parsed_metadata['total_amount'], dispute['amount_claimed'])
            if amount_ratio > 0.7:
                score = max(score, 0.30)
                reasoning_parts.append(f"Amount range match (ratio: {amount_ratio:.2f})")
        
        reasoning = "; ".join(reasoning_parts) if reasoning_parts else "No significant matches found"
        return score, reasoning
    
    def _calculate_similarity(self, str1: str, str2: str) -> float:
        """Calculate string similarity using SequenceMatcher"""
        return SequenceMatcher(None, str1, str2).ratio()
    
    def _extract_supplier_from_dispute(self, dispute: Dict[str, Any]) -> str:
        """Extract supplier name from dispute metadata"""
        # This would typically come from order data or dispute metadata
        # For now, return a placeholder
        return dispute.get('metadata', {}).get('supplier_name', '')
    
    def _check_date_proximity(self, date1: Optional[str], date2: Optional[str], days: int = 30) -> bool:
        """Check if two dates are within specified days"""
        if not date1 or not date2:
            return False
        
        try:
            d1 = datetime.strptime(date1, '%Y-%m-%d')
            d2 = datetime.strptime(date2, '%Y-%m-%d')
            return abs((d1 - d2).days) <= days
        except ValueError:
            return False
    
    def _check_amount_match(self, amount1: float, amount2: Optional[float], tolerance: float = 0.05) -> bool:
        """Check if two amounts match within tolerance"""
        if not amount2:
            return False
        
        ratio = min(amount1, amount2) / max(amount1, amount2)
        return ratio >= (1 - tolerance)
    
    def _calculate_final_confidence(self, rule_score: float, ml_score: Optional[float]) -> float:
        """Calculate final confidence score"""
        if ml_score is not None:
            # Combine rule and ML scores (weighted average)
            return (rule_score * 0.7) + (ml_score * 0.3)
        else:
            return rule_score
    
    def _determine_match_type(self, reasoning: str) -> str:
        """Determine the type of match based on reasoning"""
        if "Exact invoice number" in reasoning:
            return "exact_invoice"
        elif "Exact SKU match" in reasoning:
            return "sku_match"
        elif "ASIN match" in reasoning:
            return "asin_match"
        elif "Supplier name fuzzy match" in reasoning:
            return "supplier_match"
        elif "Date proximity match" in reasoning:
            return "date_match"
        elif "Amount range match" in reasoning:
            return "amount_match"
        else:
            return "partial_match"
    
    def _extract_matched_fields(self, reasoning: str) -> List[str]:
        """Extract matched fields from reasoning"""
        fields = []
        if "invoice number" in reasoning.lower():
            fields.append("invoice_number")
        if "sku" in reasoning.lower():
            fields.append("sku")
        if "asin" in reasoning.lower():
            fields.append("asin")
        if "supplier" in reasoning.lower():
            fields.append("supplier_name")
        if "date" in reasoning.lower():
            fields.append("date")
        if "amount" in reasoning.lower():
            fields.append("amount")
        return fields
    
    def _determine_action(self, confidence: float) -> str:
        """Determine action based on confidence score"""
        if confidence >= self.auto_submit_threshold:
            return "auto_submit"
        elif confidence >= self.smart_prompt_threshold:
            return "smart_prompt"
        else:
            return "no_action"
    
    async def _get_unlinked_disputes(self, user_id: str) -> List[Dict[str, Any]]:
        """Get dispute cases that don't have evidence linked.
        
        Joins with detection_results to get order details (order_id, asin, sku)
        from the evidence JSONB field. Uses dispute_evidence_links to check
        if evidence has already been linked.
        """
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT 
                        dc.id, 
                        dc.seller_id,
                        dr.evidence->>'order_id' as order_id,
                        dr.evidence->>'asin' as asin,
                        dr.evidence->>'sku' as sku,
                        dc.case_type as dispute_type,
                        dc.status,
                        dc.claim_amount as amount_claimed,
                        dc.currency,
                        dc.submission_date as dispute_date,
                        dc.created_at as order_date,
                        dc.evidence_attachments as metadata
                    FROM dispute_cases dc
                    LEFT JOIN detection_results dr ON dc.detection_result_id = dr.id
                    WHERE dc.seller_id = %s 
                    AND dc.status IN ('pending', 'submitted')
                    AND NOT EXISTS (
                        SELECT 1 FROM dispute_evidence_links del 
                        WHERE del.dispute_case_id = dc.id
                    )
                    ORDER BY dc.created_at DESC
                """, (user_id,))
                
                disputes = []
                for row in cursor.fetchall():
                    disputes.append({
                        'id': str(row[0]),
                        'user_id': str(row[1]),
                        'order_id': row[2],
                        'asin': row[3],
                        'sku': row[4],
                        'dispute_type': row[5],
                        'status': row[6],
                        'amount_claimed': float(row[7]) if row[7] else None,
                        'currency': row[8],
                        'dispute_date': row[9].isoformat() if row[9] else None,
                        'order_date': row[10].isoformat() if row[10] else None,
                        'metadata': row[11] if row[11] else {}
                    })
                
                return disputes
    
    async def _get_parsed_evidence_documents(self, user_id: str) -> List[Dict[str, Any]]:
        """Get evidence documents with parsed metadata.
        
        Uses seller_id (not user_id) to match the actual schema.
        Falls back to 'extracted' column if 'parsed_metadata' is empty.
        """
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, parsed_metadata, parser_confidence, extracted
                    FROM evidence_documents 
                    WHERE seller_id = %s 
                    AND parser_status = 'completed'
                    AND (parsed_metadata IS NOT NULL OR extracted IS NOT NULL)
                    ORDER BY created_at DESC
                """, (user_id,))
                
                evidence_docs = []
                for row in cursor.fetchall():
                    # Prefer parsed_metadata, fall back to extracted
                    parsed = row[1] if row[1] else row[3]
                    if isinstance(parsed, str):
                        parsed = json.loads(parsed)
                    evidence_docs.append({
                        'id': str(row[0]),
                        'parsed_metadata': parsed if parsed else {},
                        'parser_confidence': float(row[2]) if row[2] else None
                    })
                
                return evidence_docs
    
    async def _create_evidence_link(self, dispute: Dict[str, Any], match: MatchResult, link_type: LinkType):
        """Create evidence link between dispute and document.
        
        Uses the actual schema: dispute_case_id (not dispute_id),
        relevance_score (not confidence), matched_context (not separate fields).
        """
        link_id = str(uuid.uuid4())
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                # Create evidence link using actual schema columns
                cursor.execute("""
                    INSERT INTO dispute_evidence_links 
                    (id, dispute_case_id, evidence_document_id, relevance_score, matched_context)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    link_id, dispute['id'], match.evidence_document_id,
                    match.final_confidence,
                    json.dumps({
                        'link_type': link_type.value,
                        'match_reasoning': match.reasoning,
                        'matched_fields': match.matched_fields,
                        'rule_score': match.rule_score,
                        'ml_score': match.ml_score,
                        'match_type': match.match_type,
                        'action_taken': match.action_taken
                    })
                ))
                
                # Update dispute evidence_attachments to track linked evidence
                cursor.execute("""
                    UPDATE dispute_cases 
                    SET evidence_attachments = COALESCE(evidence_attachments, '{}'::jsonb) || 
                        jsonb_build_object('linked_evidence_ids', 
                            COALESCE((evidence_attachments->>'linked_evidence_ids')::jsonb, '[]'::jsonb) || %s::jsonb
                        ),
                        updated_at = NOW()
                    WHERE id = %s
                """, (json.dumps([match.evidence_document_id]), dispute['id']))
    
    async def _create_smart_prompt(self, dispute: Dict[str, Any], match: MatchResult):
        """Create smart prompt for ambiguous match.
        
        Uses the actual schema: seller_id, related_dispute_id, prompt_type, metadata.
        """
        prompt_id = str(uuid.uuid4())
        
        # Generate question and options based on match type
        question, options = self._generate_smart_prompt_content(dispute, match)
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO smart_prompts 
                    (id, seller_id, related_dispute_id, prompt_type, question, options, status, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    prompt_id, 
                    dispute['user_id'],  # seller_id
                    dispute['id'],       # related_dispute_id
                    'evidence_selection',
                    question, 
                    json.dumps(options),
                    'open',
                    json.dumps({
                        'evidence_document_id': match.evidence_document_id,
                        'match_confidence': match.final_confidence,
                        'match_type': match.match_type,
                        'reasoning': match.reasoning
                    })
                ))
    
    def _generate_smart_prompt_content(self, dispute: Dict[str, Any], match: MatchResult) -> Tuple[str, List[Dict[str, Any]]]:
        """Generate smart prompt question and options"""
        if match.match_type == "supplier_match":
            question = f"We found an invoice from {match.reasoning.split('(')[0].strip()}. Is this related to your dispute for order {dispute['order_id']}?"
            options = [
                {"id": "yes", "text": "Yes, this is the correct invoice", "action": "confirm_match"},
                {"id": "no", "text": "No, this is not related", "action": "reject_match"},
                {"id": "unsure", "text": "I'm not sure", "action": "manual_review"}
            ]
        elif match.match_type == "sku_match":
            question = f"We found an invoice with SKU {dispute.get('sku', 'N/A')} that matches your dispute. Is this the correct evidence?"
            options = [
                {"id": "yes", "text": "Yes, this matches my dispute", "action": "confirm_match"},
                {"id": "no", "text": "No, this doesn't match", "action": "reject_match"},
                {"id": "review", "text": "I need to review this", "action": "manual_review"}
            ]
        else:
            question = f"We found a potential match for your dispute. {match.reasoning}. Is this evidence related to your case?"
            options = [
                {"id": "yes", "text": "Yes, this is related", "action": "confirm_match"},
                {"id": "no", "text": "No, this is not related", "action": "reject_match"},
                {"id": "review", "text": "I need to review this", "action": "manual_review"}
            ]
        
        return question, options
    
    async def _update_dispute_status(self, dispute_id: str, status: str, confidence: float):
        """Update dispute case status.
        
        Maps internal statuses to actual schema statuses:
        - 'auto_submitted' -> 'submitted'
        - 'smart_prompt_sent' -> 'pending' (keeps pending until user responds)
        - 'pending' -> 'pending'
        
        Stores match_confidence in provider_response JSONB since there's no dedicated column.
        """
        # Map internal statuses to schema-valid statuses
        status_map = {
            'auto_submitted': 'submitted',
            'smart_prompt_sent': 'pending',
            'pending': 'pending',
            'evidence_linked': 'pending'
        }
        actual_status = status_map.get(status, 'pending')
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    UPDATE dispute_cases 
                    SET status = %s, 
                        provider_response = COALESCE(provider_response, '{}'::jsonb) || 
                            jsonb_build_object('match_confidence', %s, 'match_status', %s),
                        updated_at = NOW()
                    WHERE id = %s
                """, (actual_status, confidence, status, dispute_id))

