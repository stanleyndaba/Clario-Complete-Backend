#!/usr/bin/env python3
"""
Knowledge Base Sync for Concierge Feedback Update System
Updates claim templates and edge cases based on successful and failed claims
"""

import json
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, asdict
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class ClaimTemplate:
    """Data structure for claim template"""
    template_name: str
    claim_type: str
    template_text: str
    required_evidence: List[str]
    success_rate: float
    usage_count: int = 0
    last_updated: datetime = None
    created_at: datetime = None

@dataclass
class EdgeCase:
    """Data structure for edge case"""
    edge_case_name: str
    claim_type: str
    description: str
    special_requirements: str
    success_patterns: List[str]
    failure_patterns: List[str]
    occurrence_count: int = 0
    last_updated: datetime = None
    created_at: datetime = None

class KnowledgeBaseSync:
    """Synchronizes knowledge base with successful and failed claims"""
    
    def __init__(self, db_connection=None):
        self.db_connection = db_connection
        self.templates = {}  # In-memory cache
        self.edge_cases = {}  # In-memory cache
        
    def update_successful_template(self, 
                                 claim_type: str,
                                 claim_text: str,
                                 evidence_used: List[str],
                                 template_name: Optional[str] = None) -> str:
        """
        Update or create template based on successful claim
        
        Args:
            claim_type: Type of claim (lost, damaged, fee, etc.)
            claim_text: Successful claim text
            evidence_used: List of evidence types that were successful
            template_name: Optional name for the template
            
        Returns:
            str: Template ID
        """
        try:
            # Generate template name if not provided
            if not template_name:
                template_name = f"{claim_type.capitalize()} Success Template"
            
            # Check if template exists
            template_id = self._find_matching_template(claim_type, claim_text)
            
            if template_id:
                # Update existing template
                self._update_existing_template(template_id, claim_text, evidence_used)
                logger.info(f"Updated existing template: {template_id}")
            else:
                # Create new template
                template_id = self._create_new_template(
                    template_name, claim_type, claim_text, evidence_used
                )
                logger.info(f"Created new template: {template_id}")
            
            return template_id
            
        except Exception as e:
            logger.error(f"Error updating successful template: {e}")
            raise
    
    def update_edge_case(self, 
                        claim_type: str,
                        description: str,
                        is_success: bool,
                        special_requirements: Optional[str] = None,
                        patterns: Optional[List[str]] = None) -> str:
        """
        Update edge case based on claim outcome
        
        Args:
            claim_type: Type of claim
            description: Description of the edge case
            is_success: Whether the claim was successful
            special_requirements: Special requirements for this edge case
            patterns: List of patterns that led to success/failure
            
        Returns:
            str: Edge case ID
        """
        try:
            # Check if edge case exists
            edge_case_id = self._find_matching_edge_case(claim_type, description)
            
            if edge_case_id:
                # Update existing edge case
                self._update_existing_edge_case(
                    edge_case_id, is_success, patterns, special_requirements
                )
                logger.info(f"Updated existing edge case: {edge_case_id}")
            else:
                # Create new edge case
                edge_case_id = self._create_new_edge_case(
                    claim_type, description, is_success, 
                    special_requirements, patterns
                )
                logger.info(f"Created new edge case: {edge_case_id}")
            
            return edge_case_id
            
        except Exception as e:
            logger.error(f"Error updating edge case: {e}")
            raise
    
    def get_best_template(self, claim_type: str, evidence_available: List[str]) -> Optional[ClaimTemplate]:
        """
        Get the best template for a claim type with available evidence
        
        Args:
            claim_type: Type of claim
            evidence_available: List of available evidence types
            
        Returns:
            Optional[ClaimTemplate]: Best matching template
        """
        try:
            best_template = None
            best_score = 0.0
            
            for template_id, template in self.templates.items():
                if template.claim_type != claim_type:
                    continue
                
                # Calculate match score
                evidence_match = len(set(template.required_evidence) & set(evidence_available))
                evidence_score = evidence_match / len(template.required_evidence) if template.required_evidence else 0
                
                # Combined score: evidence match + success rate + usage count
                combined_score = (evidence_score * 0.5 + 
                                template.success_rate * 0.3 + 
                                min(template.usage_count / 100, 1.0) * 0.2)
                
                if combined_score > best_score:
                    best_score = combined_score
                    best_template = template
            
            return best_template
            
        except Exception as e:
            logger.error(f"Error getting best template: {e}")
            return None
    
    def get_edge_case_requirements(self, claim_type: str, claim_text: str) -> Optional[str]:
        """
        Get special requirements for edge case if applicable
        
        Args:
            claim_type: Type of claim
            claim_text: Claim text to check
            
        Returns:
            Optional[str]: Special requirements if edge case detected
        """
        try:
            for edge_case_id, edge_case in self.edge_cases.items():
                if edge_case.claim_type != claim_type:
                    continue
                
                # Check if claim text matches any patterns
                text_lower = claim_text.lower()
                
                # Check success patterns
                for pattern in edge_case.success_patterns:
                    if pattern.lower() in text_lower:
                        return edge_case.special_requirements
                
                # Check failure patterns
                for pattern in edge_case.failure_patterns:
                    if pattern.lower() in text_lower:
                        return edge_case.special_requirements
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting edge case requirements: {e}")
            return None
    
    def sync_from_database(self) -> bool:
        """Sync knowledge base from database"""
        try:
            if not self.db_connection:
                logger.warning("No database connection available for sync")
                return False
            
            # Load templates
            templates = self._load_templates_from_database()
            for template in templates:
                self.templates[template['id']] = ClaimTemplate(**template)
            
            # Load edge cases
            edge_cases = self._load_edge_cases_from_database()
            for edge_case in edge_cases:
                self.edge_cases[edge_case['id']] = EdgeCase(**edge_case)
            
            logger.info(f"Synced {len(templates)} templates and {len(edge_cases)} edge cases from database")
            return True
            
        except Exception as e:
            logger.error(f"Error syncing from database: {e}")
            return False
    
    def export_knowledge_base(self) -> Dict:
        """Export knowledge base for backup or transfer"""
        try:
            templates_data = {}
            for template_id, template in self.templates.items():
                templates_data[template_id] = asdict(template)
            
            edge_cases_data = {}
            for edge_case_id, edge_case in self.edge_cases.items():
                edge_cases_data[edge_case_id] = asdict(edge_case)
            
            return {
                'templates': templates_data,
                'edge_cases': edge_cases_data,
                'export_date': datetime.now().isoformat(),
                'version': '1.0'
            }
            
        except Exception as e:
            logger.error(f"Error exporting knowledge base: {e}")
            return {}
    
    def import_knowledge_base(self, data: Dict) -> bool:
        """Import knowledge base from backup"""
        try:
            if 'templates' in data:
                for template_id, template_data in data['templates'].items():
                    self.templates[template_id] = ClaimTemplate(**template_data)
            
            if 'edge_cases' in data:
                for edge_case_id, edge_case_data in data['edge_cases'].items():
                    self.edge_cases[edge_case_id] = EdgeCase(**edge_case_data)
            
            logger.info(f"Imported {len(data.get('templates', {}))} templates and {len(data.get('edge_cases', {}))} edge cases")
            return True
            
        except Exception as e:
            logger.error(f"Error importing knowledge base: {e}")
            return False
    
    def _find_matching_template(self, claim_type: str, claim_text: str) -> Optional[str]:
        """Find matching template based on claim type and text similarity"""
        try:
            best_match_id = None
            best_similarity = 0.0
            
            for template_id, template in self.templates.items():
                if template.claim_type != claim_type:
                    continue
                
                # Calculate text similarity (simple word overlap)
                template_words = set(template.template_text.lower().split())
                claim_words = set(claim_text.lower().split())
                
                if not template_words:
                    continue
                
                overlap = len(template_words.intersection(claim_words))
                similarity = overlap / len(template_words)
                
                if similarity > best_similarity and similarity > 0.3:  # Minimum similarity threshold
                    best_similarity = similarity
                    best_match_id = template_id
            
            return best_match_id
            
        except Exception as e:
            logger.error(f"Error finding matching template: {e}")
            return None
    
    def _update_existing_template(self, template_id: str, claim_text: str, evidence_used: List[str]):
        """Update existing template with new successful claim"""
        try:
            template = self.templates[template_id]
            
            # Update usage count
            template.usage_count += 1
            
            # Update success rate (simple average)
            current_success_rate = template.success_rate
            template.success_rate = (current_success_rate * (template.usage_count - 1) + 1.0) / template.usage_count
            
            # Update required evidence (union of existing and new)
            template.required_evidence = list(set(template.required_evidence + evidence_used))
            
            # Update template text if new one is better (longer/more detailed)
            if len(claim_text) > len(template.template_text):
                template.template_text = claim_text
            
            template.last_updated = datetime.now()
            
        except Exception as e:
            logger.error(f"Error updating existing template: {e}")
    
    def _create_new_template(self, template_name: str, claim_type: str, 
                           claim_text: str, evidence_used: List[str]) -> str:
        """Create new template"""
        try:
            template_id = str(uuid.uuid4())
            
            template = ClaimTemplate(
                template_name=template_name,
                claim_type=claim_type,
                template_text=claim_text,
                required_evidence=evidence_used,
                success_rate=1.0,
                usage_count=1,
                last_updated=datetime.now(),
                created_at=datetime.now()
            )
            
            self.templates[template_id] = template
            
            # Store in database if available
            if self.db_connection:
                self._store_template_in_database(template_id, template)
            
            return template_id
            
        except Exception as e:
            logger.error(f"Error creating new template: {e}")
            raise
    
    def _find_matching_edge_case(self, claim_type: str, description: str) -> Optional[str]:
        """Find matching edge case based on claim type and description similarity"""
        try:
            best_match_id = None
            best_similarity = 0.0
            
            for edge_case_id, edge_case in self.edge_cases.items():
                if edge_case.claim_type != claim_type:
                    continue
                
                # Calculate description similarity
                edge_case_words = set(edge_case.description.lower().split())
                description_words = set(description.lower().split())
                
                if not edge_case_words:
                    continue
                
                overlap = len(edge_case_words.intersection(description_words))
                similarity = overlap / len(edge_case_words)
                
                if similarity > best_similarity and similarity > 0.2:  # Lower threshold for edge cases
                    best_similarity = similarity
                    best_match_id = edge_case_id
            
            return best_match_id
            
        except Exception as e:
            logger.error(f"Error finding matching edge case: {e}")
            return None
    
    def _update_existing_edge_case(self, edge_case_id: str, is_success: bool, 
                                 patterns: Optional[List[str]], special_requirements: Optional[str]):
        """Update existing edge case"""
        try:
            edge_case = self.edge_cases[edge_case_id]
            
            # Update occurrence count
            edge_case.occurrence_count += 1
            
            # Update patterns
            if patterns:
                if is_success:
                    edge_case.success_patterns.extend(patterns)
                else:
                    edge_case.failure_patterns.extend(patterns)
                
                # Remove duplicates
                edge_case.success_patterns = list(set(edge_case.success_patterns))
                edge_case.failure_patterns = list(set(edge_case.failure_patterns))
            
            # Update special requirements if provided
            if special_requirements:
                edge_case.special_requirements = special_requirements
            
            edge_case.last_updated = datetime.now()
            
        except Exception as e:
            logger.error(f"Error updating existing edge case: {e}")
    
    def _create_new_edge_case(self, claim_type: str, description: str, is_success: bool,
                            special_requirements: Optional[str], patterns: Optional[List[str]]) -> str:
        """Create new edge case"""
        try:
            edge_case_id = str(uuid.uuid4())
            
            edge_case = EdgeCase(
                edge_case_name=f"{claim_type.capitalize()} Edge Case",
                claim_type=claim_type,
                description=description,
                special_requirements=special_requirements or "",
                success_patterns=patterns if is_success else [],
                failure_patterns=patterns if not is_success else [],
                occurrence_count=1,
                last_updated=datetime.now(),
                created_at=datetime.now()
            )
            
            self.edge_cases[edge_case_id] = edge_case
            
            # Store in database if available
            if self.db_connection:
                self._store_edge_case_in_database(edge_case_id, edge_case)
            
            return edge_case_id
            
        except Exception as e:
            logger.error(f"Error creating new edge case: {e}")
            raise
    
    def _store_template_in_database(self, template_id: str, template: ClaimTemplate) -> bool:
        """Store template in database"""
        try:
            query = """
            INSERT INTO claim_templates (
                id, template_name, claim_type, template_text, required_evidence,
                success_rate, usage_count, last_updated, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                template_text = EXCLUDED.template_text,
                required_evidence = EXCLUDED.required_evidence,
                success_rate = EXCLUDED.success_rate,
                usage_count = EXCLUDED.usage_count,
                last_updated = EXCLUDED.last_updated
            """
            
            # Execute query with database connection
            # cursor.execute(query, (
            #     template_id, template.template_name, template.claim_type,
            #     template.template_text, template.required_evidence,
            #     template.success_rate, template.usage_count,
            #     template.last_updated, template.created_at
            # ))
            
            return True
            
        except Exception as e:
            logger.error(f"Database template storage error: {e}")
            return False
    
    def _store_edge_case_in_database(self, edge_case_id: str, edge_case: EdgeCase) -> bool:
        """Store edge case in database"""
        try:
            query = """
            INSERT INTO claim_edge_cases (
                id, edge_case_name, claim_type, description, special_requirements,
                success_patterns, failure_patterns, occurrence_count, last_updated, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                description = EXCLUDED.description,
                special_requirements = EXCLUDED.special_requirements,
                success_patterns = EXCLUDED.success_patterns,
                failure_patterns = EXCLUDED.failure_patterns,
                occurrence_count = EXCLUDED.occurrence_count,
                last_updated = EXCLUDED.last_updated
            """
            
            # Execute query with database connection
            # cursor.execute(query, (
            #     edge_case_id, edge_case.edge_case_name, edge_case.claim_type,
            #     edge_case.description, edge_case.special_requirements,
            #     edge_case.success_patterns, edge_case.failure_patterns,
            #     edge_case.occurrence_count, edge_case.last_updated, edge_case.created_at
            # ))
            
            return True
            
        except Exception as e:
            logger.error(f"Database edge case storage error: {e}")
            return False
    
    def _load_templates_from_database(self) -> List[Dict]:
        """Load templates from database"""
        try:
            query = """
            SELECT * FROM claim_templates
            ORDER BY success_rate DESC, usage_count DESC
            """
            
            # Execute query and return results
            # cursor.execute(query)
            # return cursor.fetchall()
            
            # Placeholder return
            return []
            
        except Exception as e:
            logger.error(f"Database template loading error: {e}")
            return []
    
    def _load_edge_cases_from_database(self) -> List[Dict]:
        """Load edge cases from database"""
        try:
            query = """
            SELECT * FROM claim_edge_cases
            ORDER BY occurrence_count DESC, last_updated DESC
            """
            
            # Execute query and return results
            # cursor.execute(query)
            # return cursor.fetchall()
            
            # Placeholder return
            return []
            
        except Exception as e:
            logger.error(f"Database edge case loading error: {e}")
            return []

