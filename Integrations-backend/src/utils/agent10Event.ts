export type Agent10EntityType =
  | 'dispute_case'
  | 'detection_result'
  | 'evidence_document'
  | 'recovery'
  | 'billing_transaction'
  | 'sync_job'
  | 'notification'
  | 'unknown';

type LegacyPayload = Record<string, any> | undefined;

function pickFirstString(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function extractAgent10EntityIds(source?: LegacyPayload) {
  const payload = source || {};
  const metadata = typeof payload.metadata === 'object' && payload.metadata ? payload.metadata : {};

  const disputeCaseId = pickFirstString(
    payload.dispute_case_id,
    payload.disputeId,
    payload.dispute_id,
    payload.caseId,
    payload.case_id,
    metadata.dispute_case_id,
    metadata.disputeId,
    metadata.dispute_id,
    metadata.caseId,
    metadata.case_id
  );

  const detectionId = pickFirstString(
    payload.detection_id,
    payload.detectionId,
    payload.claim_id,
    payload.claimId,
    metadata.detection_id,
    metadata.detectionId,
    metadata.claim_id,
    metadata.claimId
  );

  const documentId = pickFirstString(
    payload.document_id,
    payload.documentId,
    metadata.document_id,
    metadata.documentId
  );

  const recoveryId = pickFirstString(
    payload.recovery_id,
    payload.recoveryId,
    metadata.recovery_id,
    metadata.recoveryId
  );

  const billingTransactionId = pickFirstString(
    payload.billing_transaction_id,
    payload.billingTransactionId,
    metadata.billing_transaction_id,
    metadata.billingTransactionId
  );

  const syncId = pickFirstString(
    payload.sync_id,
    payload.syncId,
    metadata.sync_id,
    metadata.syncId
  );

  return {
    disputeCaseId,
    detectionId,
    documentId,
    recoveryId,
    billingTransactionId,
    syncId
  };
}

export function inferAgent10PrimaryEntityType(source?: LegacyPayload): Agent10EntityType {
  const ids = extractAgent10EntityIds(source);
  if (ids.recoveryId) return 'recovery';
  if (ids.billingTransactionId) return 'billing_transaction';
  if (ids.documentId) return 'evidence_document';
  if (ids.disputeCaseId) return 'dispute_case';
  if (ids.detectionId) return 'detection_result';
  if (ids.syncId) return 'sync_job';
  return 'unknown';
}

export function inferAgent10PrimaryEntityId(source?: LegacyPayload): string | undefined {
  const ids = extractAgent10EntityIds(source);
  return (
    ids.recoveryId ||
    ids.billingTransactionId ||
    ids.documentId ||
    ids.disputeCaseId ||
    ids.detectionId ||
    ids.syncId
  );
}

export function normalizeAgent10EventPayload(
  eventName: string,
  rawData?: LegacyPayload,
  overrides?: {
    tenantId?: string;
    timestamp?: string;
    entityType?: Agent10EntityType;
    entityId?: string;
  }
) {
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  const ids = extractAgent10EntityIds(data);
  const timestamp = overrides?.timestamp || pickFirstString(data.timestamp, data.created_at) || new Date().toISOString();
  const tenantId = overrides?.tenantId || pickFirstString(data.tenant_id, data.tenantId, data.tenantID);
  const entityType = overrides?.entityType || inferAgent10PrimaryEntityType(data);
  const entityId = overrides?.entityId || inferAgent10PrimaryEntityId(data);

  return {
    ...data,
    event_type: data.event_type || eventName,
    timestamp,
    tenant_id: tenantId,
    entity_type: entityType,
    entity_id: entityId,
    dispute_case_id: ids.disputeCaseId,
    detection_id: ids.detectionId,
    document_id: ids.documentId,
    recovery_id: ids.recoveryId,
    billing_transaction_id: ids.billingTransactionId,
    sync_id: ids.syncId,
    metadata: {
      ...(typeof data.metadata === 'object' && data.metadata ? data.metadata : {}),
      raw_event_name: eventName
    }
  };
}
