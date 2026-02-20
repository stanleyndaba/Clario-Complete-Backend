/**
 * Weekly Summary Worker
 * Generates a weekly digest notification for each active user
 * Runs every Monday at 8am UTC
 */

import logger from '../utils/logger';
import { supabaseAdmin, supabase } from '../database/supabaseClient';
import notificationHelper from '../services/notificationHelper';
import { NotificationType, NotificationPriority, NotificationChannel } from '../notifications/models/notification';

interface WeeklySummaryData {
    claimsDetected: number;
    casesFiled: number;
    fundsRecovered: number;
    pendingClaims: number;
    totalRecoverableValue: number;
}

class WeeklySummaryWorker {
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private readonly INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    /**
     * Start the weekly summary worker
     * Runs immediately at startup to check if a summary is due, then weekly
     */
    start(): void {
        logger.info('[WEEKLY SUMMARY] Worker started');

        // Check every hour if it's time to send (Monday 8am UTC)
        this.intervalId = setInterval(() => {
            const now = new Date();
            // Monday = 1, 8am UTC
            if (now.getUTCDay() === 1 && now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
                this.runWeeklySummary().catch(err => {
                    logger.error('[WEEKLY SUMMARY] Failed to run weekly summary', { error: err.message });
                });
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }

    /**
     * Stop the worker
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        logger.info('[WEEKLY SUMMARY] Worker stopped');
    }

    /**
     * Run the weekly summary for all active users
     */
    async runWeeklySummary(): Promise<{ usersNotified: number; errors: string[] }> {
        logger.info('[WEEKLY SUMMARY] Starting weekly summary generation');
        const errors: string[] = [];
        let usersNotified = 0;

        const dbClient = supabaseAdmin || supabase;

        try {
            // Get all active users (users who have had any activity in the last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const { data: activeUsers, error: usersError } = await dbClient
                .from('profiles')
                .select('id')
                .gte('updated_at', thirtyDaysAgo.toISOString());

            if (usersError) {
                // Fallback: try to get users from sync_progress
                logger.warn('[WEEKLY SUMMARY] Could not query profiles, trying sync_progress', { error: usersError.message });
                const { data: syncUsers, error: syncError } = await dbClient
                    .from('sync_progress')
                    .select('user_id')
                    .gte('created_at', thirtyDaysAgo.toISOString());

                if (syncError || !syncUsers || syncUsers.length === 0) {
                    logger.info('[WEEKLY SUMMARY] No active users found');
                    return { usersNotified: 0, errors: [] };
                }

                // Deduplicate user IDs
                const seenIds = new Set<string>();
                const uniqueUserIds: string[] = [];
                for (const s of syncUsers) {
                    const uid = String(s.user_id);
                    if (!seenIds.has(uid)) { seenIds.add(uid); uniqueUserIds.push(uid); }
                }
                for (const userId of uniqueUserIds) {
                    try {
                        await this.generateSummaryForUser(userId);
                        usersNotified++;
                    } catch (err: any) {
                        errors.push(`User ${userId}: ${err.message}`);
                        logger.error('[WEEKLY SUMMARY] Failed for user', { userId, error: err.message });
                    }
                }
            } else if (activeUsers && activeUsers.length > 0) {
                for (const user of activeUsers) {
                    try {
                        await this.generateSummaryForUser(user.id);
                        usersNotified++;
                    } catch (err: any) {
                        errors.push(`User ${user.id}: ${err.message}`);
                        logger.error('[WEEKLY SUMMARY] Failed for user', { userId: user.id, error: err.message });
                    }
                }
            } else {
                logger.info('[WEEKLY SUMMARY] No active users found');
            }
        } catch (error: any) {
            logger.error('[WEEKLY SUMMARY] Fatal error', { error: error.message });
            errors.push(`Fatal: ${error.message}`);
        }

        logger.info('[WEEKLY SUMMARY] Completed', { usersNotified, errorCount: errors.length });
        return { usersNotified, errors };
    }

    /**
     * Generate and send weekly summary for a single user
     */
    private async generateSummaryForUser(userId: string): Promise<void> {
        const dbClient = supabaseAdmin || supabase;
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const since = sevenDaysAgo.toISOString();

        // Gather stats from the last 7 days
        const summary: WeeklySummaryData = {
            claimsDetected: 0,
            casesFiled: 0,
            fundsRecovered: 0,
            pendingClaims: 0,
            totalRecoverableValue: 0
        };

        // 1. Claims detected this week
        try {
            const { data: detections, error } = await dbClient
                .from('detection_results')
                .select('amount')
                .eq('seller_id', userId)
                .gte('created_at', since);

            if (!error && detections) {
                summary.claimsDetected = detections.length;
                summary.totalRecoverableValue = detections.reduce(
                    (sum, d) => sum + (parseFloat(d.amount) || 0), 0
                );
            }
        } catch (err: any) {
            logger.debug('[WEEKLY SUMMARY] Could not query detections', { userId, error: err.message });
        }

        // 2. Cases filed this week
        try {
            const { data: cases, error } = await dbClient
                .from('dispute_cases')
                .select('id')
                .eq('seller_id', userId)
                .gte('created_at', since);

            if (!error && cases) {
                summary.casesFiled = cases.length;
            }
        } catch (err: any) {
            logger.debug('[WEEKLY SUMMARY] Could not query cases', { userId, error: err.message });
        }

        // 3. Funds recovered this week
        try {
            const { data: recoveries, error } = await dbClient
                .from('recoveries')
                .select('amount')
                .eq('user_id', userId)
                .gte('created_at', since);

            if (!error && recoveries) {
                summary.fundsRecovered = recoveries.reduce(
                    (sum, r) => sum + (parseFloat(r.amount) || 0), 0
                );
            }
        } catch (err: any) {
            logger.debug('[WEEKLY SUMMARY] Could not query recoveries', { userId, error: err.message });
        }

        // 4. Pending claims count
        try {
            const { data: pending, error } = await dbClient
                .from('dispute_cases')
                .select('id')
                .eq('seller_id', userId)
                .in('status', ['filed', 'pending', 'in_progress']);

            if (!error && pending) {
                summary.pendingClaims = pending.length;
            }
        } catch (err: any) {
            logger.debug('[WEEKLY SUMMARY] Could not query pending claims', { userId, error: err.message });
        }

        // Skip if no activity at all
        if (summary.claimsDetected === 0 && summary.casesFiled === 0 &&
            summary.fundsRecovered === 0 && summary.pendingClaims === 0) {
            logger.debug('[WEEKLY SUMMARY] No activity for user, skipping', { userId });
            return;
        }

        // Build message
        const parts: string[] = ['Here\'s your weekly recovery summary:'];

        if (summary.claimsDetected > 0) {
            const value = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(summary.totalRecoverableValue);
            parts.push(`• ${summary.claimsDetected} new discrepancies detected (${value} recoverable)`);
        }
        if (summary.casesFiled > 0) {
            parts.push(`• ${summary.casesFiled} claim${summary.casesFiled > 1 ? 's' : ''} filed with Amazon`);
        }
        if (summary.fundsRecovered > 0) {
            const recovered = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(summary.fundsRecovered);
            parts.push(`• ${recovered} recovered and deposited`);
        }
        if (summary.pendingClaims > 0) {
            parts.push(`• ${summary.pendingClaims} claim${summary.pendingClaims > 1 ? 's' : ''} still pending review`);
        }

        const message = parts.join(' ');

        // Send the notification
        await notificationHelper.notifyUser(
            userId,
            NotificationType.WEEKLY_SUMMARY,
            'Weekly Recovery Report',
            message,
            NotificationPriority.NORMAL,
            NotificationChannel.IN_APP,
            {
                ...summary,
                periodStart: since,
                periodEnd: new Date().toISOString()
            }
        );

        logger.info('[WEEKLY SUMMARY] Summary sent to user', { userId, summary });
    }
}

const weeklySummaryWorker = new WeeklySummaryWorker();
export default weeklySummaryWorker;
