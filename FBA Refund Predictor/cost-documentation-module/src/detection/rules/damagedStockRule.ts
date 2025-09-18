import { RuleType, AnomalySeverity } from '@prisma/client';
import { BaseRule } from './baseRule';
import { Anomaly, RuleInput, RuleContext } from '../types';

export class DamagedStockRule extends BaseRule {
  readonly ruleType = RuleType.DAMAGED_STOCK;
  readonly priority = 'MEDIUM';

  apply(input: RuleInput, context: RuleContext): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const { data } = input;

    // Extract damaged stock data
    const damagedItems = data.damagedStock || [];
    const totalInventory = data.totalInventory || 0;
    const totalInventoryValue = data.totalInventoryValue || 0;

    for (const item of damagedItems) {
      const { sku, asin, units, value, vendor, damageType, damageReason } = item;

      // Check if item is whitelisted
      if (this.isWhitelisted('SKU', sku, context.whitelist) ||
          this.isWhitelisted('ASIN', asin, context.whitelist) ||
          this.isWhitelisted('VENDOR', vendor, context.whitelist)) {
        continue;
      }

      // Check thresholds
      const relevantThresholds = context.thresholds.filter(t => 
        t.ruleType === RuleType.DAMAGED_STOCK && 
        (t.sellerId === null || t.sellerId === context.sellerId)
      );

      const shouldTriggerUnits = this.checkThresholds(units, relevantThresholds);
      const shouldTriggerValue = this.checkThresholds(value, relevantThresholds);

      if (shouldTriggerUnits || shouldTriggerValue) {
        const score = Math.min(0.9, Math.max(0.5, (units / totalInventory) + (value / totalInventoryValue)));
        const severity = this.calculateSeverity(score);

        const coreFields = {
          sku,
          asin,
          units: units.toString(),
          value: value.toString(),
          vendor,
          damageType,
          damageReason
        };

        const dedupeHash = this.generateDedupeHash(context.sellerId, this.ruleType, coreFields);

        anomalies.push({
          ruleType: this.ruleType,
          severity,
          score,
          summary: `Damaged stock detected: ${units} units (${sku}) worth $${value} - ${damageType}`,
          evidence: {
            sku,
            asin,
            units,
            value,
            vendor,
            damageType,
            damageReason,
            totalInventory,
            totalInventoryValue
          },
          dedupeHash
        });
      }
    }

    return anomalies;
  }
}

