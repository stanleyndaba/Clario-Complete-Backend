import { afterEach, describe, expect, it } from '@jest/globals';
import {
  SYNTHETIC_TRAINING_PROVENANCE,
  SYNTHETIC_TRAINING_SYNC_PREFIX,
  createSyntheticAuditExecutionContext,
  isSyntheticTrainingContext,
  isSyntheticTrainingSyncCandidate,
  resolveTrustedSyntheticAuditExecutionContext,
  syntheticTrainingSummaryFields,
  validateSyntheticAuditExecutionContext,
} from '../../src/services/syntheticAuditExecutionContext';

const originalTenantId = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;

afterEach(() => {
  if (originalTenantId === undefined) {
    delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
  } else {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = originalTenantId;
  }
});

describe('synthetic audit execution context', () => {
  it('fails closed unless the server has a configured dedicated training tenant', () => {
    delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;

    expect(() => createSyntheticAuditExecutionContext('training-tenant'))
      .toThrow('MARGIN_SYNTHETIC_TRAINING_TENANT_ID is not configured');
  });

  it('rejects a caller whose tenant is not the configured dedicated training tenant', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';

    expect(() => createSyntheticAuditExecutionContext('seller-tenant'))
      .toThrow('restricted to the configured training tenant');
  });

  it('creates immutable synthetic provenance only for the dedicated training tenant', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';

    const context = createSyntheticAuditExecutionContext('training-tenant');

    expect(Object.isFrozen(context)).toBe(true);
    expect(context).toEqual({
      provenance: SYNTHETIC_TRAINING_PROVENANCE,
      tenantId: 'training-tenant',
    });
    expect(isSyntheticTrainingContext(context)).toBe(true);
    expect(validateSyntheticAuditExecutionContext('training-tenant', context)).toEqual(context);
  });

  it('rejects a forged lookalike execution context even when its fields are correct', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';
    const forged = Object.freeze({
      provenance: SYNTHETIC_TRAINING_PROVENANCE,
      tenantId: 'training-tenant',
    });

    expect(() => validateSyntheticAuditExecutionContext('training-tenant', forged))
      .toThrow('was not issued by the server');
  });

  it('treats the prefix as a consistency identifier, not proof of synthetic authorization', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';
    const syntheticSyncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;

    expect(isSyntheticTrainingSyncCandidate(syntheticSyncId)).toBe(true);
    expect(() => resolveTrustedSyntheticAuditExecutionContext('training-tenant', syntheticSyncId, null))
      .toThrow('Synthetic sync identity is missing trusted execution provenance');
  });

  it('rejects trusted provenance attached to an ordinary sync identity rather than silently downgrading it', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';

    expect(() => resolveTrustedSyntheticAuditExecutionContext('training-tenant', 'csv_123', syntheticTrainingSummaryFields()))
      .toThrow('conflicts with a non-synthetic sync identity');
  });

  it('fails closed for a synthetic ID whose durable queue payload is missing, malformed, or unrecognized', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';
    const syncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;

    expect(() => resolveTrustedSyntheticAuditExecutionContext('training-tenant', syncId, {}))
      .toThrow('missing trusted execution provenance');
    expect(() => resolveTrustedSyntheticAuditExecutionContext('training-tenant', syncId, {
      execution_provenance: 'SELLER_LIVE',
    }))
      .toThrow('execution provenance is unrecognized');
    expect(() => resolveTrustedSyntheticAuditExecutionContext('training-tenant', syncId, {
      syntheticTraining: true,
    }))
      .toThrow('flag is present without trusted execution provenance');
  });

  it('does not trust a generic provenance-shaped value from a serialized payload', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';
    const syncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;

    expect(() => resolveTrustedSyntheticAuditExecutionContext('training-tenant', syncId, {
      provenance: SYNTHETIC_TRAINING_PROVENANCE,
    } as any)).toThrow('missing trusted execution provenance');
  });

  it('rehydrates a serialized authoritative queue payload into a fresh server-issued context for a future worker or retry', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';
    const syncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;
    const serializedPayload = JSON.parse(JSON.stringify({
      execution_provenance: SYNTHETIC_TRAINING_PROVENANCE,
    }));

    const rehydrated = resolveTrustedSyntheticAuditExecutionContext('training-tenant', syncId, serializedPayload);

    expect(rehydrated).toEqual({ provenance: SYNTHETIC_TRAINING_PROVENANCE, tenantId: 'training-tenant' });
    expect(validateSyntheticAuditExecutionContext('training-tenant', rehydrated)).toEqual(rehydrated);
  });

  it('resolves synthetic status only from trusted provenance plus a consistent server-created sync identity', () => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = 'training-tenant';
    const syncId = `${SYNTHETIC_TRAINING_SYNC_PREFIX}123`;

    expect(resolveTrustedSyntheticAuditExecutionContext('training-tenant', syncId, syntheticTrainingSummaryFields()))
      .toEqual({ provenance: SYNTHETIC_TRAINING_PROVENANCE, tenantId: 'training-tenant' });
  });
});
