import crypto from 'crypto';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import {
  fulfillmentInboundV0Service,
  INBOUND_PROVIDER_CONTRACT_VERSION,
  INBOUND_PROVIDER_SOURCE,
  type FulfillmentInboundV0ReadResult,
  type FulfillmentInboundV0Request,
  type FulfillmentInboundV0Shipment,
  type FulfillmentInboundV0ShipmentItem,
  type InboundHistoryCoverageStatus,
  type InboundSourceHealthStatus,
} from './fulfillmentInboundV0Service';

export type CanonicalInboundStatus =
  | 'PLANNED'
  | 'IN_TRANSIT'
  | 'DELIVERED_OR_CHECKED_IN'
  | 'RECEIVING'
  | 'CLOSED'
  | 'CANCELLED_OR_DELETED'
  | 'PROVIDER_ERROR_OR_UNKNOWN';

export interface InboundReceivingSyncRequest extends FulfillmentInboundV0Request {
  sourceObservedAt?: Date;
}

export interface CanonicalInboundShipment {
  providerShipmentId: string;
  shipmentStatusRaw: string;
  shipmentStatusCanonical: CanonicalInboundStatus;
  statusObservedAt: string;
  shipmentCreatedAt: string | null;
  lastProviderUpdatedAt: string | null;
  closedAt: null;
  destinationFulfillmentCenterId: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  provenance: Record<string, unknown>;
}

export interface CanonicalInboundShipmentItem {
  providerShipmentId: string;
  providerItemIdentity: string;
  sku: string;
  fnsku: string | null;
  asin: null;
  quantityShipped: number;
  quantityReceived: number | null;
  quantityInCase: number | null;
  releaseDate: string | null;
  labelOwner: string | null;
  prepMetadata: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export interface CanonicalInboundNormalization {
  shipments: CanonicalInboundShipment[];
  items: CanonicalInboundShipmentItem[];
}

export interface InboundReceivingSyncResult {
  sourceRunId: string;
  healthStatus: InboundSourceHealthStatus;
  historyCoverageStatus: InboundHistoryCoverageStatus;
  shipmentCount: number;
  itemCount: number;
  claimCapable: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export class InboundNormalizationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'InboundNormalizationError';
  }
}

const directProviderHealthStatuses = new Set<InboundSourceHealthStatus>([
  'AVAILABLE_DATA',
  'AVAILABLE_ZERO_QUALIFYING_DATA',
  'AVAILABLE_PARTIAL_HISTORY',
]);

function toOptionalIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InboundNormalizationError(`Provider returned an invalid date: ${value}`, 'INVALID_PROVIDER_DATE');
  }
  return parsed.toISOString();
}

function toOptionalDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InboundNormalizationError(`Provider returned an invalid release date: ${value}`, 'INVALID_RELEASE_DATE');
  }
  return parsed.toISOString().slice(0, 10);
}

function toRequiredNonNegativeInteger(value: unknown, field: string): number {
  if (value === null || value === undefined || value === '') {
    throw new InboundNormalizationError(`Provider omitted required ${field}.`, `MISSING_${field.toUpperCase()}`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InboundNormalizationError(`Provider returned invalid ${field}: ${String(value)}.`, `INVALID_${field.toUpperCase()}`);
  }
  return parsed;
}

function toOptionalNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InboundNormalizationError(`Provider returned invalid ${field}: ${String(value)}.`, `INVALID_${field.toUpperCase()}`);
  }
  return parsed;
}

function toOptionalPositiveInteger(value: unknown, field: string): number | null {
  const parsed = toOptionalNonNegativeInteger(value, field);
  if (parsed === 0) {
    throw new InboundNormalizationError(`Provider returned non-positive ${field}: 0.`, `INVALID_${field.toUpperCase()}`);
  }
  return parsed;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InboundNormalizationError(`Provider omitted required ${field}.`, `MISSING_${field.toUpperCase()}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function mapInboundStatus(rawStatus: unknown): CanonicalInboundStatus {
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : '';
  if (status === 'WORKING' || status === 'READY_TO_SHIP') return 'PLANNED';
  if (status === 'SHIPPED' || status === 'IN_TRANSIT') return 'IN_TRANSIT';
  if (status === 'DELIVERED' || status === 'CHECKED_IN') return 'DELIVERED_OR_CHECKED_IN';
  if (status === 'RECEIVING') return 'RECEIVING';
  if (status === 'CLOSED') return 'CLOSED';
  if (status === 'CANCELLED' || status === 'CANCELED' || status === 'DELETED') return 'CANCELLED_OR_DELETED';
  return 'PROVIDER_ERROR_OR_UNKNOWN';
}

function statusObservedAt(shipment: FulfillmentInboundV0Shipment, observedAt: Date): string {
  return toOptionalIso(shipment.LastUpdatedDate || shipment.LastUpdatedAt || shipment.LastUpdatedTimestamp)
    || observedAt.toISOString();
}

function shipmentCreatedAt(shipment: FulfillmentInboundV0Shipment): string | null {
  return toOptionalIso(shipment.CreatedDate || shipment.ShipmentCreationDate);
}

function prepOwner(item: FulfillmentInboundV0ShipmentItem): string | null {
  const first = Array.isArray(item.PrepDetailsList) ? item.PrepDetailsList[0] : undefined;
  return optionalString(first?.PrepOwner);
}

function itemIdentity(item: FulfillmentInboundV0ShipmentItem): string {
  const shipmentId = requiredString(item.ShipmentId, 'ShipmentId');
  const sku = requiredString(item.SellerSKU, 'SellerSKU');
  const fnsku = optionalString(item.FulfillmentNetworkSKU) || '';
  return `${shipmentId}|${sku}|${fnsku}`;
}

function sameInboundItem(left: CanonicalInboundShipmentItem, right: CanonicalInboundShipmentItem): boolean {
  return left.quantityShipped === right.quantityShipped
    && left.quantityReceived === right.quantityReceived
    && left.quantityInCase === right.quantityInCase
    && left.releaseDate === right.releaseDate
    && left.labelOwner === right.labelOwner;
}

/**
 * Normalizes only the direct facts returned by Fulfillment Inbound v0.
 * In particular, null received quantity remains null and never becomes shipped quantity.
 */
export function normalizeFulfillmentInboundV0(
  result: FulfillmentInboundV0ReadResult,
  observedAt: Date = new Date(),
): CanonicalInboundNormalization {
  if (!directProviderHealthStatuses.has(result.health.status)) {
    throw new InboundNormalizationError(
      `Cannot normalize inbound provider state ${result.health.status}.`,
      'SOURCE_NOT_AVAILABLE',
    );
  }

  const shipmentsById = new Map<string, CanonicalInboundShipment>();
  for (const rawShipment of result.shipments) {
    const providerShipmentId = requiredString(rawShipment.ShipmentId, 'ShipmentId');
    const shipmentStatusRaw = requiredString(rawShipment.ShipmentStatus, 'ShipmentStatus');
    const normalized: CanonicalInboundShipment = {
      providerShipmentId,
      shipmentStatusRaw,
      shipmentStatusCanonical: mapInboundStatus(shipmentStatusRaw),
      statusObservedAt: statusObservedAt(rawShipment, observedAt),
      shipmentCreatedAt: shipmentCreatedAt(rawShipment),
      lastProviderUpdatedAt: toOptionalIso(rawShipment.LastUpdatedDate || rawShipment.LastUpdatedAt || rawShipment.LastUpdatedTimestamp),
      closedAt: null,
      destinationFulfillmentCenterId: optionalString(rawShipment.DestinationFulfillmentCenterId),
      carrier: null,
      trackingNumber: null,
      provenance: {
        provider_source: INBOUND_PROVIDER_SOURCE,
        provider_contract_version: INBOUND_PROVIDER_CONTRACT_VERSION,
        raw_shipment_name: optionalString(rawShipment.ShipmentName),
      },
    };
    const prior = shipmentsById.get(providerShipmentId);
    if (prior && (prior.shipmentStatusRaw !== normalized.shipmentStatusRaw || prior.destinationFulfillmentCenterId !== normalized.destinationFulfillmentCenterId)) {
      throw new InboundNormalizationError(
        `Provider returned conflicting duplicate shipment ${providerShipmentId}.`,
        'CONFLICTING_SHIPMENT_DUPLICATE',
      );
    }
    shipmentsById.set(providerShipmentId, normalized);
  }

  const itemsByIdentity = new Map<string, CanonicalInboundShipmentItem>();
  for (const rawItem of result.shipmentItems) {
    const providerShipmentId = requiredString(rawItem.ShipmentId, 'ShipmentId');
    if (!shipmentsById.has(providerShipmentId)) {
      throw new InboundNormalizationError(
        `Inbound item ${providerShipmentId} has no provider shipment parent.`,
        'ORPHAN_INBOUND_ITEM',
      );
    }
    const sku = requiredString(rawItem.SellerSKU, 'SellerSKU');
    const fnsku = optionalString(rawItem.FulfillmentNetworkSKU);
    const canonical: CanonicalInboundShipmentItem = {
      providerShipmentId,
      providerItemIdentity: itemIdentity(rawItem),
      sku,
      fnsku,
      asin: null,
      quantityShipped: toRequiredNonNegativeInteger(rawItem.QuantityShipped, 'QuantityShipped'),
      quantityReceived: toOptionalNonNegativeInteger(rawItem.QuantityReceived, 'QuantityReceived'),
      quantityInCase: toOptionalPositiveInteger(rawItem.QuantityInCase, 'QuantityInCase'),
      releaseDate: toOptionalDate(rawItem.ReleaseDate),
      labelOwner: prepOwner(rawItem),
      prepMetadata: {
        prep_details: Array.isArray(rawItem.PrepDetailsList) ? rawItem.PrepDetailsList : [],
      },
      provenance: {
        provider_source: INBOUND_PROVIDER_SOURCE,
        provider_contract_version: INBOUND_PROVIDER_CONTRACT_VERSION,
      },
    };
    const prior = itemsByIdentity.get(canonical.providerItemIdentity);
    if (prior && !sameInboundItem(prior, canonical)) {
      throw new InboundNormalizationError(
        `Provider returned conflicting duplicate item ${canonical.providerItemIdentity}.`,
        'CONFLICTING_ITEM_DUPLICATE',
      );
    }
    itemsByIdentity.set(canonical.providerItemIdentity, canonical);
  }

  if (shipmentsById.size === 0 && itemsByIdentity.size > 0) {
    throw new InboundNormalizationError('Inbound item response cannot be non-empty when shipment response is empty.', 'ORPHAN_INBOUND_ITEM');
  }

  return {
    shipments: [...shipmentsById.values()],
    items: [...itemsByIdentity.values()],
  };
}

export class InboundReceivingSyncService {
  async synchronize(input: InboundReceivingSyncRequest): Promise<InboundReceivingSyncResult> {
    const observedAt = input.sourceObservedAt || new Date();
    const sourceRunId = crypto.randomUUID();
    const providerResult = await fulfillmentInboundV0Service.readInboundReceivingWindow(input);

    if (!directProviderHealthStatuses.has(providerResult.health.status)) {
      await this.persistSourceRun({ input, sourceRunId, providerResult, observedAt });
      return this.toResult(sourceRunId, providerResult.health.status, providerResult.health.historyCoverageStatus, 0, 0, providerResult);
    }

    let normalized: CanonicalInboundNormalization;
    try {
      normalized = normalizeFulfillmentInboundV0(providerResult, observedAt);
    } catch (error) {
      const normalizationError = error instanceof InboundNormalizationError
        ? error
        : new InboundNormalizationError(error instanceof Error ? error.message : 'Inbound normalization failed.', 'UNKNOWN_NORMALIZATION_ERROR');
      const parserFailure: FulfillmentInboundV0ReadResult = {
        ...providerResult,
        health: {
          ...providerResult.health,
          status: 'PARSER_FAILURE',
          errorCode: normalizationError.code,
          errorMessage: normalizationError.message,
        },
      };
      await this.persistSourceRun({ input, sourceRunId, providerResult: parserFailure, observedAt });
      return this.toResult(sourceRunId, 'PARSER_FAILURE', parserFailure.health.historyCoverageStatus, 0, 0, parserFailure);
    }

    await this.persistSourceRun({ input, sourceRunId, providerResult, observedAt });
    if (providerResult.health.status === 'AVAILABLE_ZERO_QUALIFYING_DATA') {
      return this.toResult(sourceRunId, providerResult.health.status, providerResult.health.historyCoverageStatus, 0, 0, providerResult);
    }

    const shipmentIdByProviderId = await this.persistCanonicalRows({
      input,
      sourceRunId,
      observedAt,
      normalized,
    });

    const itemRows = normalized.items.map(item => ({
      inbound_shipment_id: shipmentIdByProviderId.get(item.providerShipmentId),
      tenant_id: input.tenantId,
      user_id: input.userId,
      store_id: input.storeId || null,
      sync_id: input.syncId || null,
      marketplace_id: input.marketplaceId,
      provider_shipment_id: item.providerShipmentId,
      provider_item_identity: item.providerItemIdentity,
      sku: item.sku,
      fnsku: item.fnsku,
      asin: item.asin,
      quantity_shipped: item.quantityShipped,
      quantity_received: item.quantityReceived,
      quantity_in_case: item.quantityInCase,
      release_date: item.releaseDate,
      label_owner: item.labelOwner,
      prep_metadata: item.prepMetadata,
      provider_source: INBOUND_PROVIDER_SOURCE,
      provider_contract_version: INBOUND_PROVIDER_CONTRACT_VERSION,
      source_run_id: sourceRunId,
      source_observed_at: observedAt.toISOString(),
      provenance: item.provenance,
      updated_at: observedAt.toISOString(),
    }));
    if (itemRows.some(row => !row.inbound_shipment_id)) {
      throw new InboundNormalizationError('Canonical inbound parent persistence did not return every shipment ID.', 'PERSISTED_PARENT_NOT_FOUND');
    }
    if (itemRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('inbound_shipment_items')
        .upsert(itemRows, {
          onConflict: 'tenant_id,user_id,marketplace_id,provider_source,provider_shipment_id,provider_item_identity',
        });
      if (error) {
        throw new Error(`Failed to persist canonical inbound shipment items: ${error.message}`);
      }
    }

    return this.toResult(
      sourceRunId,
      providerResult.health.status,
      providerResult.health.historyCoverageStatus,
      normalized.shipments.length,
      normalized.items.length,
      providerResult,
    );
  }

  private async persistSourceRun(args: {
    input: InboundReceivingSyncRequest;
    sourceRunId: string;
    providerResult: FulfillmentInboundV0ReadResult;
    observedAt: Date;
  }): Promise<void> {
    const { input, sourceRunId, providerResult, observedAt } = args;
    const { error } = await supabaseAdmin.from('inbound_source_runs').upsert({
      id: sourceRunId,
      tenant_id: input.tenantId,
      user_id: input.userId,
      store_id: input.storeId || null,
      sync_id: input.syncId || null,
      marketplace_id: input.marketplaceId,
      provider_source: INBOUND_PROVIDER_SOURCE,
      provider_contract_version: INBOUND_PROVIDER_CONTRACT_VERSION,
      health_status: providerResult.health.status,
      history_coverage_status: providerResult.health.historyCoverageStatus,
      requested_after: providerResult.health.requestedAfter,
      requested_before: providerResult.health.requestedBefore,
      observed_oldest_updated_at: providerResult.health.observedOldestUpdatedAt || null,
      observed_newest_updated_at: providerResult.health.observedNewestUpdatedAt || null,
      provider_request_count: providerResult.health.providerRequestCount,
      provider_error_code: providerResult.health.errorCode || null,
      provider_error_message: providerResult.health.errorMessage || null,
      metadata: {
        shipment_count: providerResult.shipments.length,
        item_count: providerResult.shipmentItems.length,
      },
      completed_at: observedAt.toISOString(),
      updated_at: observedAt.toISOString(),
    });
    if (error) {
      throw new Error(`Failed to persist inbound source run: ${error.message}`);
    }
  }

  private async persistCanonicalRows(args: {
    input: InboundReceivingSyncRequest;
    sourceRunId: string;
    observedAt: Date;
    normalized: CanonicalInboundNormalization;
  }): Promise<Map<string, string>> {
    const { input, sourceRunId, observedAt, normalized } = args;
    const shipmentRows = normalized.shipments.map(shipment => ({
      tenant_id: input.tenantId,
      user_id: input.userId,
      store_id: input.storeId || null,
      sync_id: input.syncId || null,
      marketplace_id: input.marketplaceId,
      provider_shipment_id: shipment.providerShipmentId,
      provider_plan_id: null,
      provider_shipment_confirmation_id: null,
      shipment_status_raw: shipment.shipmentStatusRaw,
      shipment_status_canonical: shipment.shipmentStatusCanonical,
      status_observed_at: shipment.statusObservedAt,
      shipment_created_at: shipment.shipmentCreatedAt,
      last_provider_updated_at: shipment.lastProviderUpdatedAt,
      closed_at: shipment.closedAt,
      destination_fulfillment_center_id: shipment.destinationFulfillmentCenterId,
      carrier: shipment.carrier,
      tracking_number: shipment.trackingNumber,
      provider_source: INBOUND_PROVIDER_SOURCE,
      provider_contract_version: INBOUND_PROVIDER_CONTRACT_VERSION,
      source_run_id: sourceRunId,
      source_observed_at: observedAt.toISOString(),
      ingestion_version: 'p1-inbound-v0-1',
      provenance: shipment.provenance,
      updated_at: observedAt.toISOString(),
    }));
    const { data, error } = await supabaseAdmin
      .from('inbound_shipments')
      .upsert(shipmentRows, {
        onConflict: 'tenant_id,user_id,marketplace_id,provider_source,provider_shipment_id',
      })
      .select('id,provider_shipment_id');
    if (error) {
      throw new Error(`Failed to persist canonical inbound shipments: ${error.message}`);
    }

    const shipmentIdByProviderId = new Map<string, string>();
    for (const row of data || []) {
      if (row?.provider_shipment_id && row?.id) {
        shipmentIdByProviderId.set(row.provider_shipment_id, row.id);
      }
    }
    return shipmentIdByProviderId;
  }

  private toResult(
    sourceRunId: string,
    healthStatus: InboundSourceHealthStatus,
    historyCoverageStatus: InboundHistoryCoverageStatus,
    shipmentCount: number,
    itemCount: number,
    providerResult: FulfillmentInboundV0ReadResult,
  ): InboundReceivingSyncResult {
    return {
      sourceRunId,
      healthStatus,
      historyCoverageStatus,
      shipmentCount,
      itemCount,
      claimCapable: healthStatus === 'AVAILABLE_DATA',
      errorCode: providerResult.health.errorCode,
      errorMessage: providerResult.health.errorMessage,
    };
  }
}

export const inboundReceivingSyncService = new InboundReceivingSyncService();
export default inboundReceivingSyncService;
