import { LostUnitsRule } from '../../src/detection/rules/lostUnitsRule';
import { RuleInput, RuleContext, Threshold, WhitelistItem } from '../../src/detection/types';
import { RuleType, ThresholdOperator, WhitelistScope } from '@prisma/client';

describe('LostUnitsRule', () => {
  let rule: LostUnitsRule;
  let mockContext: RuleContext;

  beforeEach(() => {
    rule = new LostUnitsRule();
    
    mockContext = {
      sellerId: 'seller123',
      syncId: 'sync456',
      thresholds: [
        {
          id: 'threshold1',
          sellerId: null, // Global threshold
          ruleType: RuleType.LOST_UNITS,
          operator: ThresholdOperator.LT,
          value: 0.01, // 1% of total units
          active: true
        },
        {
          id: 'threshold2',
          sellerId: null, // Global threshold
          ruleType: RuleType.LOST_UNITS,
          operator: ThresholdOperator.LT,
          value: 5.0, // $5
          active: true
        }
      ],
      whitelist: []
    };
  });

  describe('rule properties', () => {
    it('should have correct rule type', () => {
      expect(rule.ruleType).toBe(RuleType.LOST_UNITS);
    });

    it('should have correct priority', () => {
      expect(rule.priority).toBe('HIGH');
    });
  });

  describe('happy path scenarios', () => {
    it('should detect lost units when thresholds are exceeded', () => {
      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 10,
              value: 50.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, mockContext);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].ruleType).toBe(RuleType.LOST_UNITS);
      expect(anomalies[0].severity).toBeDefined();
      expect(anomalies[0].score).toBeGreaterThan(0.5);
      expect(anomalies[0].summary).toContain('Lost units detected: 10 units (SKU001) worth $50');
      expect(anomalies[0].dedupeHash).toBeDefined();
    });

    it('should handle multiple inventory items', () => {
      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 5,
              value: 25.0,
              vendor: 'Vendor A'
            },
            {
              sku: 'SKU002',
              asin: 'B001234568',
              units: 15,
              value: 75.0,
              vendor: 'Vendor B'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, mockContext);

      expect(anomalies).toHaveLength(2);
      expect(anomalies[0].dedupeHash).not.toBe(anomalies[1].dedupeHash);
    });
  });

  describe('threshold suppression', () => {
    it('should not trigger when units are below percentage threshold', () => {
      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 0.5, // 0.5% of total units (below 1% threshold)
              value: 2.5,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, mockContext);

      expect(anomalies).toHaveLength(0);
    });

    it('should not trigger when value is below amount threshold', () => {
      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 10,
              value: 3.0, // Below $5 threshold
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, mockContext);

      expect(anomalies).toHaveLength(0);
    });

    it('should respect seller-specific thresholds', () => {
      const sellerSpecificContext: RuleContext = {
        ...mockContext,
        thresholds: [
          {
            id: 'seller-threshold',
            sellerId: 'seller123',
            ruleType: RuleType.LOST_UNITS,
            operator: ThresholdOperator.LT,
            value: 0.05, // 5% threshold for this seller
            active: true
          }
        ]
      };

      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 3, // 3% of total units
              value: 15.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, sellerSpecificContext);

      expect(anomalies).toHaveLength(0); // Should not trigger with 3% < 5%
    });
  });

  describe('whitelist bypass', () => {
    it('should skip SKU whitelisted items', () => {
      const contextWithWhitelist: RuleContext = {
        ...mockContext,
        whitelist: [
          {
            id: 'whitelist1',
            sellerId: 'seller123',
            scope: WhitelistScope.SKU,
            value: 'SKU001',
            reason: 'Test SKU',
            active: true
          }
        ]
      };

      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001', // This SKU is whitelisted
              asin: 'B001234567',
              units: 10,
              value: 50.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, contextWithWhitelist);

      expect(anomalies).toHaveLength(0);
    });

    it('should skip ASIN whitelisted items', () => {
      const contextWithWhitelist: RuleContext = {
        ...mockContext,
        whitelist: [
          {
            id: 'whitelist1',
            sellerId: 'seller123',
            scope: WhitelistScope.ASIN,
            value: 'B001234567',
            reason: 'Test ASIN',
            active: true
          }
        ]
      };

      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567', // This ASIN is whitelisted
              units: 10,
              value: 50.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, contextWithWhitelist);

      expect(anomalies).toHaveLength(0);
    });

    it('should skip vendor whitelisted items', () => {
      const contextWithWhitelist: RuleContext = {
        ...mockContext,
        whitelist: [
          {
            id: 'whitelist1',
            sellerId: 'seller123',
            scope: WhitelistScope.VENDOR,
            value: 'Vendor A',
            reason: 'Test Vendor',
            active: true
          }
        ]
      };

      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 10,
              value: 50.0,
              vendor: 'Vendor A' // This vendor is whitelisted
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, contextWithWhitelist);

      expect(anomalies).toHaveLength(0);
    });
  });

  describe('determinism', () => {
    it('should generate same dedupe hash for same inputs', () => {
      const input1: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 10,
              value: 50.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const input2: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 10,
              value: 50.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies1 = rule.apply(input1, mockContext);
      const anomalies2 = rule.apply(input2, mockContext);

      expect(anomalies1[0].dedupeHash).toBe(anomalies2[0].dedupeHash);
    });

    it('should generate different dedupe hashes for different inputs', () => {
      const input1: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 10,
              value: 50.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const input2: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU002', // Different SKU
              asin: 'B001234567',
              units: 10,
              value: 50.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies1 = rule.apply(input1, mockContext);
      const anomalies2 = rule.apply(input2, mockContext);

      expect(anomalies1[0].dedupeHash).not.toBe(anomalies2[0].dedupeHash);
    });
  });

  describe('edge cases', () => {
    it('should handle zero total units gracefully', () => {
      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [
            {
              sku: 'SKU001',
              asin: 'B001234567',
              units: 5,
              value: 25.0,
              vendor: 'Vendor A'
            }
          ],
          totalUnits: 0,
          totalValue: 0
        }
      };

      const anomalies = rule.apply(input, mockContext);

      expect(anomalies).toHaveLength(0);
    });

    it('should handle empty inventory', () => {
      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {
          inventory: [],
          totalUnits: 100,
          totalValue: 1000.0
        }
      };

      const anomalies = rule.apply(input, mockContext);

      expect(anomalies).toHaveLength(0);
    });

    it('should handle missing inventory data', () => {
      const input: RuleInput = {
        sellerId: 'seller123',
        syncId: 'sync456',
        data: {}
      };

      const anomalies = rule.apply(input, mockContext);

      expect(anomalies).toHaveLength(0);
    });
  });
});

