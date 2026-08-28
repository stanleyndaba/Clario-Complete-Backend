import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const mockGetOwnedIntentForLifecycle: any = jest.fn();
const mockGetSafeAuditIntentReturnPath: any = jest.fn();
const mockGetLatestAudit: any = jest.fn();
const mockGetTenantEntitlement: any = jest.fn();
const mockGetAuthoritativeAmazonConnectionTruth: any = jest.fn();
const mockToAmazonLifecycleStatus: any = jest.fn();

jest.mock('../../src/services/auditIntentService', () => ({
  __esModule: true,
  default: { getOwnedIntentForLifecycle: mockGetOwnedIntentForLifecycle },
  getSafeAuditIntentReturnPath: mockGetSafeAuditIntentReturnPath,
}));

jest.mock('../../src/services/auditRunService', () => ({
  __esModule: true,
  default: { getLatestAudit: mockGetLatestAudit },
}));

jest.mock('../../src/services/workspaceEntitlementService', () => ({
  __esModule: true,
  default: { getTenantEntitlement: mockGetTenantEntitlement },
}));

jest.mock('../../src/services/amazonConnectionTruthService', () => ({
  getAuthoritativeAmazonConnectionTruth: mockGetAuthoritativeAmazonConnectionTruth,
  toAmazonLifecycleStatus: mockToAmazonLifecycleStatus,
}));

import sellerLifecycleService from '../../src/services/sellerLifecycleService';

const disconnectedTruth = {
  connected: false,
  needsReconnect: false,
  tokenPresent: false,
  tokenNotExpired: false,
  tenantBound: false,
  sellerResolved: false,
  storeBound: false,
  errorCode: null,
  errorMessage: null,
  errorState: null,
  storeId: null,
};

function configureDefaults() {
  mockGetOwnedIntentForLifecycle.mockResolvedValue(null);
  mockGetSafeAuditIntentReturnPath.mockImplementation((value: string) => value);
  mockGetLatestAudit.mockResolvedValue(null);
  mockGetTenantEntitlement.mockResolvedValue({
    entitlement: { entitled: false, state: 'none', access_until: null },
  });
  mockGetAuthoritativeAmazonConnectionTruth.mockResolvedValue(disconnectedTruth);
  mockToAmazonLifecycleStatus.mockReturnValue('connection_required');
}

async function resolve(overrides: Partial<{
  userId: string;
  tenantId: string;
  tenantSlug: string;
  auditIntentId: string | null;
}> = {}) {
  return sellerLifecycleService.resolve({
    userId: 'user-a',
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    auditIntentId: 'intent-a',
    ...overrides,
  });
}

describe('sellerLifecycleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureDefaults();
  });

  it('uses an owned active Audit intent before every other lifecycle branch', async () => {
    mockGetOwnedIntentForLifecycle.mockResolvedValue({
      id: 'intent-a',
      tenant_id: 'tenant-a',
      audit_run_id: 'audit-intent',
      return_path: '/data-upload?returnTo=audit',
    });
    mockGetLatestAudit.mockResolvedValue({ id: 'audit-latest', status: 'completed' });
    mockGetTenantEntitlement.mockResolvedValue({
      entitlement: { entitled: true, state: 'active', access_until: '2099-01-01T00:00:00.000Z' },
    });

    const result = await resolve();

    expect(result.continuation).toEqual({
      kind: 'audit_intent',
      destination: '/data-upload?returnTo=audit',
      audit_id: 'audit-intent',
      audit_status: null,
      intent_id: 'intent-a',
    });
    expect(mockGetOwnedIntentForLifecycle).toHaveBeenCalledWith('intent-a', 'user-a');
    expect(mockGetLatestAudit).toHaveBeenCalledWith('user-a', 'tenant-a');
    expect(mockGetAuthoritativeAmazonConnectionTruth).toHaveBeenCalledWith({ userId: 'user-a', tenantId: 'tenant-a' });
  });

  it('refuses an unsafe intent return path and continues with the latest Audit', async () => {
    mockGetSafeAuditIntentReturnPath.mockReturnValue(null);
    mockGetOwnedIntentForLifecycle.mockResolvedValue({
      id: 'intent-a',
      tenant_id: 'tenant-a',
      audit_run_id: null,
      return_path: '//untrusted.example/redirect',
    });
    mockGetLatestAudit.mockResolvedValue({ id: 'audit-1', status: 'syncing' });

    const result = await resolve();

    expect(result.continuation).toMatchObject({
      kind: 'audit',
      destination: '/audit?auditId=audit-1',
      audit_id: 'audit-1',
      audit_status: 'syncing',
    });
  });

  it('refuses an owned intent that is bound to another tenant', async () => {
    mockGetOwnedIntentForLifecycle.mockResolvedValue({
      id: 'intent-other-tenant',
      tenant_id: 'tenant-b',
      audit_run_id: null,
      return_path: '/audit',
    });

    const result = await resolve();

    expect(result.continuation).toMatchObject({
      kind: 'audit_default',
      destination: '/audit',
    });
  });

  it.each(['created', 'syncing', 'detecting', 'amazon_connection_required', 'completed', 'failed'])(
    'returns the existing Audit decision surface for %s',
    async (status) => {
      mockGetLatestAudit.mockResolvedValue({ id: `audit-${status}`, status });

      const result = await resolve({ auditIntentId: null });

      expect(result.continuation).toEqual({
        kind: 'audit',
        destination: `/audit?auditId=audit-${status}`,
        audit_id: `audit-${status}`,
        audit_status: status,
        intent_id: null,
      });
    },
  );

  it('maps activated Audit continuity to completed without creating a new lifecycle state', async () => {
    mockGetLatestAudit.mockResolvedValue({ id: 'audit-activated', status: 'activated' });

    const result = await resolve({ auditIntentId: null });

    expect(result.continuation).toMatchObject({
      kind: 'audit',
      destination: '/audit?auditId=audit-activated',
      audit_status: 'completed',
    });
  });

  it('returns the existing dashboard only for an entitled seller without Audit continuity', async () => {
    mockGetTenantEntitlement.mockResolvedValue({
      entitlement: { entitled: true, state: 'active', access_until: '2099-01-01T00:00:00.000Z' },
    });

    const result = await resolve({ auditIntentId: null });

    expect(result.continuation).toEqual({
      kind: 'workspace',
      destination: '/app/tenant-a/dashboard',
      audit_id: null,
      audit_status: null,
      intent_id: null,
    });
  });

  it('defaults a non-entitled seller to Audit without forcing Amazon connection', async () => {
    const result = await resolve({ auditIntentId: null });

    expect(result.continuation).toEqual({
      kind: 'audit_default',
      destination: '/audit',
      audit_id: null,
      audit_status: null,
      intent_id: null,
    });
  });

  it('returns only the shared authoritative Amazon truth fields', async () => {
    const reconnectTruth = {
      ...disconnectedTruth,
      needsReconnect: true,
      tokenPresent: true,
      errorCode: 'amazon_token_expired',
      errorMessage: 'Amazon token is expired and must be refreshed through reconnect.',
      errorState: 'auth_invalid',
    };
    mockGetAuthoritativeAmazonConnectionTruth.mockResolvedValue(reconnectTruth);
    mockToAmazonLifecycleStatus.mockReturnValue('reconnect_required');

    const result = await resolve({ auditIntentId: null });

    expect(result.amazon).toEqual({
      connected: false,
      needs_reconnect: true,
      status: 'reconnect_required',
      error_code: 'amazon_token_expired',
      error_message: 'Amazon token is expired and must be refreshed through reconnect.',
    });
  });
});
