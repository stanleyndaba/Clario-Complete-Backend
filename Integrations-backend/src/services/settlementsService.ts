/**
 * Settlements Service - Fetches and normalizes financial settlements data
 * Phase 2: Continuous Data Sync
 */

import axios from 'axios';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';

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
    endDate?: Date
  ): Promise<{ success: boolean; data: NormalizedSettlement[]; message: string }> {
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

      // Get access token (should use tokenManager)
      const accessToken = await this.getAccessToken(userId);
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';

      const postedAfter = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const postedBefore = endDate || new Date();

      const params: any = {
        PostedAfter: postedAfter.toISOString(),
        PostedBefore: postedBefore.toISOString(),
        MarketplaceIds: marketplaceId
      };

      // Fetch financial events
      const response = await axios.get(`${this.baseUrl}/finances/v0/financialEvents`, {
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

      // Extract settlement data from financial events
      const settlements = this.extractSettlementsFromFinancialEvents(financialEvents, userId);

      logger.info(`Successfully fetched ${settlements.length} settlements from SP-API ${environment}`, {
        settlementCount: settlements.length,
        userId,
        isSandbox: this.isSandbox(),
        dataType
      });

      return {
        success: true,
        data: settlements,
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
  async saveSettlementsToDatabase(userId: string, settlements: NormalizedSettlement[]): Promise<void> {
    try {
      logger.info('Saving settlements to database', { userId, count: settlements.length });

      if (settlements.length === 0) {
        logger.info('No settlements to save', { userId });
        return;
      }

      if (typeof supabase.from !== 'function') {
        logger.warn('Demo mode: Settlements save skipped', { userId });
        return;
      }

      const settlementsToInsert = settlements.map(settlement => ({
        user_id: userId,
        settlement_id: settlement.settlement_id,
        order_id: settlement.order_id || null,
        transaction_type: settlement.transaction_type,
        amount: settlement.amount,
        fees: settlement.fees,
        currency: settlement.currency,
        settlement_date: settlement.settlement_date,
        fee_breakdown: settlement.fee_breakdown,
        metadata: settlement.metadata || {},
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
          onConflict: 'user_id,settlement_id,transaction_type',
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
    } catch (error: any) {
      logger.error('Error saving settlements to database', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Get access token from amazonService
   */
  private async getAccessToken(userId: string): Promise<string> {
    const amazonService = (await import('./amazonService')).default;
    return amazonService.getAccessTokenForService(userId);
  }
}

export default new SettlementsService();

