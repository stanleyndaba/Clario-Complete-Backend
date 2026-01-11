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
import recoveriesService, { ReconciliationResult } from '../services/recoveriesService';

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
  private schedule: string = '*/10 * * * *'; // Every 10 minutes
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  /**
   * Start the worker
   */
  start(): void {
    if (this.cronJob) {
      logger.warn('⚠️ [RECOVERIES] Worker already started');
      return;
    }

    logger.info('🚀 [RECOVERIES] Starting Recoveries Worker', {
      schedule: this.schedule
    });

    // Schedule recovery job (every 10 minutes)
    this.cronJob = cron.schedule(this.schedule, async () => {
      if (this.isRunning) {
        logger.debug('⏸️ [RECOVERIES] Previous run still in progress, skipping');
        return;
      }

      this.isRunning = true;
      try {
        await this.runRecoveriesForAllTenants();
      } catch (error: any) {
        logger.error('❌ [RECOVERIES] Error in recovery job', { error: error.message });
      } finally {
        this.isRunning = false;
      }
    });

    logger.info('✅ [RECOVERIES] Worker started successfully');
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
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
      logger.info('💰 [RECOVERIES] Starting recovery run for all tenants');

      // Get all active tenants
      const { data: tenants, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id, name, status')
        .in('status', ['active', 'trialing'])
        .is('deleted_at', null);

      if (tenantError) {
        logger.error('❌ [RECOVERIES] Failed to get active tenants', { error: tenantError.message });
        stats.errors.push(`Failed to get tenants: ${tenantError.message}`);
        return stats;
      }

      if (!tenants || tenants.length === 0) {
        logger.debug('ℹ️ [RECOVERIES] No active tenants found');
        return stats;
      }

      logger.info(`📋 [RECOVERIES] Processing ${tenants.length} active tenants`);

      // Process each tenant in isolation
      for (const tenant of tenants) {
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
      return stats;

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Fatal error in recovery run', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
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

    const tenantQuery = createTenantScopedQueryById(tenantId, 'dispute_cases');

    // Get approved cases that need recovery detection for this tenant
    const { data: approvedCases, error } = await tenantQuery
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
      .in('recovery_status', ['pending', null])
      .limit(50);

    if (error) {
      logger.error('❌ [RECOVERIES] Failed to get approved cases', { tenantId, error: error.message });
      stats.errors.push(`Failed to get cases: ${error.message}`);
      return stats;
    }

    if (!approvedCases || approvedCases.length === 0) {
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
            new Date()
          ),
          3,
          2000
        );

        stats.payoutsDetected += payouts.length;

        logger.info(`🔍 [RECOVERIES] Detected ${payouts.length} payouts for user ${userId}`);

        // Process each case for this user
        for (const disputeCase of userCases) {
          try {
            stats.processed++;

            // Try to match payout to this case
            let matched = false;
            for (const payout of payouts) {
              const match = await recoveriesService.matchPayoutToClaim(payout, userId);

              if (match && match.disputeId === disputeCase.id) {
                matched = true;
                stats.matched++;

                // Reconcile the payout
                const result = await recoveriesService.reconcilePayout(match, userId);

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

                break; // Found match, move to next case
              }
            }

            if (!matched) {
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

    logger.info('✅ [RECOVERIES] Tenant recovery run completed', { tenantId, stats });
    return stats;
  }

  /**
   * Process recovery for a specific case (called by Agent 7)
   */
  async processRecoveryForCase(disputeId: string, userId: string): Promise<ReconciliationResult | null> {
    try {
      logger.info('🔄 [RECOVERIES] Processing recovery for specific case', {
        disputeId,
        userId
      });

      return await recoveriesService.processRecoveryForCase(disputeId, userId);

    } catch (error: any) {
      logger.error('❌ [RECOVERIES] Failed to process recovery for case', {
        disputeId,
        userId,
        error: error.message
      });
      return null;
    }
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

