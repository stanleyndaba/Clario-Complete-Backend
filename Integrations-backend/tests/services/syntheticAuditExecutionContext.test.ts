import { afterEach, describe, expect, it } from '@jest/globals';
import {
  SYNTHETIC_TRAINING_PROVENANCE,
  SYNTHETIC_TRAINING_SYNC_PREFIX,
  SyntheticTrainingAuthorizationError,
  createSyntheticAuditExecutionContext,
  isSyntheticTrainingContext,
  isSyntheticTrainingSyncCandidate,
  resolveTrustedSyntheticAuditExecutionContext,
  syntheticTrainingSummaryFields,
  validateSyntheticAuditExecutionContext,
} from '../../src/services/syntheticAuditExecutionContext';

const originalTenantId = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
const TRAINING_TENANT = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';

afterEach(() => {
  if (originalTenantId === undefined) {
    delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
  } else {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = originalTenantId;
  }
});

function expectAuthorizationCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected synthetic authorization failure');
  } catch (error) {
    expect(error).toBeInstanceOf(SyntheticTrainingAuthorizationError);
    expect((error as SyntheticTrainingAuthorizationError).code).toBe(code);
  }
}

describe('synthetic audit execution context', () => {
  it('fails closed unless the server has a configured dedicated training tenant', () => {
    delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;

    expectAuthorizationCode(
      () => createSyntheticAuditExecutionContext(TRAINING_TENANT),
      'SYNTHETIC_TRAINING_TENANT_NOT_CONFIGURED',
    );
  });

  it('rejects malformed configured and authenticated tenant identities before issuing synthetic context', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'not-a-tenant-uuid';
    expectAuthorizationCode(
      () => createSyntheticAuditExecutionContext(TRAINING_TENANT),
      'SYNTHETIC_TRAINING_TENANT_CONFIGURATION_INVALID',
    );

    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;
    expectAuthorizationCode(
      () => createSyntheticAuditExecutionContext('not-a-tenant-uuid'),
      'SYNTHETIC_TRAINING_TENANT_CONTEXT_INVALID',
    );
  });

  it('normalizes trusted tenant UUID casing and whitespace without accepting a different tenant', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = `  ${TRAINING_TENANT.toUpperCase()}  `;

    const context = createSyntheticAuditExecutionContext(` ${TRAINING_TENANT.toUpperCase()} `);

    expect(context.tenantId).toBe(TRAINING_TENANT);
    expectAuthorizationCode(
      () => createSyntheticAuditExecutionContext(OTHER_TENANT),
      'SYNTHETIC_TRAINING_TENANT_MISMATCH',
    );
  });

  it('creates immutable synthetic provenance only for the dedicated training tenant', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;

    const context = createSyntheticAuditExecutionContext(TRAINING_TENANT);

    expect(Object.isFrozen(context)).toBe(true);
    expect(context).toEqual({
      provenance: SYNTHETIC_TRAINING_PROVENANCE,
      tenantId: TRAINING_TENANT,
    });
    expect(isSyntheticTrainingContext(context)).toBe(true);
    expect(validateSyntheticAuditExecutionContext(TRAINING_TENANT, context)).toEqual(context);
  });

  it('rejects a forged lookalike execution context even when its fields are correct', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;
    const forged = Object.freeze({
      provenance: SYNTHETIC_TRAINING_PROVENANCE,
      tenantId: TRAINING_TENANT,
    });

    expect(() => validateSyntheticAuditExecutionContext(TRAINING_TENANT, forged))
      .toThrow('was not issued by the server');
  });

  it('treats the prefix as a consistency identifier, not proof of synthetic authorization', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;
    const syntheticSyncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;

    expect(isSyntheticTrainingSyncCandidate(syntheticSyncId)).toBe(true);
    expect(() => resolveTrustedSyntheticAuditExecutionContext(TRAINING_TENANT, syntheticSyncId, null))
      .toThrow('Synthetic sync identity is missing trusted execution provenance');
  });

  it('rejects trusted provenance attached to an ordinary sync identity rather than silently downgrading it', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;

    expect(() => resolveTrustedSyntheticAuditExecutionContext(TRAINING_TENANT, 'csv_123', syntheticTrainingSummaryFields()))
      .toThrow('conflicts with a non-synthetic sync identity');
  });

  it('fails closed for a synthetic ID whose durable queue payload is missing, malformed, or unrecognized', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;
    const syncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;

    expect(() => resolveTrustedSyntheticAuditExecutionContext(TRAINING_TENANT, syncId, {}))
      .toThrow('missing trusted execution provenance');
    expect(() => resolveTrustedSyntheticAuditExecutionContext(TRAINING_TENANT, syncId, {
      execution_provenance: 'SELLER_LIVE',
    }))
      .toThrow('execution provenance is unrecognized');
    expect(() => resolveTrustedSyntheticAuditExecutionContext(TRAINING_TENANT, syncId, {
      syntheticTraining: true,
    }))
      .toThrow('flag is present without trusted execution provenance');
  });

  it('does not trust a generic provenance-shaped value from a serialized payload', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;
    const syncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;

    expect(() => resolveTrustedSyntheticAuditExecutionContext(TRAINING_TENANT, syncId, {
      provenance: SYNTHETIC_TRAINING_PROVENANCE,
    } as any)).toThrow('missing trusted execution provenance');
  });

  it('rehydrates a serialized authoritative queue payload into a fresh server-issued context for a future worker or retry', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;
    const syncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;
    const serializedPayload = JSON.parse(JSON.stringify({
      execution_provenance: SYNTHETIC_TRAINING_PROVENANCE,
    }));

    const rehydrated = resolveTrustedSyntheticAuditExecutionContext(TRAINING_TENANT, syncId, serializedPayload);

    expect(rehydrated).toEqual({ provenance: SYNTHETIC_TRAINING_PROVENANCE, tenantId: TRAINING_TENANT });
    expect(validateSyntheticAuditExecutionContext(TRAINING_TENANT, rehydrated)).toEqual(rehydrated);
  });

  it('resolves synthetic status only from trusted provenance plus a consistent server-created sync identity', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = TRAINING_TENANT;
    const syncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;

    expect(resolveTrustedSyntheticAuditExecutionContext(TRAINING_TENANT, syncId, syntheticTrainingSummaryFields()))
      .toEqual({ provenance: SYNTHETIC_TRAINING_PROVENANCE, tenantId: TRAINING_TENANT });
  });
});
