import { supabaseAdmin } from '../database/supabaseClient';
import runtimeCapacityService from './runtimeCapacityService';

export type IntakeAdmissionDecision = {
  allowed: boolean;
  reason: string | null;
  metrics: Record<string, number>;
};

class CapacityGovernanceService {
  private readonly MAX_PARSING_BACKLOG_PER_TENANT = Number(process.env.MAX_PARSING_BACKLOG_PER_TENANT || '400');
  private readonly MAX_MATCHING_BACKLOG_PER_TENANT = Number(process.env.MAX_MATCHING_BACKLOG_PER_TENANT || '400');
  private readonly MAX_FILING_BACKLOG_PER_TENANT = Number(process.env.MAX_FILING_BACKLOG_PER_TENANT || '120');
  private readonly MAX_RECOVERY_BACKLOG_PER_TENANT = Number(process.env.MAX_RECOVERY_BACKLOG_PER_TENANT || '120');
  private readonly MAX_BILLING_BACKLOG_PER_TENANT = Number(process.env.MAX_BILLING_BACKLOG_PER_TENANT || '120');
  private readonly MAX_CONCURRENT_SYNCS_PER_TENANT = Number(process.env.MAX_CONCURRENT_SYNCS_PER_TENANT || '2');
  private readonly MAX_PARSING_AGE_MS = Number(process.env.MAX_PARSING_AGE_MS || String(30 * 60 * 1000));
  private readonly MAX_MATCHING_AGE_MS = Number(process.env.MAX_MATCHING_AGE_MS || String(30 * 60 * 1000));
  private readonly MAX_RECOVERY_AGE_MS = Number(process.env.MAX_RECOVERY_AGE_MS || String(60 * 60 * 1000));
  private readonly MAX_BILLING_AGE_MS = Number(process.env.MAX_BILLING_AGE_MS || String(60 * 60 * 1000));

  async getTenantBacklogMetrics(tenantId: string): Promise<Record<string, number>> {
    const [
      parsing,
      matching,
      filing,
      recovery,
      billing,
      syncs
    ] = await Promise.all([
      supabaseAdmin
        .from('evidence_documents')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('parser_status', ['pending', 'processing']),
      supabaseAdmin
        .from('detection_results')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['detected', 'pending']),
      supabaseAdmin
        .from('dispute_cases')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('filing_status', ['pending', 'retrying', 'submitting']),
      supabaseAdmin
        .from('dispute_cases')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'approved')
        .or('recovery_status.eq.pending,recovery_status.eq.detecting,recovery_status.is.null'),
      supabaseAdmin
        .from('dispute_cases')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('recovery_status', 'reconciled')
        .or('billing_status.is.null,billing_status.eq.pending'),
      supabaseAdmin
        .from('sync_progress')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'running')
    ]);

    return {
      parsingBacklog: parsing.count || 0,
      matchingBacklog: matching.count || 0,
      filingBacklog: filing.count || 0,
      recoveryBacklog: recovery.count || 0,
      billingBacklog: billing.count || 0,
      runningSyncs: syncs.count || 0
    };
  }

  async getIntakeAdmissionDecision(tenantId: string): Promise<IntakeAdmissionDecision> {
    const metrics = await this.getTenantBacklogMetrics(tenantId);
    const parsingSnapshot = runtimeCapacityService.getWorkerSnapshot(`document-parsing:${tenantId}`);
    const matchingSnapshot = runtimeCapacityService.getWorkerSnapshot(`evidence-matching:${tenantId}`);
    const recoverySnapshot = runtimeCapacityService.getWorkerSnapshot(`recoveries:${tenantId}`);
    const billingSnapshot = runtimeCapacityService.getWorkerSnapshot(`billing:${tenantId}`);
    const runtime = runtimeCapacityService.getSnapshot();

    if (runtime.circuitBreakers.some((breaker) => breaker.breakerName === 'filing-auto-dispatch' && breaker.state === 'open')) {
      return {
        allowed: false,
        reason: 'filing_circuit_breaker_open',
        metrics
      };
    }

    if (metrics.runningSyncs >= this.MAX_CONCURRENT_SYNCS_PER_TENANT) {
      return {
        allowed: false,
        reason: `tenant_sync_capacity_reached:${metrics.runningSyncs}/${this.MAX_CONCURRENT_SYNCS_PER_TENANT}`,
        metrics
      };
    }

    if (metrics.parsingBacklog >= this.MAX_PARSING_BACKLOG_PER_TENANT) {
      return {
        allowed: false,
        reason: `parsing_backlog_limit_reached:${metrics.parsingBacklog}/${this.MAX_PARSING_BACKLOG_PER_TENANT}`,
        metrics
      };
    }

    if ((parsingSnapshot?.oldestItemAgeMs || 0) >= this.MAX_PARSING_AGE_MS) {
      return {
        allowed: false,
        reason: `parsing_age_slo_exceeded:${parsingSnapshot?.oldestItemAgeMs}/${this.MAX_PARSING_AGE_MS}`,
        metrics
      };
    }

    if (metrics.matchingBacklog >= this.MAX_MATCHING_BACKLOG_PER_TENANT) {
      return {
        allowed: false,
        reason: `matching_backlog_limit_reached:${metrics.matchingBacklog}/${this.MAX_MATCHING_BACKLOG_PER_TENANT}`,
        metrics
      };
    }

    if ((matchingSnapshot?.oldestItemAgeMs || 0) >= this.MAX_MATCHING_AGE_MS) {
      return {
        allowed: false,
        reason: `matching_age_slo_exceeded:${matchingSnapshot?.oldestItemAgeMs}/${this.MAX_MATCHING_AGE_MS}`,
        metrics
      };
    }

    if (metrics.filingBacklog >= this.MAX_FILING_BACKLOG_PER_TENANT) {
      return {
        allowed: false,
        reason: `filing_backlog_limit_reached:${metrics.filingBacklog}/${this.MAX_FILING_BACKLOG_PER_TENANT}`,
        metrics
      };
    }

    if (metrics.recoveryBacklog >= this.MAX_RECOVERY_BACKLOG_PER_TENANT) {
      return {
        allowed: false,
        reason: `recovery_backlog_limit_reached:${metrics.recoveryBacklog}/${this.MAX_RECOVERY_BACKLOG_PER_TENANT}`,
        metrics
      };
    }

    if ((recoverySnapshot?.oldestItemAgeMs || 0) >= this.MAX_RECOVERY_AGE_MS) {
      return {
        allowed: false,
        reason: `recovery_age_slo_exceeded:${recoverySnapshot?.oldestItemAgeMs}/${this.MAX_RECOVERY_AGE_MS}`,
        metrics
      };
    }

    if (metrics.billingBacklog >= this.MAX_BILLING_BACKLOG_PER_TENANT) {
      return {
        allowed: false,
        reason: `billing_backlog_limit_reached:${metrics.billingBacklog}/${this.MAX_BILLING_BACKLOG_PER_TENANT}`,
        metrics
      };
    }

    if ((billingSnapshot?.oldestItemAgeMs || 0) >= this.MAX_BILLING_AGE_MS) {
      return {
        allowed: false,
        reason: `billing_age_slo_exceeded:${billingSnapshot?.oldestItemAgeMs}/${this.MAX_BILLING_AGE_MS}`,
        metrics
      };
    }

    return {
      allowed: true,
      reason: null,
      metrics
    };
  }
}

const capacityGovernanceService = new CapacityGovernanceService();

export default capacityGovernanceService;
