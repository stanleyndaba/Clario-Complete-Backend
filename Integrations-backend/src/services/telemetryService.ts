import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

export type StreamType = 'inventory' | 'financial' | 'reimbursements' | 'fees' | 'shipments' | 'returns' | 'removals';

export interface TelemetryPoint {
  userId: string;
  streamType: StreamType;
  marketplaceId: string;
  lastSuccess: Date;
  recordsIngested?: number;
  expectedRecords?: number;
  errorCount?: number;
}

class TelemetryService {
  async record(point: TelemetryPoint): Promise<void> {
    try {
      const freshnessLagMs = Math.max(0, Date.now() - point.lastSuccess.getTime());
      const { error } = await supabase
        .from('sync_telemetry')
        .insert({
          user_id: point.userId,
          stream_type: point.streamType,
          marketplace_id: point.marketplaceId,
          last_success: point.lastSuccess.toISOString(),
          records_ingested: point.recordsIngested ?? null,
          expected_records: point.expectedRecords ?? null,
          error_count: point.errorCount ?? 0,
          freshness_lag_ms: freshnessLagMs
        });
      if (error) throw error;
    } catch (e) {
      logger.warn('Failed to record telemetry', { error: (e as any)?.message, point });
    }
  }

  async latestByUser(userId: string) {
    const { data, error } = await supabase
      .from('sync_telemetry')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data || [];
  }
}

export const telemetryService = new TelemetryService();
export default telemetryService;

