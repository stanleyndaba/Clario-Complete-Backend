"""
Mapping service for invoice SKUs to catalog SKUs/ASINs
"""
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import re
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

class SKUMappingService:
    """Service for mapping invoice SKUs to catalog SKUs and ASINs"""
    
    def __init__(self, fuzzy_threshold: float = 0.8):
        self.fuzzy_threshold = fuzzy_threshold
        self.catalog_cache = {}  # Cache for catalog lookups
        
    def map_invoice_skus(self, invoice_items: List[Dict[str, Any]], 
                         catalog_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Map invoice SKUs to catalog SKUs and ASINs
        
        Args:
            invoice_items: List of invoice items with raw_sku
            catalog_data: Catalog data with SKU mappings
            
        Returns:
            List of mapped invoice items
        """
        try:
            mapped_items = []
            
            for item in invoice_items:
                raw_sku = item.get('raw_sku')
                if not raw_sku:
                    # No SKU to map
                    mapped_item = item.copy()
                    mapped_item.update({
                        'mapped_sku': None,
                        'asin': None,
                        'mapping_confidence': 0.0,
                        'mapping_status': 'no_sku'
                    })
                    mapped_items.append(mapped_item)
                    continue
                
                # Try to map the SKU
                mapping_result = self._map_single_sku(raw_sku, catalog_data)
                
                mapped_item = item.copy()
                mapped_item.update(mapping_result)
                mapped_items.append(mapped_item)
            
            return mapped_items
            
        except Exception as e:
            logger.error(f"SKU mapping failed: {e}")
            raise
    
    def _map_single_sku(self, raw_sku: str, catalog_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Map a single SKU to catalog data
        
        Args:
            raw_sku: Raw SKU from invoice
            catalog_data: Catalog data
            
        Returns:
            Mapping result with mapped_sku, asin, confidence, and status
        """
        try:
            # Clean the raw SKU
            cleaned_sku = self._clean_sku(raw_sku)
            
            # Try exact match first
            exact_match = self._find_exact_match(cleaned_sku, catalog_data)
            if exact_match:
                return {
                    'mapped_sku': exact_match['sku'],
                    'asin': exact_match.get('asin'),
                    'mapping_confidence': 1.0,
                    'mapping_status': 'exact_match'
                }
            
            # Try normalized match
            normalized_match = self._find_normalized_match(cleaned_sku, catalog_data)
            if normalized_match:
                return {
                    'mapped_sku': normalized_match['sku'],
                    'asin': normalized_match.get('asin'),
                    'mapping_confidence': 0.95,
                    'mapping_status': 'normalized_match'
                }
            
            # Try fuzzy match
            fuzzy_match = self._find_fuzzy_match(cleaned_sku, catalog_data)
            if fuzzy_match:
                return {
                    'mapped_sku': fuzzy_match['sku'],
                    'asin': fuzzy_match.get('asin'),
                    'mapping_confidence': fuzzy_match['similarity'],
                    'mapping_status': 'fuzzy_match'
                }
            
            # No match found
            return {
                'mapped_sku': None,
                'asin': None,
                'mapping_confidence': 0.0,
                'mapping_status': 'no_match'
            }
            
        except Exception as e:
            logger.error(f"Failed to map SKU {raw_sku}: {e}")
            return {
                'mapped_sku': None,
                'asin': None,
                'mapping_confidence': 0.0,
                'mapping_status': 'error'
            }
    
    def _clean_sku(self, raw_sku: str) -> str:
        """Clean and normalize raw SKU"""
        if not raw_sku:
            return ""
        
        # Convert to uppercase
        cleaned = raw_sku.upper()
        
        # Remove common prefixes/suffixes
        prefixes_to_remove = ['SKU:', 'ITEM:', 'PRODUCT:', 'CODE:']
        for prefix in prefixes_to_remove:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip()
        
        # Remove extra whitespace and special characters
        cleaned = re.sub(r'[^\w\-]', '', cleaned)
        
        return cleaned.strip()
    
    def _find_exact_match(self, cleaned_sku: str, catalog_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find exact match in catalog"""
        catalog_skus = catalog_data.get('skus', {})
        
        # Direct key lookup
        if cleaned_sku in catalog_skus:
            return catalog_skus[cleaned_sku]
        
        # Check in SKU list
        for sku_info in catalog_data.get('sku_list', []):
            if sku_info.get('sku') == cleaned_sku:
                return sku_info
        
        return None
    
    def _find_normalized_match(self, cleaned_sku: str, catalog_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find normalized match in catalog"""
        # Try different normalization variations
        variations = self._generate_sku_variations(cleaned_sku)
        
        for variation in variations:
            match = self._find_exact_match(variation, catalog_data)
            if match:
                return match
        
        return None
    
    def _generate_sku_variations(self, sku: str) -> List[str]:
        """Generate common SKU variations"""
        variations = [sku]
        
        # Remove hyphens
        if '-' in sku:
            variations.append(sku.replace('-', ''))
        
        # Add hyphens at common positions
        if len(sku) >= 6 and '-' not in sku:
            # Try adding hyphen after 2-4 characters
            for i in range(2, min(5, len(sku))):
                variations.append(f"{sku[:i]}-{sku[i:]}")
        
        # Remove leading zeros
        if sku.startswith('0'):
            variations.append(sku.lstrip('0'))
        
        return list(set(variations))  # Remove duplicates
    
    def _find_fuzzy_match(self, cleaned_sku: str, catalog_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find fuzzy match in catalog using similarity scoring"""
        best_match = None
        best_similarity = 0.0
        
        # Get all catalog SKUs
        catalog_skus = []
        
        # Add from skus dict
        catalog_skus.extend(catalog_data.get('skus', {}).keys())
        
        # Add from sku_list
        for sku_info in catalog_data.get('sku_list', []):
            if 'sku' in sku_info:
                catalog_skus.append(sku_info['sku'])
        
        # Calculate similarity with each catalog SKU
        for catalog_sku in catalog_skus:
            if not catalog_sku:
                continue
            
            similarity = self._calculate_similarity(cleaned_sku, catalog_sku)
            
            if similarity > best_similarity and similarity >= self.fuzzy_threshold:
                best_similarity = similarity
                best_match = self._get_sku_info(catalog_sku, catalog_data)
        
        if best_match:
            best_match['similarity'] = best_similarity
            return best_match
        
        return None
    
    def _calculate_similarity(self, sku1: str, sku2: str) -> float:
        """Calculate similarity between two SKUs"""
        if not sku1 or not sku2:
            return 0.0
        
        # Use SequenceMatcher for string similarity
        similarity = SequenceMatcher(None, sku1.lower(), sku2.lower()).ratio()
        
        # Bonus for same length
        if len(sku1) == len(sku2):
            similarity += 0.1
        
        # Bonus for same prefix
        if sku1.lower().startswith(sku2.lower()[:3]) or sku2.lower().startswith(sku1.lower()[:3]):
            similarity += 0.1
        
        return min(1.0, similarity)
    
    def _get_sku_info(self, sku: str, catalog_data: Dict[str, Any]) -> Dict[str, Any]:
        """Get SKU information from catalog data"""
        # Try skus dict first
        if sku in catalog_data.get('skus', {}):
            return catalog_data['skus'][sku]
        
        # Try sku_list
        for sku_info in catalog_data.get('sku_list', []):
            if sku_info.get('sku') == sku:
                return sku_info
        
        # Return basic info if not found
        return {'sku': sku}
    
    def batch_map_skus(self, sku_list: List[str], catalog_data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """
        Batch map multiple SKUs
        
        Args:
            sku_list: List of SKUs to map
            catalog_data: Catalog data
            
        Returns:
            Dict mapping SKU to mapping result
        """
        results = {}
        
        for sku in sku_list:
            mapping_result = self._map_single_sku(sku, catalog_data)
            results[sku] = mapping_result
        
        return results
    
    def get_mapping_statistics(self, mapped_items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Get statistics about SKU mapping results
        
        Args:
            mapped_items: List of mapped invoice items
            
        Returns:
            Mapping statistics
        """
        stats = {
            'total_items': len(mapped_items),
            'mapped_items': 0,
            'unmapped_items': 0,
            'mapping_status_counts': {},
            'confidence_distribution': {
                'high': 0,      # >= 0.9
                'medium': 0,    # 0.7-0.89
                'low': 0,       # 0.5-0.69
                'none': 0       # < 0.5
            }
        }
        
        for item in mapped_items:
            status = item.get('mapping_status', 'unknown')
            confidence = item.get('mapping_confidence', 0.0)
            
            # Count by status
            stats['mapping_status_counts'][status] = stats['mapping_status_counts'].get(status, 0) + 1
            
            # Count mapped vs unmapped
            if item.get('mapped_sku'):
                stats['mapped_items'] += 1
            else:
                stats['unmapped_items'] += 1
            
            # Count by confidence level
            if confidence >= 0.9:
                stats['confidence_distribution']['high'] += 1
            elif confidence >= 0.7:
                stats['confidence_distribution']['medium'] += 1
            elif confidence >= 0.5:
                stats['confidence_distribution']['low'] += 1
            else:
                stats['confidence_distribution']['none'] += 1
        
        # Calculate success rate
        if stats['total_items'] > 0:
            stats['success_rate'] = stats['mapped_items'] / stats['total_items']
        else:
            stats['success_rate'] = 0.0
        
        return stats
    
    def suggest_mapping_improvements(self, mapped_items: List[Dict[str, Any]], 
                                   catalog_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Suggest improvements for failed or low-confidence mappings
        
        Args:
            mapped_items: List of mapped invoice items
            catalog_data: Catalog data
            
        Returns:
            List of improvement suggestions
        """
        suggestions = []
        
        for item in mapped_items:
            if item.get('mapping_status') in ['no_match', 'error'] or item.get('mapping_confidence', 0) < 0.5:
                raw_sku = item.get('raw_sku')
                if not raw_sku:
                    continue
                
                # Find potential matches with lower threshold
                potential_matches = self._find_potential_matches(raw_sku, catalog_data, threshold=0.3)
                
                if potential_matches:
                    suggestions.append({
                        'raw_sku': raw_sku,
                        'suggestions': potential_matches,
                        'reason': 'low_confidence_or_no_match'
                    })
        
        return suggestions
    
    def _find_potential_matches(self, raw_sku: str, catalog_data: Dict[str, Any], 
                               threshold: float = 0.3) -> List[Dict[str, Any]]:
        """Find potential matches with lower threshold for suggestions"""
        potential_matches = []
        
        # Get all catalog SKUs
        catalog_skus = []
        catalog_skus.extend(catalog_data.get('skus', {}).keys())
        for sku_info in catalog_data.get('sku_list', []):
            if 'sku' in sku_info:
                catalog_skus.append(sku_info['sku'])
        
        # Calculate similarity with each catalog SKU
        for catalog_sku in catalog_skus:
            if not catalog_sku:
                continue
            
            similarity = self._calculate_similarity(raw_sku, catalog_sku)
            
            if similarity >= threshold:
                sku_info = self._get_sku_info(catalog_sku, catalog_data)
                potential_matches.append({
                    'suggested_sku': catalog_sku,
                    'similarity': similarity,
                    'sku_info': sku_info
                })
        
        # Sort by similarity (highest first)
        potential_matches.sort(key=lambda x: x['similarity'], reverse=True)
        
        # Return top 5 suggestions
        return potential_matches[:5]
