import { RuleType, AnomalySeverity, ThresholdOperator } from '@prisma/client';
import { Anomaly, RuleInput, RuleContext, Threshold, WhitelistItem } from '../types';

export abstract class BaseRule {
  abstract readonly ruleType: RuleType;
  abstract readonly priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

  abstract apply(input: RuleInput, context: RuleContext): Anomaly[];

  protected checkThresholds(value: number, thresholds: Threshold[]): boolean {
    for (const threshold of thresholds) {
      if (!threshold.active) continue;

      const thresholdValue = Number(threshold.value);
      let shouldTrigger = false;

      switch (threshold.operator) {
        case ThresholdOperator.GT:
          shouldTrigger = value > thresholdValue;
          break;
        case ThresholdOperator.GTE:
          shouldTrigger = value >= thresholdValue;
          break;
        case ThresholdOperator.LT:
          shouldTrigger = value < thresholdValue;
          break;
        case ThresholdOperator.LTE:
          shouldTrigger = value <= thresholdValue;
          break;
        case ThresholdOperator.EQ:
          shouldTrigger = value === thresholdValue;
          break;
      }

      if (shouldTrigger) {
        return true;
      }
    }
    return false;
  }

  protected isWhitelisted(scope: string, value: string, whitelist: WhitelistItem[]): boolean {
    return whitelist.some(item => 
      item.active && 
      item.scope.toLowerCase() === scope.toLowerCase() && 
      item.value === value
    );
  }

  protected calculateSeverity(score: number): AnomalySeverity {
    if (score >= 0.9) return AnomalySeverity.CRITICAL;
    if (score >= 0.7) return AnomalySeverity.HIGH;
    if (score >= 0.5) return AnomalySeverity.MEDIUM;
    return AnomalySeverity.LOW;
  }

  protected generateDedupeHash(sellerId: string, ruleType: RuleType, coreFields: Record<string, any>): string {
    const normalizedFields = Object.keys(coreFields)
      .sort()
      .map(key => `${key}:${coreFields[key]}`)
      .join('|');
    
    const hashInput = `${sellerId}|${ruleType}|${normalizedFields}`;
    return this.simpleHash(hashInput);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

