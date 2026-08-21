import crypto from 'crypto';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export const TRANSFER_LEDGER_OBSERVATION_FLAG = 'connected_transfer_ledger_observation';
export const TRANSFER_LEDGER_OBSERVATION_SOURCE = 'amazon_inventory_ledger';
export const TRANSFER_LEDGER_OBSERVATION_VERSION = 'v1';

export type TransferLedgerHealthStatus =
  | 'AVAILABLE_DATA'
  | 'AVAILABLE_ZERO_QUALIFYING_DATA'
  | 'AVAILABLE_PARTIAL_HISTORY'
  | 'UNSUPPORTED_EVENT_SEMANTICS'
  | 'AMBIGUOUS_TRANSFER_EVIDENCE'
  | 'ACCESS_DENIED'
  | 'PARSER_FAILURE'
  | 'RATE_LIMITED_OR_TEMPORARY_ERROR';

export type TransferLedgerObservationState =
  | 'UNPAIRED'
  | 'AMBIGUOUS'
  | 'PENDING_PROVIDER_SEMANTICS';

export interface LedgerObservationSourceResult {
  success: boolean;
  count: number;
  message?: string;
}

export interface TransferLedgerObservationRequest {
  userId: string;
  tenantId: string;
  storeId: string;
  marketplaceId: string;
  /** Parent Connected Audit detection sync identifier. */
  syncId: string;
  /** The existing Agent 2 Ledger persistence sync identifier. */
  ledgerSyncId: string;
  historyCoverageStart: Date;
  historyCoverageEnd: Date;
  ledgerResult: LedgerObservationSourceResult;
  historyCoverageStatus?: 'FULL' | 'PARTIAL' | 'UNKNOWN';
  observedAt?: Date;
}

export interface TransferLedgerObservationResult {
  sourceRunId: string;
  healthStatus: TransferLedgerHealthStatus;
  historyCoverageStatus: 'FULL' | 'PARTIAL' | 'UNKNOWN';
  observationCount: number;
  ambiguityCount: number;
  claimCapable: false;
  errorClass?: string;
  errorMessage?: string;
}

interface LedgerRow {
  tenant_id: string;
  user_id: string;
  store_id: string | null;
  sync_id: string;
  source: string | null;
  fnsku: string | null;
  sku: string | null;
  asin: string | null;
  event_date: string | null;
  event_datetime: string | null;
  provider_event_type_raw: string | null;
  reference_id: string | null;
  raw_quantity: number | string | null;
  quantity: number | string | null;
  fulfillment_center: string | null;
  country: string | null;
  disposition: string | null;
  reason: string | null;
  reconciled_quantity: number | string | null;
  unreconciled_quantity: number | string | null;
  provider_store: string | null;
  provider_row_fingerprint: string | null;
  raw_payload: Record<string, unknown> | null;
}

interface DatabaseClient {
  from(table: string): any;
}

export function normalizeProviderEventType(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

export function isExactWhseTransfersEvent(value: unknown): boolean {
  return normalizeProviderEventType(value) === 'WHSETRANSFERS';
}

function isTransferLikeProviderEvent(value: unknown): boolean {
  return normalizeProviderEventType(value).includes('TRANSFER');
}

function toNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function toRequiredIso(value: unknown, field: string): string {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) {
    throw new TransferLedgerObservationError(`Missing or invalid ${field}.`, `INVALID_${field.toUpperCase()}`);
  }
  return parsed.toISOString();
}

function toOptionalIso(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return toRequiredIso(value, 'event_datetime');
}

function requiredString(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new TransferLedgerObservationError(`Missing ${field} on preserved Ledger observation.`, `MISSING_${field.toUpperCase()}`);
  }
  return normalized;
}

export class TransferLedgerObservationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TransferLedgerObservationError';
  }
}

/**
 * Reads already-persisted Ledger data only. It never requests an Amazon report,
 * derives a route or transfer lifecycle, writes inventory_transfers, emits a
 * detection result, assigns a valuation, or creates claim-capable output.
 */
export class TransferLedgerObservationService {
  constructor(private readonly db: DatabaseClient = supabaseAdmin as unknown as DatabaseClient) {}

  async observe(input: TransferLedgerObservationRequest): Promise<TransferLedgerObservationResult> {
    const observedAt = input.observedAt || new Date();
    const sourceRunId = crypto.randomUUID();
    const historyCoverageStatus = input.historyCoverageStatus || (input.ledgerResult.success ? 'FULL' : 'UNKNOWN');

    if (!input.ledgerResult.success) {
      const unavailable = this.classifyLedgerFailure(input.ledgerResult.message);
      await this.persistSourceRun({
        input,
        sourceRunId,
        observedAt,
        healthStatus: unavailable.status,
        historyCoverageStatus,
        observationCount: 0,
        ambiguityCount: 0,
        errorClass: unavailable.errorClass,
        errorMessage: input.ledgerResult.message || null,
      });
      return this.toResult(sourceRunId, unavailable.status, historyCoverageStatus, 0, 0, unavailable.errorClass, input.ledgerResult.message);
    }

    let rows: LedgerRow[];
    try {
      const { data, error } = await this.db
        .from('inventory_ledger_events')
        .select('*')
        .eq('tenant_id', input.tenantId)
        .eq('user_id', input.userId)
        .eq('store_id', input.storeId)
        .eq('sync_id', input.ledgerSyncId)
        .eq('source', 'sp_api');
      if (error) throw new Error(error.message || 'Ledger observation query failed.');
      rows = (data || []) as LedgerRow[];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ledger observation query failed.';
      await this.persistSourceRun({
        input,
        sourceRunId,
        observedAt,
        healthStatus: 'PARSER_FAILURE',
        historyCoverageStatus,
        observationCount: 0,
        ambiguityCount: 0,
        errorClass: 'LEDGER_OBSERVATION_QUERY_FAILURE',
        errorMessage: message,
      });
      return this.toResult(sourceRunId, 'PARSER_FAILURE', historyCoverageStatus, 0, 0, 'LEDGER_OBSERVATION_QUERY_FAILURE', message);
    }

    if (rows.length === 0) {
      const healthStatus: TransferLedgerHealthStatus = historyCoverageStatus === 'PARTIAL'
        ? 'AVAILABLE_PARTIAL_HISTORY'
        : 'AVAILABLE_ZERO_QUALIFYING_DATA';
      await this.persistSourceRun({
        input,
        sourceRunId,
        observedAt,
        healthStatus,
        historyCoverageStatus,
        observationCount: 0,
        ambiguityCount: 0,
      });
      return this.toResult(sourceRunId, healthStatus, historyCoverageStatus, 0, 0);
    }

    const exactRows = rows.filter(row => isExactWhseTransfersEvent(row.provider_event_type_raw));
    const transferLikeRows = rows.filter(row => isTransferLikeProviderEvent(row.provider_event_type_raw));

    if (exactRows.length === 0) {
      const hasUnsupportedTransferLikeRows = transferLikeRows.length > 0;
      const healthStatus: TransferLedgerHealthStatus = hasUnsupportedTransferLikeRows
        ? 'UNSUPPORTED_EVENT_SEMANTICS'
        : historyCoverageStatus === 'PARTIAL'
          ? 'AVAILABLE_PARTIAL_HISTORY'
          : 'AVAILABLE_ZERO_QUALIFYING_DATA';
      await this.persistSourceRun({
        input,
        sourceRunId,
        observedAt,
        healthStatus,
        historyCoverageStatus,
        observationCount: 0,
        ambiguityCount: 0,
        errorClass: hasUnsupportedTransferLikeRows ? 'NON_WHSETRANSFERS_TRANSFER_EVENT' : undefined,
        errorMessage: hasUnsupportedTransferLikeRows
          ? 'Transfer-like Ledger events were preserved but do not match the exact WhseTransfers taxonomy.'
          : undefined,
      });
      return this.toResult(
        sourceRunId,
        healthStatus,
        historyCoverageStatus,
        0,
        0,
        hasUnsupportedTransferLikeRows ? 'NON_WHSETRANSFERS_TRANSFER_EVENT' : undefined,
        hasUnsupportedTransferLikeRows ? 'Transfer-like Ledger events were preserved but do not match the exact WhseTransfers taxonomy.' : undefined,
      );
    }

    let observations: Array<Record<string, unknown>>;
    try {
      observations = exactRows.map(row => this.toObservationRow(row, input, sourceRunId, observedAt));
    } catch (error) {
      const normalized = error instanceof TransferLedgerObservationError
        ? error
        : new TransferLedgerObservationError(error instanceof Error ? error.message : 'Observation normalization failed.', 'UNKNOWN_NORMALIZATION_FAILURE');
      await this.persistSourceRun({
        input,
        sourceRunId,
        observedAt,
        healthStatus: 'PARSER_FAILURE',
        historyCoverageStatus,
        observationCount: 0,
        ambiguityCount: 0,
        errorClass: normalized.code,
        errorMessage: normalized.message,
      });
      return this.toResult(sourceRunId, 'PARSER_FAILURE', historyCoverageStatus, 0, 0, normalized.code, normalized.message);
    }

    const referenceCounts = new Map<string, number>();
    for (const row of observations) {
      const referenceId = String(row.reference_id || '').trim();
      if (referenceId) referenceCounts.set(referenceId, (referenceCounts.get(referenceId) || 0) + 1);
    }
    const ambiguousReferences = new Set([...referenceCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([referenceId]) => referenceId));
    const ambiguityCount = observations.filter(row => ambiguousReferences.has(String(row.reference_id || '').trim())).length;

    observations = observations.map(row => {
      const referenceId = String(row.reference_id || '').trim();
      const observationState: TransferLedgerObservationState = !referenceId
        ? 'UNPAIRED'
        : ambiguousReferences.has(referenceId)
          ? 'AMBIGUOUS'
          : 'PENDING_PROVIDER_SEMANTICS';
      return { ...row, observation_state: observationState };
    });

    const finalHealthStatus: TransferLedgerHealthStatus = historyCoverageStatus === 'PARTIAL'
      ? 'AVAILABLE_PARTIAL_HISTORY'
      : ambiguityCount > 0
        ? 'AMBIGUOUS_TRANSFER_EVIDENCE'
        : 'AVAILABLE_DATA';

    // Persist source-run provenance before dependent observations so the
    // foreign key is valid and every row is traceable to one attempt.
    await this.persistSourceRun({
      input,
      sourceRunId,
      observedAt,
      healthStatus: finalHealthStatus,
      historyCoverageStatus,
      observationCount: observations.length,
      ambiguityCount,
    });

    try {
      const { error } = await this.db
        .from('transfer_ledger_observations')
        .upsert(observations, {
          onConflict: 'tenant_id,user_id,store_id,marketplace_id,provider_source,provider_row_fingerprint',
        });
      if (error) throw new Error(error.message || 'Transfer observation persistence failed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer observation persistence failed.';
      await this.updatePersistedSourceRun(sourceRunId, {
        health_status: 'PARSER_FAILURE',
        observed_transfer_event_count: 0,
        ambiguity_count: 0,
        error_class: 'OBSERVATION_PERSISTENCE_FAILURE',
        error_message: message,
        completed_at: observedAt.toISOString(),
        updated_at: observedAt.toISOString(),
      });
      return this.toResult(sourceRunId, 'PARSER_FAILURE', historyCoverageStatus, 0, 0, 'OBSERVATION_PERSISTENCE_FAILURE', message);
    }

    const healthStatus = finalHealthStatus;

    logger.info('[TRANSFER OBSERVATION] Preserved WhseTransfers observations without reconstruction or claims', {
      userId: input.userId,
      tenantId: input.tenantId,
      storeId: input.storeId,
      marketplaceId: input.marketplaceId,
      syncId: input.syncId,
      ledgerSyncId: input.ledgerSyncId,
      sourceRunId,
      healthStatus,
      observationCount: observations.length,
      ambiguityCount,
      claimCapable: false,
    });

    return this.toResult(sourceRunId, healthStatus, historyCoverageStatus, observations.length, ambiguityCount);
  }

  private toObservationRow(
    row: LedgerRow,
    input: TransferLedgerObservationRequest,
    sourceRunId: string,
    observedAt: Date,
  ): Record<string, unknown> {
    const providerFingerprint = requiredString(row.provider_row_fingerprint, 'provider_row_fingerprint');
    const rawQuantity = toNullableInteger(row.raw_quantity ?? row.quantity);
    if (rawQuantity === null) {
      throw new TransferLedgerObservationError('Missing or invalid raw_quantity on WhseTransfers Ledger row.', 'INVALID_RAW_QUANTITY');
    }

    return {
      source_run_id: sourceRunId,
      tenant_id: input.tenantId,
      user_id: input.userId,
      store_id: input.storeId,
      marketplace_id: input.marketplaceId,
      sync_id: input.syncId,
      provider_source: TRANSFER_LEDGER_OBSERVATION_SOURCE,
      provider_event_type_raw: requiredString(row.provider_event_type_raw, 'provider_event_type_raw'),
      event_date: toRequiredIso(row.event_date, 'event_date'),
      event_datetime: toOptionalIso(row.event_datetime),
      fnsku: requiredString(row.fnsku, 'fnsku'),
      sku: row.sku || null,
      asin: row.asin || null,
      reference_id: row.reference_id || null,
      raw_quantity: rawQuantity,
      fulfillment_center: row.fulfillment_center || null,
      country: row.country || null,
      disposition: row.disposition || null,
      reason: row.reason || null,
      reconciled_quantity: toNullableInteger(row.reconciled_quantity),
      unreconciled_quantity: toNullableInteger(row.unreconciled_quantity),
      provider_store: row.provider_store || null,
      provider_row_fingerprint: providerFingerprint,
      observation_state: 'PENDING_PROVIDER_SEMANTICS',
      raw_payload: row.raw_payload || {},
      ingestion_version: TRANSFER_LEDGER_OBSERVATION_VERSION,
      last_observed_at: observedAt.toISOString(),
      updated_at: observedAt.toISOString(),
    };
  }

  private async persistSourceRun(args: {
    input: TransferLedgerObservationRequest;
    sourceRunId: string;
    observedAt: Date;
    healthStatus: TransferLedgerHealthStatus;
    historyCoverageStatus: 'FULL' | 'PARTIAL' | 'UNKNOWN';
    observationCount: number;
    ambiguityCount: number;
    errorClass?: string;
    errorMessage?: string | null;
  }): Promise<void> {
    const { input, sourceRunId, observedAt, healthStatus, historyCoverageStatus, observationCount, ambiguityCount, errorClass, errorMessage } = args;
    const { error } = await this.db
      .from('transfer_ledger_source_runs')
      .insert({
        id: sourceRunId,
        tenant_id: input.tenantId,
        user_id: input.userId,
        store_id: input.storeId,
        marketplace_id: input.marketplaceId,
        sync_id: input.syncId,
        ledger_sync_id: input.ledgerSyncId,
        provider_source: TRANSFER_LEDGER_OBSERVATION_SOURCE,
        observation_version: TRANSFER_LEDGER_OBSERVATION_VERSION,
        health_status: healthStatus,
        history_coverage_status: historyCoverageStatus,
        history_coverage_start: input.historyCoverageStart.toISOString(),
        history_coverage_end: input.historyCoverageEnd.toISOString(),
        observed_transfer_event_count: observationCount,
        ambiguity_count: ambiguityCount,
        error_class: errorClass || null,
        error_message: errorMessage || null,
        metadata: {
          ledger_sync_success: input.ledgerResult.success,
          ledger_sync_count: input.ledgerResult.count,
          claim_capable: false,
          reads_existing_ledger_only: true,
        },
        started_at: observedAt.toISOString(),
        completed_at: observedAt.toISOString(),
        updated_at: observedAt.toISOString(),
      });
    if (error) throw new Error(`Failed to persist transfer observation source run: ${error.message}`);
  }

  private async updatePersistedSourceRun(sourceRunId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await this.db
      .from('transfer_ledger_source_runs')
      .update(patch)
      .eq('id', sourceRunId);
    if (error) throw new Error(`Failed to update transfer observation source run: ${error.message}`);
  }

  private classifyLedgerFailure(message?: string): { status: TransferLedgerHealthStatus; errorClass: string } {
    const normalized = String(message || '').toLowerCase();
    if (normalized.includes('access denied') || normalized.includes('unauthorized') || normalized.includes('forbidden')) {
      return { status: 'ACCESS_DENIED', errorClass: 'LEDGER_ACCESS_DENIED' };
    }
    return { status: 'RATE_LIMITED_OR_TEMPORARY_ERROR', errorClass: 'LEDGER_SOURCE_UNAVAILABLE' };
  }

  private toResult(
    sourceRunId: string,
    healthStatus: TransferLedgerHealthStatus,
    historyCoverageStatus: 'FULL' | 'PARTIAL' | 'UNKNOWN',
    observationCount: number,
    ambiguityCount: number,
    errorClass?: string,
    errorMessage?: string,
  ): TransferLedgerObservationResult {
    return {
      sourceRunId,
      healthStatus,
      historyCoverageStatus,
      observationCount,
      ambiguityCount,
      claimCapable: false,
      errorClass,
      errorMessage,
    };
  }
}

export const transferLedgerObservationService = new TransferLedgerObservationService();
export default transferLedgerObservationService;
