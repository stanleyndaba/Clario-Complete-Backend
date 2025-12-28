/**
 * Scheduled Sync Job - Agent 2: The Radar Always On
 * 
 * This cron job automatically syncs all active users' Amazon data
 * in the background at regular intervals (default: every 6 hours).
 * 
 * The manual sync page continues to work for users who want to
 * view logs or trigger immediate syncs.
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import agent2DataSyncService from '../services/agent2DataSyncService';

// Default sync interval (every 1 hour)
const SYNC_INTERVAL_HOURS = parseInt(process.env.AUTO_SYNC_INTERVAL_HOURS || '1', 10);
// Minimum hours since last sync before triggering auto-sync
const MIN_HOURS_BETWEEN_SYNCS = parseInt(process.env.MIN_HOURS_BETWEEN_SYNCS || '1', 10);

interface UserSyncInfo {
    userId: string;
    lastSyncAt: Date | null;
    hasActiveIntegration: boolean;
}

class ScheduledSyncJob {
    private isRunning = false;
    private cronTask: cron.ScheduledTask | null = null;

    /**
     * Start the scheduled sync cron job
     */
    start(): void {
        if (this.cronTask) {
            logger.warn('⏰ [SCHEDULED SYNC] Cron job already running');
            return;
        }

        // Run every SYNC_INTERVAL_HOURS hours
        // Cron format: "0 */6 * * *" = every 6 hours at minute 0
        const cronExpression = `0 */${SYNC_INTERVAL_HOURS} * * *`;

        logger.info(`⏰ [SCHEDULED SYNC] Starting cron job with interval: every ${SYNC_INTERVAL_HOURS} hours`);
        logger.info(`⏰ [SCHEDULED SYNC] Cron expression: ${cronExpression}`);

        this.cronTask = cron.schedule(cronExpression, async () => {
            await this.runScheduledSync();
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        logger.info('✅ [SCHEDULED SYNC] Cron job started successfully');

        // Also run initial check on startup (after a delay to let server fully start)
        setTimeout(() => {
            logger.info('⏰ [SCHEDULED SYNC] Running initial sync check on startup...');
            this.runScheduledSync().catch(err => {
                logger.error('❌ [SCHEDULED SYNC] Initial sync check failed:', err);
            });
        }, 30000); // 30 second delay after startup
    }

    /**
     * Stop the scheduled sync cron job
     */
    stop(): void {
        if (this.cronTask) {
            this.cronTask.stop();
            this.cronTask = null;
            logger.info('⏹️ [SCHEDULED SYNC] Cron job stopped');
        }
    }

    /**
     * Run the scheduled sync for all eligible users
     */
    async runScheduledSync(): Promise<void> {
        if (this.isRunning) {
            logger.warn('⚠️ [SCHEDULED SYNC] Sync already in progress, skipping...');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();

        try {
            logger.info('🔄 [SCHEDULED SYNC] Starting scheduled sync for all users...');

            // Get all users eligible for auto-sync
            const eligibleUsers = await this.getEligibleUsersForSync();

            if (eligibleUsers.length === 0) {
                logger.info('ℹ️ [SCHEDULED SYNC] No users eligible for sync at this time');
                return;
            }

            logger.info(`📋 [SCHEDULED SYNC] Found ${eligibleUsers.length} user(s) eligible for sync`);

            // Sync each user sequentially to avoid overwhelming the system
            let successCount = 0;
            let failCount = 0;

            for (const user of eligibleUsers) {
                try {
                    await this.syncUserInBackground(user.userId);
                    successCount++;

                    // Small delay between users to prevent rate limiting
                    await this.delay(2000);
                } catch (error: any) {
                    failCount++;
                    logger.error(`❌ [SCHEDULED SYNC] Failed to sync user ${user.userId}:`, error.message);
                }
            }

            const durationMs = Date.now() - startTime;
            logger.info(`✅ [SCHEDULED SYNC] Completed: ${successCount} success, ${failCount} failed, took ${Math.round(durationMs / 1000)}s`);

        } catch (error: any) {
            logger.error('❌ [SCHEDULED SYNC] Scheduled sync failed:', error.message);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Get all users eligible for automatic sync
     */
    private async getEligibleUsersForSync(): Promise<UserSyncInfo[]> {
        const db = supabaseAdmin || supabase;
        if (!db) {
            logger.error('❌ [SCHEDULED SYNC] No database connection available');
            return [];
        }

        try {
            // Get all users with active Amazon integrations
            const { data: integrations, error: intError } = await db
                .from('integrations')
                .select('user_id, provider, status, last_sync_at')
                .eq('provider', 'amazon')
                .eq('status', 'connected');

            if (intError) {
                logger.error('❌ [SCHEDULED SYNC] Error fetching integrations:', intError.message);
                return [];
            }

            if (!integrations || integrations.length === 0) {
                return [];
            }

            // Filter users who haven't synced recently
            const cutoffTime = new Date(Date.now() - MIN_HOURS_BETWEEN_SYNCS * 60 * 60 * 1000);

            const eligibleUsers: UserSyncInfo[] = [];

            for (const integration of integrations) {
                const lastSyncAt = integration.last_sync_at ? new Date(integration.last_sync_at) : null;

                // Eligible if never synced OR last sync was more than MIN_HOURS ago
                if (!lastSyncAt || lastSyncAt < cutoffTime) {
                    eligibleUsers.push({
                        userId: integration.user_id,
                        lastSyncAt,
                        hasActiveIntegration: true
                    });
                }
            }

            // Also check for users with connected Amazon tokens but no integration record
            // (for demo users or testing)
            if (process.env.AMAZON_SANDBOX_MODE === 'true' || process.env.USE_MOCK_DATA === 'true') {
                const { data: profiles } = await db
                    .from('profiles')
                    .select('id')
                    .limit(5);

                if (profiles) {
                    for (const profile of profiles) {
                        // Only add if not already in list
                        if (!eligibleUsers.find(u => u.userId === profile.id)) {
                            eligibleUsers.push({
                                userId: profile.id,
                                lastSyncAt: null,
                                hasActiveIntegration: true
                            });
                        }
                    }
                }
            }

            return eligibleUsers;
        } catch (error: any) {
            logger.error('❌ [SCHEDULED SYNC] Error getting eligible users:', error.message);
            return [];
        }
    }

    /**
     * Sync a single user in the background (no SSE logs)
     */
    private async syncUserInBackground(userId: string): Promise<void> {
        logger.info(`🔄 [SCHEDULED SYNC] Starting background sync for user: ${userId}`);

        try {
            // Create a sync ID for tracking
            const syncId = `auto_sync_${userId}_${Date.now()}`;

            // Use Agent 2 service for the actual sync
            // syncUserData handles all data fetching and detection
            const result = await agent2DataSyncService.syncUserData(
                userId,
                undefined, // startDate - use defaults
                undefined, // endDate - use defaults
                syncId     // parentSyncId for tracking
            );

            // Update last_sync_at in integrations table
            const db = supabaseAdmin || supabase;
            if (db) {
                await db
                    .from('integrations')
                    .update({ last_sync_at: new Date().toISOString() })
                    .eq('user_id', userId)
                    .eq('provider', 'amazon');
            }

            logger.info(`✅ [SCHEDULED SYNC] User ${userId} synced successfully`, {
                syncId: result.syncId,
                claimsDetected: result.detectionResult?.totalDetected || result.summary?.claimsDetected || 0,
                success: result.success
            });

        } catch (error: any) {
            logger.error(`❌ [SCHEDULED SYNC] User ${userId} sync failed:`, error.message);
            throw error;
        }
    }

    /**
     * Force run sync for a specific user (called from admin endpoints)
     */
    async forceSyncUser(userId: string): Promise<{ success: boolean; message: string }> {
        try {
            await this.syncUserInBackground(userId);
            return { success: true, message: `Background sync started for user ${userId}` };
        } catch (error: any) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Get status of the scheduled sync job
     */
    getStatus(): { running: boolean; nextRun: string | null; interval: number } {
        return {
            running: this.isRunning,
            nextRun: this.cronTask ? 'Next scheduled run based on cron' : null,
            interval: SYNC_INTERVAL_HOURS
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export singleton instance
const scheduledSyncJob = new ScheduledSyncJob();
export default scheduledSyncJob;
