#!/usr/bin/env python3
"""
Rejection Reason Normalization Engine for Claim Detector v2.0
Converts Amazon's varied rejection text into standardized categories for consistent processing
"""

import re
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
import json
from pathlib import Path
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import pickle

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class NormalizedRejection:
    """Normalized rejection reason with structured information"""
    category: str
    confidence: float
    required_evidence: List[str]
    is_fixable: bool
    amazon_original_text: str
    normalized_text: str
    subcategory: Optional[str] = None
    policy_reference: Optional[str] = None
    time_constraint: Optional[str] = None
    amount_constraint: Optional[str] = None

@dataclass
class RejectionPattern:
    """Pattern for matching rejection reasons"""
    pattern: str
    category: str
    subcategory: Optional[str]
    confidence: float
    required_evidence: List[str]
    is_fixable: bool
    policy_reference: Optional[str]
    time_constraint: Optional[str]
    amount_constraint: Optional[str]

class RejectionNormalizer:
    """Normalizes Amazon rejection reasons into structured categories"""
    
    def __init__(self, patterns_file: Optional[str] = None):
        self.patterns_file = patterns_file or "rejection_patterns.json"
        self.rejection_patterns = self._load_rejection_patterns()
        self.tfidf_vectorizer = None
        self.pattern_embeddings = None
        self._build_pattern_embeddings()
        
        # Standard rejection categories
        self.standard_categories = [
            "missing_invoice",
            "timeframe_expired", 
            "insufficient_evidence",
            "policy_not_claimable",
            "format_error",
            "duplicate_claim",
            "amount_exceeds_limit",
            "warehouse_location_issue",
            "marketplace_specific_rule",
            "seller_account_issue"
        ]
        
        # Evidence requirements mapping
        self.evidence_mapping = {
            "missing_invoice": ["invoice", "packing_list", "purchase_order"],
            "timeframe_expired": ["age_justification", "policy_exception_request"],
            "insufficient_evidence": ["photos", "damage_report", "inspection_certificate"],
            "policy_not_claimable": ["policy_reference", "exception_request"],
            "format_error": ["corrected_documentation", "format_guide"],
            "duplicate_claim": ["claim_history", "previous_submission_proof"],
            "amount_exceeds_limit": ["manager_approval", "policy_exception"],
            "warehouse_location_issue": ["location_verification", "transfer_documentation"],
            "marketplace_specific_rule": ["marketplace_policy", "local_requirements"],
            "seller_account_issue": ["account_verification", "compliance_documentation"]
        }
    
    def _load_rejection_patterns(self) -> List[RejectionPattern]:
        """Load rejection patterns from file or use defaults"""
        try:
            if Path(self.patterns_file).exists():
                with open(self.patterns_file, 'r') as f:
                    patterns_data = json.load(f)
                    return [RejectionPattern(**pattern) for pattern in patterns_data]
            else:
                logger.info(f"⚠️ Patterns file not found: {self.patterns_file}, using default patterns")
                return self._get_default_patterns()
        except Exception as e:
            logger.error(f"❌ Error loading patterns: {e}, using default patterns")
            return self._get_default_patterns()
    
    def _get_default_patterns(self) -> List[RejectionPattern]:
        """Get default rejection patterns"""
        return [
            # Missing Invoice Patterns
            RejectionPattern(
                pattern=r"invoice.*missing|no.*invoice|invoice.*required|missing.*invoice",
                category="missing_invoice",
                subcategory="documentation",
                confidence=0.95,
                required_evidence=["invoice", "packing_list"],
                is_fixable=True,
                policy_reference="Documentation Requirements",
                time_constraint=None,
                amount_constraint=None
            ),
            
            # Timeframe Expired Patterns
            RejectionPattern(
                pattern=r"18.*month|time.*limit|expired.*claim|beyond.*timeframe|too.*old",
                category="timeframe_expired",
                subcategory="eligibility",
                confidence=0.90,
                required_evidence=["age_justification", "policy_exception_request"],
                is_fixable=False,
                policy_reference="18-Month Policy",
                time_constraint="18 months from shipment",
                amount_constraint=None
            ),
            
            # Insufficient Evidence Patterns
            RejectionPattern(
                pattern=r"evidence.*insufficient|proof.*required|documentation.*needed|more.*evidence",
                category="insufficient_evidence",
                subcategory="documentation",
                confidence=0.85,
                required_evidence=["photos", "damage_report", "inspection_certificate"],
                is_fixable=True,
                policy_reference="Evidence Requirements",
                time_constraint=None,
                amount_constraint=None
            ),
            
            # Policy Not Claimable Patterns
            RejectionPattern(
                pattern=r"policy.*not.*claimable|not.*eligible|excluded.*policy|policy.*exclusion",
                category="policy_not_claimable",
                subcategory="eligibility",
                confidence=0.80,
                required_evidence=["policy_reference", "exception_request"],
                is_fixable=False,
                policy_reference="Policy Exclusions",
                time_constraint=None,
                amount_constraint=None
            ),
            
            # Format Error Patterns
            RejectionPattern(
                pattern=r"format.*error|incorrect.*format|wrong.*format|format.*issue",
                category="format_error",
                subcategory="submission",
                confidence=0.75,
                required_evidence=["corrected_documentation", "format_guide"],
                is_fixable=True,
                policy_reference="Submission Format Requirements",
                time_constraint=None,
                amount_constraint=None
            ),
            
            # Duplicate Claim Patterns
            RejectionPattern(
                pattern=r"duplicate.*claim|already.*submitted|previous.*claim|duplicate.*submission",
                category="duplicate_claim",
                subcategory="submission",
                confidence=0.90,
                required_evidence=["claim_history", "previous_submission_proof"],
                is_fixable=False,
                policy_reference="Duplicate Claim Policy",
                time_constraint=None,
                amount_constraint=None
            ),
            
            # Amount Exceeds Limit Patterns
            RejectionPattern(
                pattern=r"amount.*exceeds|limit.*exceeded|maximum.*amount|too.*high",
                category="amount_exceeds_limit",
                subcategory="eligibility",
                confidence=0.85,
                required_evidence=["manager_approval", "policy_exception"],
                is_fixable=True,
                policy_reference="Amount Limits",
                time_constraint=None,
                amount_constraint="Varies by claim type"
            ),
            
            # Warehouse Location Issue Patterns
            RejectionPattern(
                pattern=r"warehouse.*location|location.*issue|wrong.*warehouse|location.*mismatch",
                category="warehouse_location_issue",
                subcategory="logistics",
                confidence=0.80,
                required_evidence=["location_verification", "transfer_documentation"],
                is_fixable=True,
                policy_reference="Warehouse Location Policy",
                time_constraint=None,
                amount_constraint=None
            ),
            
            # Marketplace Specific Rule Patterns
            RejectionPattern(
                pattern=r"marketplace.*specific|local.*rule|regional.*policy|country.*specific",
                category="marketplace_specific_rule",
                subcategory="marketplace",
                confidence=0.75,
                required_evidence=["marketplace_policy", "local_requirements"],
                is_fixable=True,
                policy_reference="Marketplace-Specific Rules",
                time_constraint=None,
                amount_constraint=None
            ),
            
            # Seller Account Issue Patterns
            RejectionPattern(
                pattern=r"seller.*account|account.*issue|account.*suspended|compliance.*issue",
                category="seller_account_issue",
                subcategory="account",
                confidence=0.90,
                required_evidence=["account_verification", "compliance_documentation"],
                is_fixable=True,
                policy_reference="Seller Account Requirements",
                time_constraint=None,
                amount_constraint=None
            )
        ]
    
    def _build_pattern_embeddings(self):
        """Build TF-IDF embeddings for pattern matching"""
        try:
            pattern_texts = [pattern.pattern for pattern in self.rejection_patterns]
            self.tfidf_vectorizer = TfidfVectorizer(
                ngram_range=(1, 3),
                max_features=1000,
                stop_words='english'
            )
            self.pattern_embeddings = self.tfidf_vectorizer.fit_transform(pattern_texts)
            logger.info("✅ Pattern embeddings built successfully")
        except Exception as e:
            logger.error(f"❌ Error building pattern embeddings: {e}")
            self.tfidf_vectorizer = None
            self.pattern_embeddings = None
    
    def normalize_rejection(self, amazon_reason: str) -> NormalizedRejection:
        """Convert Amazon's rejection text to structured format"""
        if not amazon_reason or not amazon_reason.strip():
            return self._create_unknown_rejection(amazon_reason)
        
        # Clean the rejection text
        cleaned_reason = self._clean_rejection_text(amazon_reason)
        
        # Try exact pattern matching first
        exact_match = self._find_exact_pattern_match(cleaned_reason)
        if exact_match:
            return exact_match
        
        # Try fuzzy pattern matching
        fuzzy_match = self._find_fuzzy_pattern_match(cleaned_reason)
        if fuzzy_match:
            return fuzzy_match
        
        # Try semantic similarity matching
        semantic_match = self._find_semantic_match(cleaned_reason)
        if semantic_match:
            return semantic_match
        
        # Fallback to unknown category
        return self._create_unknown_rejection(amazon_reason)
    
    def _clean_rejection_text(self, text: str) -> str:
        """Clean and normalize rejection text"""
        # Convert to lowercase
        text = text.lower()
        
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Remove special characters but keep important ones
        text = re.sub(r'[^\w\s\-\.]', ' ', text)
        
        # Normalize common abbreviations
        text = re.sub(r'\b(inc|corp|llc|ltd)\b', '', text)
        
        return text.strip()
    
    def _find_exact_pattern_match(self, cleaned_reason: str) -> Optional[NormalizedRejection]:
        """Find exact pattern match using regex"""
        for pattern in self.rejection_patterns:
            if re.search(pattern.pattern, cleaned_reason, re.IGNORECASE):
                return self._create_normalized_rejection(pattern, cleaned_reason)
        return None
    
    def _find_fuzzy_pattern_match(self, cleaned_reason: str) -> Optional[NormalizedRejection]:
        """Find fuzzy pattern match using partial matching"""
        best_match = None
        best_score = 0.0
        
        for pattern in self.rejection_patterns:
            # Split pattern into words
            pattern_words = set(re.findall(r'\w+', pattern.pattern.lower()))
            reason_words = set(cleaned_reason.split())
            
            # Calculate word overlap
            overlap = len(pattern_words.intersection(reason_words))
            total_words = len(pattern_words.union(reason_words))
            
            if total_words > 0:
                score = overlap / total_words
                if score > best_score and score > 0.3:  # Threshold for fuzzy matching
                    best_score = score
                    best_match = pattern
        
        if best_match:
            return self._create_normalized_rejection(best_match, cleaned_reason, confidence=best_score * 0.8)
        
        return None
    
    def _find_semantic_match(self, cleaned_reason: str) -> Optional[NormalizedRejection]:
        """Find semantic match using TF-IDF similarity"""
        if self.tfidf_vectorizer is None or self.pattern_embeddings is None:
            return None
        
        try:
            # Vectorize the input reason
            reason_vector = self.tfidf_vectorizer.transform([cleaned_reason])
            
            # Calculate similarity with all patterns
            similarities = cosine_similarity(reason_vector, self.pattern_embeddings).flatten()
            
            # Find best match
            best_idx = np.argmax(similarities)
            best_similarity = similarities[best_idx]
            
            if best_similarity > 0.2:  # Threshold for semantic matching
                best_pattern = self.rejection_patterns[best_idx]
                return self._create_normalized_rejection(best_pattern, cleaned_reason, confidence=best_similarity * 0.7)
        
        except Exception as e:
            logger.error(f"❌ Error in semantic matching: {e}")
        
        return None
    
    def _create_normalized_rejection(self, pattern: RejectionPattern, original_text: str, confidence: Optional[float] = None) -> NormalizedRejection:
        """Create normalized rejection from pattern"""
        return NormalizedRejection(
            category=pattern.category,
            confidence=confidence or pattern.confidence,
            required_evidence=pattern.required_evidence.copy(),
            is_fixable=pattern.is_fixable,
            amazon_original_text=original_text,
            normalized_text=pattern.category.replace('_', ' ').title(),
            subcategory=pattern.subcategory,
            policy_reference=pattern.policy_reference,
            time_constraint=pattern.time_constraint,
            amount_constraint=pattern.amount_constraint
        )
    
    def _create_unknown_rejection(self, original_text: str) -> NormalizedRejection:
        """Create unknown rejection category"""
        return NormalizedRejection(
            category="unknown",
            confidence=0.0,
            required_evidence=["general_documentation", "policy_review"],
            is_fixable=False,
            amazon_original_text=original_text,
            normalized_text="Unknown Rejection Reason",
            subcategory="unclassified",
            policy_reference="Requires Manual Review",
            time_constraint=None,
            amount_constraint=None
        )
    
    def get_required_evidence(self, category: str) -> List[str]:
        """Get required evidence for a rejection category"""
        return self.evidence_mapping.get(category, ["general_documentation"])
    
    def is_fixable(self, category: str) -> bool:
        """Check if a rejection category is fixable"""
        for pattern in self.rejection_patterns:
            if pattern.category == category:
                return pattern.is_fixable
        return False
    
    def get_policy_reference(self, category: str) -> Optional[str]:
        """Get policy reference for a rejection category"""
        for pattern in self.rejection_patterns:
            if pattern.category == category:
                return pattern.policy_reference
        return None
    
    def add_custom_pattern(self, pattern: RejectionPattern):
        """Add a custom rejection pattern"""
        self.rejection_patterns.append(pattern)
        self._build_pattern_embeddings()  # Rebuild embeddings
        logger.info(f"✅ Added custom pattern: {pattern.category}")
    
    def remove_pattern(self, category: str):
        """Remove a rejection pattern by category"""
        self.rejection_patterns = [p for p in self.rejection_patterns if p.category != category]
        self._build_pattern_embeddings()  # Rebuild embeddings
        logger.info(f"✅ Removed pattern: {category}")
    
    def save_patterns(self, filepath: Optional[str] = None):
        """Save rejection patterns to file"""
        filepath = filepath or self.patterns_file
        
        try:
            patterns_data = []
            for pattern in self.rejection_patterns:
                pattern_dict = {
                    'pattern': pattern.pattern,
                    'category': pattern.category,
                    'subcategory': pattern.subcategory,
                    'confidence': pattern.confidence,
                    'required_evidence': pattern.required_evidence,
                    'is_fixable': pattern.is_fixable,
                    'policy_reference': pattern.policy_reference,
                    'time_constraint': pattern.time_constraint,
                    'amount_constraint': pattern.amount_constraint
                }
                patterns_data.append(pattern_dict)
            
            with open(filepath, 'w') as f:
                json.dump(patterns_data, f, indent=2)
            
            logger.info(f"✅ Patterns saved to {filepath}")
            
        except Exception as e:
            logger.error(f"❌ Error saving patterns: {e}")
    
    def get_patterns_summary(self) -> Dict[str, Any]:
        """Get summary of all rejection patterns"""
        summary = {
            'total_patterns': len(self.rejection_patterns),
            'categories': {},
            'fixable_count': 0,
            'unfixable_count': 0
        }
        
        for pattern in self.rejection_patterns:
            if pattern.category not in summary['categories']:
                summary['categories'][pattern.category] = {
                    'count': 0,
                    'subcategories': set(),
                    'fixable': pattern.is_fixable
                }
            
            summary['categories'][pattern.category]['count'] += 1
            if pattern.subcategory:
                summary['categories'][pattern.category]['subcategories'].add(pattern.subcategory)
            
            if pattern.is_fixable:
                summary['fixable_count'] += 1
            else:
                summary['unfixable_count'] += 1
        
        # Convert sets to lists for JSON serialization
        for category_info in summary['categories'].values():
            category_info['subcategories'] = list(category_info['subcategories'])
        
        return summary










