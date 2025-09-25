import amazonService from '../../services/amazonService';

describe('SP-API integration smoke (transpile-only path assumed)', () => {
  const userId = process.env.USER_ID || 'test-user';
  it('fetches reimbursements, fees, shipments, returns, removals without throwing', async () => {
    await expect(amazonService.getRealFbaReimbursements(userId)).resolves.toBeDefined();
    await expect(amazonService.getRealFeeDiscrepancies(userId)).resolves.toBeDefined();
    await expect(amazonService.getRealShipmentData(userId)).resolves.toBeDefined();
    await expect(amazonService.getRealReturnsData(userId)).resolves.toBeDefined();
    await expect(amazonService.getRealRemovalData(userId)).resolves.toBeDefined();
  });
});

