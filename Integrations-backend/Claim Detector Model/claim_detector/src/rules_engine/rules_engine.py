#!/usr/bin/env python3
"""
Rules Engine for FBA Claims System
Handles Amazon's reimbursement rules and policies
Can be easily updated when Amazon changes policies
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import re
import operator
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

class RuleAction(Enum):
    """Possible actions for rules"""
    ALLOW = "allow"
    DENY = "deny"
    LIMIT = "limit"
    WARN = "warn"
    REQUIRE_EVIDENCE = "require_evidence"

class RuleCategory(Enum):
    """Categories of rules"""
    ELIGIBILITY = "eligibility"
    LIMITS = "limits"
    TIMEFRAMES = "timeframes"
    DOCUMENTATION = "documentation"
    MARKETPLACE_SPECIFIC = "marketplace_specific"

@dataclass
class RuleResult:
    """Result of applying a rule"""
    rule_name: str
    action: RuleAction
    passed: bool
    message: str
    applied_value: Optional[float] = None
    original_value: Optional[float] = None
    evidence_required: bool = False

@dataclass
class ClaimData:
    """Data structure for claim evaluation"""
    sku: str
    asin: str
    claim_type: str
    quantity_affected: int
    amount_requested: float
    shipment_date: Optional[datetime] = None
    received_date: Optional[datetime] = None
    warehouse_location: Optional[str] = None
    marketplace: Optional[str] = None
    cost_per_unit: Optional[float] = None
    evidence_attached: bool = False
    days_since_shipment: Optional[int] = None

class RuleEvaluator:
    """Evaluates individual rules against claim data"""
    
    def __init__(self):
        self.operators = {
            '>': operator.gt,
            '>=': operator.ge,
            '<': operator.lt,
            '<=': operator.le,
            '==': operator.eq,
            '!=': operator.ne,
            'in': lambda x, y: x in y,
            'not_in': lambda x, y: x not in y,
            'contains': lambda x, y: y in str(x),
            'regex': lambda x, y: bool(re.search(y, str(x)))
        }
    
    def evaluate_condition(self, condition: Dict[str, Any], claim_data: ClaimData) -> bool:
        """Evaluate a rule condition against claim data"""
        try:
            field = condition.get('field')
            operator_name = condition.get('operator')
            value = condition.get('value')
            
            if not all([field, operator_name, value]):
                logger.warning(f"⚠️ Invalid condition: {condition}")
                return False
            
            # Get the field value from claim data
            field_value = self._get_field_value(field, claim_data)
            
            # Handle special field calculations
            if field == 'days_since_shipment' and claim_data.shipment_date:
                field_value = (datetime.now() - claim_data.shipment_date).days
            
            # Handle dynamic value calculations
            if isinstance(value, str) and '*' in value:
                value = self._calculate_dynamic_value(value, claim_data)
            
            # Apply the operator
            if operator_name in self.operators:
                return self.operators[operator_name](field_value, value)
            else:
                logger.warning(f"⚠️ Unknown operator: {operator_name}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error evaluating condition {condition}: {e}")
            return False
    
    def _get_field_value(self, field: str, claim_data: ClaimData) -> Any:
        """Get field value from claim data"""
        field_mapping = {
            'sku': claim_data.sku,
            'asin': claim_data.asin,
            'claim_type': claim_data.claim_type,
            'quantity_affected': claim_data.quantity_affected,
            'amount_requested': claim_data.amount_requested,
            'shipment_date': claim_data.shipment_date,
            'received_date': claim_data.received_date,
            'warehouse_location': claim_data.warehouse_location,
            'marketplace': claim_data.marketplace,
            'cost_per_unit': claim_data.cost_per_unit,
            'evidence_attached': claim_data.evidence_attached,
            'days_since_shipment': claim_data.days_since_shipment
        }
        
        return field_mapping.get(field)
    
    def _calculate_dynamic_value(self, expression: str, claim_data: ClaimData) -> float:
        """Calculate dynamic values like 'cost_per_unit * quantity_affected'"""
        try:
            # Replace field names with actual values
            expression = expression.replace('cost_per_unit', str(claim_data.cost_per_unit or 0))
            expression = expression.replace('quantity_affected', str(claim_data.quantity_affected))
            expression = expression.replace('quantity_lost', str(claim_data.quantity_affected))
            
            # Evaluate the expression safely
            return eval(expression)
        except Exception as e:
            logger.error(f"❌ Error calculating dynamic value {expression}: {e}")
            return 0.0

class RulesEngine:
    """Main rules engine for evaluating Amazon's reimbursement policies"""
    
    def __init__(self, rules_file: Optional[str] = None):
        self.rules_file = rules_file or "amazon_rules.json"
        self.rules = self._load_rules()
        self.evaluator = RuleEvaluator()
        self.rule_cache = {}
    
    def _load_rules(self) -> List[Dict[str, Any]]:
        """Load rules from file or use defaults"""
        try:
            if Path(self.rules_file).exists():
                with open(self.rules_file, 'r') as f:
                    rules = json.load(f)
                    logger.info(f"✅ Loaded {len(rules)} rules from {self.rules_file}")
                    return rules
            else:
                logger.info("📝 No rules file found, using default rules")
                return self._get_default_rules()
        except Exception as e:
            logger.error(f"❌ Error loading rules: {e}")
            return self._get_default_rules()
    
    def _get_default_rules(self) -> List[Dict[str, Any]]:
        """Get default Amazon rules"""
        return [
            {
                "id": "rule_001",
                "rule_name": "18 Month Rule",
                "rule_category": "eligibility",
                "rule_description": "Items older than 18 months are ineligible for reimbursement",
                "rule_condition": {
                    "field": "days_since_shipment",
                    "operator": ">",
                    "value": 547
                },
                "rule_action": "deny",
                "rule_value": None,
                "effective_date": "2024-01-01",
                "priority": 1,
                "is_active": True
            },
            {
                "id": "rule_002",
                "rule_name": "Max Claim Limit",
                "rule_category": "limits",
                "rule_description": "Maximum claim cannot exceed item cost × quantity lost",
                "rule_condition": {
                    "field": "amount_requested",
                    "operator": ">",
                    "value": "cost_per_unit * quantity_affected"
                },
                "rule_action": "limit",
                "rule_value": None,
                "effective_date": "2024-01-01",
                "priority": 2,
                "is_active": True
            },
            {
                "id": "rule_003",
                "rule_name": "Minimum Claim Amount",
                "rule_category": "eligibility",
                "rule_description": "Claims under $5 are not eligible",
                "rule_condition": {
                    "field": "amount_requested",
                    "operator": "<",
                    "value": 5.00
                },
                "rule_action": "deny",
                "rule_value": 5.00,
                "effective_date": "2024-01-01",
                "priority": 3,
                "is_active": True
            },
            {
                "id": "rule_004",
                "rule_name": "Lost Inventory Timeframe",
                "rule_category": "timeframes",
                "rule_description": "Lost inventory claims must be filed within 9 months",
                "rule_condition": {
                    "field": "days_since_shipment",
                    "operator": ">",
                    "value": 270
                },
                "rule_action": "deny",
                "rule_value": None,
                "effective_date": "2024-01-01",
                "priority": 4,
                "is_active": True
            },
            {
                "id": "rule_005",
                "rule_name": "Damaged Goods Evidence",
                "rule_category": "documentation",
                "rule_description": "Damaged goods claims require photographic evidence",
                "rule_condition": {
                    "field": "claim_type",
                    "operator": "==",
                    "value": "damaged_goods",
                    "and": {
                        "field": "evidence_attached",
                        "operator": "==",
                        "value": False
                    }
                },
                "rule_action": "require_evidence",
                "rule_value": None,
                "effective_date": "2024-01-01",
                "priority": 5,
                "is_active": True
            },
            {
                "id": "rule_006",
                "rule_name": "Marketplace Specific - Japan",
                "rule_category": "marketplace_specific",
                "rule_description": "Japan marketplace has stricter documentation requirements",
                "rule_condition": {
                    "field": "marketplace",
                    "operator": "==",
                    "value": "JP"
                },
                "rule_action": "warn",
                "rule_value": None,
                "effective_date": "2024-01-01",
                "priority": 6,
                "is_active": True
            }
        ]
    
    def evaluate_claim(self, claim_data: ClaimData) -> List[RuleResult]:
        """Evaluate a claim against all active rules"""
        logger.info(f"🔍 Evaluating claim for SKU: {claim_data.sku}")
        
        results = []
        active_rules = [rule for rule in self.rules if rule.get('is_active', True)]
        
        # Sort rules by priority (higher priority first)
        active_rules.sort(key=lambda x: x.get('priority', 1), reverse=True)
        
        for rule in active_rules:
            try:
                result = self._evaluate_single_rule(rule, claim_data)
                results.append(result)
                
                # If rule denies the claim, stop evaluation
                if result.action == RuleAction.DENY and not result.passed:
                    logger.info(f"❌ Claim denied by rule: {rule['rule_name']}")
                    break
                    
            except Exception as e:
                logger.error(f"❌ Error evaluating rule {rule.get('rule_name', 'Unknown')}: {e}")
                continue
        
        logger.info(f"✅ Claim evaluation completed. {len(results)} rules evaluated.")
        return results
    
    def _evaluate_single_rule(self, rule: Dict[str, Any], claim_data: ClaimData) -> RuleResult:
        """Evaluate a single rule against claim data"""
        rule_name = rule.get('rule_name', 'Unknown Rule')
        rule_action = RuleAction(rule.get('rule_action', 'allow'))
        rule_condition = rule.get('rule_condition', {})
        
        # Evaluate the main condition
        condition_passed = self.evaluator.evaluate_condition(rule_condition, claim_data)
        
        # Handle AND conditions
        if 'and' in rule_condition:
            and_condition = rule_condition['and']
            and_passed = self.evaluator.evaluate_condition(and_condition, claim_data)
            condition_passed = condition_passed and and_passed
        
        # Determine the result
        if rule_action == RuleAction.DENY:
            passed = not condition_passed  # Rule passes if condition is NOT met
            message = f"Claim {'denied' if not passed else 'allowed'} by {rule_name}"
        elif rule_action == RuleAction.LIMIT:
            passed = True
            message = f"Claim limited by {rule_name}"
        elif rule_action == RuleAction.REQUIRE_EVIDENCE:
            passed = condition_passed
            message = f"Evidence required by {rule_name}"
        else:  # ALLOW, WARN
            passed = True
            message = f"Claim {'warned' if rule_action == RuleAction.WARN else 'allowed'} by {rule_name}"
        
        # Calculate applied value for LIMIT actions
        applied_value = None
        original_value = None
        if rule_action == RuleAction.LIMIT and condition_passed:
            original_value = claim_data.amount_requested
            applied_value = self._calculate_limit_value(rule, claim_data)
        
        return RuleResult(
            rule_name=rule_name,
            action=rule_action,
            passed=passed,
            message=message,
            applied_value=applied_value,
            original_value=original_value,
            evidence_required=rule_action == RuleAction.REQUIRE_EVIDENCE and condition_passed
        )
    
    def _calculate_limit_value(self, rule: Dict[str, Any], claim_data: ClaimData) -> float:
        """Calculate the limited value for LIMIT actions"""
        try:
            rule_condition = rule.get('rule_condition', {})
            if 'value' in rule_condition:
                value_expr = rule_condition['value']
                if isinstance(value_expr, str) and '*' in value_expr:
                    return self.evaluator._calculate_dynamic_value(value_expr, claim_data)
                elif isinstance(value_expr, (int, float)):
                    return float(value_expr)
            
            # Default to original amount if limit calculation fails
            return claim_data.amount_requested
            
        except Exception as e:
            logger.error(f"❌ Error calculating limit value: {e}")
            return claim_data.amount_requested
    
    def get_claim_decision(self, rule_results: List[RuleResult]) -> Dict[str, Any]:
        """Get final claim decision based on rule results"""
        # Check for immediate denials
        denials = [r for r in rule_results if r.action == RuleAction.DENY and not r.passed]
        if denials:
            return {
                "decision": "DENIED",
                "reason": denials[0].message,
                "rule_applied": denials[0].rule_name,
                "can_proceed": False
            }
        
        # Check for evidence requirements
        evidence_required = [r for r in rule_results if r.evidence_required]
        if evidence_required:
            return {
                "decision": "EVIDENCE_REQUIRED",
                "reason": f"Evidence required: {', '.join([r.rule_name for r in evidence_required])}",
                "rules_applied": [r.rule_name for r in evidence_required],
                "can_proceed": False
            }
        
        # Check for limits
        limits = [r for r in rule_results if r.action == RuleAction.LIMIT and r.applied_value is not None]
        if limits:
            return {
                "decision": "LIMITED",
                "reason": f"Claim limited by: {', '.join([r.rule_name for r in limits])}",
                "rules_applied": [r.rule_name for r in limits],
                "can_proceed": True,
                "recommended_amount": min([r.applied_value for r in limits])
            }
        
        # Check for warnings
        warnings = [r for r in rule_results if r.action == RuleAction.WARN]
        if warnings:
            return {
                "decision": "WARNED",
                "reason": f"Warnings: {', '.join([r.rule_name for r in warnings])}",
                "rules_applied": [r.rule_name for r in warnings],
                "can_proceed": True
            }
        
        # Default: allowed
        return {
            "decision": "ALLOWED",
            "reason": "Claim meets all eligibility requirements",
            "rules_applied": [r.rule_name for r in rule_results if r.passed],
            "can_proceed": True
        }
    
    def update_rule(self, rule_id: str, updates: Dict[str, Any]) -> bool:
        """Update an existing rule"""
        try:
            for i, rule in enumerate(self.rules):
                if rule.get('id') == rule_id:
                    self.rules[i].update(updates)
                    self.rules[i]['updated_at'] = datetime.now().isoformat()
                    
                    # Save to file
                    self._save_rules()
                    
                    logger.info(f"✅ Rule {rule_id} updated successfully")
                    return True
            
            logger.warning(f"⚠️ Rule {rule_id} not found")
            return False
            
        except Exception as e:
            logger.error(f"❌ Error updating rule {rule_id}: {e}")
            return False
    
    def add_rule(self, new_rule: Dict[str, Any]) -> bool:
        """Add a new rule"""
        try:
            # Generate ID if not provided
            if 'id' not in new_rule:
                new_rule['id'] = f"rule_{len(self.rules) + 1:03d}"
            
            # Set creation timestamp
            new_rule['created_at'] = datetime.now().isoformat()
            new_rule['updated_at'] = datetime.now().isoformat()
            
            # Validate required fields
            required_fields = ['rule_name', 'rule_category', 'rule_condition', 'rule_action']
            if not all(field in new_rule for field in required_fields):
                logger.error(f"❌ Missing required fields: {required_fields}")
                return False
            
            self.rules.append(new_rule)
            
            # Save to file
            self._save_rules()
            
            logger.info(f"✅ New rule '{new_rule['rule_name']}' added successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error adding new rule: {e}")
            return False
    
    def deactivate_rule(self, rule_id: str) -> bool:
        """Deactivate a rule"""
        return self.update_rule(rule_id, {'is_active': False})
    
    def _save_rules(self):
        """Save rules to file"""
        try:
            with open(self.rules_file, 'w') as f:
                json.dump(self.rules, f, indent=2, default=str)
            logger.info(f"💾 Rules saved to {self.rules_file}")
        except Exception as e:
            logger.error(f"❌ Error saving rules: {e}")
    
    def get_rules_summary(self) -> Dict[str, Any]:
        """Get summary of all rules"""
        active_rules = [r for r in self.rules if r.get('is_active', True)]
        inactive_rules = [r for r in self.rules if not r.get('is_active', True)]
        
        return {
            "total_rules": len(self.rules),
            "active_rules": len(active_rules),
            "inactive_rules": len(inactive_rules),
            "categories": list(set(r.get('rule_category') for r in self.rules)),
            "last_updated": max(r.get('updated_at', '') for r in self.rules) if self.rules else None
        }

# Example usage and testing
if __name__ == "__main__":
    # Initialize rules engine
    engine = RulesEngine()
    
    # Create sample claim data
    claim_data = ClaimData(
        sku="TEST-SKU-001",
        asin="B08N5WRWNW",
        claim_type="lost_inventory",
        quantity_affected=5,
        amount_requested=150.00,
        shipment_date=datetime.now() - timedelta(days=200),
        cost_per_unit=30.00,
        marketplace="US",
        evidence_attached=False
    )
    
    # Evaluate the claim
    rule_results = engine.evaluate_claim(claim_data)
    
    # Get final decision
    decision = engine.get_claim_decision(rule_results)
    
    print(f"\n📋 CLAIM EVALUATION RESULTS")
    print(f"SKU: {claim_data.sku}")
    print(f"Claim Type: {claim_data.claim_type}")
    print(f"Amount Requested: ${claim_data.amount_requested}")
    print(f"Final Decision: {decision['decision']}")
    print(f"Reason: {decision['reason']}")
    print(f"Can Proceed: {decision['can_proceed']}")
    
    if decision.get('recommended_amount'):
        print(f"Recommended Amount: ${decision['recommended_amount']}")
    
    print(f"\n📊 RULE EVALUATION DETAILS:")
    for result in rule_results:
        status = "✅ PASSED" if result.passed else "❌ FAILED"
        print(f"  {status} - {result.rule_name}: {result.message}")
    
    # Show rules summary
    summary = engine.get_rules_summary()
    print(f"\n📈 RULES SUMMARY:")
    print(f"  Total Rules: {summary['total_rules']}")
    print(f"  Active Rules: {summary['active_rules']}")
    print(f"  Categories: {', '.join(summary['categories'])}")

