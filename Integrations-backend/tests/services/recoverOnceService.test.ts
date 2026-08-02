import { describe, expect, it } from '@jest/globals';
import { calculateRecoverOnceQuote } from '../../src/services/recoverOnceService';

describe('Recover Once quote calculation', () => {
  it('returns unavailable when there is no actionable scope', () => {
    const quote = calculateRecoverOnceQuote({
      opportunityCount: 0,
      workloadScore: 0,
      estimatedRecoverableSubunits: 0,
    });

    expect(quote.status).toBe('unavailable');
    expect(quote.amountSubunits).toBeNull();
  });

  it('returns a single fixed quote for an eligible light scope', () => {
    const quote = calculateRecoverOnceQuote({
      opportunityCount: 1,
      workloadScore: 2,
      estimatedRecoverableSubunits: 1000000,
    });

    expect(quote.status).toBe('available');
    expect(quote.amountSubunits).toBe(149900);
    expect(quote.tier).toBe('light');
  });

  it('requires manual review when the fixed quote breaks the economic guardrail', () => {
    const quote = calculateRecoverOnceQuote({
      opportunityCount: 2,
      workloadScore: 4,
      estimatedRecoverableSubunits: 500000,
    });

    expect(quote.status).toBe('manual_review_required');
    expect(quote.amountSubunits).toBeNull();
  });

  it('requires manual review for complex scopes beyond self-serve quoting', () => {
    const quote = calculateRecoverOnceQuote({
      opportunityCount: 10,
      workloadScore: 12,
      estimatedRecoverableSubunits: 10000000,
    });

    expect(quote.status).toBe('manual_review_required');
    expect(quote.amountSubunits).toBeNull();
  });
});
