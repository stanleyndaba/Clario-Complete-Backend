/**
 * Evidence Ingestion Worker
 * Automated background worker for continuous evidence ingestion from all connected sources
 * Runs every 5 minutes, ingests from Gmail, Outlook, Google Drive, and Dropbox
 * 
 * MULTI-TENANT: Uses tenant-scoped queries for data isolation
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { createTenantScopedQueryById } from '../database/tenantScopedClient';
import { unifiedIngestionService } from '../services/unifiedIngestionService';
import { gmailIngestionService } from '../services/gmailIngestionService';
import { outlookIngestionService } from '../services/outlookIngestionService';
import { googleDriveIngestionService } from '../services/googleDriveIngestionService';
import { dropboxIngestionService } from '../services/dropboxIngestionService';
import { oneDriveIngestionService } from '../services/oneDriveIngestionService';
import tokenManager from '../utils/tokenManager';

const SUPPORTED_INGESTION_PROVIDERS = ['gmail', 'outlook', 'gdrive', 'dropbox', 'onedrive'] as const;
type SupportedIngestionProvider = typeof SUPPORTED_INGESTION_PROVIDERS[number];

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
   * MULTI-TENANT: Iterates through each tenant first, then processes users per tenant
   */
  private async runEvidenceIngestionForAllTenants(): Promise<void> {
    const runStartTime = Date.now();

    try {
      logger.info('🔍 [EVIDENCE WORKER] Starting scheduled evidence ingestion', {
        timestamp: new Date().toISOString()
      });

      // MULTI-TENANT: Get all active tenants first
      const client = supabaseAdmin || supabase;
      const { data: tenants, error: tenantError } = await client
        .from('tenants')
        .select('id, name, status')
        .in('status', ['active', 'trialing'])
        .is('deleted_at', null);

      if (tenantError) {
        logger.error('❌ [EVIDENCE WORKER] Failed to get active tenants', { error: tenantError.message });
        return;
      }

      if (!tenants || tenants.length === 0) {
        logger.info('ℹ️ [EVIDENCE WORKER] No active tenants found');
        return;
      }

      logger.info(`📊 [EVIDENCE WORKER] Processing ${tenants.length} active tenants`);

      const totalStats: IngestionStats = {
        ingested: 0,
        skipped: 0,
        failed: 0,
        errors: []
      };

      // MULTI-TENANT: Process each tenant in isolation
      for (const tenant of tenants) {
        try {
          const tenantStats = await this.runIngestionForTenant(tenant.id);
          totalStats.ingested += tenantStats.ingested;
          totalStats.skipped += tenantStats.skipped;
          totalStats.failed += tenantStats.failed;
          totalStats.errors.push(...tenantStats.errors);
        } catch (error: any) {
          logger.error('❌ [EVIDENCE WORKER] Error processing tenant', {
            tenantId: tenant.id,
            tenantName: tenant.name,
            error: error.message
          });
          totalStats.errors.push(`Tenant ${tenant.id}: ${error.message}`);
        }
      }

      const runDuration = Date.now() - runStartTime;

      logger.info('✅ [EVIDENCE WORKER] Scheduled evidence ingestion completed', {
        tenantCount: tenants.length,
        ingested: totalStats.ingested,
        skipped: totalStats.skipped,
        failed: totalStats.failed,
        errors: totalStats.errors.length,
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
   * MULTI-TENANT: Run ingestion for a specific tenant
   * All database queries are scoped to this tenant only
   */
  private async runIngestionForTenant(tenantId: string): Promise<IngestionStats> {
    const stats: IngestionStats = {
      ingested: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    // Get users with connected evidence sources for this tenant
    const userIds = await this.getActiveUserIdsForTenant(tenantId);

    if (userIds.length === 0) {
      logger.debug('ℹ️ [EVIDENCE WORKER] No users with connected sources for tenant', { tenantId });
      return stats;
    }

    logger.info(`📊 [EVIDENCE WORKER] Processing ${userIds.length} users for tenant`, { tenantId, userCount: userIds.length });

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
          userId,
          tenantId
        });
      }
    }

    return stats;
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
        .in('provider', [...SUPPORTED_INGESTION_PROVIDERS]);

      // If user_id column doesn't exist, try seller_id
      if (error && error.message?.includes('column') && error.message?.includes('user_id')) {
        const retry = await supabase
          .from('evidence_sources')
          .select('seller_id')
          .eq('status', 'connected')
          .in('provider', [...SUPPORTED_INGESTION_PROVIDERS]);
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
   * MULTI-TENANT: Get list of active user IDs for a specific tenant
   * Uses tenant-scoped query to only get users belonging to this tenant
   */
  private async getActiveUserIdsForTenant(tenantId: string): Promise<string[]> {
    try {
      // Use tenant-scoped query to get evidence sources for this tenant only
      const tenantQuery = createTenantScopedQueryById(tenantId, 'evidence_sources');
      let { data: sources, error } = await tenantQuery
        .select('user_id, seller_id')
        .eq('status', 'connected')
        .in('provider', [...SUPPORTED_INGESTION_PROVIDERS]);

      if (error && error.message?.includes('seller_id')) {
        const retry = await tenantQuery
          .select('user_id')
          .eq('status', 'connected')
          .in('provider', [...SUPPORTED_INGESTION_PROVIDERS]);
        sources = retry.data;
        error = retry.error;
      }

      if (error && error.message?.includes('user_id')) {
        const retry = await tenantQuery
          .select('seller_id')
          .eq('status', 'connected')
          .in('provider', [...SUPPORTED_INGESTION_PROVIDERS]);
        sources = retry.data;
        error = retry.error;
      }

      if (error) {
        logger.error('❌ [EVIDENCE WORKER] Error fetching active user IDs for tenant', {
          tenantId,
          error: error.message
        });
        return [];
      }

      // Extract unique user IDs
      const userIds = [...new Set((sources || []).map((s: any) => s.user_id || s.seller_id))];
      return userIds.filter((id: any): id is string => typeof id === 'string' && id.length > 0);
    } catch (error: any) {
      logger.error('❌ [EVIDENCE WORKER] Error getting active user IDs for tenant', {
        tenantId,
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

      // Use admin client to bypass RLS for source queries
      const client = supabaseAdmin || supabase;

      // Convert prefixed user IDs (e.g. "stress-test-user-UUID") to valid UUID
      // before querying tables that require UUID format
      const dbUserId = convertUserIdToUuid(userId);

      // Get connected sources for this user (try seller_id first, fallback to user_id)
      let { data: sources, error } = await client
        .from('evidence_sources')
        .select('id, provider, last_synced_at, metadata')
        .eq('seller_id', dbUserId)
        .eq('status', 'connected')
        .in('provider', [...SUPPORTED_INGESTION_PROVIDERS]);

      // If seller_id column doesn't exist or no results, try user_id
      if ((error && error.message?.includes('column') && error.message?.includes('seller_id')) || (!error && (!sources || sources.length === 0))) {
        const retry = await client
          .from('evidence_sources')
          .select('id, provider, last_synced_at, metadata')
          .eq('user_id', dbUserId)
          .eq('status', 'connected')
          .in('provider', [...SUPPORTED_INGESTION_PROVIDERS]);
        if (retry.data && retry.data.length > 0) {
          sources = retry.data;
          error = retry.error;
        }
      }

      if (error) {
        logger.warn(`⚠️ [EVIDENCE WORKER] Error fetching sources for user ${userId}`, {
          error: error.message,
          errorCode: error.code
        });
        return stats;
      }

      if (!sources || sources.length === 0) {
        logger.debug(`ℹ️ [EVIDENCE WORKER] No connected sources for user ${userId}`);
        return stats;
      }

      logger.info(`📦 [EVIDENCE WORKER] Found ${sources.length} connected sources for user ${userId}`, {
        providers: sources.map(s => s.provider),
        sourceIds: sources.map(s => s.id)
      });

      // Process each source
      for (const source of sources) {
        try {
          // Refresh token if needed
          await this.refreshTokenIfNeeded(userId, source.provider);

          // Wait for rate limit
          await this.rateLimiter.waitForRateLimit(source.provider);

          // Ingest from this source with retry (max 3 retries = 4 total attempts)
          let sourceStats: IngestionStats;

          try {
            sourceStats = await retryWithBackoff(async () => {
              return await this.ingestFromSource(userId, source);
            }, 3, 1000);

            stats.ingested += sourceStats.ingested;
            stats.skipped += sourceStats.skipped;
            stats.failed += sourceStats.failed;
            stats.errors.push(...sourceStats.errors);

            // Update last_synced_at after successful ingestion
            await this.updateLastSyncedAt(source.id);
          } catch (error: any) {
            // Retry exhausted - log error
            stats.failed++;
            const errorMsg = `[${source.provider}] ${error.message}`;
            stats.errors.push(errorMsg);

            // Log error with retry count (retryWithBackoff will have attempted 4 times, 3 retries)
            await this.logError(userId, source.provider, source.id, error, 3);

            logger.error(`❌ [EVIDENCE WORKER] Failed to ingest from ${source.provider} for user ${userId} after retries`, {
              error: error.message,
              provider: source.provider,
              userId,
              retries: 3
            });

            // Still update last_synced_at even on failure (to track last attempt)
            await this.updateLastSyncedAt(source.id);
          }
        } catch (error: any) {
          // Outer catch for unexpected errors
          stats.failed++;
          const errorMsg = `[${source.provider}] ${error.message}`;
          stats.errors.push(errorMsg);
          logger.error(`❌ [EVIDENCE WORKER] Unexpected error processing source ${source.provider}`, {
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

      // Check for simulate_failure flag (for testing retry logic)
      if (source.metadata?.simulate_failure === true) {
        logger.warn('🧪 [EVIDENCE WORKER] Simulating failure for testing retry logic', {
          provider: source.provider,
          userId,
          sourceId: source.id
        });
        throw new Error(`Simulated failure for testing retry logic (provider: ${source.provider})`);
      }

      // Build query for incremental sync (only fetch new documents)
      const query = source.last_synced_at
        ? `after:${new Date(source.last_synced_at).toISOString().split('T')[0]}`
        : undefined;

      let result: any;

      switch (source.provider) {
        case 'gmail':
          // Do not hard-skip based solely on tokenManager. In this codebase, Gmail
          // connectivity may be represented by a connected evidence source even when
          // the token manager path is not populated for the same user identifier.
          try {
            const hasGmailToken = await tokenManager.isTokenValid(userId, 'gmail');
            if (!hasGmailToken) {
              logger.info('ℹ️ [EVIDENCE WORKER] Gmail token not found in tokenManager, attempting ingestion via connected source state', {
                userId,
                sourceId: source.id
              });
            }
          } catch (tokenError: any) {
            logger.debug('Gmail tokenManager check failed; continuing with ingestion attempt', {
              userId,
              sourceId: source.id,
              error: tokenError.message
            });
          }

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

        case 'onedrive':
          result = await oneDriveIngestionService.ingestEvidenceFromOneDrive(userId, {
            query,
            maxResults: 50,
            autoParse: true,
            folderId: source.metadata?.folderId
          });
          break;

        default:
          await this.recordSourceIngestionDecision(source.id, {
            strategy: 'REJECTED',
            reason: 'unsupported_provider_in_worker',
            preserved_fields: ['provider', 'source_id', 'metadata'],
            missing_fields: ['provider_handler']
          });
          stats.failed = 1;
          stats.errors = [`Unsupported provider in evidence worker: ${source.provider}`];
          return stats;
      }

      // Only process result if it was actually returned (handles skip case)
      if (result) {
        const processedCount = result.itemsProcessed || result.filesProcessed || result.emailsProcessed || 0;
        stats.ingested = result.documentsIngested || 0;
        stats.skipped = Math.max(0, processedCount - stats.ingested);
        stats.failed = result.errors?.length || 0;
        stats.errors = result.errors || [];

        if (stats.failed > 0 && stats.ingested === 0) {
          await this.recordSourceIngestionDecision(source.id, {
            strategy: 'REJECTED',
            reason: stats.errors[0] || 'provider_ingestion_failed_without_preserved_documents',
            preserved_fields: ['provider', 'source_id', 'metadata'],
            missing_fields: ['accessible_input_content']
          });
        } else if (stats.failed > 0 || stats.skipped > 0) {
          await this.recordSourceIngestionDecision(source.id, {
            strategy: 'DEGRADED',
            reason: stats.errors[0] || 'provider_ingestion_preserved_partial_inputs',
            preserved_fields: ['provider', 'source_id', 'metadata'],
            missing_fields: stats.failed > 0 ? ['full_input_coverage'] : []
          });
        } else {
          await this.recordSourceIngestionDecision(source.id, {
            strategy: 'FULL',
            reason: 'provider_ingestion_completed',
            preserved_fields: ['provider', 'source_id', 'metadata'],
            missing_fields: []
          });
        }
      }

      // 🎯 AGENT 11 INTEGRATION: Log ingestion event
      try {
        const agentEventLogger = (await import('../services/agentEventLogger')).default;
        const ingestionStartTime = Date.now();
        await agentEventLogger.logEvidenceIngestion({
          userId,
          success: stats.failed === 0,
          documentsIngested: stats.ingested,
          documentsSkipped: stats.skipped,
          documentsFailed: stats.failed,
          duration: Date.now() - ingestionStartTime,
          provider: source.provider,
          errors: stats.errors
        });
      } catch (logError: any) {
        logger.warn('⚠️ [EVIDENCE WORKER] Failed to log event', {
          error: logError.message
        });
      }

      // Store raw files for newly ingested documents
      if (stats.ingested > 0) {
        await this.storeRawFilesForNewDocuments(userId, source.provider);

        // 🎯 AGENT 10 INTEGRATION: Notify when evidence is found
        try {
          const notificationHelper = (await import('../services/notificationHelper')).default;

          // Get recently ingested documents to notify about
          const dbUserIdForDocs = convertUserIdToUuid(userId);
          const client = supabaseAdmin || supabase;
          const { data: recentDocs } = await client
            .from('evidence_documents')
            .select('id, filename, provider')
            .eq('seller_id', dbUserIdForDocs)
            .eq('provider', source.provider)
            .order('created_at', { ascending: false })
            .limit(stats.ingested);

          if (recentDocs && recentDocs.length > 0) {
            for (const doc of recentDocs) {
              const notificationSource = source.provider === 'gdrive' || source.provider === 'onedrive'
                ? 'drive'
                : source.provider;
              await notificationHelper.notifyEvidenceFound(userId, {
                documentId: doc.id,
                source: notificationSource as 'gmail' | 'outlook' | 'drive' | 'dropbox',
                fileName: doc.filename || 'Unknown',
                parsed: false
              });
            }
          }
        } catch (notifError: any) {
          logger.warn('⚠️ [EVIDENCE WORKER] Failed to send notification', {
            error: notifError.message
          });
        }
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
      const dbUserIdForStorage = convertUserIdToUuid(userId);
      let { data: documents, error } = await supabase
        .from('evidence_documents')
        .select('id, filename, content_type, metadata')
        .eq('user_id', dbUserIdForStorage)
        .eq('provider', provider)
        .is('storage_path', null)
        .gte('ingested_at', new Date(Date.now() - 60000).toISOString()) // Last minute
        .limit(100);

      // If user_id column doesn't exist, try seller_id
      if (error && error.message?.includes('column') && error.message?.includes('user_id')) {
        const retry = await supabase
          .from('evidence_documents')
          .select('id, filename, content_type, metadata')
          .eq('seller_id', dbUserIdForStorage)
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

      // For other providers (outlook, gdrive, dropbox, onedrive), tokens are in evidence_sources.metadata
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
      const now = new Date().toISOString();

      // Use admin client to bypass RLS if needed
      const client = supabaseAdmin || supabase;

      // Try to update last_synced_at column directly
      const { data: updateData, error } = await client
        .from('evidence_sources')
        .update({
          last_synced_at: now,
          updated_at: now
        })
        .eq('id', sourceId)
        .select('last_synced_at')
        .single();

      // If column doesn't exist or update failed, try updating metadata instead
      if (error && (error.message?.includes('column') || error.message?.includes('last_synced_at'))) {
        // Get current metadata
        const { data: source } = await client
          .from('evidence_sources')
          .select('metadata')
          .eq('id', sourceId)
          .single();

        if (source) {
          const { error: updateError } = await client
            .from('evidence_sources')
            .update({
              metadata: {
                ...(source.metadata || {}),
                last_synced_at: now
              },
              updated_at: now
            })
            .eq('id', sourceId);

          if (updateError) {
            logger.warn('⚠️ [EVIDENCE WORKER] Failed to update last_synced_at in metadata', {
              error: updateError.message,
              sourceId
            });
          } else {
            logger.debug('✅ [EVIDENCE WORKER] Updated last_synced_at in metadata', { sourceId });
          }
        }
      } else if (error) {
        logger.warn('⚠️ [EVIDENCE WORKER] Failed to update last_synced_at', {
          error: error.message,
          errorCode: error.code,
          errorDetails: error.details,
          sourceId
        });
      } else if (updateData) {
        logger.info('✅ [EVIDENCE WORKER] Updated last_synced_at', {
          sourceId,
          last_synced_at: updateData.last_synced_at
        });
      } else {
        // No error but no data returned - might be a silent failure
        logger.warn('⚠️ [EVIDENCE WORKER] Update completed but no data returned', {
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
      // Use admin client to bypass RLS for error logging
      const client = supabaseAdmin || supabase;

      const dbUserIdForError = convertUserIdToUuid(userId);
      const { error: insertError } = await client
        .from('evidence_ingestion_errors')
        .insert({
          user_id: dbUserIdForError,
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
            source_id: sourceId,
            user_id: userId
          }
        });

      if (insertError) {
        logger.warn('⚠️ [EVIDENCE WORKER] Failed to log error', {
          error: insertError.message,
          code: insertError.code,
          details: insertError.details
        });
      } else {
        logger.info('📝 [EVIDENCE WORKER] Logged ingestion error', {
          userId,
          provider,
          sourceId,
          errorType: error.name || 'UnknownError',
          retryCount
        });
      }
    } catch (logError: any) {
      logger.warn('⚠️ [EVIDENCE WORKER] Error logging error (non-critical)', {
        error: logError.message
      });
    }
  }

  private async recordSourceIngestionDecision(
    sourceId: string,
    decision: {
      strategy: 'FULL' | 'DEGRADED' | 'REJECTED';
      reason: string;
      preserved_fields: string[];
      missing_fields: string[];
    }
  ): Promise<void> {
    try {
      const client = supabaseAdmin || supabase;
      const timestamp = new Date().toISOString();
      const { data: source } = await client
        .from('evidence_sources')
        .select('metadata')
        .eq('id', sourceId)
        .maybeSingle();

      await client
        .from('evidence_sources')
        .update({
          metadata: {
            ...(source?.metadata || {}),
            last_ingestion_strategy: decision.strategy,
            last_ingestion_explanation: {
              reason: decision.reason,
              preserved_fields: decision.preserved_fields,
              missing_fields: decision.missing_fields,
              recorded_at: timestamp
            }
          },
          updated_at: timestamp
        })
        .eq('id', sourceId);
    } catch (error: any) {
      logger.warn('⚠️ [EVIDENCE WORKER] Failed to record source ingestion decision', {
        sourceId,
        error: error?.message || String(error)
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

