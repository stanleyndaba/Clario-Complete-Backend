import dataOrchestrator from '../../src/orchestration/dataOrchestrator';

const userId = 'user-1';
const claimId = 'claim-1';
const mcdeDocs = [{ id: 'mcde-1', claim_id: claimId }];

describe('DataOrchestrator Unit', () => {
  it('normalizes inventory ledger', () => {
    const raw = [{ claim_id: claimId, sku: 'sku1', quantity: 5, currency: 'USD', date: '2024-01-01' }];
    const result = dataOrchestrator.normalizeInventoryLedger(raw);
    expect(result[0]).toMatchObject({ claimId, type: 'inventory', amount: 5, currency: 'USD' });
  });

  it('normalizes shipments', () => {
    const raw = [{ claim_id: claimId, shipment_id: 'sh1', shipped_quantity: 10, currency: 'USD', shipment_date: '2024-01-02' }];
    const result = dataOrchestrator.normalizeShipments(raw);
    expect(result[0]).toMatchObject({ claimId, type: 'shipment', amount: 10 });
  });

  it('normalizes fees', () => {
    const raw = [{ claim_id: claimId, fee_type: 'FBA', fee_amount: 2.5, currency: 'USD', fee_date: '2024-01-03' }];
    const result = dataOrchestrator.normalizeFees(raw);
    expect(result[0]).toMatchObject({ claimId, type: 'fee', amount: 2.5 });
  });

  it('normalizes returns', () => {
    const raw = [{ claim_id: claimId, order_id: 'ord1', return_quantity: 1, currency: 'USD', return_date: '2024-01-04' }];
    const result = dataOrchestrator.normalizeReturns(raw);
    expect(result[0]).toMatchObject({ claimId, type: 'return', amount: 1 });
  });

  it('links MCDE docs to claims', () => {
    const claims = [{ claim_id: claimId, normalized: [{}] }];
    const linked = dataOrchestrator.linkMCDEDocsToClaims(claims, mcdeDocs);
    expect(linked[0].mcdeDocId).toBe('mcde-1');
  });

  it('is idempotent: createCaseFileLedgerEntry does not duplicate', async () => {
    // Mock supabase
    dataOrchestrator["supabase"] = {
      from: () => ({ select: () => ({ eq: () => ({ single: () => ({ data: { id: 'existing' }, error: null }) }) }) })
    };
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    await expect(
      dataOrchestrator.createCaseFileLedgerEntry(
        userId,
        { claim_id: claimId, raw: {} },
        [
          { claimId: claimId, type: 'inventory', amount: 0, currency: 'USD', date: new Date().toISOString(), details: {} }
        ],
        'mcde-1',
        []
      )
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});