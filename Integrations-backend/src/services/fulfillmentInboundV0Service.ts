import axios, { AxiosError } from 'axios';
import amazonService from './amazonService';
import logger from '../utils/logger';

export const INBOUND_PROVIDER_SOURCE = 'fulfillment_inbound_v0' as const;
export const INBOUND_PROVIDER_CONTRACT_VERSION = 'v0' as const;

export type InboundSourceHealthStatus =
  | 'AVAILABLE_DATA'
  | 'AVAILABLE_ZERO_QUALIFYING_DATA'
  | 'AVAILABLE_PARTIAL_HISTORY'
  | 'ACCESS_DENIED'
  | 'UNSUPPORTED_ACCOUNT_OR_MARKETPLACE'
  | 'PARSER_FAILURE'
  | 'RATE_LIMITED_OR_TEMPORARY_ERROR'
  | 'API_PENDING'
  | 'PROVIDER_CANCELLED'
  | 'PROVIDER_FATAL';

export type InboundHistoryCoverageStatus = 'FULL' | 'PARTIAL' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface FulfillmentInboundV0Request {
  userId: string;
  tenantId: string;
  storeId?: string | null;
  syncId?: string | null;
  marketplaceId: string;
  lastUpdatedAfter: Date;
  lastUpdatedBefore: Date;
}

export interface FulfillmentInboundV0Shipment {
  ShipmentId?: string;
  ShipmentName?: string;
  DestinationFulfillmentCenterId?: string;
  ShipmentStatus?: string;
  LastUpdatedDate?: string;
  LastUpdatedAt?: string;
  LastUpdatedTimestamp?: string;
  CreatedDate?: string;
  ShipmentCreationDate?: string;
  ShipFromAddress?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FulfillmentInboundV0ShipmentItem {
  ShipmentId?: string;
  SellerSKU?: string;
  FulfillmentNetworkSKU?: string;
  QuantityShipped?: number | string | null;
  QuantityReceived?: number | string | null;
  QuantityInCase?: number | string | null;
  ReleaseDate?: string | null;
  PrepDetailsList?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface InboundProviderSourceHealth {
  status: InboundSourceHealthStatus;
  historyCoverageStatus: InboundHistoryCoverageStatus;
  requestedAfter: string;
  requestedBefore: string;
  observedOldestUpdatedAt?: string;
  observedNewestUpdatedAt?: string;
  providerRequestCount: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface FulfillmentInboundV0ReadResult {
  source: typeof INBOUND_PROVIDER_SOURCE;
  contractVersion: typeof INBOUND_PROVIDER_CONTRACT_VERSION;
  shipments: FulfillmentInboundV0Shipment[];
  shipmentItems: FulfillmentInboundV0ShipmentItem[];
  health: InboundProviderSourceHealth;
}

export interface InboundHttpResponse<T = unknown> {
  data: T;
  headers?: Record<string, string | number | undefined>;
  status?: number;
}

export type InboundHttpExecutor = (args: {
  url: string;
  accessToken: string;
  params: Record<string, string>;
}) => Promise<InboundHttpResponse>;

interface FulfillmentInboundV0ServiceOptions {
  request?: InboundHttpExecutor;
  getAccessToken?: (userId: string, storeId?: string | null) => Promise<string>;
  getRegionalBaseUrl?: (marketplaceId?: string) => string;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
  maxPages?: number;
}

interface PageResult<T> {
  rows: T[];
  providerRequestCount: number;
  error?: { status: InboundSourceHealthStatus; code?: string; message: string };
}

const TEMPORARY_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const AUTH_HTTP_STATUSES = new Set([401, 403]);
const UNSUPPORTED_HTTP_STATUSES = new Set([404, 422]);

function toIso(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new Error('Inbound date window contains an invalid date.');
  }
  return value.toISOString();
}

function asArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? value as T[] : null;
}

function parseProviderDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function classifyError(error: unknown): { status: InboundSourceHealthStatus; code?: string; message: string; temporary: boolean } {
  const axiosError = error as AxiosError<{ errors?: Array<{ code?: string; message?: string }>; message?: string }>;
  const httpStatus = axiosError?.response?.status;
  const providerCode = axiosError?.response?.data?.errors?.[0]?.code;
  const providerMessage = axiosError?.response?.data?.errors?.[0]?.message
    || axiosError?.response?.data?.message
    || (error instanceof Error ? error.message : 'Unknown Fulfillment Inbound v0 error');

  if (httpStatus && AUTH_HTTP_STATUSES.has(httpStatus)) {
    return { status: 'ACCESS_DENIED', code: providerCode || String(httpStatus), message: providerMessage, temporary: false };
  }
  if (httpStatus && UNSUPPORTED_HTTP_STATUSES.has(httpStatus)) {
    return { status: 'UNSUPPORTED_ACCOUNT_OR_MARKETPLACE', code: providerCode || String(httpStatus), message: providerMessage, temporary: false };
  }
  if (httpStatus && TEMPORARY_HTTP_STATUSES.has(httpStatus)) {
    return { status: 'RATE_LIMITED_OR_TEMPORARY_ERROR', code: providerCode || String(httpStatus), message: providerMessage, temporary: true };
  }

  const lower = providerMessage.toLowerCase();
  if (lower.includes('token') || lower.includes('access denied') || lower.includes('unauthorized')) {
    return { status: 'ACCESS_DENIED', code: providerCode, message: providerMessage, temporary: false };
  }

  return { status: 'RATE_LIMITED_OR_TEMPORARY_ERROR', code: providerCode, message: providerMessage, temporary: true };
}

/**
 * Production-only reader for the retained Fulfillment Inbound v0 GET operations.
 * It intentionally has no mock fallback and exposes no Amazon write operation.
 */
export class FulfillmentInboundV0Service {
  private readonly request: InboundHttpExecutor;
  private readonly getAccessToken: (userId: string, storeId?: string | null) => Promise<string>;
  private readonly getRegionalBaseUrl: (marketplaceId?: string) => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly maxPages: number;

  constructor(options: FulfillmentInboundV0ServiceOptions = {}) {
    this.request = options.request || (async ({ url, accessToken, params }) => axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-amz-access-token': accessToken,
        'Content-Type': 'application/json',
      },
      params,
      timeout: 30_000,
    }));
    this.getAccessToken = options.getAccessToken || ((userId, storeId) => amazonService.getAccessTokenForService(userId, storeId || undefined));
    this.getRegionalBaseUrl = options.getRegionalBaseUrl || ((marketplaceId) => amazonService.getRegionalBaseUrl(marketplaceId));
    this.sleep = options.sleep || ((milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.maxRetries = options.maxRetries ?? 2;
    this.maxPages = options.maxPages ?? 2_000;
  }

  async readInboundReceivingWindow(input: FulfillmentInboundV0Request): Promise<FulfillmentInboundV0ReadResult> {
    const requestedAfter = toIso(input.lastUpdatedAfter);
    const requestedBefore = toIso(input.lastUpdatedBefore);
    if (input.lastUpdatedAfter >= input.lastUpdatedBefore) {
      throw new Error('Inbound date window must end after it starts.');
    }
    if (!input.userId || !input.tenantId || !input.marketplaceId) {
      throw new Error('Inbound v0 read requires tenant, user, and marketplace scope.');
    }

    let accessToken: string;
    try {
      accessToken = await this.getAccessToken(input.userId, input.storeId);
    } catch (error) {
      const classified = classifyError(error);
      return this.emptyResult(requestedAfter, requestedBefore, classified.status, {
        errorCode: classified.code,
        errorMessage: classified.message,
      });
    }

    const baseUrl = this.getRegionalBaseUrl(input.marketplaceId);
    const shipments = await this.readAllPages<FulfillmentInboundV0Shipment>({
      url: `${baseUrl}/fba/inbound/v0/shipments`,
      accessToken,
      marketplaceId: input.marketplaceId,
      lastUpdatedAfter: requestedAfter,
      lastUpdatedBefore: requestedBefore,
      responseKey: 'ShipmentData',
    });
    if (shipments.error) {
      return this.emptyResult(requestedAfter, requestedBefore, shipments.error.status, {
        providerRequestCount: shipments.providerRequestCount,
        errorCode: shipments.error.code,
        errorMessage: shipments.error.message,
      });
    }

    const items = await this.readAllPages<FulfillmentInboundV0ShipmentItem>({
      url: `${baseUrl}/fba/inbound/v0/shipmentItems`,
      accessToken,
      marketplaceId: input.marketplaceId,
      lastUpdatedAfter: requestedAfter,
      lastUpdatedBefore: requestedBefore,
      responseKey: 'ItemData',
    });
    if (items.error) {
      return this.emptyResult(requestedAfter, requestedBefore, items.error.status, {
        providerRequestCount: shipments.providerRequestCount + items.providerRequestCount,
        errorCode: items.error.code,
        errorMessage: items.error.message,
      });
    }

    const totalRequestCount = shipments.providerRequestCount + items.providerRequestCount;
    const parentIds = new Set(shipments.rows.map(row => row.ShipmentId).filter((value): value is string => Boolean(value)));
    const orphanItem = items.rows.find(item => !item.ShipmentId || !parentIds.has(item.ShipmentId));
    if (orphanItem) {
      return this.emptyResult(requestedAfter, requestedBefore, 'PARSER_FAILURE', {
        providerRequestCount: totalRequestCount,
        errorCode: 'ORPHAN_INBOUND_ITEM',
        errorMessage: 'Fulfillment Inbound v0 item response included an item without a matching shipment parent.',
      });
    }

    const observedDates = shipments.rows
      .map(row => parseProviderDate(row.LastUpdatedDate || row.LastUpdatedAt || row.LastUpdatedTimestamp))
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime());
    const oldest = observedDates[0];
    const newest = observedDates[observedDates.length - 1];
    const hasRows = shipments.rows.length > 0 || items.rows.length > 0;
    const partialHistory = Boolean(oldest && oldest.getTime() > input.lastUpdatedAfter.getTime());

    const health: InboundProviderSourceHealth = {
      status: partialHistory
        ? 'AVAILABLE_PARTIAL_HISTORY'
        : hasRows
          ? 'AVAILABLE_DATA'
          : 'AVAILABLE_ZERO_QUALIFYING_DATA',
      historyCoverageStatus: partialHistory ? 'PARTIAL' : oldest ? 'FULL' : 'UNKNOWN',
      requestedAfter,
      requestedBefore,
      observedOldestUpdatedAt: oldest?.toISOString(),
      observedNewestUpdatedAt: newest?.toISOString(),
      providerRequestCount: totalRequestCount,
    };

    logger.info('Fulfillment Inbound v0 read completed', {
      userId: input.userId,
      tenantId: input.tenantId,
      marketplaceId: input.marketplaceId,
      shipmentCount: shipments.rows.length,
      itemCount: items.rows.length,
      sourceHealth: health.status,
      providerRequestCount: totalRequestCount,
    });

    return {
      source: INBOUND_PROVIDER_SOURCE,
      contractVersion: INBOUND_PROVIDER_CONTRACT_VERSION,
      shipments: shipments.rows,
      shipmentItems: items.rows,
      health,
    };
  }

  private emptyResult(
    requestedAfter: string,
    requestedBefore: string,
    status: InboundSourceHealthStatus,
    options: Partial<Pick<InboundProviderSourceHealth, 'providerRequestCount' | 'errorCode' | 'errorMessage'>> = {},
  ): FulfillmentInboundV0ReadResult {
    return {
      source: INBOUND_PROVIDER_SOURCE,
      contractVersion: INBOUND_PROVIDER_CONTRACT_VERSION,
      shipments: [],
      shipmentItems: [],
      health: {
        status,
        historyCoverageStatus: status === 'AVAILABLE_PARTIAL_HISTORY' ? 'PARTIAL' : 'UNKNOWN',
        requestedAfter,
        requestedBefore,
        providerRequestCount: options.providerRequestCount || 0,
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
      },
    };
  }

  private async readAllPages<T>(args: {
    url: string;
    accessToken: string;
    marketplaceId: string;
    lastUpdatedAfter: string;
    lastUpdatedBefore: string;
    responseKey: string;
  }): Promise<PageResult<T>> {
    const rows: T[] = [];
    const seenTokens = new Set<string>();
    let nextToken: string | undefined;
    let providerRequestCount = 0;

    for (let page = 0; page < this.maxPages; page += 1) {
      const params: Record<string, string> = nextToken
        ? { QueryType: 'NEXT_TOKEN', NextToken: nextToken }
        : {
          QueryType: 'DATE_RANGE',
          MarketplaceId: args.marketplaceId,
          LastUpdatedAfter: args.lastUpdatedAfter,
          LastUpdatedBefore: args.lastUpdatedBefore,
        };

      let response: InboundHttpResponse;
      try {
        response = await this.requestWithRetry({
          url: args.url,
          accessToken: args.accessToken,
          params,
        });
        providerRequestCount += 1;
      } catch (error) {
        const classified = classifyError(error);
        return {
          rows,
          providerRequestCount,
          error: {
            status: classified.status,
            code: classified.code,
            message: classified.message,
          },
        };
      }

      const payload = (response.data as { payload?: Record<string, unknown> })?.payload || response.data as Record<string, unknown>;
      const pageRows = asArray<T>(payload?.[args.responseKey]);
      if (!pageRows) {
        return {
          rows,
          providerRequestCount,
          error: {
            status: 'PARSER_FAILURE',
            code: 'MISSING_PROVIDER_COLLECTION',
            message: `Fulfillment Inbound v0 response did not contain array ${args.responseKey}.`,
          },
        };
      }
      rows.push(...pageRows);

      const returnedNextToken = typeof payload?.NextToken === 'string' && payload.NextToken.trim()
        ? payload.NextToken
        : undefined;
      if (!returnedNextToken) {
        return { rows, providerRequestCount };
      }
      if (seenTokens.has(returnedNextToken)) {
        return {
          rows,
          providerRequestCount,
          error: {
            status: 'PARSER_FAILURE',
            code: 'REPEATED_NEXT_TOKEN',
            message: 'Fulfillment Inbound v0 response repeated a pagination token.',
          },
        };
      }
      seenTokens.add(returnedNextToken);
      nextToken = returnedNextToken;
    }

    return {
      rows,
      providerRequestCount,
      error: {
        status: 'PARSER_FAILURE',
        code: 'PAGINATION_LIMIT_EXCEEDED',
        message: `Fulfillment Inbound v0 pagination exceeded ${this.maxPages} pages.`,
      },
    };
  }

  private async requestWithRetry(args: Parameters<InboundHttpExecutor>[0]): Promise<InboundHttpResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.request(args);
      } catch (error) {
        lastError = error;
        const classified = classifyError(error);
        if (!classified.temporary || attempt === this.maxRetries) {
          throw error;
        }
        await this.sleep(250 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Fulfillment Inbound v0 request failed.');
  }
}

export const fulfillmentInboundV0Service = new FulfillmentInboundV0Service();
export default fulfillmentInboundV0Service;
