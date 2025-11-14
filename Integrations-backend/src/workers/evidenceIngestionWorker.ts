/**
 * Evidence Ingestion Worker
 * Automated background worker for continuous evidence ingestion from all connected sources
 * Runs every 5 minutes, ingests from Gmail, Outlook, Google Drive, and Dropbox
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { unifiedIngestionService } from '../services/unifiedIngestionService';
import { gmailIngestionService } from '../services/gmailIngestionService';
import { outlookIngestionService } from '../services/outlookIngestionService';
import { googleDriveIngestionService } from '../services/googleDriveIngestionService';
import { dropboxIngestionService } from '../services/dropboxIngestionService';
import tokenManager from '../utils/tokenManager';

// Rate limiter: Max 10 requests/second per provider
class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private maxRequests: number = 10;
  private windowMs: number = 1000; // 1 second

  canMakeRequest(provider: string): boolean {
    const now = Date.now();
    const key = provider;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    const timestamps = this.requests.get(key)!;
    
    // Remove old timestamps outside the window
    const recentTimestamps = timestamps.filter(ts => now - ts < this.windowMs);
    this.requests.set(key, recentTimestamps);
    
    if (recentTimestamps.length >= this.maxRequests) {
      return false;
    }
    
    recentTimestamps.push(now);
    return true;
  }

  async waitForRateLimit(provider: string): Promise<void> {
    while (!this.canMakeRequest(provider)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// Retry logic with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
          error: error.message,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Storage bucket helper
class StorageBucketHelper {
  private bucketName = 'evidence-documents';
  private initialized = false;

  async ensureBucketExists(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Use admin client for storage operations (requires service role key)
      const storageClient = supabaseAdmin || supabase;
      
      // Check if bucket exists by trying to list it
      const { data: buckets, error: listError } = await storageClient.storage.listBuckets();
      
      if (listError) {
        logger.warn('⚠️ [STORAGE] Could not list buckets (may need service role key)', {
          error: listError.message
        });
        // Continue anyway - bucket might exist but we can't check
        this.initialized = true;
        return;
      }

      const bucketExists = buckets?.some(b => b.name === this.bucketName);
      
      if (!bucketExists) {
        // Try to create bucket (requires service role key)
        const { data: newBucket, error: createError } = await storageClient.storage.createBucket(
          this.bucketName,
          {
            public: false,
            fileSizeLimit: 52428800, // 50MB
            allowedMimeTypes: [
              'application/pdf',
              'image/jpeg',
              'image/png',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel',
              'text/csv'
            ]
          }
        );

        if (createError) {
          logger.warn('⚠️ [STORAGE] Could not create bucket (may need manual creation)', {
            error: createError.message,
            bucket: this.bucketName,
            note: 'Bucket must be created manually in Supabase dashboard with RLS enabled'
          });
        } else {
          logger.info('✅ [STORAGE] Created evidence-documents bucket', {
            bucket: this.bucketName
          });
        }
      } else {
        logger.info('✅ [STORAGE] evidence-documents bucket exists', {
          bucket: this.bucketName
        });
      }

      this.initialized = true;
    } catch (error: any) {
      logger.warn('⚠️ [STORAGE] Error checking bucket (non-critical)', {
        error: error.message,
        bucket: this.bucketName
      });
      this.initialized = true; // Continue anyway
    }
  }

  async uploadFile(
    userId: string,
    documentId: string,
    filename: string,
    content: Buffer,
    contentType: string
  ): Promise<string | null> {
    try {
      await this.ensureBucketExists();

      const filePath = `${userId}/${documentId}/${filename}`;

      // Use admin client for storage uploads (requires service role key)
      const storageClient = supabaseAdmin || supabase;
      
      const { data, error } = await storageClient.storage
        .from(this.bucketName)
        .upload(filePath, content, {
          contentType,
          upsert: false
        });

      if (error) {
        logger.error('❌ [STORAGE] Failed to upload file', {
          error: error.message,
          documentId,
          filename,
          userId
        });
        return null;
      }

      logger.info('✅ [STORAGE] File uploaded successfully', {
        documentId,
        filename,
        path: filePath,
        size: content.length
      });

      return filePath;
    } catch (error: any) {
      logger.error('❌ [STORAGE] Error uploading file', {
        error: error.message,
        documentId,
        filename,
        userId
      });
      return null;
    }
  }
}

export interface IngestionStats {
  ingested: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export class EvidenceIngestionWorker {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private isRunning: boolean = false;
  private rateLimiter: RateLimiter = new RateLimiter();
  private storageHelper: StorageBucketHelper = new StorageBucketHelper();
  private schedule: string = '*/5 * * * *'; // Every 5 minutes

  constructor() {
    // Initialize storage bucket on startup
    this.storageHelper.ensureBucketExists().catch((error) => {
      logger.warn('Failed to initialize storage bucket (non-critical)', { error: error.message });
    });
  }

  /**
   * Start the evidence ingestion worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Evidence ingestion worker is already running');
      return;
    }

    logger.info('🚀 [EVIDENCE WORKER] Starting evidence ingestion worker', {
      schedule: this.schedule
    });

    this.isRunning = true;

    // Schedule main ingestion job
    const task = cron.schedule(this.schedule, async () => {
      await this.runEvidenceIngestionForAllTenants();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.jobs.set('evidence-ingestion', task);

    logger.info('✅ [EVIDENCE WORKER] Evidence ingestion worker started successfully', {
      schedule: this.schedule
    });
  }

  /**
   * Stop the evidence ingestion worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Evidence ingestion worker is not running');
      return;
    }

    logger.info('🛑 [EVIDENCE WORKER] Stopping evidence ingestion worker');

    for (const [name, task] of this.jobs.entries()) {
      task.stop();
      logger.info(`Stopped evidence ingestion job: ${name}`);
    }

    this.jobs.clear();
    this.isRunning = false;

    logger.info('✅ [EVIDENCE WORKER] Evidence ingestion worker stopped');
  }

  /**
   * Run evidence ingestion for all tenants
   */
  private async runEvidenceIngestionForAllTenants(): Promise<void> {
    const runStartTime = Date.now();
    
    try {
      logger.info('🔍 [EVIDENCE WORKER] Starting scheduled evidence ingestion', {
        timestamp: new Date().toISOString()
      });

      // Get all users with connected evidence sources
      const userIds = await this.getActiveUserIds();

      if (userIds.length === 0) {
        logger.info('ℹ️ [EVIDENCE WORKER] No users with connected evidence sources found');
        return;
      }

      logger.info(`📊 [EVIDENCE WORKER] Processing ${userIds.length} users`, {
        userCount: userIds.length
      });

      // Process each user (with rate limiting)
      const stats: IngestionStats = {
        ingested: 0,
        skipped: 0,
        failed: 0,
        errors: []
      };

      for (let i = 0; i < userIds.length; i++) {
        const userId = userIds[i];
        
        // Stagger processing to avoid rate limits
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds between users
        }

        try {
          const userStats = await this.ingestForUser(userId);
          stats.ingested += userStats.ingested;
          stats.skipped += userStats.skipped;
          stats.failed += userStats.failed;
          stats.errors.push(...userStats.errors);
        } catch (error: any) {
          stats.failed++;
          stats.errors.push(`User ${userId}: ${error.message}`);
          logger.error(`❌ [EVIDENCE WORKER] Failed to ingest for user ${userId}`, {
            error: error.message,
            userId
          });
        }
      }

      const runDuration = Date.now() - runStartTime;

      logger.info('✅ [EVIDENCE WORKER] Scheduled evidence ingestion completed', {
        userCount: userIds.length,
        ingested: stats.ingested,
        skipped: stats.skipped,
        failed: stats.failed,
        errors: stats.errors.length,
        duration: `${runDuration}ms`
      });

    } catch (error: any) {
      logger.error('❌ [EVIDENCE WORKER] Error in scheduled evidence ingestion', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Get list of active user IDs with connected evidence sources
   */
  private async getActiveUserIds(): Promise<string[]> {
    try {
      // Try user_id first, fallback to seller_id if needed
      let { data: sources, error } = await supabase
        .from('evidence_sources')
        .select('user_id, seller_id')
        .eq('status', 'connected')
        .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);

      // If user_id column doesn't exist, try seller_id
      if (error && error.message?.includes('column') && error.message?.includes('user_id')) {
        const retry = await supabase
          .from('evidence_sources')
          .select('seller_id')
          .eq('status', 'connected')
          .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);
        sources = retry.data;
        error = retry.error;
      }

      if (error) {
        logger.error('❌ [EVIDENCE WORKER] Error fetching active user IDs', {
          error: error.message
        });
        return [];
      }

      // Extract unique user IDs (handle both user_id and seller_id)
      const userIds = [...new Set((sources || []).map((s: any) => s.user_id || s.seller_id))];
      
      return userIds.filter((id: any): id is string => typeof id === 'string' && id.length > 0);
    } catch (error: any) {
      logger.error('❌ [EVIDENCE WORKER] Error getting active user IDs', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Ingest evidence for a specific user
   */
  private async ingestForUser(userId: string): Promise<IngestionStats> {
    const stats: IngestionStats = {
      ingested: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    try {
      logger.info(`👤 [EVIDENCE WORKER] Processing user: ${userId}`);

      // Get connected sources for this user (try user_id first, fallback to seller_id)
      let { data: sources, error } = await supabase
        .from('evidence_sources')
        .select('id, provider, last_synced_at, metadata')
        .eq('user_id', userId)
        .eq('status', 'connected')
        .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);

      // If user_id column doesn't exist, try seller_id
      if (error && error.message?.includes('column') && error.message?.includes('user_id')) {
        const retry = await supabase
          .from('evidence_sources')
          .select('id, provider, last_synced_at, metadata')
          .eq('seller_id', userId)
          .eq('status', 'connected')
          .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);
        sources = retry.data;
        error = retry.error;
      }

      if (error || !sources || sources.length === 0) {
        logger.debug(`No connected sources for user ${userId}`);
        return stats;
      }

      logger.info(`📦 [EVIDENCE WORKER] Found ${sources.length} connected sources for user ${userId}`, {
        providers: sources.map(s => s.provider)
      });

      // Process each source
      for (const source of sources) {
        try {
          // Refresh token if needed
          await this.refreshTokenIfNeeded(userId, source.provider);

          // Wait for rate limit
          await this.rateLimiter.waitForRateLimit(source.provider);

          // Ingest from this source with retry
          const sourceStats = await retryWithBackoff(async () => {
            return await this.ingestFromSource(userId, source);
          }, 3, 1000);

          stats.ingested += sourceStats.ingested;
          stats.skipped += sourceStats.skipped;
          stats.failed += sourceStats.failed;
          stats.errors.push(...sourceStats.errors);

          // Update last_synced_at
          await this.updateLastSyncedAt(source.id);

        } catch (error: any) {
          stats.failed++;
          const errorMsg = `[${source.provider}] ${error.message}`;
          stats.errors.push(errorMsg);
          
          await this.logError(userId, source.provider, source.id, error);
          
          logger.error(`❌ [EVIDENCE WORKER] Failed to ingest from ${source.provider} for user ${userId}`, {
            error: error.message,
            provider: source.provider,
            userId
          });
        }
      }

      return stats;
    } catch (error: any) {
      logger.error(`❌ [EVIDENCE WORKER] Error ingesting for user ${userId}`, {
        error: error.message,
        userId
      });
      stats.failed++;
      stats.errors.push(error.message);
      return stats;
    }
  }

  /**
   * Ingest from a specific source
   */
  private async ingestFromSource(
    userId: string,
    source: { id: string; provider: string; last_synced_at?: string; metadata?: any }
  ): Promise<IngestionStats> {
    const stats: IngestionStats = {
      ingested: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    try {
      logger.info(`📥 [EVIDENCE WORKER] Ingesting from ${source.provider} for user ${userId}`);

      // Build query for incremental sync (only fetch new documents)
      const query = source.last_synced_at
        ? `after:${new Date(source.last_synced_at).toISOString().split('T')[0]}`
        : undefined;

      let result: any;

      switch (source.provider) {
        case 'gmail':
          result = await gmailIngestionService.ingestEvidenceFromGmail(userId, {
            query,
            maxResults: 50,
            autoParse: true
          });
          break;

        case 'outlook':
          result = await outlookIngestionService.ingestEvidenceFromOutlook(userId, {
            query,
            maxResults: 50,
            autoParse: true
          });
          break;

        case 'gdrive':
          result = await googleDriveIngestionService.ingestEvidenceFromGoogleDrive(userId, {
            query,
            maxResults: 50,
            autoParse: true,
            folderId: source.metadata?.folderId
          });
          break;

        case 'dropbox':
          result = await dropboxIngestionService.ingestEvidenceFromDropbox(userId, {
            query,
            maxResults: 50,
            autoParse: true,
            folderPath: source.metadata?.folderPath
          });
          break;

        default:
          throw new Error(`Unknown provider: ${source.provider}`);
      }

      stats.ingested = result.documentsIngested || 0;
      stats.skipped = (result.itemsProcessed || 0) - stats.ingested;
      stats.failed = result.errors?.length || 0;
      stats.errors = result.errors || [];

      // Store raw files for newly ingested documents
      if (stats.ingested > 0) {
        await this.storeRawFilesForNewDocuments(userId, source.provider);
      }

      logger.info(`✅ [EVIDENCE WORKER] Ingested from ${source.provider} for user ${userId}`, {
        ingested: stats.ingested,
        skipped: stats.skipped,
        failed: stats.failed
      });

      return stats;
    } catch (error: any) {
      logger.error(`❌ [EVIDENCE WORKER] Error ingesting from ${source.provider}`, {
        error: error.message,
        provider: source.provider,
        userId
      });
      throw error;
    }
  }

  /**
   * Store raw files for newly ingested documents
   */
  private async storeRawFilesForNewDocuments(userId: string, provider: string): Promise<void> {
    try {
      // Get documents that were just ingested (within last minute) and don't have storage_path
      // Try user_id first, fallback to seller_id
      let { data: documents, error } = await supabase
        .from('evidence_documents')
        .select('id, filename, content_type, metadata')
        .eq('user_id', userId)
        .eq('provider', provider)
        .is('storage_path', null)
        .gte('ingested_at', new Date(Date.now() - 60000).toISOString()) // Last minute
        .limit(100);

      // If user_id column doesn't exist, try seller_id
      if (error && error.message?.includes('column') && error.message?.includes('user_id')) {
        const retry = await supabase
          .from('evidence_documents')
          .select('id, filename, content_type, metadata')
          .eq('seller_id', userId)
          .eq('provider', provider)
          .is('storage_path', null)
          .gte('ingested_at', new Date(Date.now() - 60000).toISOString())
          .limit(100);
        documents = retry.data;
        error = retry.error;
      }

      if (error || !documents || documents.length === 0) {
        return;
      }

      logger.info(`📦 [EVIDENCE WORKER] Found ${documents.length} documents needing storage for ${provider}`, {
        userId,
        provider
      });

      // Note: The actual file content needs to be retrieved from the ingestion service
      // The ingestion services should be updated to store files during ingestion
      // This is a placeholder - full storage integration will be added when ingestion services are updated

    } catch (error: any) {
      logger.warn('⚠️ [EVIDENCE WORKER] Error storing raw files (non-critical)', {
        error: error.message,
        userId,
        provider
      });
    }
  }

  /**
   * Refresh OAuth token if needed
   * Note: Evidence sources store tokens in evidence_sources.metadata, not in tokenManager
   * The ingestion services handle token refresh internally
   */
  private async refreshTokenIfNeeded(userId: string, provider: string): Promise<void> {
    try {
      // For Gmail, check tokenManager (it supports gmail)
      if (provider === 'gmail') {
        try {
          const tokenData = await tokenManager.getToken(userId, 'gmail');
          
          if (!tokenData) {
            logger.debug(`No Gmail token in tokenManager for user ${userId} (may be in evidence_sources)`);
            return;
          }

          // Check if token is expired or will expire soon (within 5 minutes)
          if (tokenData.expiresAt) {
            const expiresAt = new Date(tokenData.expiresAt);
            const now = new Date();
            const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

            if (expiresAt <= fiveMinutesFromNow) {
              logger.info(`🔄 [EVIDENCE WORKER] Gmail token needs refresh (handled by ingestion service)`, {
                userId,
                provider
              });
              // Token refresh is handled by GmailService internally
            }
          }
        } catch (error: any) {
          // TokenManager may not have Gmail token - that's OK, it's in evidence_sources
          logger.debug(`Gmail token not in tokenManager (may be in evidence_sources)`, {
            userId,
            provider
          });
        }
      }

      // For other providers (outlook, gdrive, dropbox), tokens are in evidence_sources.metadata
      // The ingestion services handle token refresh internally via their getAccessToken methods
      // No action needed here - ingestion services will refresh as needed
      
    } catch (error: any) {
      logger.warn(`⚠️ [EVIDENCE WORKER] Error checking token (non-critical)`, {
        error: error.message,
        userId,
        provider
      });
      // Don't throw - continue with ingestion attempt
    }
  }

  /**
   * Update last_synced_at for a source
   */
  private async updateLastSyncedAt(sourceId: string): Promise<void> {
    try {
      // Check if last_synced_at column exists, if not, update metadata instead
      const { error } = await supabase
        .from('evidence_sources')
        .update({
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sourceId);

      // If column doesn't exist, update metadata instead
      if (error && error.message?.includes('column') && error.message?.includes('last_synced_at')) {
        // Get current metadata
        const { data: source } = await supabase
          .from('evidence_sources')
          .select('metadata')
          .eq('id', sourceId)
          .single();

        if (source) {
          const { error: updateError } = await supabase
            .from('evidence_sources')
            .update({
              metadata: {
                ...(source.metadata || {}),
                last_synced_at: new Date().toISOString()
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', sourceId);

          if (updateError) {
            logger.warn('⚠️ [EVIDENCE WORKER] Failed to update last_synced_at in metadata', {
              error: updateError.message,
              sourceId
            });
          }
        }
      } else if (error) {
        logger.warn('⚠️ [EVIDENCE WORKER] Failed to update last_synced_at', {
          error: error.message,
          sourceId
        });
      }
    } catch (error: any) {
      logger.warn('⚠️ [EVIDENCE WORKER] Error updating last_synced_at', {
        error: error.message,
        sourceId
      });
    }
  }

  /**
   * Log ingestion error
   */
  private async logError(
    userId: string,
    provider: string,
    sourceId: string | null,
    error: any,
    retryCount: number = 0
  ): Promise<void> {
    try {
      const { error: insertError } = await supabase
        .from('evidence_ingestion_errors')
        .insert({
          user_id: userId,
          provider,
          source_id: sourceId,
          error_type: error.name || 'UnknownError',
          error_message: error.message || String(error),
          error_stack: error.stack,
          retry_count: retryCount,
          max_retries: 3,
          metadata: {
            timestamp: new Date().toISOString(),
            provider,
            source_id: sourceId
          }
        });

      if (insertError) {
        logger.warn('⚠️ [EVIDENCE WORKER] Failed to log error', {
          error: insertError.message
        });
      }
    } catch (logError: any) {
      logger.warn('⚠️ [EVIDENCE WORKER] Error logging error (non-critical)', {
        error: logError.message
      });
    }
  }

  /**
   * Get worker status
   */
  getStatus(): { running: boolean; schedule: string } {
    return {
      running: this.isRunning,
      schedule: this.schedule
    };
  }

  /**
   * Manually trigger ingestion for a user (for testing)
   */
  async triggerManualIngestion(userId: string): Promise<IngestionStats> {
    logger.info(`🔧 [EVIDENCE WORKER] Manual ingestion triggered for user: ${userId}`);
    return await this.ingestForUser(userId);
  }
}

// Singleton instance
const evidenceIngestionWorker = new EvidenceIngestionWorker();

// Auto-start if enabled
if (process.env.ENABLE_EVIDENCE_INGESTION_WORKER !== 'false') {
  evidenceIngestionWorker.start().catch((error) => {
    logger.error('Failed to start evidence ingestion worker', { error: error.message });
  });
}

export default evidenceIngestionWorker;

