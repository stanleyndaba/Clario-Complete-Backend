import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export type OnboardingCapacityStatus = {
  max: number;
  active: number;
  allowed: boolean;
  nextBatchHours: number;
};

const DEFAULT_MAX_ACTIVE = Number(process.env.MAX_ACTIVE_ONBOARDING_USERS || '5');
const DEFAULT_TTL_MINUTES = Number(process.env.ONBOARDING_SLOT_TTL_MINUTES || '1440'); // 24 hours
const DEFAULT_NEXT_BATCH_HOURS = Number(process.env.ONBOARDING_NEXT_BATCH_HOURS || '24');

const hasTrustedInternalApiKey = (req: any): boolean => {
  const configuredKey = process.env.INTERNAL_API_KEY;
  if (!configuredKey || configuredKey.trim().length === 0) return false;
  const providedKey = req?.headers?.['x-internal-api-key'] || req?.headers?.['x-api-key'];
  return typeof providedKey === 'string' && providedKey === configuredKey;
};

const normalizeUserId = (value?: string | null) => {
  if (!value) return null;
  return value.trim();
};

class OnboardingCapacityService {
  getMaxActive(): number {
    return DEFAULT_MAX_ACTIVE;
  }

  getNextBatchHours(): number {
    return DEFAULT_NEXT_BATCH_HOURS;
  }

  isAdminOverride(req: any): boolean {
    if (!req) return false;
    const overrideFlag = req.query?.override === 'true' || req.query?.admin_override === 'true';
    if (!overrideFlag) return false;
    return hasTrustedInternalApiKey(req);
  }

  async getActiveCount(): Promise<number> {
    const { count, error } = await supabaseAdmin
      .from('onboarding_slots')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString());

    if (error) {
      logger.warn('Failed to read onboarding slot count', { error: error.message });
      return 0;
    }

    return count || 0;
  }

  async getCapacityStatus(): Promise<OnboardingCapacityStatus> {
    const active = await this.getActiveCount();
    const max = this.getMaxActive();
    return {
      max,
      active,
      allowed: active < max,
      nextBatchHours: this.getNextBatchHours()
    };
  }

  async reserveSlot(userId: string, tenantId: string, options: { override?: boolean } = {}) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      return { allowed: false, active: 0, max: this.getMaxActive() };
    }

    if (options.override) {
      return { allowed: true, active: await this.getActiveCount(), max: this.getMaxActive() };
    }

    const { data, error } = await supabaseAdmin.rpc('reserve_onboarding_slot', {
      p_user_id: normalizedUserId,
      p_tenant_id: tenantId,
      p_max: this.getMaxActive(),
      p_ttl_minutes: DEFAULT_TTL_MINUTES
    });

    if (error) {
      logger.error('Failed to reserve onboarding slot', { error: error.message, userId: normalizedUserId, tenantId });
      return { allowed: false, active: await this.getActiveCount(), max: this.getMaxActive() };
    }

    const payload = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(payload?.allowed),
      active: Number(payload?.active_count || 0),
      max: this.getMaxActive()
    };
  }

  async releaseSlot(userId: string, outcome: 'completed' | 'failed' | 'cancelled' = 'completed'): Promise<void> {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return;

    if (outcome === 'completed') {
      const { error } = await supabaseAdmin.rpc('complete_onboarding_slot', { p_user_id: normalizedUserId });
      if (error) {
        logger.warn('Failed to complete onboarding slot', { error: error.message, userId: normalizedUserId });
      }
      return;
    }

    const { error } = await supabaseAdmin
      .from('onboarding_slots')
      .update({
        status: 'expired',
        released_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', normalizedUserId)
      .eq('status', 'active');

    if (error) {
      logger.warn('Failed to release onboarding slot', { error: error.message, userId: normalizedUserId, outcome });
    }
  }
}

const onboardingCapacityService = new OnboardingCapacityService();

export default onboardingCapacityService;

