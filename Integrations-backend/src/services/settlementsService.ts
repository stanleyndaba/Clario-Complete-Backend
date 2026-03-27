/**
 * Settlements Service - Fetches and normalizes financial settlements data
 * Phase 2: Continuous Data Sync
 */

import axios from 'axios';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';
import {
  buildCanonicalFinancialEventRow,
  CanonicalFinancialClassification,
  classifyFinancialEventType,
  parseCurrencyAmount,
  toIsoEventDate
} from '../utils/financialEventCanonical';

export interface FeeBreakdown {
  fba_fee?: number;
  referral_fee?: number;
  shipping_fee?: number;
  storage_fee?: number;
  long_term_storage_fee?: number;
  removal_fee?: number;
  [key: string]: number | undefined;
}

export interface NormalizedSettlement {
  settlement_id: string;
  order_id?: string;
  transaction_type: string;
  amount: number;
  fees: number;
  currency: string;
  settlement_date: string;
  fee_breakdown: FeeBreakdown;
  metadata?: any;
}

export interface NormalizedFinancialEvent {
  amazon_event_id: string;
  reference_id?: string | null;
  reference_type?: string | null;
  settlement_id?: string | null;
  payout_batch_id?: string | null;
  order_id?: string | null;
  event_type: string;
  event_subtype?: string | null;
  amount: number;
  currency: string;
  event_date: string;
  sku?: string | null;
  asin?: string | null;
  description?: string | null;
  raw_payload: any;
  metadata?: any;
  is_payout_event?: boolean;
}

export interface FinancialEventsPersistenceResult {
  persistedCount: number;
  feeEventsCount: number;
  reimbursementEventsCount: number;
  refundEventsCount: number;
  settlementEventsCount: number;
  payoutEventsCount: number;
}

export class SettlementsService {
  private baseUrl: string;
  private isSandboxMode: boolean;

  constructor() {
    this.baseUrl = process.env.AMAZON_SPAPI_BASE_URL || 'https://sellingpartnerapi-na.amazon.com';
    this.isSandboxMode = this.baseUrl.includes('sandbox') || process.env.NODE_ENV === 'development';
  }

  private isSandbox(): boolean {
    return this.isSandboxMode;
  }

  /**
   * Fetch settlements from Amazon SP-API Financial Events
   * Enhanced version that extracts settlement data
   */
  async fetchSettlements(
    userId: string,
    startDate?: Date,
    endDate?: Date,
    storeId?: string
  ): Promise<{ success: boolean; data: NormalizedSettlement[]; financialEvents: NormalizedFinancialEvent[]; message: string }> {
    const environment = this.isSandbox() ? 'SANDBOX' : 'PRODUCTION';
    const dataType = this.isSandbox() ? 'SANDBOX_TEST_DATA' : 'LIVE_PRODUCTION_DATA';

    try {
      logger.info('Fetching settlements from SP-API Financial Events', {
        userId,
        environment,
        dataType,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        isSandbox: this.isSandbox()
      });

      // Check if using mock SP-API (Bypass credentials check)
      if (process.env.USE_MOCK_SPAPI === 'true') {
        logger.info('Using Mock SP-API for settlements (Credentials bypassed)', { userId });
        // Settlements logic is complex (financial events -> settlements), mockSPAPIService provides getFees which returns FinancialEvents
        // But settlementsService expects to call /finances/v0/financialEvents
        // mockSPAPIService.getFees returns the FinancialEvents structure we need
        const mockResponse = await (await import('./mockSPAPIService')).mockSPAPIService.getFees({});
        const payload = mockResponse.payload || mockResponse;
        const financialEvents = payload?.FinancialEvents || {};

        // Extract settlement data from financial events
        const settlements = this.extractSettlementsFromFinancialEvents(financialEvents, userId);
        const normalizedFinancialEvents = this.extractCanonicalFinancialEvents(financialEvents);

        return {
          success: true,
          data: settlements,
          financialEvents: normalizedFinancialEvents,
          message: `Fetched ${settlements.length} settlements from Mock SP-API`
        };
      }

      // Get access token (should use tokenManager)
      const accessToken = await this.getAccessToken(userId, storeId);
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
      const regionalBaseUrl = (await import('./amazonService')).default.getRegionalBaseUrl(marketplaceId);

      const postedAfter = startDate || new Date(Date.now() - 540 * 24 * 60 * 60 * 1000);
      const postedBefore = endDate || new Date();

      const baseParams: any = {
        PostedAfter: postedAfter.toISOString(),
        PostedBefore: postedBefore.toISOString(),
        MarketplaceIds: marketplaceId
      };
      const settlements: NormalizedSettlement[] = [];
      const normalizedFinancialEvents: NormalizedFinancialEvent[] = [];
      let nextToken: string | null = null;
      let page = 0;
      const maxPages = 200;

      do {
        page += 1;
        const params = nextToken ? { NextToken: nextToken } : { ...baseParams };

        const response = await axios.get(`${regionalBaseUrl}/finances/v0/financialEvents`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          },
          params,
          timeout: 30000
        });

        const payload = response.data?.payload || response.data;
        const financialEvents = payload?.FinancialEvents || {};
        settlements.push(...this.extractSettlementsFromFinancialEvents(financialEvents, userId));
        normalizedFinancialEvents.push(...this.extractCanonicalFinancialEvents(financialEvents));
        nextToken = payload?.NextToken || null;
      } while (nextToken && page < maxPages);

      if (page >= maxPages && nextToken) {
        logger.warn('Settlements pagination reached max pages', { userId, maxPages });
      }

      logger.info(`Successfully fetched ${settlements.length} settlements from SP-API ${environment}`, {
        settlementCount: settlements.length,
        userId,
        isSandbox: this.isSandbox(),
        dataType
      });

      return {
        success: true,
        data: settlements,
        financialEvents: normalizedFinancialEvents,
        message: `Fetched ${settlements.length} settlements from SP-API ${environment} (${dataType})`
      };
    } catch (error: any) {
      const errorDetails = error.response?.data?.errors?.[0] || {};
      logger.error('Error fetching settlements from SP-API', {
        error: error.message,
        status: error.response?.status,
        errorCode: errorDetails.code,
        userId,
        isSandbox: this.isSandbox()
      });

      await logAuditEvent({
        event_type: 'settlements_sync_failed',
        user_id: userId,
        metadata: { error: error.message, isSandbox: this.isSandbox() },
        severity: 'high'
      });

      if (this.isSandbox() && (error.response?.status === 404 || error.response?.status === 400)) {
        logger.info('Sandbox returned empty/error response - returning empty settlements (normal for sandbox)', {
          status: error.response?.status,
          userId
        });
        return {
          success: true,
          data: [],
          financialEvents: [],
          message: 'Sandbox returned no settlements data (normal for testing)'
        };
      }

      throw new Error(`Failed to fetch settlements: ${errorDetails.message || error.message}`);
    }
  }

  /**
   * Extract settlement data from Financial Events API response
   */
  private extractSettlementsFromFinancialEvents(financialEvents: any, userId: string): NormalizedSettlement[] {
    const settlements: NormalizedSettlement[] = [];

    // Extract from ServiceFeeEventList
    const serviceFeeEvents = financialEvents.ServiceFeeEventList || [];
    serviceFeeEvents.forEach((event: any) => {
      const feeBreakdown: FeeBreakdown = {};
      let totalFees = 0;

      if (event.FeeList) {
        event.FeeList.forEach((fee: any) => {
          const feeType = fee.FeeType || fee.fee_type || 'unknown';
          const feeAmount = parseFloat(fee.FeeAmount?.CurrencyAmount || fee.amount || '0');
          feeBreakdown[feeType.toLowerCase().replace(/\s+/g, '_')] = feeAmount;
          totalFees += feeAmount;
        });
      }

      settlements.push({
        settlement_id: event.AmazonOrderId || event.OrderId || `SETTLEMENT_${Date.now()}_${Math.random()}`,
        order_id: event.AmazonOrderId || event.OrderId || null,
        transaction_type: 'fee',
        amount: totalFees,
        fees: totalFees,
        currency: event.FeeList?.[0]?.FeeAmount?.CurrencyCode || 'USD',
        settlement_date: event.PostedDate || event.posted_date || new Date().toISOString(),
        fee_breakdown: feeBreakdown,
        metadata: {
          sellerOrderId: event.SellerOrderId || event.seller_order_id,
          sku: event.SKU || event.sku
        }
      });
    });

    // Extract from ShipmentEventList (FBA fees)
    const shipmentEvents = financialEvents.ShipmentEventList || [];
    shipmentEvents.forEach((event: any) => {
      const feeBreakdown: FeeBreakdown = {};
      let totalFees = 0;

      if (event.ShipmentFeeList) {
        event.ShipmentFeeList.forEach((fee: any) => {
          const feeType = fee.FeeType || fee.fee_type || 'unknown';
          const feeAmount = parseFloat(fee.FeeAmount?.CurrencyAmount || fee.amount || '0');
          feeBreakdown[feeType.toLowerCase().replace(/\s+/g, '_')] = feeAmount;
          totalFees += feeAmount;
        });
      }

      settlements.push({
        settlement_id: event.AmazonOrderId || event.OrderId || `SHIPMENT_${Date.now()}_${Math.random()}`,
        order_id: event.AmazonOrderId || event.OrderId || null,
        transaction_type: 'shipment_fee',
        amount: totalFees,
        fees: totalFees,
        currency: event.ShipmentFeeList?.[0]?.FeeAmount?.CurrencyCode || 'USD',
        settlement_date: event.PostedDate || event.posted_date || new Date().toISOString(),
        fee_breakdown: feeBreakdown,
        metadata: {
          shipmentId: event.ShipmentId || event.shipment_id
        }
      });
    });

    // Extract from AdjustmentEventList
    const adjustmentEvents = financialEvents.AdjustmentEventList || [];
    adjustmentEvents.forEach((event: any) => {
      const adjustmentAmount = parseFloat(event.AdjustmentAmount?.CurrencyAmount || event.amount || '0');

      settlements.push({
        settlement_id: event.AdjustmentType || `ADJUSTMENT_${Date.now()}_${Math.random()}`,
        order_id: event.AmazonOrderId || event.OrderId || null,
        transaction_type: adjustmentAmount > 0 ? 'reimbursement' : 'adjustment',
        amount: Math.abs(adjustmentAmount),
        fees: 0,
        currency: event.AdjustmentAmount?.CurrencyCode || 'USD',
        settlement_date: event.PostedDate || event.posted_date || new Date().toISOString(),
        fee_breakdown: {},
        metadata: {
          adjustmentType: event.AdjustmentType || event.adjustment_type
        }
      });
    });

    return settlements;
  }

  private extractCanonicalFinancialEvents(financialEvents: any): NormalizedFinancialEvent[] {
    const events: NormalizedFinancialEvent[] = [];

    const pushRow = (row: Partial<NormalizedFinancialEvent>) => {
      const amount = Number(row.amount || 0);
      if (!row.amazon_event_id || !Number.isFinite(amount) || amount === 0) {
        return;
      }

      events.push({
        amazon_event_id: row.amazon_event_id,
        reference_id: row.reference_id || null,
        reference_type: row.reference_type || 'financial_event',
        settlement_id: row.settlement_id || null,
        payout_batch_id: row.payout_batch_id || null,
        order_id: row.order_id || null,
        event_type: row.event_type || 'adjustment',
        event_subtype: row.event_subtype || row.event_type || 'adjustment',
        amount,
        currency: row.currency || 'USD',
        event_date: row.event_date || new Date().toISOString(),
        sku: row.sku || null,
        asin: row.asin || null,
        description: row.description || null,
        raw_payload: row.raw_payload || {},
        metadata: row.metadata || {},
        is_payout_event: Boolean(row.is_payout_event)
      });
    };

    const pushFeeList = (entries: any[], event: any, prefix: string) => {
      entries.forEach((fee: any, index: number) => {
        const money = parseCurrencyAmount(fee.FeeAmount || fee.ChargeAmount || fee.Amount || fee.amount);
        if (!money.amount) {
          return;
        }

        const classification = classifyFinancialEventType(fee.FeeType || fee.ChargeType || prefix, event.FeeDescription || event.Description);
        pushRow({
          amazon_event_id: `${prefix}:${event.AmazonOrderId || event.OrderId || event.SellerSKU || 'na'}:${classification.eventSubtype}:${index}:${toIsoEventDate(event.PostedDate || event.posted_date)}`,
          reference_id: event.AmazonOrderId || event.OrderId || event.ShipmentId || null,
          reference_type: classification.referenceType,
          order_id: event.AmazonOrderId || event.OrderId || null,
          event_type: classification.eventType,
          event_subtype: classification.eventSubtype,
          amount: Math.abs(money.amount),
          currency: money.currency,
          event_date: event.PostedDate || event.posted_date,
          sku: event.SellerSKU || event.SKU || null,
          asin: event.ASIN || null,
          description: fee.FeeType || fee.ChargeType || event.FeeDescription || event.Description || prefix,
          raw_payload: { event, fee },
          metadata: {
            feeType: fee.FeeType || fee.ChargeType || null,
            shipmentId: event.ShipmentId || null
          },
          is_payout_event: false
        });
      });
    };

    (financialEvents.ServiceFeeEventList || []).forEach((event: any) => {
      pushFeeList(event.FeeList || [], event, 'service_fee');
    });

    (financialEvents.ShipmentEventList || []).forEach((event: any) => {
      pushFeeList(event.ShipmentFeeList || [], event, 'shipment_fee');
      pushFeeList(event.ShipmentFeeAdjustmentList || [], event, 'shipment_fee_adjustment');
    });

    (financialEvents.AdjustmentEventList || []).forEach((event: any, index: number) => {
      const money = parseCurrencyAmount(event.AdjustmentAmount || event.TotalAmount || event.amount);
      const classification = this.classifyAdjustmentEvent(event.AdjustmentType || event.Description, money.amount, event.Description);
      pushRow({
        amazon_event_id: event.AdjustmentEventId || `adjustment:${classification.eventSubtype}:${index}:${toIsoEventDate(event.PostedDate || event.posted_date)}`,
        reference_id: event.AdjustmentEventId || event.AmazonOrderId || event.OrderId || null,
        reference_type: classification.referenceType,
        order_id: event.AmazonOrderId || event.OrderId || null,
        event_type: classification.eventType,
        event_subtype: classification.eventSubtype,
        amount: money.amount,
        currency: money.currency,
        event_date: event.PostedDate || event.posted_date,
        sku: event.SellerSKU || event.SKU || null,
        asin: event.ASIN || null,
        description: event.Description || event.AdjustmentType || 'Amazon adjustment',
        raw_payload: event,
        metadata: {
          adjustmentType: event.AdjustmentType || null,
          quantity: event.Quantity || null,
          fulfillmentCenterId: event.FulfillmentCenterId || null
        },
        is_payout_event: classification.isPayoutEvent && money.amount > 0
      });
    });

    (financialEvents.FBALiquidationEventList || []).forEach((event: any, index: number) => {
      const money = parseCurrencyAmount(event.LiquidationProceedsAmount || event.amount);
      pushRow({
        amazon_event_id: event.LiquidationEventId || `liquidation:${event.OriginalRemovalOrderId || 'na'}:${index}:${toIsoEventDate(event.PostedDate)}`,
        reference_id: event.OriginalRemovalOrderId || null,
        reference_type: 'reimbursement',
        settlement_id: event.OriginalRemovalOrderId || null,
        payout_batch_id: event.OriginalRemovalOrderId || null,
        event_type: 'reimbursement',
        event_subtype: 'fba_liquidation',
        amount: money.amount,
        currency: money.currency,
        event_date: event.PostedDate,
        sku: event.SellerSKU || null,
        asin: event.ASIN || null,
        description: 'FBA liquidation proceeds',
        raw_payload: event,
        metadata: {
          removalQuantity: event.RemovalQuantity || null
        },
        is_payout_event: money.amount > 0
      });
    });

    (financialEvents.RefundEventList || []).forEach((event: any, eventIndex: number) => {
      const refundLists = [
        ['OrderChargeAdjustmentList', 'order_charge_adjustment'],
        ['ShipmentItemAdjustmentList', 'shipment_item_adjustment'],
        ['PostageAdjustmentList', 'postage_adjustment'],
        ['FeeAdjustmentList', 'fee_adjustment']
      ] as const;

      refundLists.forEach(([listKey, subtype]) => {
        (event[listKey] || []).forEach((entry: any, index: number) => {
          const money = parseCurrencyAmount(entry.ChargeAmount || entry.FeeAmount || entry.amount);
          if (!money.amount) {
            return;
          }

          const classification = classifyFinancialEventType(subtype, event.Description);
          pushRow({
            amazon_event_id: `refund:${listKey}:${event.AmazonOrderId || 'na'}:${eventIndex}:${index}:${toIsoEventDate(event.PostedDate)}`,
            reference_id: event.AmazonOrderId || event.SellerOrderId || null,
            reference_type: classification.referenceType,
            order_id: event.AmazonOrderId || null,
            event_type: classification.eventType,
            event_subtype: classification.eventSubtype,
            amount: Math.abs(money.amount),
            currency: money.currency,
            event_date: event.PostedDate,
            sku: entry.SellerSKU || event.SellerSKU || null,
            asin: entry.ASIN || event.ASIN || null,
            description: entry.ChargeType || entry.FeeType || event.Description || subtype,
            raw_payload: { event, entry },
            metadata: {
              listKey
            },
            is_payout_event: false
          });
        });
      });
    });

    const deduped = new Map<string, NormalizedFinancialEvent>();
    for (const event of events) {
      deduped.set(event.amazon_event_id, event);
    }

    return Array.from(deduped.values());
  }

  private classifyAdjustmentEvent(rawType: any, amount: number, description?: any): CanonicalFinancialClassification {
    const base = classifyFinancialEventType(rawType, description);
    if (base.eventType !== 'adjustment') {
      return base;
    }

    if (amount > 0) {
      return {
        eventType: 'reimbursement',
        eventSubtype: base.eventSubtype,
        referenceType: 'reimbursement',
        isPayoutEvent: true
      };
    }

    return {
      eventType: 'fee',
      eventSubtype: base.eventSubtype,
      referenceType: 'adjustment',
      isPayoutEvent: false
    };
  }

  /**
   * Normalize settlements to Clario schema
   */
  normalizeSettlements(settlements: any[], userId: string): NormalizedSettlement[] {
    return settlements.map((settlement: any) => ({
      settlement_id: settlement.settlement_id || settlement.SettlementId || `SETTLEMENT_${Date.now()}`,
      order_id: settlement.order_id || settlement.OrderId || null,
      transaction_type: settlement.transaction_type || settlement.TransactionType || 'fee',
      amount: parseFloat(settlement.amount || settlement.Amount || '0'),
      fees: parseFloat(settlement.fees || settlement.Fees || '0'),
      currency: settlement.currency || settlement.Currency || 'USD',
      settlement_date: settlement.settlement_date || settlement.SettlementDate ? new Date(settlement.settlement_date || settlement.SettlementDate).toISOString() : new Date().toISOString(),
      fee_breakdown: settlement.fee_breakdown || settlement.FeeBreakdown || {},
      metadata: settlement.metadata || {}
    }));
  }

  /**
   * Save normalized settlements to database
   */
  async saveSettlementsToDatabase(
    userId: string,
    settlements: NormalizedSettlement[],
    storeId?: string,
    tenantId?: string,
    syncId?: string
  ): Promise<{ persistedCount: number }> {
    try {
      logger.info('Saving settlements to database', { userId, count: settlements.length });

      if (settlements.length === 0) {
        logger.info('No settlements to save', { userId });
        return { persistedCount: 0 };
      }

      if (typeof supabase.from !== 'function') {
        logger.warn('Demo mode: Settlements save skipped', { userId });
        return { persistedCount: settlements.length };
      }

      if (!tenantId) {
        throw new Error('tenantId is required to persist settlements');
      }

      if (!storeId) {
        throw new Error('storeId is required to persist SP-API settlements canonically');
      }

      const settlementsToInsert = settlements.map(settlement => ({
        user_id: userId,
        tenant_id: tenantId,
        settlement_id: settlement.settlement_id,
        order_id: settlement.order_id || null,
        transaction_type: settlement.transaction_type,
        amount: settlement.amount,
        fees: settlement.fees,
        currency: settlement.currency,
        settlement_date: settlement.settlement_date,
        fee_breakdown: settlement.fee_breakdown,
        metadata: settlement.metadata || {},
        store_id: storeId,
        sync_id: syncId || null,
        source: 'sp_api',
        source_report: 'SP-API_FinancialEvents',
        sync_timestamp: new Date().toISOString(),
        is_sandbox: this.isSandbox(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Check for existing settlements (using composite key: settlement_id + transaction_type)
      const settlementKeys = settlementsToInsert.map(s => `${s.settlement_id}_${s.transaction_type}`);

      // Insert with conflict handling
      const { error: insertError } = await supabase
        .from('settlements')
        .upsert(settlementsToInsert, {
          onConflict: 'tenant_id,user_id,settlement_id,transaction_type',
          ignoreDuplicates: false
        });

      if (insertError) {
        logger.error('Error upserting settlements', { error: insertError, userId });
        throw new Error(`Failed to save settlements: ${insertError.message}`);
      }

      logger.info('Settlements saved to database successfully', { userId, inserted: settlementsToInsert.length });

      await logAuditEvent({
        event_type: 'settlements_synced',
        user_id: userId,
        metadata: { count: settlementsToInsert.length, isSandbox: this.isSandbox() },
        severity: 'low'
      });
      return { persistedCount: settlementsToInsert.length };
    } catch (error: any) {
      logger.error('Error saving settlements to database', { error: error.message, userId });
      throw error;
    }
  }

  private mapSettlementToFinancialEventType(transactionType: string): string {
    const normalized = String(transactionType || '').toLowerCase();
    if (normalized.includes('reimbursement')) return 'reimbursement';
    if (normalized.includes('fee')) return 'fee';
    if (normalized.includes('return') || normalized.includes('refund')) return 'return';
    if (normalized.includes('shipment')) return 'shipment';
    if (normalized.includes('adjust')) return 'adjustment';
    return normalized || 'adjustment';
  }

  async saveFinancialEventsToDatabase(
    userId: string,
    settlements: NormalizedSettlement[],
    financialEvents: NormalizedFinancialEvent[],
    storeId?: string,
    tenantId?: string,
    syncId?: string
  ): Promise<FinancialEventsPersistenceResult> {
    if (settlements.length === 0 && financialEvents.length === 0) {
      return {
        persistedCount: 0,
        feeEventsCount: 0,
        reimbursementEventsCount: 0,
        refundEventsCount: 0,
        settlementEventsCount: 0,
        payoutEventsCount: 0
      };
    }

    if (typeof supabase.from !== 'function') {
      logger.warn('Demo mode: Financial events save skipped', { userId });
      return {
        persistedCount: settlements.length + financialEvents.length,
        feeEventsCount: financialEvents.filter((event) => event.event_type === 'fee').length,
        reimbursementEventsCount: financialEvents.filter((event) => event.event_type === 'reimbursement').length,
        refundEventsCount: financialEvents.filter((event) => event.event_type === 'refund').length,
        settlementEventsCount: settlements.length,
        payoutEventsCount: financialEvents.filter((event) => event.is_payout_event).length + settlements.filter((settlement) => settlement.amount > 0).length
      };
    }

    if (!tenantId) {
      throw new Error('tenantId is required to persist financial events');
    }

    if (!storeId) {
      throw new Error('storeId is required to persist SP-API financial events canonically');
    }

    const settlementRows = settlements.map((settlement) =>
      buildCanonicalFinancialEventRow({
        sellerId: userId,
        tenantId,
        storeId,
        syncId,
        source: 'sp_api',
        eventType: 'settlement',
        eventSubtype: settlement.transaction_type,
        amount: settlement.amount,
        currency: settlement.currency || 'USD',
        eventDate: settlement.settlement_date,
        referenceId: settlement.settlement_id,
        referenceType: 'settlement',
        settlementId: settlement.settlement_id,
        payoutBatchId: settlement.settlement_id,
        amazonEventId: `settlement:${settlement.settlement_id}:${settlement.transaction_type}`,
        amazonOrderId: settlement.order_id || null,
        sku: settlement.metadata?.sku || null,
        asin: settlement.metadata?.asin || null,
        description: `Settlement ${settlement.transaction_type}`,
        rawPayload: {
          settlement_id: settlement.settlement_id,
          transaction_type: settlement.transaction_type,
          fee_breakdown: settlement.fee_breakdown || {},
          metadata: settlement.metadata || {}
        },
        metadata: settlement.metadata || {},
        isPayoutEvent: settlement.amount > 0
      })
    );

    const detailRows = financialEvents.map((event) =>
      buildCanonicalFinancialEventRow({
        sellerId: userId,
        tenantId,
        storeId,
        syncId,
        source: 'sp_api',
        eventType: event.event_type,
        eventSubtype: event.event_subtype,
        amount: event.amount,
        currency: event.currency,
        eventDate: event.event_date,
        referenceId: event.reference_id,
        referenceType: event.reference_type,
        settlementId: event.settlement_id,
        payoutBatchId: event.payout_batch_id,
        amazonEventId: event.amazon_event_id,
        amazonOrderId: event.order_id,
        amazonSku: event.sku || null,
        sku: event.sku || null,
        asin: event.asin || null,
        description: event.description,
        rawPayload: event.raw_payload,
        metadata: event.metadata,
        isPayoutEvent: event.is_payout_event
      })
    );

    const dedupedRows = new Map<string, any>();
    [...detailRows, ...settlementRows].forEach((row) => {
      dedupedRows.set(row.amazon_event_id, row);
    });
    const financialRows = Array.from(dedupedRows.values());

    const { error } = await supabase
      .from('financial_events')
      .upsert(financialRows, {
        onConflict: 'tenant_id,seller_id,source,amazon_event_id',
        ignoreDuplicates: false
      });

    if (error) {
      logger.error('Error upserting financial events', { error, userId });
      throw new Error(`Failed to save financial events: ${error.message}`);
    }

    return {
      persistedCount: financialRows.length,
      feeEventsCount: financialRows.filter((row) => row.event_type === 'fee').length,
      reimbursementEventsCount: financialRows.filter((row) => row.event_type === 'reimbursement').length,
      refundEventsCount: financialRows.filter((row) => row.event_type === 'refund').length,
      settlementEventsCount: financialRows.filter((row) => row.event_type === 'settlement').length,
      payoutEventsCount: financialRows.filter((row) => row.is_payout_event).length
    };
  }

  /**
   * Get access token from amazonService
   */
  private async getAccessToken(userId: string, storeId?: string): Promise<string> {
    const amazonService = (await import('./amazonService')).default;
    return amazonService.getAccessTokenForService(userId, storeId);
  }
}

export default new SettlementsService();

