/**
 * Returns Service - Fetches and normalizes customer returns data
 * Phase 2: Continuous Data Sync
 */

import axios from 'axios';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';

export interface ReturnItem {
  sku: string;
  asin: string;
  quantity: number;
  refund_amount: number;
}

export interface NormalizedReturn {
  return_id: string;
  order_id?: string;
  reason: string;
  returned_date: string;
  status: string;
  refund_amount: number;
  currency: string;
  items: ReturnItem[];
  is_partial: boolean;
  metadata?: any;
}

export class ReturnsService {
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
   * Fetch returns from Amazon SP-API Reports
   * Uses FBA Customer Returns Data report
   */
  async fetchReturns(
    userId: string,
    startDate?: Date,
    endDate?: Date,
    storeId?: string
  ): Promise<{ success: boolean; data: NormalizedReturn[]; message: string }> {
    const environment = this.isSandbox() ? 'SANDBOX' : 'PRODUCTION';
    const dataType = this.isSandbox() ? 'SANDBOX_TEST_DATA' : 'LIVE_PRODUCTION_DATA';

    try {
      logger.info('Fetching returns from SP-API', {
        userId,
        environment,
        dataType,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        isSandbox: this.isSandbox()
      });

      // Check if using mock SP-API (Bypass credentials check)
      if (process.env.USE_MOCK_SPAPI === 'true') {
        logger.info('Using Mock SP-API for returns (Credentials bypassed)', { userId });
        const mockResponse = await (await import('./mockSPAPIService')).mockSPAPIService.getReturns({});
        const payload = mockResponse.payload || mockResponse;
        const returns = payload?.Returns || [];

        // Normalize returns
        const normalizedReturns = this.normalizeReturns(returns, userId);

        return {
          success: true,
          data: normalizedReturns,
          message: `Fetched ${normalizedReturns.length} returns from Mock SP-API`
        };
      }

      // Returns are fetched via FBA reports
      // Report type: GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA
      // This will be implemented with report processing

      logger.info('Returns fetch initiated (report-based sync)', {
        userId,
        isSandbox: this.isSandbox()
      });

      return {
        success: true,
        data: [],
        message: `Returns sync initiated (report processing will be implemented)`
      };
    } catch (error: any) {
      logger.error('Error fetching returns from SP-API', {
        error: error.message,
        userId,
        isSandbox: this.isSandbox()
      });

      await logAuditEvent({
        event_type: 'returns_sync_failed',
        user_id: userId,
        metadata: { error: error.message, isSandbox: this.isSandbox() },
        severity: 'high'
      });

      if (this.isSandbox()) {
        return {
          success: true,
          data: [],
          message: 'Sandbox returned no returns data (normal for testing)'
        };
      }

      throw new Error(`Failed to fetch returns: ${error.message}`);
    }
  }

  /**
   * Normalize returns data to Clario schema
   */
  normalizeReturns(returns: any[], userId: string): NormalizedReturn[] {
    return returns.map((returnData: any) => {
      const items: ReturnItem[] = (returnData.Items || returnData.items || []).map((item: any) => ({
        sku: item.SellerSKU || item.sku || '',
        asin: item.ASIN || item.asin || '',
        quantity: item.QuantityReturned || item.quantity || 0,
        refund_amount: parseFloat(item.RefundAmount?.Amount || item.refund_amount || '0')
      }));

      const totalRefund = items.reduce((sum, item) => sum + item.refund_amount, 0);
      const orderQuantity = returnData.OrderQuantity || returnData.order_quantity || 0;
      const returnedQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
      const isPartial = orderQuantity > 0 && returnedQuantity < orderQuantity;

      return {
        return_id: returnData.ReturnId || returnData.return_id || returnData.ReturnID || '',
        order_id: returnData.AmazonOrderId || returnData.order_id || null,
        reason: returnData.ReturnReason || returnData.reason || returnData.Reason || 'Unknown',
        returned_date: returnData.ReturnedDate || returnData.returned_date ? new Date(returnData.ReturnedDate || returnData.returned_date).toISOString() : new Date().toISOString(),
        status: returnData.ReturnStatus || returnData.status || 'pending',
        refund_amount: totalRefund,
        currency: returnData.RefundAmount?.CurrencyCode || returnData.currency || 'USD',
        items,
        is_partial: isPartial,
        metadata: {
          returnType: returnData.ReturnType || returnData.return_type,
          fulfillmentCenterId: returnData.FulfillmentCenterId || returnData.fulfillment_center_id,
          disposition: returnData.Disposition || returnData.disposition
        }
      };
    });
  }

  /**
   * Save normalized returns to database
   */
  async saveReturnsToDatabase(userId: string, returns: NormalizedReturn[], storeId?: string): Promise<void> {
    try {
      logger.info('Saving returns to database', { userId, count: returns.length });

      if (returns.length === 0) {
        logger.info('No returns to save', { userId });
        return;
      }

      if (typeof supabase.from !== 'function') {
        logger.warn('Demo mode: Returns save skipped', { userId });
        return;
      }

      const returnsToInsert = returns.map(returnData => ({
        user_id: userId,
        return_id: returnData.return_id,
        order_id: returnData.order_id || null,
        reason: returnData.reason,
        returned_date: returnData.returned_date,
        status: returnData.status,
        refund_amount: returnData.refund_amount,
        currency: returnData.currency,
        items: returnData.items,
        is_partial: returnData.is_partial,
        metadata: returnData.metadata || {},
        source_report: 'SP-API_FBA_Returns',
        sync_timestamp: new Date().toISOString(),
        is_sandbox: this.isSandbox(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Check for existing returns
      const returnIds = returnsToInsert.map(r => r.return_id).filter(Boolean);
      if (returnIds.length > 0) {
        const { data: existingReturns, error: fetchError } = await supabase
          .from('returns')
          .select('return_id')
          .eq('user_id', userId)
          .in('return_id', returnIds);

        if (!fetchError && existingReturns) {
          const existingIds = new Set(existingReturns.map((r: any) => r.return_id));
          const newReturns = returnsToInsert.filter(r => !existingIds.has(r.return_id));

          if (newReturns.length > 0) {
            const { error: insertError } = await supabase
              .from('returns')
              .insert(newReturns);

            if (insertError) {
              logger.error('Error inserting returns', { error: insertError, userId });
              throw new Error(`Failed to insert returns: ${insertError.message}`);
            }

            logger.info('Returns saved to database', { userId, inserted: newReturns.length });
          }

          // Update existing returns
          const returnsToUpdate = returnsToInsert.filter(r => existingIds.has(r.return_id));
          for (const returnData of returnsToUpdate) {
            const { error: updateError } = await supabase
              .from('returns')
              .update({
                status: returnData.status,
                refund_amount: returnData.refund_amount,
                sync_timestamp: returnData.sync_timestamp,
                updated_at: returnData.updated_at
              })
              .eq('user_id', userId)
              .eq('return_id', returnData.return_id);

            if (updateError) {
              logger.warn('Error updating return', { error: updateError, userId, returnId: returnData.return_id });
            }
          }
          return;
        }
      }

      // Insert all if no existing check
      const { error: insertError } = await supabase
        .from('returns')
        .insert(returnsToInsert);

      if (insertError) {
        logger.error('Error inserting returns', { error: insertError, userId });
        throw new Error(`Failed to insert returns: ${insertError.message}`);
      }

      logger.info('Returns saved to database successfully', { userId, inserted: returnsToInsert.length });

      await logAuditEvent({
        event_type: 'returns_synced',
        user_id: userId,
        metadata: { count: returnsToInsert.length, isSandbox: this.isSandbox() },
        severity: 'low'
      });
    } catch (error: any) {
      logger.error('Error saving returns to database', { error: error.message, userId });
      throw error;
    }
  }
}

export default new ReturnsService();

