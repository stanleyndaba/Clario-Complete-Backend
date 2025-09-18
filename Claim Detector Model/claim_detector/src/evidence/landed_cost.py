"""
Landed cost calculation service for Evidence & Value Engine
"""
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
import json

logger = logging.getLogger(__name__)

class LandedCostService:
    """Service for calculating landed costs from invoice data"""
    
    def __init__(self):
        # Default allocation percentages
        self.default_allocation_policy = {
            'freight_pct': Decimal('5.00'),    # 5% of invoice total
            'duties_pct': Decimal('2.00'),     # 2% of invoice total
            'prep_pct': Decimal('1.00'),       # 1% of invoice total
            'other_pct': Decimal('0.00'),      # 0% of invoice total
            'minimum_freight': Decimal('25.00'),  # Minimum freight cost
            'minimum_duties': Decimal('10.00'),   # Minimum duties cost
        }
    
    def calculate_landed_costs(self, invoice_data: Dict[str, Any], 
                              seller_policy: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Calculate landed costs for all items in an invoice
        
        Args:
            invoice_data: Parsed invoice data with line items
            seller_policy: Optional seller-specific cost allocation policy
            
        Returns:
            List of landed cost calculations per SKU
        """
        try:
            # Get allocation policy
            policy = self._get_allocation_policy(seller_policy)
            
            # Extract invoice totals
            invoice_totals = self._extract_invoice_totals(invoice_data)
            
            # Calculate allocation amounts
            allocation_amounts = self._calculate_allocation_amounts(invoice_totals, policy)
            
            # Calculate landed costs per SKU
            landed_costs = []
            
            for item in invoice_data.get('line_items', []):
                landed_cost = self._calculate_item_landed_cost(
                    item, allocation_amounts, policy, invoice_totals
                )
                if landed_cost:
                    landed_costs.append(landed_cost)
            
            logger.info(f"Calculated landed costs for {len(landed_costs)} items")
            return landed_costs
            
        except Exception as e:
            logger.error(f"Landed cost calculation failed: {e}")
            raise
    
    def _get_allocation_policy(self, seller_policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Get allocation policy, using seller policy if available, otherwise defaults"""
        if seller_policy:
            policy = self.default_allocation_policy.copy()
            policy.update(seller_policy)
            return policy
        
        return self.default_allocation_policy.copy()
    
    def _extract_invoice_totals(self, invoice_data: Dict[str, Any]) -> Dict[str, Decimal]:
        """Extract invoice totals for allocation calculations"""
        totals = {
            'subtotal': Decimal('0.00'),
            'tax': Decimal('0.00'),
            'shipping': Decimal('0.00'),
            'total': Decimal('0.00'),
            'total_quantity': 0
        }
        
        # Get totals from parsed invoice data
        extracted_totals = invoice_data.get('totals', {})
        for key in totals:
            if key in extracted_totals:
                totals[key] = Decimal(str(extracted_totals[key]))
        
        # Calculate total quantity from line items
        for item in invoice_data.get('line_items', []):
            quantity = item.get('quantity', 0)
            totals['total_quantity'] += quantity
        
        # If no total found, calculate from line items
        if totals['total'] == 0:
            for item in invoice_data.get('line_items', []):
                total_cost = item.get('total_cost')
                if total_cost:
                    totals['total'] += Decimal(str(total_cost))
        
        return totals
    
    def _calculate_allocation_amounts(self, invoice_totals: Dict[str, Decimal], 
                                    policy: Dict[str, Any]) -> Dict[str, Decimal]:
        """Calculate allocation amounts based on policy"""
        allocation_amounts = {}
        
        # Calculate freight allocation
        freight_pct = policy.get('freight_pct', Decimal('0.00'))
        if freight_pct > 0:
            freight_amount = (invoice_totals['total'] * freight_pct / Decimal('100.00'))
            # Apply minimum freight if specified
            min_freight = policy.get('minimum_freight', Decimal('0.00'))
            if min_freight > 0:
                freight_amount = max(freight_amount, min_freight)
            allocation_amounts['freight'] = freight_amount
        else:
            allocation_amounts['freight'] = Decimal('0.00')
        
        # Calculate duties allocation
        duties_pct = policy.get('duties_pct', Decimal('0.00'))
        if duties_pct > 0:
            duties_amount = (invoice_totals['total'] * duties_pct / Decimal('100.00'))
            # Apply minimum duties if specified
            min_duties = policy.get('minimum_duties', Decimal('0.00'))
            if min_duties > 0:
                duties_amount = max(duties_amount, min_duties)
            allocation_amounts['duties'] = duties_amount
        else:
            allocation_amounts['duties'] = Decimal('0.00')
        
        # Calculate prep allocation
        prep_pct = policy.get('prep_pct', Decimal('0.00'))
        if prep_pct > 0:
            prep_amount = (invoice_totals['total'] * prep_pct / Decimal('100.00'))
            allocation_amounts['prep'] = prep_amount
        else:
            allocation_amounts['prep'] = Decimal('0.00')
        
        # Calculate other allocation
        other_pct = policy.get('other_pct', Decimal('0.00'))
        if other_pct > 0:
            other_amount = (invoice_totals['total'] * other_pct / Decimal('100.00'))
            allocation_amounts['other'] = other_amount
        else:
            allocation_amounts['other'] = Decimal('0.00')
        
        # Calculate total allocation
        allocation_amounts['total'] = sum([
            allocation_amounts['freight'],
            allocation_amounts['duties'],
            allocation_amounts['prep'],
            allocation_amounts['other']
        ])
        
        return allocation_amounts
    
    def _calculate_item_landed_cost(self, item: Dict[str, Any], 
                                  allocation_amounts: Dict[str, Decimal],
                                  policy: Dict[str, Any],
                                  invoice_totals: Dict[str, Decimal]) -> Optional[Dict[str, Any]]:
        """
        Calculate landed cost for a single invoice item
        
        Args:
            item: Invoice line item
            allocation_amounts: Calculated allocation amounts
            policy: Allocation policy
            invoice_totals: Invoice totals
            
        Returns:
            Landed cost calculation result
        """
        try:
            # Get item details
            sku = item.get('mapped_sku') or item.get('raw_sku')
            asin = item.get('asin')
            unit_cost = item.get('unit_cost')
            quantity = item.get('quantity', 1)
            
            if not sku or not unit_cost:
                logger.warning(f"Skipping item without SKU or unit cost: {item}")
                return None
            
            # Convert unit cost to Decimal
            unit_cost_decimal = Decimal(str(unit_cost))
            
            # Calculate allocation per unit
            total_quantity = invoice_totals['total_quantity']
            if total_quantity == 0:
                total_quantity = 1  # Avoid division by zero
            
            freight_per_unit = allocation_amounts['freight'] / total_quantity
            duties_per_unit = allocation_amounts['duties'] / total_quantity
            prep_per_unit = allocation_amounts['prep'] / total_quantity
            other_per_unit = allocation_amounts['other'] / total_quantity
            
            # Calculate landed cost per unit
            landed_per_unit = (
                unit_cost_decimal +
                freight_per_unit +
                duties_per_unit +
                prep_per_unit +
                other_per_unit
            )
            
            # Round to 4 decimal places
            landed_per_unit = landed_per_unit.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
            
            # Calculate total landed cost for this item
            total_landed_cost = landed_per_unit * quantity
            
            # Prepare calculation metadata
            calc_meta = {
                'allocation_policy': policy,
                'allocation_amounts': {
                    'freight': float(allocation_amounts['freight']),
                    'duties': float(allocation_amounts['duties']),
                    'prep': float(allocation_amounts['prep']),
                    'other': float(allocation_amounts['other']),
                    'total': float(allocation_amounts['total'])
                },
                'per_unit_allocations': {
                    'freight': float(freight_per_unit),
                    'duties': float(duties_per_unit),
                    'prep': float(prep_per_unit),
                    'other': float(other_per_unit)
                },
                'invoice_totals': {
                    'total': float(invoice_totals['total']),
                    'total_quantity': invoice_totals['total_quantity']
                },
                'calculation_method': 'percentage_based',
                'calculated_at': datetime.now().isoformat()
            }
            
            return {
                'sku': sku,
                'asin': asin,
                'unit_cost': float(unit_cost_decimal),
                'quantity': quantity,
                'freight_alloc': float(freight_per_unit),
                'duties_alloc': float(duties_per_unit),
                'prep_alloc': float(prep_per_unit),
                'other_alloc': float(other_per_unit),
                'landed_per_unit': float(landed_per_unit),
                'total_landed_cost': float(total_landed_cost),
                'calc_meta': calc_meta
            }
            
        except Exception as e:
            logger.error(f"Failed to calculate landed cost for item {item}: {e}")
            return None
    
    def get_seller_cost_policy(self, seller_id: str) -> Dict[str, Any]:
        """
        Get cost allocation policy for a specific seller
        
        Args:
            seller_id: Seller identifier
            
        Returns:
            Seller cost policy
        """
        # TODO: Implement database lookup for seller-specific policies
        # For now, return default policy
        return self.default_allocation_policy.copy()
    
    def update_seller_cost_policy(self, seller_id: str, policy_updates: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update cost allocation policy for a specific seller
        
        Args:
            seller_id: Seller identifier
            policy_updates: Policy updates to apply
            
        Returns:
            Updated policy
        """
        # TODO: Implement database update for seller policies
        current_policy = self.get_seller_cost_policy(seller_id)
        current_policy.update(policy_updates)
        
        # Validate policy values
        for key, value in current_policy.items():
            if key.endswith('_pct'):
                if not isinstance(value, (int, float, Decimal)):
                    raise ValueError(f"Invalid percentage value for {key}: {value}")
                if value < 0 or value > 100:
                    raise ValueError(f"Percentage value for {key} must be between 0 and 100: {value}")
        
        logger.info(f"Updated cost policy for seller {seller_id}: {current_policy}")
        return current_policy
    
    def validate_invoice_for_landed_cost(self, invoice_data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Validate invoice data for landed cost calculation
        
        Args:
            invoice_data: Parsed invoice data
            
        Returns:
            Tuple of (is_valid, list_of_issues)
        """
        issues = []
        
        # Check if invoice has line items
        line_items = invoice_data.get('line_items', [])
        if not line_items:
            issues.append("No line items found in invoice")
        
        # Check if line items have required fields
        for i, item in enumerate(line_items):
            if not item.get('unit_cost'):
                issues.append(f"Line item {i+1} missing unit cost")
            if not item.get('quantity'):
                issues.append(f"Line item {i+1} missing quantity")
            if not item.get('mapped_sku') and not item.get('raw_sku'):
                issues.append(f"Line item {i+1} missing SKU")
        
        # Check if invoice has totals
        totals = invoice_data.get('totals', {})
        if not totals.get('total') and not totals.get('subtotal'):
            issues.append("Invoice missing total amount")
        
        is_valid = len(issues) == 0
        return is_valid, issues
    
    def get_landed_cost_summary(self, landed_costs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Get summary statistics for landed cost calculations
        
        Args:
            landed_costs: List of landed cost calculations
            
        Returns:
            Summary statistics
        """
        if not landed_costs:
            return {
                'total_items': 0,
                'total_value': 0.0,
                'average_landed_cost': 0.0,
                'cost_ranges': {}
            }
        
        # Calculate totals
        total_items = len(landed_costs)
        total_value = sum(item.get('total_landed_cost', 0) for item in landed_costs)
        average_landed_cost = total_value / total_items if total_items > 0 else 0
        
        # Calculate cost ranges
        landed_costs_sorted = sorted(landed_costs, key=lambda x: x.get('landed_per_unit', 0))
        min_cost = landed_costs_sorted[0].get('landed_per_unit', 0) if landed_costs_sorted else 0
        max_cost = landed_costs_sorted[-1].get('landed_per_unit', 0) if landed_costs_sorted else 0
        
        # Group by cost ranges
        cost_ranges = {
            'low': 0,      # < $10
            'medium': 0,   # $10 - $50
            'high': 0      # > $50
        }
        
        for item in landed_costs:
            cost = item.get('landed_per_unit', 0)
            if cost < 10:
                cost_ranges['low'] += 1
            elif cost < 50:
                cost_ranges['medium'] += 1
            else:
                cost_ranges['high'] += 1
        
        return {
            'total_items': total_items,
            'total_value': round(total_value, 2),
            'average_landed_cost': round(average_landed_cost, 2),
            'min_landed_cost': round(min_cost, 2),
            'max_landed_cost': round(max_cost, 2),
            'cost_ranges': cost_ranges
        }
