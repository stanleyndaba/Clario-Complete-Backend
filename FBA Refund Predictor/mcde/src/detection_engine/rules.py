import hashlib
from abc import ABC, abstractmethod
from typing import List, Dict, Any
from decimal import Decimal

from .types import (
    Anomaly, RuleInput, RuleContext, Threshold, WhitelistItem,
    RuleType, AnomalySeverity, ThresholdOperator, WhitelistScope
)


class BaseRule(ABC):
    @property
    @abstractmethod
    def rule_type(self) -> RuleType:
        pass

    @property
    @abstractmethod
    def priority(self) -> str:
        pass

    @abstractmethod
    def apply(self, input_data: RuleInput, context: RuleContext) -> List[Anomaly]:
        pass

    def check_thresholds(self, value: float, thresholds: List[Threshold]) -> bool:
        """Check if a value triggers any of the given thresholds."""
        for threshold in thresholds:
            if not threshold.active:
                continue

            threshold_value = float(threshold.value)
            should_trigger = False

            if threshold.operator == ThresholdOperator.GT:
                should_trigger = value > threshold_value
            elif threshold.operator == ThresholdOperator.GTE:
                should_trigger = value >= threshold_value
            elif threshold.operator == ThresholdOperator.LT:
                should_trigger = value < threshold_value
            elif threshold.operator == ThresholdOperator.LTE:
                should_trigger = value <= threshold_value
            elif threshold.operator == ThresholdOperator.EQ:
                should_trigger = value == threshold_value

            if should_trigger:
                return True

        return False

    def is_whitelisted(self, scope: str, value: str, whitelist: List[WhitelistItem]) -> bool:
        """Check if an item is whitelisted."""
        return any(
            item.active and 
            item.scope.value.lower() == scope.lower() and 
            item.value == value
            for item in whitelist
        )

    def calculate_severity(self, score: float) -> AnomalySeverity:
        """Calculate severity based on confidence score."""
        if score >= 0.9:
            return AnomalySeverity.CRITICAL
        elif score >= 0.7:
            return AnomalySeverity.HIGH
        elif score >= 0.5:
            return AnomalySeverity.MEDIUM
        else:
            return AnomalySeverity.LOW

    def generate_dedupe_hash(self, seller_id: str, rule_type: RuleType, core_fields: Dict[str, Any]) -> str:
        """Generate deterministic deduplication hash."""
        normalized_fields = "|".join(
            f"{key}:{core_fields[key]}"
            for key in sorted(core_fields.keys())
        )
        
        hash_input = f"{seller_id}|{rule_type.value}|{normalized_fields}"
        return self._simple_hash(hash_input)

    def _simple_hash(self, text: str) -> str:
        """Generate a simple hash for deduplication."""
        return hashlib.md5(text.encode()).hexdigest()[:16]


class LostUnitsRule(BaseRule):
    @property
    def rule_type(self) -> RuleType:
        return RuleType.LOST_UNITS

    @property
    def priority(self) -> str:
        return "HIGH"

    def apply(self, input_data: RuleInput, context: RuleContext) -> List[Anomaly]:
        anomalies = []
        data = input_data.data

        # Extract inventory data
        inventory_items = data.get("inventory", [])
        total_units = data.get("totalUnits", 0)
        total_value = data.get("totalValue", 0)

        for item in inventory_items:
            sku = item.get("sku")
            asin = item.get("asin")
            units = item.get("units", 0)
            value = item.get("value", 0)
            vendor = item.get("vendor")

            # Check if item is whitelisted
            if (self.is_whitelisted("SKU", sku, context.whitelist) or
                self.is_whitelisted("ASIN", asin, context.whitelist) or
                self.is_whitelisted("VENDOR", vendor, context.whitelist)):
                continue

            # Calculate lost units percentage and value
            lost_units_percentage = units / total_units if total_units > 0 else 0
            lost_units_value = value

            # Check thresholds
            relevant_thresholds = [
                t for t in context.thresholds
                if t.rule_type == RuleType.LOST_UNITS and
                (t.seller_id is None or t.seller_id == context.seller_id)
            ]

            should_trigger_percentage = self.check_thresholds(lost_units_percentage, relevant_thresholds)
            should_trigger_value = self.check_thresholds(lost_units_value, relevant_thresholds)

            if should_trigger_percentage or should_trigger_value:
                score = min(0.9, max(0.5, (lost_units_percentage * 10) + (lost_units_value / total_value if total_value > 0 else 0)))
                severity = self.calculate_severity(score)

                core_fields = {
                    "sku": sku,
                    "asin": asin,
                    "units": str(units),
                    "value": str(value),
                    "vendor": vendor
                }

                dedupe_hash = self.generate_dedupe_hash(context.seller_id, self.rule_type, core_fields)

                anomalies.append(Anomaly(
                    rule_type=self.rule_type,
                    severity=severity,
                    score=score,
                    summary=f"Lost units detected: {units} units ({sku}) worth ${value}",
                    evidence={
                        "sku": sku,
                        "asin": asin,
                        "units": units,
                        "value": value,
                        "vendor": vendor,
                        "lostUnitsPercentage": lost_units_percentage,
                        "totalUnits": total_units,
                        "totalValue": total_value
                    },
                    dedupe_hash=dedupe_hash
                ))

        return anomalies


class OverchargedFeesRule(BaseRule):
    @property
    def rule_type(self) -> RuleType:
        return RuleType.OVERCHARGED_FEES

    @property
    def priority(self) -> str:
        return "HIGH"

    def apply(self, input_data: RuleInput, context: RuleContext) -> List[Anomaly]:
        anomalies = []
        data = input_data.data

        # Extract fee data
        fee_items = data.get("fees", [])
        expected_fees = data.get("expectedFees", {})
        total_revenue = data.get("totalRevenue", 0)

        for fee_item in fee_items:
            fee_type = fee_item.get("feeType")
            amount = fee_item.get("amount", 0)
            sku = fee_item.get("sku")
            asin = fee_item.get("asin")
            vendor = fee_item.get("vendor")
            shipment_id = fee_item.get("shipmentId")

            # Check if item is whitelisted
            if (self.is_whitelisted("SKU", sku, context.whitelist) or
                self.is_whitelisted("ASIN", asin, context.whitelist) or
                self.is_whitelisted("VENDOR", vendor, context.whitelist) or
                self.is_whitelisted("SHIPMENT", shipment_id, context.whitelist)):
                continue

            # Calculate fee delta
            expected_amount = expected_fees.get(fee_type, 0)
            delta = abs(amount - expected_amount)

            # Check thresholds
            relevant_thresholds = [
                t for t in context.thresholds
                if t.rule_type == RuleType.OVERCHARGED_FEES and
                (t.seller_id is None or t.seller_id == context.seller_id)
            ]

            should_trigger = self.check_thresholds(delta, relevant_thresholds)

            if should_trigger:
                score = min(0.9, max(0.5, delta / total_revenue * 100 if total_revenue > 0 else 0.5))
                severity = self.calculate_severity(score)

                core_fields = {
                    "feeType": fee_type,
                    "sku": sku,
                    "asin": asin,
                    "amount": str(amount),
                    "expectedAmount": str(expected_amount),
                    "delta": str(delta),
                    "vendor": vendor,
                    "shipmentId": shipment_id
                }

                dedupe_hash = self.generate_dedupe_hash(context.seller_id, self.rule_type, core_fields)

                anomalies.append(Anomaly(
                    rule_type=self.rule_type,
                    severity=severity,
                    score=score,
                    summary=f"Overcharged fee detected: {fee_type} fee ${amount} vs expected ${expected_amount} (delta: ${delta})",
                    evidence={
                        "feeType": fee_type,
                        "sku": sku,
                        "asin": asin,
                        "amount": amount,
                        "expectedAmount": expected_amount,
                        "delta": delta,
                        "vendor": vendor,
                        "shipmentId": shipment_id,
                        "totalRevenue": total_revenue
                    },
                    dedupe_hash=dedupe_hash
                ))

        return anomalies


class DamagedStockRule(BaseRule):
    @property
    def rule_type(self) -> RuleType:
        return RuleType.DAMAGED_STOCK

    @property
    def priority(self) -> str:
        return "MEDIUM"

    def apply(self, input_data: RuleInput, context: RuleContext) -> List[Anomaly]:
        anomalies = []
        data = input_data.data

        # Extract damaged stock data
        damaged_items = data.get("damagedStock", [])
        total_inventory = data.get("totalInventory", 0)
        total_inventory_value = data.get("totalInventoryValue", 0)

        for item in damaged_items:
            sku = item.get("sku")
            asin = item.get("asin")
            units = item.get("units", 0)
            value = item.get("value", 0)
            vendor = item.get("vendor")
            damage_type = item.get("damageType")
            damage_reason = item.get("damageReason")

            # Check if item is whitelisted
            if (self.is_whitelisted("SKU", sku, context.whitelist) or
                self.is_whitelisted("ASIN", asin, context.whitelist) or
                self.is_whitelisted("VENDOR", vendor, context.whitelist)):
                continue

            # Check thresholds
            relevant_thresholds = [
                t for t in context.thresholds
                if t.rule_type == RuleType.DAMAGED_STOCK and
                (t.seller_id is None or t.seller_id == context.seller_id)
            ]

            should_trigger_units = self.check_thresholds(units, relevant_thresholds)
            should_trigger_value = self.check_thresholds(value, relevant_thresholds)

            if should_trigger_units or should_trigger_value:
                score = min(0.9, max(0.5, (units / total_inventory if total_inventory > 0 else 0) + (value / total_inventory_value if total_inventory_value > 0 else 0)))
                severity = self.calculate_severity(score)

                core_fields = {
                    "sku": sku,
                    "asin": asin,
                    "units": str(units),
                    "value": str(value),
                    "vendor": vendor,
                    "damageType": damage_type,
                    "damageReason": damage_reason
                }

                dedupe_hash = self.generate_dedupe_hash(context.seller_id, self.rule_type, core_fields)

                anomalies.append(Anomaly(
                    rule_type=self.rule_type,
                    severity=severity,
                    score=score,
                    summary=f"Damaged stock detected: {units} units ({sku}) worth ${value} - {damage_type}",
                    evidence={
                        "sku": sku,
                        "asin": asin,
                        "units": units,
                        "value": value,
                        "vendor": vendor,
                        "damageType": damage_type,
                        "damageReason": damage_reason,
                        "totalInventory": total_inventory,
                        "totalInventoryValue": total_inventory_value
                    },
                    dedupe_hash=dedupe_hash
                ))

        return anomalies


# Export all rules
ALL_RULES = [
    LostUnitsRule(),
    OverchargedFeesRule(),
    DamagedStockRule()
]

