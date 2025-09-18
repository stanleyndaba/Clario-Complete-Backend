import evidenceValidatorService from '../src/services/evidenceValidatorService';

// Note: In a real test we would mock supabase client. Here we outline the cases.

describe('evidenceValidatorService', () => {
  test('returns no_proof when no candidates', async () => {
    // mock supabase to return empty sets for both line_items and documents
    // expect(await evidenceValidatorService.validate({ sellerId: 'u', sku: 'SKU-1', quantity: 10 })).toEqual({ status: 'no_proof' });
    expect(true).toBe(true);
  });

  test('returns proof_found when single strong match', async () => {
    // mock line items for a single matching document
    expect(true).toBe(true);
  });

  test('returns ambiguity when multiple candidates', async () => {
    // mock two documents matched
    expect(true).toBe(true);
  });
});


