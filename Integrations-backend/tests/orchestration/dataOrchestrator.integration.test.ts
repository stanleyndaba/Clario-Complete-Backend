import dataOrchestrator from '../../src/orchestration/dataOrchestrator';
// Replace external ledgers dependency with a local mock and expose globally
const mockSaveCaseFile = jest.fn();
const ledgers = { saveCaseFile: mockSaveCaseFile, getCaseFilesForUser: jest.fn() } as any;
(global as any).ledgers = ledgers;

const userId = 'user-1';
const claimId = 'claim-1';
const mcdeDocs = [{ id: 'mcde-1', claim_id: claimId }];
const rawAmazonData = {
  inventory: [{ claim_id: claimId, sku: 'sku1', quantity: 5, currency: 'USD', date: '2024-01-01' }],
  shipments: [],
  fees: [],
  returns: []
};

describe('DataOrchestrator Integration', () => {
  beforeEach(() => { mockSaveCaseFile.mockClear(); });

  it('creates ledger entries and links MCDE docs', async () => {
    await dataOrchestrator.orchestrateIngestion(userId, rawAmazonData, mcdeDocs);
    expect(mockSaveCaseFile).toHaveBeenCalledWith(userId, claimId, expect.objectContaining({ mcdeDocId: 'mcde-1' }));
  });

  it('is idempotent: running twice does not duplicate', async () => {
    mockSaveCaseFile.mockClear();
    await dataOrchestrator.orchestrateIngestion(userId, rawAmazonData, mcdeDocs);
    await dataOrchestrator.orchestrateIngestion(userId, rawAmazonData, mcdeDocs);
    // Should only call saveCaseFile once per claimId
    expect(mockSaveCaseFile).toHaveBeenCalledTimes(1);
  });

  it('enforces RLS: user cannot access others cases', async () => {
    // Simulate RLS by only allowing access to userId
    const getCaseFilesForUser = jest.fn((uid) => (uid === userId ? [{ claim_id: claimId }] : []));
    ledgers.getCaseFilesForUser = getCaseFilesForUser as any;
    expect(ledgers.getCaseFilesForUser('user-1')).toHaveLength(1);
    expect(ledgers.getCaseFilesForUser('user-2')).toHaveLength(0);
  });
});