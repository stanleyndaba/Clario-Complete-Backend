import { describe, test, expect } from '@jest/globals';
import { recoveryReconciliationService, AccountingFinancialArtifact } from '../recoveryReconciliationService';

describe('RecoveryReconciliationService Matching V0', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';

  test('A. Exact amount + exact date -> RECONCILED', () => {
    const date = new Date('2026-08-15T00:00:00Z');
    const artifact: AccountingFinancialArtifact = {
      provider: 'quickbooks',
      tenantId,
      providerRecordId: 'rec-1',
      recordType: 'Bill',
      transactionDate: date,
      amount: 842.17,
      currency: 'USD',
      reference: 'INV-01',
      description: 'Test bill',
      counterpartyName: 'Supplier A'
    };

    const result = recoveryReconciliationService.reconcileArtifacts(
      842.17,
      'USD',
      date,
      'INV-01',
      [artifact]
    );

    expect(result.status).toBe('RECONCILED');
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.7);
    expect(result.matchReasons).toContain('EXACT_AMOUNT');
    expect(result.matchReasons).toContain('SAME_CURRENCY');
    expect(result.matchReasons).toContain('DATE_EXACT');
    expect(result.matchReasons).toContain('REFERENCE_MATCH');
  });

  test('B. Exact amount + date within 2 days -> RECONCILED', () => {
    const expectedDate = new Date('2026-08-15T00:00:00Z');
    const artDate = new Date('2026-08-17T00:00:00Z');
    const artifact: AccountingFinancialArtifact = {
      provider: 'quickbooks',
      tenantId,
      providerRecordId: 'rec-2',
      recordType: 'Bill',
      transactionDate: artDate,
      amount: 842.17,
      currency: 'USD',
      reference: null,
      description: 'Test',
      counterpartyName: 'Supplier B'
    };

    const result = recoveryReconciliationService.reconcileArtifacts(
      842.17,
      'USD',
      expectedDate,
      null,
      [artifact]
    );

    expect(result.status).toBe('RECONCILED');
    expect(result.matchReasons).toContain('EXACT_AMOUNT');
    expect(result.matchReasons).toContain('DATE_NEAR');
  });

  test('D. Partial amount -> PARTIAL_MATCH', () => {
    const date = new Date('2026-08-15T00:00:00Z');
    const artifact: AccountingFinancialArtifact = {
      provider: 'xero',
      tenantId,
      providerRecordId: 'rec-3',
      recordType: 'ACCPAY',
      transactionDate: date,
      amount: 817.17,
      currency: 'USD',
      reference: null,
      description: 'Partial bill',
      counterpartyName: 'Supplier C'
    };

    const result = recoveryReconciliationService.reconcileArtifacts(
      842.17,
      'USD',
      date,
      null,
      [artifact]
    );

    expect(result.status).toBe('PARTIAL_MATCH');
    expect(result.difference).toBe(25.00);
  });

  test('E. Multiple similarly strong candidates -> NEEDS_REVIEW', () => {
    const date = new Date('2026-08-15T00:00:00Z');
    const art1: AccountingFinancialArtifact = {
      provider: 'quickbooks',
      tenantId,
      providerRecordId: 'rec-4a',
      recordType: 'Bill',
      transactionDate: date,
      amount: 842.17,
      currency: 'USD',
      reference: 'REF-X',
      description: 'First',
      counterpartyName: 'Sup 1'
    };
    const art2: AccountingFinancialArtifact = {
      provider: 'quickbooks',
      tenantId,
      providerRecordId: 'rec-4b',
      recordType: 'Bill',
      transactionDate: date,
      amount: 842.17,
      currency: 'USD',
      reference: 'REF-Y',
      description: 'Second',
      counterpartyName: 'Sup 2'
    };

    const result = recoveryReconciliationService.reconcileArtifacts(
      842.17,
      'USD',
      date,
      null,
      [art1, art2]
    );

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.matchReasons).toContain('MULTIPLE_CANDIDATES');
  });

  test('F. No credible candidate -> UNMATCHED', () => {
    const date = new Date('2026-08-15T00:00:00Z');
    const artifact: AccountingFinancialArtifact = {
      provider: 'quickbooks',
      tenantId,
      providerRecordId: 'rec-5',
      recordType: 'Bill',
      transactionDate: date,
      amount: 50.00,
      currency: 'USD',
      reference: null,
      description: 'Small fee',
      counterpartyName: 'Other'
    };

    const result = recoveryReconciliationService.reconcileArtifacts(
      842.17,
      'USD',
      date,
      null,
      [artifact]
    );

    expect(result.status).toBe('UNMATCHED');
  });

  test('G. Currency conflict -> UNMATCHED / rejected (Hard Stop)', () => {
    const date = new Date('2026-08-15T00:00:00Z');
    const artifact: AccountingFinancialArtifact = {
      provider: 'quickbooks',
      tenantId,
      providerRecordId: 'rec-6',
      recordType: 'Bill',
      transactionDate: date,
      amount: 842.17,
      currency: 'EUR',
      reference: null,
      description: 'EUR bill',
      counterpartyName: 'Euro Sup'
    };

    const result = recoveryReconciliationService.reconcileArtifacts(
      842.17,
      'USD',
      date,
      null,
      [artifact]
    );

    expect(result.status).toBe('UNMATCHED');
  });

  test('K. Small absolute / large percentage discrepancy -> NEEDS_REVIEW (Not Reconciled)', () => {
    const date = new Date('2026-08-15T00:00:00Z');
    const artifact: AccountingFinancialArtifact = {
      provider: 'quickbooks',
      tenantId,
      providerRecordId: 'rec-7',
      recordType: 'Bill',
      transactionDate: date,
      amount: 46.00,
      currency: 'USD',
      reference: null,
      description: 'Discrepant bill',
      counterpartyName: 'Sup X'
    };

    const result = recoveryReconciliationService.reconcileArtifacts(
      50.00,
      'USD',
      date,
      null,
      [artifact]
    );

    // diff = 4 (<= 5), but ratio = 8% (> 0.5%)
    expect(result.status).not.toBe('RECONCILED');
    expect(result.status).toBe('PARTIAL_MATCH'); // ratio 8% is <= 10%
  });

  test('L. Legitimate minor variance -> RECONCILED', () => {
    const date = new Date('2026-08-15T00:00:00Z');
    const artifact: AccountingFinancialArtifact = {
      provider: 'quickbooks',
      tenantId,
      providerRecordId: 'rec-8',
      recordType: 'Bill',
      transactionDate: date,
      amount: 996.00,
      currency: 'USD',
      reference: null,
      description: 'Minor variance bill',
      counterpartyName: 'Sup Y'
    };

    const result = recoveryReconciliationService.reconcileArtifacts(
      1000.00,
      'USD',
      date,
      null,
      [artifact]
    );

    // diff = 4 (<= 5), ratio = 0.4% (<= 0.5%)
    expect(result.status).toBe('RECONCILED');
  });
});
