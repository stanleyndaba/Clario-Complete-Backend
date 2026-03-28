/**
 * Recoveries Worker
 * Automated background worker for detecting payouts and reconciling amounts
 * Runs every 10 minutes, processes approved cases, detects payouts, and reconciles
 * 
 * MULTI-TENANT: Processes each tenant's data in isolation
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import { createTenantScopedQueryById } from '../database/tenantScopedClient';
import recoveriesService from '../services/recoveriesService';
import workerContinuationService from '../services/workerContinuationService';
import runtimeCapacityService from '../services/runtimeCapacityService';
import operationalControlService from '../services/operationalControlService';
import financialWorkItemService from '../services/financialWorkItemService';
import { resolveTenantSlug } from '../utils/tenantEventRouting';

// Retry logic with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(`🔄 [RECOVERIES] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
          error: error.message,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export interface RecoveryStats {
  processed: number;
  payoutsDetected: number;
  matched: number;
  reconciled: number;
  discrepancies: number;
  failed: number;
  errors: string[];
}

class RecoveriesWorker {
  private executionSchedule: string = process.env.RECOVERY_EXECUTION_LANE_SCHEDULE || '*/20 * * * * *';
  private backstopSchedule: string = process.env.RECOVERY_BACKSTOP_SCHEDULE || '*/10 * * * *';
  private executionJob: cron.ScheduledTask | null = null;
  private backstopJob: cron.ScheduledTask | null = null;
  private isExecutionRunning: boolean = false;
  private isBackstopRunning: boolean = false;
  private readonly workerName = 'recoveries';
  private readonly executionLaneName = 'recoveries-execution';
  private readonly backstopLaneName = 'recoveries-backstop';
  private static readonly BATCH_SIZE = Number(process.env.RECOVERIES_BATCH_SIZE || '75');
  private static readonly WORK_BATCH_SIZE = Number(process.env.RECOVERY_WORK_BATCH_SIZE || '25');
  private tenantRotationOffset: number = 0;

  private buildExecutionMetadata(item: any, extra: Record<string, any> = {}): Record<string, any> {
    const timestamp = new Date().toISOString();
    return {
      ...(item?.payload || {}),
      execution_lane: this.executionLaneName,
      execution_runtime_role: process.env.RUNTIME_ROLE || 'monolith',
      execution_owned_by: 'recoveries',
      execution_processed_at: timestamp,
      last_processed_at: timestamp,
      last_execution_lane: this.executionLaneName,
      last_runtime_role: process.env.RUNTIME_ROLE || 'monolith',
      ...extra
    };
  }

  private async emitRecoveryEvent(
    eventType: string,
    item: any,
    extra: Record<string, any> = {}
  ): Promise<void> {
    try {
      const sseHub = (await import('../utils/sseHub')).default;
      await sseHub.sendTenantEvent(eventType, {
        event_type: eventType,
        entity_type: 'recovery',
        entity_id: item.dispute_case_id,
        tenant_id: item.tenant_id,
        tenant_slug: item.tenant_slug,
        seller_id: item.user_id,
        dispute_case_id: item.dispute_case_id,
        recovery_work_item_id: item.id,
        execution_lane: this.executionLaneName,
        runtime_role: process.env.RUNTIME_ROLE || 'monolith',
        timestamp: new Date().toISOString(),
        ...extra
      }, item.tenant_slug, item.tenant_id);
    } catch {}
  }

  private rotateTenants<T>(tenants: T[]): T[] {
    if (tenants.length <= 1) return tenants;
    const offset = this.tenantRotationOffset % tenants.length;
    this.tenantRotationOffset = (this.tenantRotationOffset + 1) % tenants.length;
    return [...tenants.slice(offset), ...tenants.slice(0, offset)];
  }

  private getDelayMsFromIso(retryAt?: string | null, fallbackMs: number = 30 * 60 * 1000): number {
    if (!retryAt) return fallbackMs;
    const target = Date.parse(retryAt);
    if (Number.isNaN(target)) return fallbackMs;
    return Math.max(60 * 1000, target - Date.now());
  }

  private async getRecoveryEligibleTenants(): Promise<Array<{ id: string; name?: string; status?: string }>> {
    const [activeTenantsResult, pendingWorkResult, approvedCasesResult] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('id, name, status')
        .in('status', ['active', 'trialing'])
        .is('deleted_at', null),
      supabaseAdmin
        .from('recovery_work_items')
        .select('tenant_id')
        .in('status', ['pending', 'processing'])
        .not('tenant_id', 'is', null),
      supabaseAdmin
        .from('dispute_cases')
        .select('tenant_id')
        .eq('status', 'approved')
        .or('recovery_status.eq.pending,recovery_status.eq.detecting,recovery_status.is.null,recovery_status.eq.failed')
        .not('tenant_id', 'is', null)
    ]);

    if (activeTenantsResult.error) {
      throw new Error(`Failed to get active tenants: ${activeTenantsResult.error.message}`);
    }
    if (pendingWorkResult.error) {
      throw new Error(`Failed to get pending recovery-work tenants: ${pendingWorkResult.error.message}`);
    }
    if (approvedCasesResult.error) {
      throw new Error(`Failed to get approved recovery-case tenants: ${approvedCasesResult.error.message}`);
    }

    const eligibleTenants = new Map<string, { id: string; name?: string; status?: string }>();
    for (const tenant of (activeTenantsResult.data || []) as Array<{ id: string; name?: string; status?: string }>) {
      eligibleTenants.set(tenant.id, tenant);
    }

    const discoveredTenantIds = new Set<string>();
    for (const row of [...(pendingWorkResult.data || []), ...(approvedCasesResult.data || [])] as Array<{ tenant_id?: string | null }>) {
      if (row?.tenant_id) {
        discoveredTenantIds.add(row.tenant_id);
      }
    }

    const unresolvedTenantIds = [...discoveredTenantIds].filter((tenantId) => !eligibleTenants.has(tenantId));
    if (unresolvedTenantIds.length > 0) {
      const { data: extraTenants, error: extraError } = await supabaseAdmin
        .from('tenants')
        .select('id, name, status')
        .in('id', unresolvedTenantIds)
        .is('deleted_at', null);

      if (extraError) {
        throw new Error(`Failed to resolve recovery-eligible tenant metadata: ${extraError.message}`);
      }

      for (const tenant of (extraTenants || []) as Array<{ id: string; name?: string; status?: string }>) {
        eligibleTenants.set(tenant.id, tenant);
      }
    }

    return [...eligibleTenants.values()];
  }

  /**
   * Start the worker
   */
  start(): void {
    if (this.executionJob || this.backstopJob) {
      logger.warn('⚠️ [RECOVERIES] Worker already started');
      return;
    }

    logger.info('🚀 [RECOVERIES] Starting Recoveries Worker', {
      executionSchedule: this.executionSchedule,
      backstopSchedule: this.backstopSchedule
    });

    this.executionJob = cron.schedule(this.executionSchedule, async () => {
      if (this.isExecutionRunning) {
        runtimeCapacityService.recordWorkerSkip(this.executionLaneName, 'previous_recovery_execution_run_still_in_progress');
        logger.debug('⏸️ [RECOVERIES] Previous execution lane run still in progress, skipping');
        return;
      }

      this.isExecutionRunning = true;
      try {
        await this.runRecoveriesForAllTenants();
      } catch (error: any) {
        logger.error('❌ [RECOVERIES] Error in recovery execution lane', { error: error.message });
      } finally {
        this.isExecutionRunning = false;
      }
    });

    this.backstopJob = cron.schedule(this.backstopSchedule, async () => {
      if (this.isBackstopRunning) {
        runtimeCapacityService.recordWorkerSkip(this.backstopLaneName, 'previous_recovery_backstop_run_still_in_progress');
        logger.debug('⏸️ [RECOVERIES] Previous backstop run still in progress, skipping');
        return;
      }

      this.isBackstopRunning = true;
      try {
        await this.runRecoveryBackstopSweepForAllTenants();
      } catch (error: any) {
        logger.error('❌ [RECOVERIES] Error in recovery backstop sweep', { error: error.message });
      } finally {
        this.isBackstopRunning = false;
      }
    });

    logger.info('✅ [RECOVERIES] Worker started successfully');
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.executionJob) {
      this.executionJob.stop();
      this.executionJob = null;
    }
    if (this.backstopJob) {
      this.backstopJob.stop();
      this.backstopJob = null;
    }
    logger.info('🛑 [RECOVERIES] Worker stopped');
  }

  /**
   * Run recoveries for all tenants
   * MULTI-TENANT: Fetches active tenants and processes each in isolation
   */
  async runRecoveriesForAllTenants(): Promise<RecoveryStats> {
    const stats: RecoveryStats = {
      processed: 0,
      payoutsDetected: 0,
      matched: 0,
      reconciled: 0,
      discrepancies: 0,
      failed: 0,
      errors: []
    };

    try {
      runtimeCapacityService.recordWorkerStart(this.executionLaneName, { mode: 'execution_lane' });
      const reconciliationEnabled = await operationalControlService.isEnabled('recovery_reconciliation', true);
      if (!reconciliationEnabled) {
        runtimeCapacityService.setCircuitBreaker('recovery-reconciliation', 'open', 'operator_disabled');
        logger.warn('⏸️ [RECOVERIES] Recovery reconciliation paused by operator control');
        runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
          processed: 0,
          succeeded: 0,
          failed: 0,
          metadata: { paused: true, reason: 'operator_disabled' }
        });
        return stats;
      }
      runtimeCapacityService.setCircuitBreaker('recovery-reconciliation', 'closed', null);
      logger.info('💰 [RECOVERIES] Starting recovery execution lane for all tenants');

      const tenants = await this.getRecoveryEligibleTenants();

      if (!tenants) {
        logger.error('❌ [RECOVERIES] Failed to resolve recovery-eligible tenants');
        stats.errors.push('Failed to resolve recovery-eligible tenants');
        runtimeCapacityService.recordWorkerEnd(this.workerName, {
          failed: 1,
          lastError: 'Failed to resolve recovery-eligible tenants'
        });
        return stats;
      }

      if (tenants.length === 0) {
        logger.debug('ℹ️ [RECOVERIES] No recovery-eligible tenants found');
        runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
          processed: 0,
          succeeded: 0,
          failed: 0
        });
        return stats;
      }

      logger.info(`📋 [RECOVERIES] Processing ${tenants.length} recovery-eligible tenants`);

      // Process each tenant in isolation
      const orderedTenants = this.rotateTenants(tenants as Array<{ id: string; name?: string }>);
      for (const tenant of orderedTenants) {
        try {
          const tenantStats = await this.runRecoveriesForTenant(tenant.id);
          stats.processed += tenantStats.processed;
          stats.payoutsDetected += tenantStats.payoutsDetected;
          stats.matched += tenantStats.matched;
          stats.reconciled += tenantStats.reconciled;
          stats.discrepancies += tenantStats.discrepancies;
          stats.failed += tenantStats.failed;
          stats.errors.push(...tenantStats.errors);
        } catch (error: any) {
          logger.error('❌ [RECOVERIES] Error processing tenant', {
            tenantId: tenant.id,
            tenantName: tenant.name,
            error: error.message
          });
          stats.errors.push(`Tenant ${tenant.id}: ${error.message}`);
        }
      }

      logger.info('✅ [RECOVERIES] Recovery run completed', stats);
      runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
        processed: stats.processed,
        succeeded: stats.reconciled,
        failed: stats.failed
      });
      return stats;

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Fatal error in recovery run', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
      runtimeCapacityService.recordWorkerEnd(this.executionLaneName, {
        processed: stats.processed,
        succeeded: stats.reconciled,
        failed: stats.failed || 1,
        lastError: error.message
      });
      return stats;
    }
  }

  /**
   * Run recoveries for a specific tenant
   * MULTI-TENANT: Uses tenant-scoped queries for isolation
   */
  async runRecoveriesForTenant(tenantId: string): Promise<RecoveryStats> {
    const stats: RecoveryStats = {
      processed: 0,
      payoutsDetected: 0,
      matched: 0,
      reconciled: 0,
      discrepancies: 0,
      failed: 0,
      errors: []
    };

    const workStats = await this.processPendingRecoveryWorkForTenant(tenantId);
    stats.processed += workStats.processed;
    stats.payoutsDetected += workStats.payoutsDetected;
    stats.matched += workStats.matched;
    stats.reconciled += workStats.reconciled;
    stats.discrepancies += workStats.discrepancies;
    stats.failed += workStats.failed;
    stats.errors.push(...workStats.errors);

    return stats;

    // Legacy scan path retained below only for reference; event-driven work items are now primary.

    const cursor = await workerContinuationService.getCursor(this.workerName, tenantId);
    const tenantQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
    const backlogQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
    const oldestQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');

    // Get approved cases that need recovery detection for this tenant
    let query = tenantQuery
      .select(`
        id, 
        seller_id, 
        claim_amount, 
        currency, 
        status, 
        recovery_status, 
        provider_case_id,
        detection_result_id,
        tenant_id,
        detection_results (
          evidence
        )
      `)
      .eq('status', 'approved')
      .or('recovery_status.eq.pending,recovery_status.eq.detecting,recovery_status.is.null')
      .order('id', { ascending: true })
      .limit(RecoveriesWorker.BATCH_SIZE);

    if (cursor) {
      query = query.gt('id', cursor);
    }

    const [backlogResult, oldestResult] = await Promise.all([
      backlogQuery
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved')
        .or('recovery_status.eq.pending,recovery_status.eq.detecting,recovery_status.is.null'),
      oldestQuery
        .select('updated_at')
        .eq('status', 'approved')
        .or('recovery_status.eq.pending,recovery_status.eq.detecting,recovery_status.is.null')
        .order('updated_at', { ascending: true })
        .limit(1)
    ]);

    let { data: approvedCases, error } = await query;

    if ((!approvedCases || approvedCases.length === 0) && cursor) {
      const wrapped = await createTenantScopedQueryById(tenantId, 'dispute_cases')
        .select(`
        id, 
        seller_id, 
        claim_amount, 
        currency, 
        status, 
        recovery_status, 
        provider_case_id,
        detection_result_id,
        tenant_id,
        detection_results (
          evidence
        )
      `)
        .eq('status', 'approved')
        .or('recovery_status.eq.pending,recovery_status.eq.detecting,recovery_status.is.null')
        .order('id', { ascending: true })
        .limit(RecoveriesWorker.BATCH_SIZE);
      approvedCases = wrapped.data;
      error = wrapped.error as any;
    }

    const oldestUpdatedAt = oldestResult.data?.[0]?.updated_at as string | undefined;
    runtimeCapacityService.updateBacklog(
      `${this.workerName}:${tenantId}`,
      backlogResult.count || 0,
      oldestUpdatedAt ? Math.max(0, Date.now() - new Date(oldestUpdatedAt).getTime()) : null
    );

    if (error) {
      logger.error('❌ [RECOVERIES] Failed to get approved cases', { tenantId, error: error.message });
      stats.errors.push(`Failed to get cases: ${error.message}`);
      return stats;
    }

    if (!approvedCases || approvedCases.length === 0) {
      await workerContinuationService.clearCursor(this.workerName, tenantId);
      runtimeCapacityService.recordWorkerEnd(`${this.workerName}:${tenantId}`, {
        processed: 0,
        succeeded: 0,
        failed: 0,
        backlogDepth: backlogResult.count || 0,
        oldestItemAgeMs: oldestUpdatedAt ? Math.max(0, Date.now() - new Date(oldestUpdatedAt).getTime()) : null
      });
      logger.debug('ℹ️ [RECOVERIES] No approved cases needing recovery detection', { tenantId });
      return stats;
    }

    logger.info(`📋 [RECOVERIES] Found ${approvedCases.length} approved cases needing recovery detection`, { tenantId });

    // Group by user to batch payout detection
    const casesByUser = new Map<string, typeof approvedCases>();
    for (const case_ of approvedCases) {
      const userId = case_.seller_id;
      if (!casesByUser.has(userId)) {
        casesByUser.set(userId, []);
      }
      casesByUser.get(userId)!.push(case_);
    }

    // Process each user's cases
    for (const [userId, userCases] of casesByUser) {
      try {
        // Update recovery status to 'detecting' (tenant-scoped)
        for (const case_ of userCases) {
          const updateQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');
          await updateQuery
            .update({
              recovery_status: 'detecting',
              updated_at: new Date().toISOString()
            })
            .eq('id', case_.id);
        }

        // Detect payouts for this user (last 30 days)
        const payouts = await retryWithBackoff(
          () => recoveriesService.detectPayouts(
            userId,
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            new Date(),
            tenantId
          ),
          3,
          2000
        );

        stats.payoutsDetected += payouts.length;

        logger.info(`🔍 [RECOVERIES] Detected ${payouts.length} payouts for user ${userId}`);

        const payoutDecisions = await Promise.all(
          payouts.map(async (payout) => ({
            payout,
            decision: await recoveriesService.matchPayoutToClaim(payout, userId, tenantId)
          }))
        );
        const bestMatchByDisputeId = new Map<string, any>();

        for (const { payout, decision } of payoutDecisions) {
          if (decision.reconciliation_strategy === 'QUARANTINED' || !decision.match) {
            continue;
          }

          const existing = bestMatchByDisputeId.get(decision.match.disputeId);
          if (!existing || Number(decision.match.match_explanation?.confidence || 0) > Number(existing.match.match_explanation?.confidence || 0)) {
            bestMatchByDisputeId.set(decision.match.disputeId, {
              payout,
              match: decision.match
            });
          }
        }

        // Process each case for this user
        for (const disputeCase of userCases) {
          try {
            stats.processed++;

            const matchedDecision = bestMatchByDisputeId.get(disputeCase.id);
            if (matchedDecision?.match) {
              stats.matched++;

              // Reconcile the payout
              const result = await recoveriesService.reconcilePayout(matchedDecision.match, userId, tenantId);

              if (result.success) {
                if (result.status === 'reconciled') {
                  stats.reconciled++;
                } else if (result.status === 'discrepancy') {
                  stats.discrepancies++;
                }
              } else {
                stats.failed++;
                stats.errors.push(`Case ${disputeCase.id}: ${result.error}`);
              }
            } else {
              // No payout found yet - log lifecycle event
              await this.logLifecycleEvent(disputeCase.id, userId, {
                eventType: 'payout_detected',
                eventData: {
                  note: 'No payout found yet, will retry in next run',
                  payoutCount: payouts.length
                }
              });

              logger.debug('ℹ️ [RECOVERIES] No payout match found for case', {
                disputeId: disputeCase.id,
                payoutCount: payouts.length
              });
            }

          } catch (error: any) {
            logger.error('❌ [RECOVERIES] Error processing case', {
              disputeId: disputeCase.id,
              error: error.message
            });
            stats.failed++;
            stats.errors.push(`Case ${disputeCase.id}: ${error.message}`);
          }

          // Small delay between cases
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error: any) {
        logger.error('❌ [RECOVERIES] Error processing user cases', {
          userId,
          error: error.message
        });
        stats.errors.push(`User ${userId}: ${error.message}`);
      }

      // Small delay between users
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await workerContinuationService.setCursor(
      this.workerName,
      tenantId,
      approvedCases[approvedCases.length - 1]?.id || null,
      { processed: stats.processed, backlogDepth: backlogResult.count || 0 }
    );

    runtimeCapacityService.recordWorkerEnd(`${this.workerName}:${tenantId}`, {
      processed: stats.processed,
      succeeded: stats.reconciled,
      failed: stats.failed,
      backlogDepth: backlogResult.count || 0,
      oldestItemAgeMs: oldestUpdatedAt ? Math.max(0, Date.now() - new Date(oldestUpdatedAt).getTime()) : null
    });

    logger.info('✅ [RECOVERIES] Tenant recovery run completed', { tenantId, stats });
    return stats;
  }

  async runRecoveryBackstopSweepForAllTenants(): Promise<{ tenantsProcessed: number; enqueued: number; errors: string[] }> {
    const result = { tenantsProcessed: 0, enqueued: 0, errors: [] as string[] };

    try {
      runtimeCapacityService.recordWorkerStart(this.backstopLaneName, { mode: 'backstop_sweep' });
      const reconciliationEnabled = await operationalControlService.isEnabled('recovery_reconciliation', true);
      if (!reconciliationEnabled) {
        runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
          processed: 0,
          succeeded: 0,
          failed: 0,
          metadata: { paused: true, reason: 'operator_disabled' }
        });
        return result;
      }

      logger.info('💰 [RECOVERIES] Starting recovery backstop sweep for all tenants');

      const tenants = await this.getRecoveryEligibleTenants();

      if (!tenants) {
        runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
          failed: 1,
          lastError: 'Failed to resolve recovery-eligible tenants'
        });
        throw new Error('Failed to resolve recovery-eligible tenants');
      }

      const orderedTenants = this.rotateTenants(tenants as Array<{ id: string; name?: string }>);
      for (const tenant of orderedTenants) {
        try {
          result.tenantsProcessed++;
          result.enqueued += await this.enqueueMissingRecoveryWorkItemsForTenant(tenant.id);
        } catch (tenantError: any) {
          result.errors.push(`Tenant ${tenant.id}: ${tenantError.message}`);
        }
      }

      runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
        processed: result.tenantsProcessed,
        succeeded: result.enqueued,
        failed: result.errors.length
      });
      return result;
    } catch (error: any) {
      runtimeCapacityService.recordWorkerEnd(this.backstopLaneName, {
        processed: result.tenantsProcessed,
        succeeded: result.enqueued,
        failed: result.errors.length || 1,
        lastError: error.message
      });
      result.errors.push(error.message);
      return result;
    }
  }

  private async processPendingRecoveryWorkForTenant(tenantId: string): Promise<RecoveryStats> {
    const stats: RecoveryStats = {
      processed: 0,
      payoutsDetected: 0,
      matched: 0,
      reconciled: 0,
      discrepancies: 0,
      failed: 0,
      errors: []
    };

    const backlogState = await this.getRecoveryWorkBacklog(tenantId);
    runtimeCapacityService.updateBacklog(`${this.executionLaneName}:${tenantId}`, backlogState.backlogDepth, backlogState.oldestItemAgeMs, {
      mode: 'event_driven_primary'
    });

    for (let i = 0; i < RecoveriesWorker.WORK_BATCH_SIZE; i++) {
      const item = await financialWorkItemService.claimNext('recovery', `${this.executionLaneName}:${tenantId}`, tenantId);
      if (!item) {
        break;
      }

      await this.emitRecoveryEvent('recovery.work_claimed', item, {
        status: item.status,
        last_claimed_at: item.payload?.last_claimed_at || item.updated_at || new Date().toISOString()
      });

      const result = await this.processRecoveryWorkItem(item);
      stats.processed++;

      if (result === 'completed') {
        stats.payoutsDetected++;
        stats.matched++;
        stats.reconciled++;
      } else if (result === 'discrepancy') {
        stats.payoutsDetected++;
        stats.matched++;
        stats.discrepancies++;
      } else if (result === 'failed' || result === 'quarantined') {
        stats.failed++;
      }
    }

    return stats;
  }

  private async processRecoveryWorkItem(item: any): Promise<'completed' | 'discrepancy' | 'deferred' | 'quarantined' | 'failed' | 'blocked'> {
    try {
      const result = await recoveriesService.processRecoveryForCase(item.dispute_case_id, item.user_id, item.tenant_id);

      if (result?.success) {
        await financialWorkItemService.complete('recovery', item.id, {
          ...this.buildExecutionMetadata(item, {
          lifecycle_state: 'completed',
          status: result.status,
          recovery_id: result.recoveryId || item.payload?.recovery_id || null,
          completed_at: new Date().toISOString(),
          operational_state: result.operational_state || 'READY',
          operational_explanation: result.operational_explanation || {
            reason: 'Recovery work completed successfully.',
            next_action: result.status === 'reconciled' ? 'await_billing_lane' : 'review_discrepancy'
          }
          })
        });
        await this.emitRecoveryEvent('recovery.completed', item, {
          status: result.status,
          recovery_id: result.recoveryId || item.payload?.recovery_id || null
        });
        return result.status === 'discrepancy' ? 'discrepancy' : 'completed';
      }

      if (result?.operational_state === 'BLOCKED_OPERATIONAL') {
        await financialWorkItemService.complete('recovery', item.id, {
          ...this.buildExecutionMetadata(item, {
            lifecycle_state: 'blocked_operational',
            status: result.status,
            operational_state: result.operational_state,
            operational_explanation: result.operational_explanation,
            completed_at: new Date().toISOString()
          })
        });
        await this.emitRecoveryEvent('recovery.blocked_operational', item, {
          status: result.status,
          operational_state: result.operational_state,
          operational_explanation: result.operational_explanation,
          reason: result.operational_explanation?.reason || result.error || 'blocked_operational'
        });
        return 'blocked';
      }

      if (result?.operational_state === 'DEFERRED_EXPLICIT') {
        const retryAt = result.operational_explanation?.retry_at || new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await financialWorkItemService.defer(
          'recovery',
          item.id,
          result.operational_explanation?.reason || 'recovery_deferred',
          this.getDelayMsFromIso(retryAt),
          {
            ...this.buildExecutionMetadata(item, {
              lifecycle_state: 'deferred',
              defer_count: Number(item?.payload?.defer_count || 0) + 1,
              deferred_reason: result.operational_explanation?.reason || 'payout_not_found_yet',
              last_deferred_reason: result.operational_explanation?.reason || 'payout_not_found_yet',
              next_attempt_at: retryAt,
              operational_state: result.operational_state,
              operational_explanation: result.operational_explanation
            })
          }
        );
        await this.emitRecoveryEvent('recovery.work_deferred', item, {
          status: 'pending',
          reason: result.operational_explanation?.reason || 'payout_not_found_yet',
          defer_count: Number(item?.payload?.defer_count || 0) + 1,
          next_attempt_at: retryAt,
          operational_state: result.operational_state,
          operational_explanation: result.operational_explanation
        });
        return 'deferred';
      }

      if (result?.operational_state === 'RETRY_SCHEDULED') {
        const terminalState = await financialWorkItemService.fail(
          'recovery',
          item,
          result.operational_explanation?.reason || result.error || 'recovery_retry_scheduled',
          {
            ...this.buildExecutionMetadata(item, {
              lifecycle_state: 'retry_scheduled',
              failed_reason: result.operational_explanation?.reason || result.error || 'recovery_retry_scheduled',
              operational_state: result.operational_state,
              operational_explanation: result.operational_explanation
            })
          },
          {
            nextAttemptAt: result.operational_explanation?.retry_at || null
          }
        );
        await this.emitRecoveryEvent(
          terminalState === 'failed_retry_exhausted' ? 'recovery.failed_retry_exhausted' : 'recovery.retry_scheduled',
          item,
          {
            status: terminalState,
            reason: result.operational_explanation?.reason || result.error || 'recovery_retry_scheduled',
            retry_at: result.operational_explanation?.retry_at || null,
            operational_state: result.operational_state,
            operational_explanation: result.operational_explanation
          }
        );
        return terminalState === 'failed_retry_exhausted' ? 'failed' : 'deferred';
      }

      if (result?.operational_state === 'FAILED_DURABLE') {
        await financialWorkItemService.fail(
          'recovery',
          item,
          result.operational_explanation?.reason || result.error || 'recovery_failed_durable',
          {
            ...this.buildExecutionMetadata(item, {
              lifecycle_state: 'failed_durable',
              failed_reason: result.operational_explanation?.reason || result.error || 'recovery_failed_durable',
              operational_state: result.operational_state,
              operational_explanation: result.operational_explanation
            })
          },
          {
            forceTerminal: true
          }
        );
        await this.emitRecoveryEvent('recovery.failed_durable', item, {
          status: 'failed_retry_exhausted',
          reason: result.operational_explanation?.reason || result.error || 'recovery_failed_durable',
          operational_state: result.operational_state,
          operational_explanation: result.operational_explanation
        });
        return 'failed';
      }

      const { data: disputeCase } = await supabaseAdmin
        .from('dispute_cases')
        .select('recovery_status, last_error')
        .eq('id', item.dispute_case_id)
        .maybeSingle();

      if (String(disputeCase?.recovery_status || '').toLowerCase() === 'quarantined') {
        const reason = String(disputeCase?.last_error || 'ambiguous_recovery');
        await financialWorkItemService.quarantine('recovery', item.id, reason, {
          ...this.buildExecutionMetadata(item, {
          lifecycle_state: 'quarantined',
          quarantine_reason: reason
          })
        });
        await this.emitRecoveryEvent('recovery.quarantined', item, {
          reason,
          status: 'quarantined'
        });

        return 'quarantined';
      }

      const nextAttemptAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await financialWorkItemService.defer('recovery', item.id, 'payout_not_found_yet', 30 * 60 * 1000, {
        ...this.buildExecutionMetadata(item, {
        lifecycle_state: 'deferred',
        defer_count: Number(item?.payload?.defer_count || 0) + 1,
        deferred_reason: 'payout_not_found_yet',
        last_deferred_reason: 'payout_not_found_yet',
        next_attempt_at: nextAttemptAt,
        operational_state: 'DEFERRED_EXPLICIT',
        operational_explanation: {
          reason: 'Recovery work was deferred because no payout was found yet.',
          retry_at: nextAttemptAt,
          next_action: 'wait_for_next_payout_detection'
        }
        })
      });
      await this.emitRecoveryEvent('recovery.work_deferred', item, {
        status: 'pending',
        reason: 'payout_not_found_yet',
        defer_count: Number(item?.payload?.defer_count || 0) + 1,
        next_attempt_at: nextAttemptAt,
        operational_state: 'DEFERRED_EXPLICIT',
        operational_explanation: {
          reason: 'Recovery work was deferred because no payout was found yet.',
          retry_at: nextAttemptAt,
          next_action: 'wait_for_next_payout_detection'
        }
      });
      return 'deferred';
    } catch (error: any) {
      const attempts = Number(item?.attempts || 0) + 1;
      const maxAttempts = Number(item?.max_attempts || 5);
      const predictedTerminalState = attempts >= maxAttempts ? 'failed_retry_exhausted' : 'pending';
      const terminalState = await financialWorkItemService.fail('recovery', item, error.message, {
        ...this.buildExecutionMetadata(item, {
        lifecycle_state: predictedTerminalState === 'failed_retry_exhausted' ? 'failed_retry_exhausted' : 'failed',
        failed_reason: error.message,
        operational_state: predictedTerminalState === 'failed_retry_exhausted' ? 'FAILED_DURABLE' : 'RETRY_SCHEDULED',
        operational_explanation: predictedTerminalState === 'failed_retry_exhausted'
          ? {
              reason: error.message,
              blocking_guard: 'recovery_retry_exhausted',
              next_action: 'manual_operator_intervention'
            }
          : {
              reason: error.message,
              next_action: 'retry_recovery_processing'
            }
        })
      });
      await this.emitRecoveryEvent(
        terminalState === 'failed_retry_exhausted' ? 'recovery.failed_retry_exhausted' : 'recovery.failed',
        item,
        {
          status: terminalState,
          reason: error.message,
          error: error.message
        }
      );

      return 'failed';
    }
  }

  private async getRecoveryWorkBacklog(tenantId: string): Promise<{ backlogDepth: number; oldestItemAgeMs: number | null }> {
    const [pendingCount, oldestPending] = await Promise.all([
      supabaseAdmin
        .from('recovery_work_items')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'pending'),
      supabaseAdmin
        .from('recovery_work_items')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    ]);

    const oldestCreatedAt = oldestPending.data?.created_at as string | undefined;
    return {
      backlogDepth: pendingCount.count || 0,
      oldestItemAgeMs: oldestCreatedAt ? Math.max(0, Date.now() - new Date(oldestCreatedAt).getTime()) : null
    };
  }

  private async enqueueMissingRecoveryWorkItemsForTenant(tenantId: string): Promise<number> {
    const cursor = await workerContinuationService.getCursor(`${this.workerName}-backstop`, tenantId);
    let query = createTenantScopedQueryById(tenantId, 'dispute_cases')
      .select('id, seller_id, tenant_id, recovery_status, status')
      .eq('status', 'approved')
      .or('recovery_status.eq.pending,recovery_status.eq.detecting,recovery_status.is.null,recovery_status.eq.failed')
      .order('id', { ascending: true })
      .limit(RecoveriesWorker.BATCH_SIZE);

    if (cursor) {
      query = query.gt('id', cursor);
    }

    let { data: approvedCases, error } = await query;
    if ((!approvedCases || approvedCases.length === 0) && cursor) {
      const wrapped = await createTenantScopedQueryById(tenantId, 'dispute_cases')
        .select('id, seller_id, tenant_id, recovery_status, status')
        .eq('status', 'approved')
        .or('recovery_status.eq.pending,recovery_status.eq.detecting,recovery_status.is.null,recovery_status.eq.failed')
        .order('id', { ascending: true })
        .limit(RecoveriesWorker.BATCH_SIZE);
      approvedCases = wrapped.data as any;
      error = wrapped.error as any;
    }

    if (error || !approvedCases || approvedCases.length === 0) {
      await workerContinuationService.clearCursor(`${this.workerName}-backstop`, tenantId);
      return 0;
    }

    const tenantSlug = await resolveTenantSlug(tenantId);
    let created = 0;

    for (const disputeCase of approvedCases) {
      const result = await financialWorkItemService.enqueueRecoveryWork({
        tenantId,
        tenantSlug,
        userId: disputeCase.seller_id,
        disputeCaseId: disputeCase.id,
        sourceEventType: 'recoveries.backstop_sweep',
        sourceEventId: `backstop:${tenantId}:${disputeCase.id}`,
        payload: {
          dispute_case_id: disputeCase.id,
          sweep: true
        }
      });
      if (result.created) {
        created++;
      }
    }

    await workerContinuationService.setCursor(
      `${this.workerName}-backstop`,
      tenantId,
      approvedCases[approvedCases.length - 1]?.id || null,
      { enqueued: created }
    );

    return created;
  }

  /**
   * Log lifecycle event
   */
  private async logLifecycleEvent(
    disputeId: string,
    userId: string,
    event: { eventType: string; eventData: any }
  ): Promise<void> {
    try {
      // Get recovery ID if exists
      const { data: recovery } = await supabaseAdmin
        .from('recoveries')
        .select('id')
        .eq('dispute_id', disputeId)
        .limit(1)
        .single();

      await supabaseAdmin
        .from('recovery_lifecycle_logs')
        .insert({
          recovery_id: recovery?.id || null,
          dispute_id: disputeId,
          user_id: userId,
          event_type: event.eventType,
          event_data: event.eventData
        });

      logger.debug('📝 [RECOVERIES] Lifecycle event logged', {
        disputeId,
        eventType: event.eventType
      });

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to log lifecycle event', {
        disputeId,
        error: error.message
      });
    }
  }
}

// Export singleton instance
const recoveriesWorker = new RecoveriesWorker();
export default recoveriesWorker;

