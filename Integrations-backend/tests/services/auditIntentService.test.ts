import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import auditIntentService from '../../src/services/auditIntentService';
import { supabaseAdmin } from '../../src/database/supabaseClient';

jest.mock('../../src/database/supabaseClient', () => ({
  convertUserIdToUuid: (value: string) => value,
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

function queryResult(result: any) {
  const chain: any = {
    select: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    update: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
  };
  return chain;
}

describe('auditIntentService idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses an active intent for the same idempotency key and source', async () => {
    const existingIntent = {
      id: 'intent-1',
      source_type: 'sp_api',
      status: 'pending',
      user_id: null,
      tenant_id: null,
      audit_run_id: null,
      return_path: '/audit',
      metadata: {},
      expires_at: '2999-01-01T00:00:00.000Z',
    };

    (supabaseAdmin.from as any).mockReturnValueOnce(queryResult({ data: existingIntent, error: null }));

    const result = await auditIntentService.createIntent({
      sourceType: 'sp_api',
      returnPath: '/audit',
      idempotencyKey: 'same-click',
    });

    expect(result.id).toBe('intent-1');
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it('loads the winning intent when concurrent inserts race on the same idempotency key', async () => {
    const racedIntent = {
      id: 'intent-raced',
      source_type: 'csv_upload',
      status: 'pending',
      user_id: null,
      tenant_id: null,
      audit_run_id: null,
      return_path: '/data-upload?returnTo=audit',
      metadata: {},
      expires_at: '2999-01-01T00:00:00.000Z',
    };

    (supabaseAdmin.from as any)
      .mockReturnValueOnce(queryResult({ data: null, error: null }))
      .mockReturnValueOnce(queryResult({ data: null, error: { code: '23505', message: 'duplicate key' } }))
      .mockReturnValueOnce(queryResult({ data: racedIntent, error: null }));

    const result = await auditIntentService.createIntent({
      sourceType: 'csv_upload',
      returnPath: '/data-upload?returnTo=audit',
      idempotencyKey: 'same-manual-click',
    });

    expect(result.id).toBe('intent-raced');
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(3);
  });

  it('rejects attaching an intent already owned by another user', async () => {
    const existingIntent = {
      id: 'intent-owned',
      source_type: 'sp_api',
      status: 'attached',
      user_id: 'user-a',
      tenant_id: 'tenant-a',
      audit_run_id: null,
      return_path: '/audit',
      metadata: {},
      attached_at: '2026-08-01T00:00:00.000Z',
      expires_at: '2999-01-01T00:00:00.000Z',
    };

    (supabaseAdmin.from as any).mockReturnValueOnce(queryResult({ data: existingIntent, error: null }));

    await expect(auditIntentService.attachIntent({
      intentId: 'intent-owned',
      userId: 'user-b',
      tenantId: 'tenant-b',
    })).rejects.toThrow('different authenticated user');
  });

  it('does not return expired owned intents for audit continuation', async () => {
    const expiredIntent = {
      id: 'intent-expired',
      source_type: 'sp_api',
      status: 'attached',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      audit_run_id: null,
      return_path: '/audit',
      metadata: {},
      attached_at: '2026-08-01T00:00:00.000Z',
      expires_at: '2000-01-01T00:00:00.000Z',
    };

    (supabaseAdmin.from as any)
      .mockReturnValueOnce(queryResult({ data: expiredIntent, error: null }))
      .mockReturnValueOnce(queryResult({ data: { ...expiredIntent, status: 'expired' }, error: null }));

    const result = await auditIntentService.getOwnedActiveIntent('intent-expired', 'user-1');

    expect(result).toBeNull();
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });

  it('does not attach terminal abandoned intents to authenticated users', async () => {
    const abandonedIntent = {
      id: 'intent-abandoned',
      source_type: 'sp_api',
      status: 'abandoned',
      user_id: null,
      tenant_id: null,
      audit_run_id: null,
      return_path: '/audit',
      metadata: {},
      attached_at: null,
      expires_at: '2999-01-01T00:00:00.000Z',
    };

    (supabaseAdmin.from as any).mockReturnValueOnce(queryResult({ data: abandonedIntent, error: null }));

    const result = await auditIntentService.attachIntent({
      intentId: 'intent-abandoned',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    expect(result).toBeNull();
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
  });

  it('does not link expired intents to an audit run', async () => {
    const expiredIntent = {
      id: 'intent-expired-link',
      source_type: 'sp_api',
      status: 'attached',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      audit_run_id: null,
      return_path: '/audit',
      metadata: {},
      attached_at: '2026-08-01T00:00:00.000Z',
      expires_at: '2000-01-01T00:00:00.000Z',
    };

    (supabaseAdmin.from as any)
      .mockReturnValueOnce(queryResult({ data: expiredIntent, error: null }))
      .mockReturnValueOnce(queryResult({ data: { ...expiredIntent, status: 'expired' }, error: null }));

    const result = await auditIntentService.linkAuditRun({
      intentId: 'intent-expired-link',
      userId: 'user-1',
      tenantId: 'tenant-1',
      auditRunId: 'audit-1',
    });

    expect(result).toBeNull();
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
  });
});
