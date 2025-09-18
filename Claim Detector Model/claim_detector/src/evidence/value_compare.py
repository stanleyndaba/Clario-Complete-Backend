"""
Value comparison service for Evidence & Value Engine
Compares Amazon default reimbursement vs Opside True Value
"""
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import json

logger = logging.getLogger(__name__)

class ValueComparisonService:
    """Service for comparing Amazon default vs Opside True Value"""
    
    def __init__(self):
        # Cache for value comparisons (in-memory for now, could be Redis)
        self.comparison_cache = {}
        self.cache_ttl_hours = 24  # Cache for 24 hours
        
    def compare_values(self, seller_id: str, sku: str, 
                      landed_cost_data: Optional[Dict[str, Any]] = None,
                      amazon_default_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Compare Amazon default vs Opside True Value for a SKU
        
        Args:
            seller_id: Seller identifier
            sku: SKU to compare
            landed_cost_data: Optional landed cost data (if not provided, will fetch latest)
            amazon_default_data: Optional Amazon default data (if not provided, will fetch)
            
        Returns:
            Value comparison result
        """
        try:
            # Check cache first
            cache_key = f"{seller_id}:{sku}"
            cached_result = self._get_cached_comparison(cache_key)
            if cached_result:
                logger.info(f"Returning cached comparison for {sku}")
                return cached_result
            
            # Get landed cost data
            if not landed_cost_data:
                landed_cost_data = self._get_latest_landed_cost(seller_id, sku)
            
            # Get Amazon default data
            if not amazon_default_data:
                amazon_default_data = self._get_amazon_default_value(seller_id, sku)
            
            # Calculate comparison
            comparison_result = self._calculate_comparison(
                sku, landed_cost_data, amazon_default_data
            )
            
            # Cache the result
            self._cache_comparison(cache_key, comparison_result)
            
            logger.info(f"Calculated value comparison for {sku}: {comparison_result.get('net_gain', 0)}")
            return comparison_result
            
        except Exception as e:
            logger.error(f"Value comparison failed for {sku}: {e}")
            raise
    
    def batch_compare_values(self, seller_id: str, skus: List[str]) -> List[Dict[str, Any]]:
        """
        Batch compare values for multiple SKUs
        
        Args:
            seller_id: Seller identifier
            skus: List of SKUs to compare
            
        Returns:
            List of comparison results
        """
        try:
            results = []
            
            for sku in skus:
                try:
                    comparison = self.compare_values(seller_id, sku)
                    results.append(comparison)
                except Exception as e:
                    logger.error(f"Failed to compare values for {sku}: {e}")
                    # Add error result
                    results.append({
                        'sku': sku,
                        'error': str(e),
                        'amazon_default': None,
                        'opside_true_value': None,
                        'net_gain': None,
                        'proof': None,
                        'updated_at': datetime.now().isoformat()
                    })
            
            return results
            
        except Exception as e:
            logger.error(f"Batch value comparison failed: {e}")
            raise
    
    def _get_latest_landed_cost(self, seller_id: str, sku: str) -> Optional[Dict[str, Any]]:
        """
        Get latest landed cost data for a SKU
        
        Args:
            seller_id: Seller identifier
            sku: SKU to get landed cost for
            
        Returns:
            Latest landed cost data or None
        """
        # TODO: Implement database lookup for latest landed cost
        # For now, return mock data
        mock_landed_cost = {
            'sku': sku,
            'landed_per_unit': 25.50,
            'unit_cost': 20.00,
            'freight_alloc': 2.50,
            'duties_alloc': 1.00,
            'prep_alloc': 1.00,
            'other_alloc': 1.00,
            'calculated_at': datetime.now().isoformat(),
            'invoice_id': 'mock_invoice_123'
        }
        
        return mock_landed_cost
    
    def _get_amazon_default_value(self, seller_id: str, sku: str) -> Optional[Dict[str, Any]]:
        """
        Get Amazon default reimbursement value for a SKU
        
        Args:
            seller_id: Seller identifier
            sku: SKU to get Amazon default for
            
        Returns:
            Amazon default value data or None
        """
        # TODO: Implement lookup from SP-API sync data or reimbursement history
        # For now, return mock data
        mock_amazon_default = {
            'sku': sku,
            'default_value': 22.00,
            'currency': 'USD',
            'last_updated': datetime.now().isoformat(),
            'source': 'mock_data'
        }
        
        return mock_amazon_default
    
    def _calculate_comparison(self, sku: str, landed_cost_data: Optional[Dict[str, Any]], 
                            amazon_default_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Calculate value comparison between Amazon default and Opside True Value
        
        Args:
            sku: SKU being compared
            landed_cost_data: Landed cost data
            amazon_default_data: Amazon default value data
            
        Returns:
            Comparison result
        """
        try:
            # Get Opside True Value (landed cost)
            opside_true_value = None
            if landed_cost_data:
                opside_true_value = landed_cost_data.get('landed_per_unit')
            
            # Get Amazon default value
            amazon_default = None
            if amazon_default_data:
                amazon_default = amazon_default_data.get('default_value')
            
            # Calculate net gain
            net_gain = None
            if opside_true_value is not None and amazon_default is not None:
                net_gain = float(Decimal(str(opside_true_value)) - Decimal(str(amazon_default)))
                net_gain = round(net_gain, 2)
            
            # Prepare proof information
            proof = self._prepare_proof(landed_cost_data, amazon_default_data)
            
            # Determine comparison status
            comparison_status = self._determine_comparison_status(
                opside_true_value, amazon_default, net_gain
            )
            
            return {
                'sku': sku,
                'amazon_default': amazon_default,
                'opside_true_value': opside_true_value,
                'net_gain': net_gain,
                'comparison_status': comparison_status,
                'proof': proof,
                'updated_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to calculate comparison for {sku}: {e}")
            raise
    
    def _prepare_proof(self, landed_cost_data: Optional[Dict[str, Any]], 
                      amazon_default_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Prepare proof information for the comparison
        
        Args:
            landed_cost_data: Landed cost data
            amazon_default_data: Amazon default value data
            
        Returns:
            Proof information
        """
        proof = {
            'has_landed_cost': False,
            'has_amazon_default': False,
            'invoice_id': None,
            'calculation_details': None
        }
        
        if landed_cost_data:
            proof['has_landed_cost'] = True
            proof['invoice_id'] = landed_cost_data.get('invoice_id')
            proof['calculation_details'] = {
                'unit_cost': landed_cost_data.get('unit_cost'),
                'freight_alloc': landed_cost_data.get('freight_alloc'),
                'duties_alloc': landed_cost_data.get('duties_alloc'),
                'prep_alloc': landed_cost_data.get('prep_alloc'),
                'other_alloc': landed_cost_data.get('other_alloc'),
                'calculated_at': landed_cost_data.get('calculated_at')
            }
        
        if amazon_default_data:
            proof['has_amazon_default'] = True
            proof['amazon_source'] = amazon_default_data.get('source')
            proof['amazon_last_updated'] = amazon_default_data.get('last_updated')
        
        return proof
    
    def _determine_comparison_status(self, opside_true_value: Optional[float], 
                                   amazon_default: Optional[float], 
                                   net_gain: Optional[float]) -> str:
        """
        Determine the status of the value comparison
        
        Args:
            opside_true_value: Opside True Value
            amazon_default: Amazon default value
            net_gain: Calculated net gain
            
        Returns:
            Comparison status string
        """
        if opside_true_value is None and amazon_default is None:
            return 'no_data'
        elif opside_true_value is None:
            return 'no_landed_cost'
        elif amazon_default is None:
            return 'no_amazon_default'
        elif net_gain is None:
            return 'calculation_error'
        elif net_gain > 0:
            return 'positive_gain'
        elif net_gain < 0:
            return 'negative_gain'
        else:
            return 'no_difference'
    
    def _get_cached_comparison(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """Get cached comparison result"""
        if cache_key in self.comparison_cache:
            cached_data = self.comparison_cache[cache_key]
            cached_time = datetime.fromisoformat(cached_data['cached_at'])
            
            # Check if cache is still valid
            if datetime.now() - cached_time < timedelta(hours=self.cache_ttl_hours):
                return cached_data['data']
            else:
                # Remove expired cache entry
                del self.comparison_cache[cache_key]
        
        return None
    
    def _cache_comparison(self, cache_key: str, comparison_data: Dict[str, Any]):
        """Cache comparison result"""
        self.comparison_cache[cache_key] = {
            'data': comparison_data,
            'cached_at': datetime.now().isoformat()
        }
        
        # Limit cache size (keep only last 1000 entries)
        if len(self.comparison_cache) > 1000:
            # Remove oldest entries
            oldest_keys = sorted(
                self.comparison_cache.keys(),
                key=lambda k: self.comparison_cache[k]['cached_at']
            )[:100]
            
            for key in oldest_keys:
                del self.comparison_cache[key]
    
    def get_comparison_statistics(self, seller_id: str, days: int = 30) -> Dict[str, Any]:
        """
        Get statistics for value comparisons
        
        Args:
            seller_id: Seller identifier
            days: Number of days to look back
            
        Returns:
            Comparison statistics
        """
        # TODO: Implement database lookup for comparison statistics
        # For now, return mock statistics
        
        mock_stats = {
            'total_comparisons': 150,
            'positive_gain_count': 120,
            'negative_gain_count': 20,
            'no_difference_count': 10,
            'average_net_gain': 15.75,
            'total_potential_gain': 1890.00,
            'period_days': days,
            'seller_id': seller_id
        }
        
        return mock_stats
    
    def get_top_gain_opportunities(self, seller_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get top gain opportunities for a seller
        
        Args:
            seller_id: Seller identifier
            limit: Maximum number of opportunities to return
            
        Returns:
            List of top gain opportunities
        """
        # TODO: Implement database lookup for top gain opportunities
        # For now, return mock data
        
        mock_opportunities = [
            {
                'sku': 'SKU-001',
                'amazon_default': 25.00,
                'opside_true_value': 45.50,
                'net_gain': 20.50,
                'potential_annual_gain': 2050.00
            },
            {
                'sku': 'SKU-002',
                'amazon_default': 18.00,
                'opside_true_value': 32.75,
                'net_gain': 14.75,
                'potential_annual_gain': 1475.00
            }
        ]
        
        # Sort by net gain (highest first) and limit results
        mock_opportunities.sort(key=lambda x: x['net_gain'], reverse=True)
        return mock_opportunities[:limit]
    
    def validate_comparison_request(self, seller_id: str, sku: str) -> Tuple[bool, List[str]]:
        """
        Validate a value comparison request
        
        Args:
            seller_id: Seller identifier
            sku: SKU to validate
            
        Returns:
            Tuple of (is_valid, list_of_issues)
        """
        issues = []
        
        # Validate seller_id
        if not seller_id or not seller_id.strip():
            issues.append("Seller ID is required")
        
        # Validate SKU
        if not sku or not sku.strip():
            issues.append("SKU is required")
        elif len(sku) < 3:
            issues.append("SKU must be at least 3 characters long")
        elif len(sku) > 50:
            issues.append("SKU must be no more than 50 characters long")
        
        # Check for invalid characters
        if sku and not sku.replace('-', '').replace('_', '').isalnum():
            issues.append("SKU contains invalid characters")
        
        is_valid = len(issues) == 0
        return is_valid, issues
    
    def clear_cache(self, seller_id: Optional[str] = None):
        """
        Clear comparison cache
        
        Args:
            seller_id: Optional seller ID to clear only their cache
        """
        if seller_id:
            # Clear cache for specific seller
            keys_to_remove = [k for k in self.comparison_cache.keys() if k.startswith(f"{seller_id}:")]
            for key in keys_to_remove:
                del self.comparison_cache[key]
            logger.info(f"Cleared cache for seller {seller_id}")
        else:
            # Clear entire cache
            self.comparison_cache.clear()
            logger.info("Cleared entire comparison cache")
