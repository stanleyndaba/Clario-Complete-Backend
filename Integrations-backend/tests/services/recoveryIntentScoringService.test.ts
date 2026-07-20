import { describe, expect, it } from '@jest/globals';

import {
  buildIntentSummary,
  getHighestIntentStage,
  getIntentStage,
  getRecoveryIntentSignals,
} from '../../src/services/recoveryIntentScoringService';

describe('recoveryIntentScoringService', () => {
  it('maps scores to recovery intent stages', () => {
    expect(getIntentStage(0)).toBe('COLD');
    expect(getIntentStage(10)).toBe('INTERESTED');
    expect(getIntentStage(25)).toBe('ENGAGED');
    expect(getIntentStage(50)).toBe('HIGH_INTENT');
    expect(getIntentStage(80)).toBe('RECOVERY_READY');
    expect(getIntentStage(100)).toBe('CUSTOMER');
  });

  it('extracts meaningful intent signals from public analytics events', () => {
    expect(getRecoveryIntentSignals({
      eventName: 'page_view',
      payload: {},
      pagePath: '/',
      routeGroup: 'home',
    })).toEqual([{ reason: 'homepage_viewed', score: 1 }]);

    expect(getRecoveryIntentSignals({
      eventName: 'scroll_depth_reached',
      payload: { scroll_percent: 75 },
    })).toEqual([
      { reason: 'scroll_50', score: 2 },
      { reason: 'scroll_75', score: 3 },
    ]);

    expect(getRecoveryIntentSignals({
      eventName: 'checkout_started',
      payload: {},
    })).toEqual([{ reason: 'checkout_started', score: 25 }]);

    expect(getRecoveryIntentSignals({
      eventName: 'payment_success',
      payload: {},
    })).toEqual([{ reason: 'payment_success', score: 100 }]);
  });

  it('keeps the highest reached intent stage', () => {
    expect(getHighestIntentStage('ENGAGED', 'INTERESTED')).toBe('ENGAGED');
    expect(getHighestIntentStage('ENGAGED', 'RECOVERY_READY')).toBe('RECOVERY_READY');
  });

  it('deduplicates reason names in intent summaries', () => {
    expect(buildIntentSummary(63, 'HIGH_INTENT', {
      cta_clicked: { score: 10 },
      demo_completed: { score: 15 },
      early_access_viewed: { score: 10 },
    })).toEqual({
      score: 63,
      stage: 'HIGH_INTENT',
      reasons: ['cta_clicked', 'demo_completed', 'early_access_viewed'],
    });
  });
});
