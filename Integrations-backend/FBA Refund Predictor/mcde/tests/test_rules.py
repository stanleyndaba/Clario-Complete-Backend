import pytest
from decimal import Decimal

from src.detection_engine.rules import (
    LostUnitsRule, OverchargedFeesRule, DamagedStockRule, ALL_RULES
)
from src.detection_engine.types import (
    RuleInput, RuleContext, Threshold, WhitelistItem,
    RuleType, ThresholdOperator, WhitelistScope, AnomalySeverity
)


class TestLostUnitsRule:
    @pytest.fixture
    def rule(self):
        return LostUnitsRule()

    @pytest.fixture
    def mock_context(self):
        return RuleContext(
            seller_id='seller123',
            sync_id='sync456',
            thresholds=[
                Threshold(
                    id='threshold1',
                    seller_id=None,  # Global threshold
                    rule_type=RuleType.LOST_UNITS,
                    operator=ThresholdOperator.LT,
                    value=Decimal('0.01'),  # 1% of total units
                    active=True
                ),
                Threshold(
                    id='threshold2',
                    seller_id=None,  # Global threshold
                    rule_type=RuleType.LOST_UNITS,
                    operator=ThresholdOperator.LT,
                    value=Decimal('5.0'),  # $5
                    active=True
                )
            ],
            whitelist=[]
        )

    def test_rule_properties(self, rule):
        assert rule.rule_type == RuleType.LOST_UNITS
        assert rule.priority == "HIGH"

    def test_detect_lost_units_when_thresholds_exceeded(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'units': 10,
                        'value': 50.0,
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 1
        assert anomalies[0].rule_type == RuleType.LOST_UNITS
        assert anomalies[0].severity in [AnomalySeverity.LOW, AnomalySeverity.MEDIUM, AnomalySeverity.HIGH, AnomalySeverity.CRITICAL]
        assert anomalies[0].score > 0.5
        assert 'Lost units detected: 10 units (SKU001) worth $50' in anomalies[0].summary
        assert anomalies[0].dedupe_hash is not None

    def test_handle_multiple_inventory_items(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'units': 5,
                        'value': 25.0,
                        'vendor': 'Vendor A'
                    },
                    {
                        'sku': 'SKU002',
                        'asin': 'B001234568',
                        'units': 15,
                        'value': 75.0,
                        'vendor': 'Vendor B'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 2
        assert anomalies[0].dedupe_hash != anomalies[1].dedupe_hash

    def test_threshold_suppression_percentage(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'units': 0.5,  # 0.5% of total units (below 1% threshold)
                        'value': 2.5,
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 0

    def test_threshold_suppression_value(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'units': 10,
                        'value': 3.0,  # Below $5 threshold
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 0

    def test_sku_whitelist_bypass(self, rule, mock_context):
        context_with_whitelist = RuleContext(
            seller_id='seller123',
            sync_id='sync456',
            thresholds=mock_context.thresholds,
            whitelist=[
                WhitelistItem(
                    id='whitelist1',
                    seller_id='seller123',
                    scope=WhitelistScope.SKU,
                    value='SKU001',
                    reason='Test SKU',
                    active=True
                )
            ]
        )

        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',  # This SKU is whitelisted
                        'asin': 'B001234567',
                        'units': 10,
                        'value': 50.0,
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        anomalies = rule.apply(input_data, context_with_whitelist)

        assert len(anomalies) == 0

    def test_determinism_same_inputs(self, rule, mock_context):
        input1 = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'units': 10,
                        'value': 50.0,
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        input2 = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'units': 10,
                        'value': 50.0,
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        anomalies1 = rule.apply(input1, mock_context)
        anomalies2 = rule.apply(input2, mock_context)

        assert anomalies1[0].dedupe_hash == anomalies2[0].dedupe_hash

    def test_determinism_different_inputs(self, rule, mock_context):
        input1 = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'units': 10,
                        'value': 50.0,
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        input2 = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU002',  # Different SKU
                        'asin': 'B001234567',
                        'units': 10,
                        'value': 50.0,
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        anomalies1 = rule.apply(input1, mock_context)
        anomalies2 = rule.apply(input2, mock_context)

        assert anomalies1[0].dedupe_hash != anomalies2[0].dedupe_hash

    def test_edge_case_zero_total_units(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [
                    {
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'units': 5,
                        'value': 25.0,
                        'vendor': 'Vendor A'
                    }
                ],
                'totalUnits': 0,
                'totalValue': 0
            }
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 0

    def test_edge_case_empty_inventory(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'inventory': [],
                'totalUnits': 100,
                'totalValue': 1000.0
            }
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 0

    def test_edge_case_missing_inventory_data(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={}
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 0


class TestOverchargedFeesRule:
    @pytest.fixture
    def rule(self):
        return OverchargedFeesRule()

    @pytest.fixture
    def mock_context(self):
        return RuleContext(
            seller_id='seller123',
            sync_id='sync456',
            thresholds=[
                Threshold(
                    id='threshold1',
                    seller_id=None,
                    rule_type=RuleType.OVERCHARGED_FEES,
                    operator=ThresholdOperator.LT,
                    value=Decimal('2.0'),  # $2
                    active=True
                )
            ],
            whitelist=[]
        )

    def test_rule_properties(self, rule):
        assert rule.rule_type == RuleType.OVERCHARGED_FEES
        assert rule.priority == "HIGH"

    def test_detect_overcharged_fees(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'fees': [
                    {
                        'feeType': 'FBA_FEE',
                        'amount': 15.0,
                        'sku': 'SKU001',
                        'asin': 'B001234567',
                        'vendor': 'Vendor A',
                        'shipmentId': 'SHIP001'
                    }
                ],
                'expectedFees': {
                    'FBA_FEE': 12.0
                },
                'totalRevenue': 2000.0
            }
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 1
        assert anomalies[0].rule_type == RuleType.OVERCHARGED_FEES
        assert 'Overcharged fee detected: FBA_FEE fee $15.0 vs expected $12.0' in anomalies[0].summary


class TestDamagedStockRule:
    @pytest.fixture
    def rule(self):
        return DamagedStockRule()

    @pytest.fixture
    def mock_context(self):
        return RuleContext(
            seller_id='seller123',
            sync_id='sync456',
            thresholds=[
                Threshold(
                    id='threshold1',
                    seller_id=None,
                    rule_type=RuleType.DAMAGED_STOCK,
                    operator=ThresholdOperator.LT,
                    value=Decimal('5.0'),  # $5
                    active=True
                ),
                Threshold(
                    id='threshold2',
                    seller_id=None,
                    rule_type=RuleType.DAMAGED_STOCK,
                    operator=ThresholdOperator.LT,
                    value=Decimal('1.0'),  # 1 unit
                    active=True
                )
            ],
            whitelist=[]
        )

    def test_rule_properties(self, rule):
        assert rule.rule_type == RuleType.DAMAGED_STOCK
        assert rule.priority == "MEDIUM"

    def test_detect_damaged_stock(self, rule, mock_context):
        input_data = RuleInput(
            seller_id='seller123',
            sync_id='sync456',
            data={
                'damagedStock': [
                    {
                        'sku': 'SKU002',
                        'asin': 'B001234568',
                        'units': 2,
                        'value': 10.0,
                        'vendor': 'Vendor B',
                        'damageType': 'DAMAGED',
                        'damageReason': 'Shipping damage'
                    }
                ],
                'totalInventory': 100,
                'totalInventoryValue': 1000.0
            }
        )

        anomalies = rule.apply(input_data, mock_context)

        assert len(anomalies) == 1
        assert anomalies[0].rule_type == RuleType.DAMAGED_STOCK
        assert 'Damaged stock detected: 2 units (SKU002) worth $10.0' in anomalies[0].summary


class TestAllRules:
    def test_all_rules_loaded(self):
        assert len(ALL_RULES) == 3
        rule_types = [rule.rule_type for rule in ALL_RULES]
        assert RuleType.LOST_UNITS in rule_types
        assert RuleType.OVERCHARGED_FEES in rule_types
        assert RuleType.DAMAGED_STOCK in rule_types

    def test_all_rules_have_priorities(self):
        for rule in ALL_RULES:
            assert rule.priority in ['LOW', 'NORMAL', 'HIGH', 'CRITICAL']

