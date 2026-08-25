import crypto from 'crypto';
import {
  evaluateTransferSemanticEvidence,
  TransferEvidenceScope,
  TransferHistoryCoverage,
  TransferSemanticEvidence,
  TransferSemanticResolution,
} from './transferLedgerSemanticEvidence';

export const AMAZON_LEDGER_DETAIL_REPORT_TYPE = 'GET_LEDGER_DETAIL_VIEW_DATA';

export type ProviderFieldReadiness =
  | 'OBSERVED_RAW'
  | 'MISSING'
  | 'UNRESOLVED_PROVIDER_SEMANTICS';

export type ProviderReportReadiness = 'DOCUMENTED_RAW_SCHEMA' | 'UNSUPPORTED_REPORT_TYPE';

export interface ProviderFieldMapping {
  p3Field: string;
  providerFields: string[];
  rawValue: string | null;
  readiness: ProviderFieldReadiness;
  provenanceReference: string | null;
  note: string;
}

export interface TransferProviderEvidenceInput {
  scope: TransferEvidenceScope;
  sourceRunId: string | null;
  providerRowFingerprint: string | null;
  /** Number of rows with this immutable fingerprint in the current scoped page/window. */
  providerFingerprintOccurrences: number;
  providerSource: 'amazon_inventory_ledger';
  reportType: string;
  rawPayload: Record<string, unknown>;
  pagination: {
    historyCoverage: TransferHistoryCoverage;
    pageIndex: number | null;
    pageCount: number | null;
  };
}

export interface TransferProviderEvidenceReadiness {
  reportType: string;
  reportTypeReadiness: ProviderReportReadiness;
  rawPayloadHash: string;
  replayKey: string | null;
  fieldMappings: ProviderFieldMapping[];
  semanticEvidence: TransferSemanticEvidence;
  semanticResolution: TransferSemanticResolution;
  claimCapable: false;
  recoveryDetected: false;
  economicValue: null;
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findRawField(payload: Record<string, unknown>, aliases: string[]): { field: string | null; value: string | null } {
  const entries = Object.entries(payload);
  for (const alias of aliases) {
    const match = entries.find(([key]) => key.toLowerCase() === alias.toLowerCase());
    if (match) {
      const value = normalized(match[1]);
      return { field: match[0], value: value || null };
    }
  }
  return { field: null, value: null };
}

function stablePayloadHash(payload: Record<string, unknown>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => [key, payload[key] === undefined || payload[key] === null ? '' : String(payload[key]).trim()]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function rawMapping(
  p3Field: string,
  aliases: string[],
  payload: Record<string, unknown>,
  note: string,
  semanticsRequired = false,
): ProviderFieldMapping {
  const found = findRawField(payload, aliases);
  if (!found.value) {
    return {
      p3Field,
      providerFields: aliases,
      rawValue: null,
      readiness: 'MISSING',
      provenanceReference: null,
      note,
    };
  }

  return {
    p3Field,
    providerFields: found.field ? [found.field] : aliases,
    rawValue: found.value,
    readiness: semanticsRequired ? 'UNRESOLVED_PROVIDER_SEMANTICS' : 'OBSERVED_RAW',
    provenanceReference: `raw_payload.${found.field}`,
    note,
  };
}

/**
 * Maps an already-acquired, provider-shaped Inventory Ledger record into P3
 * inputs without requesting a report or assigning Amazon transfer semantics.
 * The documented report type and repository parser establish field presence and
 * provenance only; they do not prove that a raw label, reference, quantity,
 * fulfillment center, or timestamp carries a Transfer lifecycle meaning.
 */
export function assessTransferProviderEvidenceReadiness(
  input: TransferProviderEvidenceInput,
): TransferProviderEvidenceReadiness {
  const payload = input.rawPayload || {};
  const rawPayloadHash = stablePayloadHash(payload);
  const eventType = rawMapping(
    'provider_event_type',
    ['Event Type', 'event_type', 'event-type'],
    payload,
    'Observed raw Ledger event type. Raw labels are not independently verified Transfer semantics.',
  );
  const fnsku = rawMapping(
    'fnsku',
    ['FNSKU', 'fnsku'],
    payload,
    'Observed raw item identifier. It is preserved as evidence but does not prove a transfer route.',
  );
  const referenceId = rawMapping(
    'transfer_identity',
    ['Reference ID', 'reference_id', 'reference-id'],
    payload,
    'A raw reference is not treated as a Transfer identity until provider semantics are independently established.',
    true,
  );
  const sourceLocation = rawMapping(
    'source_location',
    ['Fulfillment Center', 'fulfillment_center', 'fulfillment-center'],
    payload,
    'A single raw fulfillment-center field cannot safely be assigned a source role.',
    true,
  );
  const destinationLocation = rawMapping(
    'destination_location',
    ['Fulfillment Center', 'fulfillment_center', 'fulfillment-center'],
    payload,
    'A single raw fulfillment-center field cannot safely be assigned a destination role.',
    true,
  );
  const quantitySent = rawMapping(
    'quantity_sent',
    ['Quantity', 'quantity'],
    payload,
    'A raw Ledger quantity cannot safely be assigned dispatched-quantity meaning without authoritative provider semantics.',
    true,
  );
  const quantityReceived = rawMapping(
    'quantity_received',
    ['Quantity', 'quantity'],
    payload,
    'A raw Ledger quantity cannot safely be assigned received-quantity meaning without authoritative provider semantics.',
    true,
  );
  const dispatchTimestamp = rawMapping(
    'dispatch_timestamp',
    ['Date and Time', 'date_and_time', 'date-and-time', 'Date', 'date'],
    payload,
    'A raw Ledger timestamp cannot safely be assigned dispatch meaning without authoritative provider semantics.',
    true,
  );
  const receiptTimestamp = rawMapping(
    'receipt_timestamp',
    ['Date and Time', 'date_and_time', 'date-and-time', 'Date', 'date'],
    payload,
    'A raw Ledger timestamp cannot safely be assigned receipt meaning without authoritative provider semantics.',
    true,
  );
  const mappings = [
    eventType,
    fnsku,
    referenceId,
    sourceLocation,
    destinationLocation,
    quantitySent,
    quantityReceived,
    dispatchTimestamp,
    receiptTimestamp,
  ];
  const rawEventType = eventType.rawValue;
  const normalizedEventType = normalized(rawEventType).replace(/\s+/g, '').toUpperCase();
  const reportTypeReadiness: ProviderReportReadiness = input.reportType === AMAZON_LEDGER_DETAIL_REPORT_TYPE
    ? 'DOCUMENTED_RAW_SCHEMA'
    : 'UNSUPPORTED_REPORT_TYPE';
  const providerSemanticsStatus = reportTypeReadiness === 'UNSUPPORTED_REPORT_TYPE'
    || (normalizedEventType && normalizedEventType !== 'WHSETRANSFERS')
    ? 'UNSUPPORTED'
    : 'PENDING_PROVIDER_SEMANTICS' as const;

  const semanticEvidence: TransferSemanticEvidence = {
    scope: input.scope,
    sourceRunId: input.sourceRunId,
    providerRowFingerprint: input.providerRowFingerprint,
    providerFingerprintOccurrences: input.providerFingerprintOccurrences,
    rawPayloadHash,
    providerEventTypeRaw: rawEventType,
    providerSemantics: {
      status: providerSemanticsStatus,
      evidenceReference: null,
    },
    // P4 deliberately leaves all Transfer-specific roles unresolved. A raw
    // reference, fulfillment center, quantity, and timestamp are preserved in
    // fieldMappings, but P3 cannot consume them as facts without authority.
    transferIdentity: null,
    sourceLocation: null,
    destinationLocation: null,
    item: {
      fnsku: fnsku.rawValue,
      sku: findRawField(payload, ['MSKU', 'msku', 'SKU', 'sku']).value,
      asin: findRawField(payload, ['ASIN', 'asin']).value,
    },
    quantity: { sent: null, received: null },
    timestamps: { sentAt: null, receivedAt: null, closedAt: null },
    lifecycle: 'UNKNOWN',
    historyCoverage: input.pagination.historyCoverage,
    counterpartCandidates: [],
  };

  return {
    reportType: input.reportType,
    reportTypeReadiness,
    rawPayloadHash,
    replayKey: normalized(input.providerRowFingerprint) || null,
    fieldMappings: mappings,
    semanticEvidence,
    semanticResolution: evaluateTransferSemanticEvidence(semanticEvidence),
    claimCapable: false,
    recoveryDetected: false,
    economicValue: null,
  };
}
