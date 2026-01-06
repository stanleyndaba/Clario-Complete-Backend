import { RuleType, AnomalySeverity } from '@prisma/client';
import { BaseRule } from './baseRule';
import { Anomaly, RuleInput, RuleContext } from '../types';

export class OverchargedFeesRule extends BaseRule {
  readonly ruleType = RuleType.OVERCHARGED_FEES;
  readonly priority = 'HIGH';

  apply(input: RuleInput, context: RuleContext): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const { data } = input;

    // Extract fee data
    const feeItems = data.fees || [];
    const expectedFees = data.expectedFees || {};
    const totalRevenue = data.totalRevenue || 0;

    for (const feeItem of feeItems) {
      const { feeType, amount, sku, asin, vendor, shipmentId } = feeItem;
      const expectedAmount = expectedFees[feeType] || 0;
      const delta = Math.abs(amount - expectedAmount);

      // Check if item is whitelisted
      if (this.isWhitelisted('SKU', sku, context.whitelist) ||
          this.isWhitelisted('ASIN', asin, context.whitelist) ||
          this.isWhitelisted('VENDOR', vendor, context.whitelist) ||
          this.isWhitelisted('SHIPMENT', shipmentId, context.whitelist)) {
        continue;
      }

      // Check thresholds
      const relevantThresholds = context.thresholds.filter(t => 
        t.ruleType === RuleType.OVERCHARGED_FEES && 
        (t.sellerId === null || t.sellerId === context.sellerId)
      );

      const shouldTrigger = this.checkThresholds(delta, relevantThresholds);

      if (shouldTrigger) {
        const score = Math.min(0.9, Math.max(0.5, delta / totalRevenue * 100));
        const severity = this.calculateSeverity(score);

        const coreFields = {
          feeType,
          sku,
          asin,
          amount: amount.toString(),
          expectedAmount: expectedAmount.toString(),
          delta: delta.toString(),
          vendor,
          shipmentId
        };

        const dedupeHash = this.generateDedupeHash(context.sellerId, this.ruleType, coreFields);

        anomalies.push({
          ruleType: this.ruleType,
          severity,
          score,
          summary: `Overcharged fee detected: ${feeType} fee $${amount} vs expected $${expectedAmount} (delta: $${delta})`,
          evidence: {
            feeType,
            sku,
            asin,
            amount,
            expectedAmount,
            delta,
            vendor,
            shipmentId,
            totalRevenue
          },
          dedupeHash
        });
      }
    }

    return anomalies;
  }
}

