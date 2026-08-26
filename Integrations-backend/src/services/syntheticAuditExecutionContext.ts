export const SYNTHETIC_TRAINING_PROVENANCE = 'SYNTHETIC_TRAINING_ONLY' as const;
export const SYNTHETIC_TRAINING_SYNC_PREFIX = 'synthetic_csv_' as const;

export type SyntheticAuditExecutionContext = Readonly<{
  provenance: typeof SYNTHETIC_TRAINING_PROVENANCE;
  tenantId: string;
}>;

export type SyntheticTrainingAuthorizationCode =
  | 'SYNTHETIC_TRAINING_TENANT_NOT_CONFIGURED'
  | 'SYNTHETIC_TRAINING_TENANT_CONFIGURATION_INVALID'
  | 'SYNTHETIC_TRAINING_TENANT_CONTEXT_MISSING'
  | 'SYNTHETIC_TRAINING_TENANT_CONTEXT_INVALID'
  | 'SYNTHETIC_TRAINING_TENANT_MISMATCH';

/**
 * A safe-to-return authorization error. The message never includes tenant IDs or
 * other configuration values; the code lets the route and test harness identify
 * the exact fail-closed branch without disclosing protected configuration.
 */
export class SyntheticTrainingAuthorizationError extends Error {
  constructor(
    public readonly code: SyntheticTrainingAuthorizationCode,
    message: string,
  ) {
    super(message);
    this.name = 'SyntheticTrainingAuthorizationError';
  }
}

const issuedSyntheticExecutionContexts = new WeakSet<object>();

type SyntheticProvenanceCarrier = {
  executionProvenance?: unknown;
  execution_provenance?: unknown;
  syntheticTraining?: unknown;
};

const TENANT_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizedTenantIdCandidate(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeTrustedTenantId(value: unknown): string | null {
  const normalized = normalizedTenantIdCandidate(value);
  return TENANT_UUID_REGEX.test(normalized) ? normalized : null;
}

export function getConfiguredSyntheticTrainingTenantId(): string | null {
  return normalizeTrustedTenantId(process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID);
}

/**
 * Synthetic runs are deliberately disabled unless the server has an explicitly
 * configured dedicated training tenant. This is the hard isolation boundary;
 * callers cannot enable training mode merely by setting a frontend flag.
 */
export function createSyntheticAuditExecutionContext(tenantId: string): SyntheticAuditExecutionContext {
  const configuredRawTenantId = normalizedTenantIdCandidate(process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID);
  if (!configuredRawTenantId) {
    throw new SyntheticTrainingAuthorizationError(
      'SYNTHETIC_TRAINING_TENANT_NOT_CONFIGURED',
      'Synthetic training execution is disabled because its dedicated training tenant is not configured.',
    );
  }

  const configuredTenantId = normalizeTrustedTenantId(configuredRawTenantId);
  if (!configuredTenantId) {
    throw new SyntheticTrainingAuthorizationError(
      'SYNTHETIC_TRAINING_TENANT_CONFIGURATION_INVALID',
      'Synthetic training execution is disabled because its dedicated training tenant configuration is invalid.',
    );
  }

  const authenticatedRawTenantId = normalizedTenantIdCandidate(tenantId);
  if (!authenticatedRawTenantId) {
    throw new SyntheticTrainingAuthorizationError(
      'SYNTHETIC_TRAINING_TENANT_CONTEXT_MISSING',
      'Synthetic training execution requires an authenticated training tenant context.',
    );
  }
  const authenticatedTenantId = normalizeTrustedTenantId(authenticatedRawTenantId);
  if (!authenticatedTenantId) {
    throw new SyntheticTrainingAuthorizationError(
      'SYNTHETIC_TRAINING_TENANT_CONTEXT_INVALID',
      'Synthetic training execution requires a valid authenticated training tenant context.',
    );
  }
  if (configuredTenantId !== authenticatedTenantId) {
    throw new SyntheticTrainingAuthorizationError(
      'SYNTHETIC_TRAINING_TENANT_MISMATCH',
      'Synthetic training execution is restricted to the configured training tenant.',
    );
  }

  const context = Object.freeze({
    provenance: SYNTHETIC_TRAINING_PROVENANCE,
    tenantId: authenticatedTenantId,
  });
  issuedSyntheticExecutionContexts.add(context);
  return context;
}

/** The prefix is an observability convention, never sufficient authorization. */
export function isSyntheticTrainingSyncCandidate(syncId: unknown): boolean {
  return String(syncId || '').startsWith(SYNTHETIC_TRAINING_SYNC_PREFIX);
}

export function isSyntheticTrainingContext(value: unknown): value is SyntheticAuditExecutionContext {
  const candidate = value as Partial<SyntheticAuditExecutionContext> | null | undefined;
  return candidate?.provenance === SYNTHETIC_TRAINING_PROVENANCE &&
    typeof candidate.tenantId === 'string' &&
    candidate.tenantId.trim().length > 0;
}

/**
 * Validates a context carried between trusted server components. The caller must
 * already have obtained the tenant from authenticated server state; this function
 * never accepts a tenant from a client payload as authority.
 */
export function validateSyntheticAuditExecutionContext(
  tenantId: string,
  value: unknown,
): SyntheticAuditExecutionContext {
  if (!isSyntheticTrainingContext(value)) {
    throw new Error('Synthetic training execution context is missing or malformed.');
  }
  if (!issuedSyntheticExecutionContexts.has(value)) {
    throw new Error('Synthetic training execution context was not issued by the server.');
  }
  if (normalizeTrustedTenantId(value.tenantId) !== normalizeTrustedTenantId(tenantId)) {
    throw new SyntheticTrainingAuthorizationError(
      'SYNTHETIC_TRAINING_TENANT_MISMATCH',
      'Synthetic training execution context tenant does not match the authenticated tenant.',
    );
  }
  return createSyntheticAuditExecutionContext(tenantId);
}

export function getTrustedSyntheticAuditExecutionContext(
  tenantId: string,
  carrier: SyntheticProvenanceCarrier | null | undefined,
): SyntheticAuditExecutionContext | null {
  const provenance = carrier?.executionProvenance ?? carrier?.execution_provenance;
  const hasSyntheticFlag = carrier?.syntheticTraining === true;

  if (provenance === undefined || provenance === null || provenance === '') {
    if (hasSyntheticFlag) {
      throw new Error('Synthetic training flag is present without trusted execution provenance.');
    }
    return null;
  }
  if (provenance !== SYNTHETIC_TRAINING_PROVENANCE) {
    throw new Error('Synthetic training execution provenance is unrecognized.');
  }

  return createSyntheticAuditExecutionContext(tenantId);
}

/**
 * A synthetic-looking sync without trusted provenance must never fall back to a
 * normal seller execution. Conversely, trusted provenance with an ordinary ID is
 * a contradiction because the only trusted creator emits the synthetic prefix.
 */
export function assertSyntheticAuditIdentityConsistency(
  syncId: unknown,
  context: SyntheticAuditExecutionContext | null,
): void {
  const hasSyntheticPrefix = isSyntheticTrainingSyncCandidate(syncId);
  if (hasSyntheticPrefix && !context) {
    throw new Error('Synthetic sync identity is missing trusted execution provenance.');
  }
  if (!hasSyntheticPrefix && context) {
    throw new Error('Trusted synthetic execution provenance conflicts with a non-synthetic sync identity.');
  }
}

export function resolveTrustedSyntheticAuditExecutionContext(
  tenantId: string,
  syncId: unknown,
  carrier: SyntheticProvenanceCarrier | null | undefined,
): SyntheticAuditExecutionContext | null {
  const context = getTrustedSyntheticAuditExecutionContext(tenantId, carrier);
  assertSyntheticAuditIdentityConsistency(syncId, context);
  return context;
}

export function syntheticTrainingSummaryFields() {
  return {
    syntheticTraining: true,
    executionProvenance: SYNTHETIC_TRAINING_PROVENANCE,
    trainingLabel: 'SYNTHETIC TRAINING ONLY',
    commercialSuppressed: true,
  } as const;
}
