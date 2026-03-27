import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export class FinancialEventsService {
  async ingestEvents(events: any[]): Promise<any> {
    if (!events.length) {
      return { success: true, inserted: 0 };
    }

    const { error } = await supabaseAdmin
      .from('financial_events')
      .upsert(events, {
        onConflict: 'tenant_id,seller_id,source,amazon_event_id',
        ignoreDuplicates: false
      });

    if (error) {
      logger.error('[FinancialEventsService] Failed to ingest events', {
        error: error.message,
        count: events.length
      });
      throw new Error(`Failed to ingest financial events: ${error.message}`);
    }

    return { success: true, inserted: events.length };
  }

  async archiveToS3(event: any): Promise<any> {
    logger.debug('[FinancialEventsService] Archive to S3 is a no-op in this environment', {
      amazonEventId: event?.amazon_event_id || null
    });
    return { success: true, skipped: true };
  }

  async confirmPayout(detectionResultId: string, userId: string, tenantId?: string, storeId?: string): Promise<any> {
    const detectionQuery = supabaseAdmin
      .from('detection_results')
      .select('id, seller_id, tenant_id, store_id, evidence, estimated_value, sync_id')
      .eq('id', detectionResultId)
      .eq('seller_id', userId);

    if (tenantId) {
      detectionQuery.eq('tenant_id', tenantId);
    }

    const { data: detection, error: detectionError } = await detectionQuery.maybeSingle();

    if (detectionError) {
      throw new Error(`Failed to load detection result: ${detectionError.message}`);
    }

    if (!detection) {
      return { confirmed: false, reason: 'detection_not_found' };
    }

    const evidence = detection.evidence || {};
    const payoutQuery = supabaseAdmin
      .from('financial_events')
      .select('*')
      .eq('seller_id', userId)
      .eq('event_type', 'reimbursement')
      .gt('amount', 0)
      .order('event_date', { ascending: false })
      .limit(20);

    if (tenantId || detection.tenant_id) {
      payoutQuery.eq('tenant_id', tenantId || detection.tenant_id);
    }

    if (storeId || detection.store_id) {
      payoutQuery.eq('store_id', storeId || detection.store_id);
    }

    if (evidence.amazon_reimbursement_id || evidence.reimbursement_id || evidence.amazon_event_id) {
      payoutQuery.in('amazon_event_id', [
        evidence.amazon_reimbursement_id,
        evidence.reimbursement_id,
        evidence.amazon_event_id
      ].filter(Boolean));
    } else if (evidence.order_id || evidence.amazon_order_id) {
      payoutQuery.eq('amazon_order_id', evidence.order_id || evidence.amazon_order_id);
    } else if (evidence.sku || evidence.asin) {
      if (evidence.sku) {
        payoutQuery.or(`sku.eq.${evidence.sku},amazon_sku.eq.${evidence.sku}`);
      }
      if (evidence.asin) {
        payoutQuery.eq('asin', evidence.asin);
      }
    }

    const { data: payouts, error: payoutError } = await payoutQuery;
    if (payoutError) {
      throw new Error(`Failed to load payout events: ${payoutError.message}`);
    }

    const matchedPayout = (payouts || []).find((event: any) => Number(event.amount || 0) > 0);
    if (!matchedPayout) {
      return { confirmed: false, reason: 'payout_not_found' };
    }

    return {
      confirmed: true,
      payoutEventId: matchedPayout.id,
      amazonEventId: matchedPayout.amazon_event_id,
      referenceId: matchedPayout.reference_id,
      amount: Number(matchedPayout.amount || 0),
      currency: matchedPayout.currency || 'USD',
      eventDate: matchedPayout.event_date,
      settlementId: matchedPayout.settlement_id || null,
      payoutBatchId: matchedPayout.payout_batch_id || null
    };
  }

  async getRecoverySummary(userId: string, tenantId: string, storeId?: string): Promise<any> {
    let payoutQuery = supabaseAdmin
      .from('financial_events')
      .select('amount, event_date, event_type, is_payout_event')
      .eq('seller_id', userId)
      .eq('tenant_id', tenantId)
      .in('event_type', ['reimbursement', 'settlement']);

    if (storeId) {
      payoutQuery = payoutQuery.eq('store_id', storeId);
    }

    const { data: payouts, error: payoutError } = await payoutQuery;
    if (payoutError) {
      throw new Error(`Failed to load payout summary: ${payoutError.message}`);
    }

    let detectionQuery = supabaseAdmin
      .from('detection_results')
      .select('estimated_value')
      .eq('seller_id', userId)
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'reviewed', 'disputed', 'resolved']);

    if (storeId) {
      detectionQuery = detectionQuery.eq('store_id', storeId);
    }

    const { data: detections, error: detectionError } = await detectionQuery;
    if (detectionError) {
      throw new Error(`Failed to load outstanding detections: ${detectionError.message}`);
    }

    const recoveredValue = (payouts || [])
      .filter((row: any) => Number(row.amount || 0) > 0)
      .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const outstandingValue = (detections || [])
      .reduce((sum: number, row: any) => sum + Number(row.estimated_value || 0), 0);
    const lastPayoutAt = (payouts || [])
      .map((row: any) => row.event_date)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;

    return {
      recoveredValue,
      outstandingValue,
      lastPayoutAt,
      payoutEventsCount: (payouts || []).length
    };
  }
}

export const financialEventsService = new FinancialEventsService();
export default financialEventsService;
