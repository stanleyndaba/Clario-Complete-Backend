/**
 * Scheduler Service
 * Handles scheduled auto-ingestion of evidence documents
 * Uses node-cron for cron job scheduling
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { gmailIngestionService } from './gmailIngestionService';

interface ScheduledUser {
    userId: string;
    schedule: string;
    autoCollect: boolean;
    lastRun?: Date;
}

class SchedulerService {
    private isRunning: boolean = false;
    private hourlyJob: cron.ScheduledTask | null = null;
    private dailyJob: cron.ScheduledTask | null = null;
    private currentlyIngesting: Set<string> = new Set();

    /**
     * Initialize the scheduler service
     * Sets up cron jobs for hourly and daily ingestion
     */
    async initialize(): Promise<void> {
        if (this.isRunning) {
            logger.info('⏰ [SCHEDULER] Already running');
            return;
        }

        logger.info('⏰ [SCHEDULER] Initializing scheduled ingestion service');

        // Hourly job - runs at minute 0 of every hour
        this.hourlyJob = cron.schedule('0 * * * *', async () => {
            logger.info('⏰ [SCHEDULER] Running hourly ingestion job');
            await this.runScheduledIngestion('hourly');
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        // Daily job - runs at 02:00 UTC
        this.dailyJob = cron.schedule('0 2 * * *', async () => {
            logger.info('⏰ [SCHEDULER] Running daily ingestion job (02:00 UTC)');
            await this.runScheduledIngestion('daily_0200');
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        this.isRunning = true;
        logger.info('✅ [SCHEDULER] Scheduled ingestion service initialized', {
            hourlyJob: 'Every hour at :00',
            dailyJob: 'Daily at 02:00 UTC'
        });

        // Run an initial check on startup (after 30 seconds to let server settle)
        setTimeout(async () => {
            logger.info('⏰ [SCHEDULER] Running startup ingestion check');
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
        if (this.dailyJob) {
            this.dailyJob.stop();
            this.dailyJob = null;
        }
        this.isRunning = false;
        logger.info('⏹️ [SCHEDULER] Scheduler service stopped');
    }

    /**
     * Run scheduled ingestion for users with matching schedule
     */
    private async runScheduledIngestion(scheduleType: 'hourly' | 'daily_0200' | 'all'): Promise<void> {
        try {
            // Find all users with auto-collect enabled
            const users = await this.getScheduledUsers(scheduleType);

            logger.info(`⏰ [SCHEDULER] Found ${users.length} users for ${scheduleType} ingestion`, {
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

            logger.info(`✅ [SCHEDULER] Completed ${scheduleType} ingestion run`, {
                usersProcessed: users.length
            });

        } catch (error: any) {
            logger.error('❌ [SCHEDULER] Error running scheduled ingestion', {
                error: error?.message || String(error),
                scheduleType
            });
        }
    }

    /**
     * Get users who have auto-collect enabled with matching schedule
     */
    private async getScheduledUsers(scheduleType: 'hourly' | 'daily_0200' | 'all'): Promise<ScheduledUser[]> {
        try {
            // Query evidence_sources for users with auto-collect enabled
            let query = supabase
                .from('evidence_sources')
                .select('user_id, metadata, last_sync_at')
                .eq('status', 'connected');

            const { data: sources, error } = await query;

            if (error) {
                logger.error('❌ [SCHEDULER] Error fetching scheduled users', { error });
                return [];
            }

            if (!sources || sources.length === 0) {
                return [];
            }

            // Filter users based on their auto-collect and schedule settings
            const users: ScheduledUser[] = [];
            const seenUserIds = new Set<string>();

            for (const source of sources) {
                if (seenUserIds.has(source.user_id)) {
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

                seenUserIds.add(source.user_id);
                users.push({
                    userId: source.user_id,
                    schedule: userSchedule,
                    autoCollect: true,
                    lastRun: source.last_sync_at ? new Date(source.last_sync_at) : undefined
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
            logger.info('⏭️ [SCHEDULER] Skipping - ingestion already in progress for user', {
                userId: user.userId
            });
            return;
        }

        this.currentlyIngesting.add(user.userId);

        try {
            logger.info('🔄 [SCHEDULER] Starting scheduled ingestion for user', {
                userId: user.userId,
                schedule: user.schedule,
                lastRun: user.lastRun?.toISOString()
            });

            // Load user's filters from metadata
            const { data: sourceData } = await supabase
                .from('evidence_sources')
                .select('metadata')
                .eq('user_id', user.userId)
                .maybeSingle();

            const filters = sourceData?.metadata || {};

            // Run Gmail ingestion with user's filters
            // Note: skipDuplicates and skipExisting are handled in storeEvidenceDocument
            const result = await gmailIngestionService.ingestEvidenceFromGmail(user.userId, {
                maxResults: 50,
                autoParse: true,
                filters: filters
            });

            // Update last_sync_at
            await supabase
                .from('evidence_sources')
                .update({
                    last_sync_at: new Date().toISOString()
                })
                .eq('user_id', user.userId);

            logger.info('✅ [SCHEDULER] Completed scheduled ingestion for user', {
                userId: user.userId,
                documentsIngested: result.documentsIngested,
                emailsProcessed: result.emailsProcessed,
                errors: result.errors.length
            });

            // Send SSE notification if any documents were ingested
            if (result.documentsIngested > 0) {
                try {
                    const sseHub = (await import('../utils/sseHub')).default;
                    sseHub.sendEvent(user.userId, 'scheduled_ingestion_complete', {
                        documentsIngested: result.documentsIngested,
                        emailsProcessed: result.emailsProcessed,
                        timestamp: new Date().toISOString()
                    });
                } catch (sseError) {
                    // SSE notification is optional
                }
            }

        } catch (error: any) {
            logger.error('❌ [SCHEDULER] Error during scheduled ingestion for user', {
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

        await this.ingestForUser({
            userId,
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
    getStatus(): { running: boolean; hourlyJob: boolean; dailyJob: boolean; currentlyIngesting: string[] } {
        return {
            running: this.isRunning,
            hourlyJob: this.hourlyJob !== null,
            dailyJob: this.dailyJob !== null,
            currentlyIngesting: Array.from(this.currentlyIngesting)
        };
    }
}

export const schedulerService = new SchedulerService();
