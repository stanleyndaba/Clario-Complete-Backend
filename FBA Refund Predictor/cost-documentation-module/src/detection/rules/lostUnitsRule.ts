import { RuleType, AnomalySeverity } from '@prisma/client';
import { BaseRule } from './baseRule';
import { Anomaly, RuleInput, RuleContext } from '../types';

export class LostUnitsRule extends BaseRule {
  readonly ruleType = RuleType.LOST_UNITS;
  readonly priority = 'HIGH';

  apply(input: RuleInput, context: RuleContext): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const { data } = input;

    // Extract inventory data
    const inventoryItems = data.inventory || [];
    const totalUnits = data.totalUnits || 0;
    const totalValue = data.totalValue || 0;

    for (const item of inventoryItems) {
      const { sku, asin, units, value, vendor } = item;

      // Check if item is whitelisted
      if (this.isWhitelisted('SKU', sku, context.whitelist) ||
          this.isWhitelisted('ASIN', asin, context.whitelist) ||
          this.isWhitelisted('VENDOR', vendor, context.whitelist)) {
        continue;
      }

      // Calculate lost units percentage and value
      const lostUnitsPercentage = units / totalUnits;
      const lostUnitsValue = value;

      // Check thresholds
      const relevantThresholds = context.thresholds.filter(t => 
        t.ruleType === RuleType.LOST_UNITS && 
        (t.sellerId === null || t.sellerId === context.sellerId)
      );

      const shouldTriggerPercentage = this.checkThresholds(lostUnitsPercentage, relevantThresholds);
      const shouldTriggerValue = this.checkThresholds(lostUnitsValue, relevantThresholds);

      if (shouldTriggerPercentage || shouldTriggerValue) {
        const score = Math.min(0.9, Math.max(0.5, (lostUnitsPercentage * 10) + (lostUnitsValue / totalValue)));
        const severity = this.calculateSeverity(score);

        const coreFields = {
          sku,
          asin,
          units: units.toString(),
          value: value.toString(),
          vendor
        };

        const dedupeHash = this.generateDedupeHash(context.sellerId, this.ruleType, coreFields);

        anomalies.push({
          ruleType: this.ruleType,
          severity,
          score,
          summary: `Lost units detected: ${units} units (${sku}) worth $${value}`,
          evidence: {
            sku,
            asin,
            units,
            value,
            vendor,
            lostUnitsPercentage,
            totalUnits,
            totalValue
          },
          dedupeHash
        });
      }
    }

    return anomalies;
  }
}

