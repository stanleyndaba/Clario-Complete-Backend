/**
 * Scheduler Service
 * Handles scheduled auto-ingestion of evidence documents
 * Uses node-cron for cron job scheduling
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, convertUserIdToUuid } from '../database/supabaseClient';
import { unifiedIngestionService } from './unifiedIngestionService';

interface ScheduledUser {
    userId: string;
    tenantId: string;
    schedule: string;
    autoCollect: boolean;
    lastRun?: Date;
}

class SchedulerService {
    private isRunning: boolean = false;
    private hourlyJob: cron.ScheduledTask | null = null;
    private dailyJobs: Map<string, cron.ScheduledTask> = new Map();
    private currentlyIngesting: Set<string> = new Set();

    // All supported daily schedules
    private readonly scheduleConfigs = [
        { schedule: 'daily_0200', hour: 2, label: '02:00 UTC' },
        { schedule: 'daily_0600', hour: 6, label: '06:00 UTC' },
        { schedule: 'daily_1000', hour: 10, label: '10:00 UTC' },
        { schedule: 'daily_1400', hour: 14, label: '14:00 UTC' },
        { schedule: 'daily_1800', hour: 18, label: '18:00 UTC' },
        { schedule: 'daily_2200', hour: 22, label: '22:00 UTC' },
    ];

    /**
     * Initialize the scheduler service
     * Sets up cron jobs for hourly and daily ingestion
     */
    async initialize(): Promise<void> {
        if (this.isRunning) {
            logger.info('[SCHEDULER] Already running');
            return;
        }

        logger.info('[SCHEDULER] Initializing scheduled ingestion service');

        // Hourly job - runs at minute 0 of every hour
        this.hourlyJob = cron.schedule('0 * * * *', async () => {
            logger.info('[SCHEDULER] Running hourly ingestion job');
            await this.runScheduledIngestion('hourly');
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        // Set up daily jobs for all time slots
        for (const config of this.scheduleConfigs) {
            const cronExpression = `0 ${config.hour} * * *`;
            const job = cron.schedule(cronExpression, async () => {
                logger.info(`[SCHEDULER] Running daily ingestion job (${config.label})`);
                await this.runScheduledIngestion(config.schedule);
            }, {
                scheduled: true,
                timezone: 'UTC'
            });
            this.dailyJobs.set(config.schedule, job);
        }

        this.isRunning = true;
        logger.info('[SCHEDULER] Scheduled ingestion service initialized', {
            hourlyJob: 'Every hour at :00',
            dailyJobs: this.scheduleConfigs.map(c => c.label).join(', ')
        });

        // Run an initial check on startup (after 30 seconds to let server settle)
        setTimeout(async () => {
            logger.info('[SCHEDULER] Running startup ingestion check');
            await this.runScheduledIngestion('all');
        }, 30000);
    }

    /**
     * Stop the scheduler service
     */
    stop(): void {
        if (this.hourlyJob) {
            this.hourlyJob.stop();
            this.hourlyJob = null;
        }
        for (const [, job] of this.dailyJobs) {
            job.stop();
        }
        this.dailyJobs.clear();
        this.isRunning = false;
        logger.info('[SCHEDULER] Scheduler service stopped');
    }

    /**
     * Run scheduled ingestion for users with matching schedule
     */
    private async runScheduledIngestion(scheduleType: string): Promise<void> {
        try {
            // Find all users with auto-collect enabled
            const users = await this.getScheduledUsers(scheduleType);

            logger.info(`[SCHEDULER] Found ${users.length} users for ${scheduleType} ingestion`, {
                userCount: users.length,
                scheduleType
            });

            if (users.length === 0) {
                return;
            }

            // Process each user's ingestion
            for (const user of users) {
                await this.ingestForUser(user);
            }

            logger.info(`[SCHEDULER] Completed ${scheduleType} ingestion run`, {
                usersProcessed: users.length
            });

        } catch (error: any) {
            logger.error('[SCHEDULER] Error running scheduled ingestion', {
                error: error?.message || String(error),
                scheduleType
            });
        }
    }

    /**
     * Get users who have auto-collect enabled with matching schedule
     */
    private async getScheduledUsers(scheduleType: string): Promise<ScheduledUser[]> {
        try {
            // Query evidence_sources for users with auto-collect enabled
            let query = supabase
                .from('evidence_sources')
                .select('tenant_id, user_id, seller_id, metadata, last_ingested_at')
                .eq('status', 'connected');

            const { data: sources, error } = await query;

            if (error) {
                logger.error('[SCHEDULER] Error fetching scheduled users', { error });
                return [];
            }

            if (!sources || sources.length === 0) {
                return [];
            }

            // Filter users based on their auto-collect and schedule settings
            const users: ScheduledUser[] = [];
            const seenUserIds = new Set<string>();

            for (const source of sources) {
                const sourceUserId = source.user_id || source.seller_id;
                if (!source.tenant_id || typeof source.tenant_id !== 'string' || source.tenant_id.trim() === '') {
                    logger.warn('[SCHEDULER] Skipping evidence source with missing tenant_id', {
                        provider: source.metadata?.provider
                    });
                    continue;
                }

                if (!sourceUserId || typeof sourceUserId !== 'string' || sourceUserId.trim() === '') {
                    logger.warn('[SCHEDULER] Skipping evidence source with invalid user_id', {
                        userId: sourceUserId
                    });
                    continue;
                }

                const scopeKey = `${source.tenant_id}:${sourceUserId}`;
                if (seenUserIds.has(scopeKey)) {
                    continue; // Skip duplicate user entries
                }

                const metadata = source.metadata || {};
                const autoCollect = metadata.autoCollect !== false; // Default true
                const userSchedule = metadata.schedule || 'daily_0200';

                // Skip if auto-collect is disabled
                if (!autoCollect) {
                    continue;
                }

                // Match schedule type
                if (scheduleType !== 'all' && userSchedule !== scheduleType) {
                    continue;
                }

                seenUserIds.add(scopeKey);
                users.push({
                    userId: sourceUserId,
                    tenantId: source.tenant_id,
                    schedule: userSchedule,
                    autoCollect: true,
                    lastRun: source.last_ingested_at ? new Date(source.last_ingested_at) : undefined
                });
            }

            return users;

        } catch (error: any) {
            logger.error('❌ [SCHEDULER] Error getting scheduled users', {
                error: error?.message || String(error)
            });
            return [];
        }
    }

    /**
     * Run ingestion for a specific user
     */
    private async ingestForUser(user: ScheduledUser): Promise<void> {
        // Prevent concurrent ingestion for same user
        if (this.currentlyIngesting.has(user.userId)) {
            logger.info('[SCHEDULER] Skipping - ingestion already in progress for user', {
                userId: user.userId
            });
            return;
        }

        this.currentlyIngesting.add(user.userId);

        try {
            logger.info('[SCHEDULER] Starting scheduled ingestion for user', {
                userId: user.userId,
                tenantId: user.tenantId,
                schedule: user.schedule,
                lastRun: user.lastRun?.toISOString()
            });
            const result = await unifiedIngestionService.ingestFromAllSources(user.userId, {
                maxResults: 50,
                autoParse: true
            }, user.tenantId);

            logger.info('[SCHEDULER] Completed scheduled ingestion for user', {
                userId: user.userId,
                tenantId: user.tenantId,
                documentsIngested: result.totalDocumentsIngested,
                itemsProcessed: result.totalItemsProcessed,
                sourcesResolved: result.sourcesResolved,
                errors: result.errors.length
            });

            // Send SSE notification if any documents were ingested
            if (result.totalDocumentsIngested > 0) {
                try {
                    const sseHub = (await import('../utils/sseHub')).default;
                    sseHub.sendEvent(user.userId, 'scheduled_ingestion_complete', {
                        documentsIngested: result.totalDocumentsIngested,
                        itemsProcessed: result.totalItemsProcessed,
                        sourcesResolved: result.sourcesResolved,
                        timestamp: new Date().toISOString()
                    });
                } catch (sseError) {
                    // SSE notification is optional
                }
            }

        } catch (error: any) {
            logger.error('[SCHEDULER] Error during scheduled ingestion for user', {
                userId: user.userId,
                error: error?.message || String(error)
            });
        } finally {
            this.currentlyIngesting.delete(user.userId);
        }
    }

    /**
     * Manually trigger ingestion for a user (called from API)
     */
    async triggerManualIngestion(userId: string): Promise<{ success: boolean; message: string }> {
        if (this.currentlyIngesting.has(userId)) {
            return {
                success: false,
                message: 'Ingestion already in progress for this user'
            };
        }

        const safeUserId = convertUserIdToUuid(userId);
        const { data: sourceRow } = await supabase
            .from('evidence_sources')
            .select('tenant_id')
            .or(`user_id.eq.${safeUserId},seller_id.eq.${safeUserId},seller_id.eq.${userId}`)
            .eq('status', 'connected')
            .not('tenant_id', 'is', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!sourceRow?.tenant_id) {
            return {
                success: false,
                message: 'No tenant-bound evidence source found for manual ingestion'
            };
        }

        await this.ingestForUser({
            userId,
            tenantId: sourceRow.tenant_id,
            schedule: 'manual',
            autoCollect: true
        });

        return {
            success: true,
            message: 'Manual ingestion triggered'
        };
    }

    /**
     * Get scheduler status
     */
    getStatus(): { running: boolean; hourlyJob: boolean; dailyJobs: string[]; currentlyIngesting: string[] } {
        return {
            running: this.isRunning,
            hourlyJob: this.hourlyJob !== null,
            dailyJobs: Array.from(this.dailyJobs.keys()),
            currentlyIngesting: Array.from(this.currentlyIngesting)
        };
    }
}

export const schedulerService = new SchedulerService();
