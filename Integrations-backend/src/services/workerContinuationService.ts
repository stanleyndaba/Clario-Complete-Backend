import { supabaseAdmin } from '../database/supabaseClient';

type WorkerCheckpointRow = {
  worker_name: string;
  tenant_id: string;
  cursor_value: string | null;
  metadata?: Record<string, any> | null;
  updated_at?: string;
};

class WorkerContinuationService {
  async getCursor(workerName: string, tenantId: string): Promise<string | null> {
    const { data, error } = await supabaseAdmin
      .from('worker_continuation_state')
      .select('cursor_value')
      .eq('worker_name', workerName)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load worker continuation cursor: ${error.message}`);
    }

    return data?.cursor_value || null;
  }

  async setCursor(
    workerName: string,
    tenantId: string,
    cursorValue: string | null,
    metadata?: Record<string, any>
  ): Promise<void> {
    const payload: WorkerCheckpointRow = {
      worker_name: workerName,
      tenant_id: tenantId,
      cursor_value: cursorValue,
      metadata: metadata || {},
      updated_at: new Date().toISOString()
    };

    const { error } = await supabaseAdmin
      .from('worker_continuation_state')
      .upsert(payload, { onConflict: 'worker_name,tenant_id' });

    if (error) {
      throw new Error(`Failed to save worker continuation cursor: ${error.message}`);
    }
  }

  async clearCursor(workerName: string, tenantId: string): Promise<void> {
    await this.setCursor(workerName, tenantId, null, { reset: true });
  }
}

const workerContinuationService = new WorkerContinuationService();

export default workerContinuationService;
