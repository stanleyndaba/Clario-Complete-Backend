import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

type FinancialSummaryParams = {
  tenantId: string;
  storeId?: string | null;
  sellerId?: string | null;
};

export type FinancialSummary = {
  tenant_id: string;
  store_id: string | null;
  seller_id: string | null;
  total_recovered: number;
  total_fees: number;
  outstanding_amount: number;
  last_payout_date: string | null;
  payout_count: number;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function isReimbursementEvent(row: any): boolean {
  return normalize(row?.event_type).includes('reimbursement');
}

function isFeeEvent(row: any): boolean {
  return normalize(row?.event_type).includes('fee');
}

class FinancialSummaryService {
  async getSummary(params: FinancialSummaryParams): Promise<FinancialSummary> {
    try {
      let financialQuery = supabaseAdmin
        .from('financial_events')
        .select('id, event_type, amount, event_date, tenant_id, store_id, seller_id')
        .eq('tenant_id', params.tenantId);

      let detectionQuery = supabaseAdmin
        .from('detection_results')
        .select('estimated_value')
        .eq('tenant_id', params.tenantId);

      if (params.storeId) {
        financialQuery = financialQuery.eq('store_id', params.storeId);
        detectionQuery = detectionQuery.eq('store_id', params.storeId);
      }

      if (params.sellerId) {
        financialQuery = financialQuery.eq('seller_id', params.sellerId);
        detectionQuery = detectionQuery.eq('seller_id', params.sellerId);
      }

      const [{ data: financialRows, error: financialError }, { data: detectionRows, error: detectionError }] = await Promise.all([
        financialQuery,
        detectionQuery,
      ]);

      if (financialError) throw financialError;
      if (detectionError) throw detectionError;

      const reimbursements = (financialRows || []).filter(isReimbursementEvent);
      const feeEvents = (financialRows || []).filter(isFeeEvent);

      const totalRecovered = Number(
        reimbursements.reduce((sum: number, row: any) => sum + toNumber(row.amount), 0).toFixed(2)
      );
      const totalFees = Number(
        feeEvents.reduce((sum: number, row: any) => sum + Math.abs(toNumber(row.amount)), 0).toFixed(2)
      );
      const totalDetected = Number(
        (detectionRows || []).reduce((sum: number, row: any) => sum + toNumber(row.estimated_value), 0).toFixed(2)
      );
      const lastPayoutDate = reimbursements
        .map((row: any) => row.event_date)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null;

      return {
        tenant_id: params.tenantId,
        store_id: params.storeId || null,
        seller_id: params.sellerId || null,
        total_recovered: totalRecovered,
        total_fees: totalFees,
        outstanding_amount: Number(Math.max(totalDetected - totalRecovered, 0).toFixed(2)),
        last_payout_date: lastPayoutDate,
        payout_count: reimbursements.length,
      };
    } catch (error: any) {
      logger.error('[FINANCIAL SUMMARY] Failed to build summary', {
        error: error.message,
        tenantId: params.tenantId,
        storeId: params.storeId || null,
        sellerId: params.sellerId || null,
      });

      return {
        tenant_id: params.tenantId,
        store_id: params.storeId || null,
        seller_id: params.sellerId || null,
        total_recovered: 0,
        total_fees: 0,
        outstanding_amount: 0,
        last_payout_date: null,
        payout_count: 0,
      };
    }
  }
}

export const financialSummaryService = new FinancialSummaryService();
export default financialSummaryService;
