import { createSilentConnectAccount, getStripeAccountStatus } from '../src/services/stripeOnboardingService';
import Stripe from 'stripe';

jest.mock('stripe');
const mockStripe = Stripe as jest.MockedClass<typeof Stripe>;
const mockAccountsCreate = jest.fn();
mockStripe.prototype.accounts = { create: mockAccountsCreate } as any;

jest.mock('../src/database/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: jest.fn(() => ({ error: null })),
      select: jest.fn(() => ({ eq: jest.fn().mockReturnThis(), single: jest.fn() })),
    })),
  },
}));
const { supabase } = require('../src/database/supabaseClient');

const userId = 'user-123';
const email = 'test@example.com';

describe('Silent Stripe Onboarding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a Stripe Connect account and stores it in DB', async () => {
    mockAccountsCreate.mockResolvedValueOnce({ id: 'acct_1' });
    supabase.from().upsert.mockResolvedValueOnce({ error: null });
    const accountId = await createSilentConnectAccount(userId, email);
    expect(accountId).toBe('acct_1');
    expect(mockAccountsCreate).toHaveBeenCalledWith({ type: 'express', email, metadata: { user_id: userId } });
    expect(supabase.from().upsert).toHaveBeenCalledWith({ user_id: userId, stripe_account_id: 'acct_1' }, { onConflict: 'user_id' });
  });

  it('retries on Stripe API failure and succeeds', async () => {
    mockAccountsCreate
      .mockRejectedValueOnce(new Error('stripe fail'))
      .mockResolvedValueOnce({ id: 'acct_2' });
    supabase.from().upsert.mockResolvedValueOnce({ error: null });
    const accountId = await createSilentConnectAccount(userId, email);
    expect(accountId).toBe('acct_2');
    expect(mockAccountsCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after all retries fail', async () => {
    mockAccountsCreate.mockRejectedValue(new Error('stripe fail'));
    await expect(createSilentConnectAccount(userId, email)).rejects.toThrow('stripe fail');
    expect(mockAccountsCreate).toHaveBeenCalledTimes(3);
  });

  it('returns created if stripe_account_id exists', async () => {
    supabase.from().select().eq().single.mockResolvedValueOnce({ data: { stripe_account_id: 'acct_1' }, error: null });
    const status = await getStripeAccountStatus(userId);
    expect(status).toBe('created');
  });

  it('returns not_found if no stripe_account_id', async () => {
    supabase.from().select().eq().single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const status = await getStripeAccountStatus(userId);
    expect(status).toBe('not_found');
  });
});