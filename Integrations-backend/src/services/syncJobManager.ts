import logger from '../utils/logger';
import agent2DataSyncService from './agent2DataSyncService';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import sseHub from '../utils/sseHub';
import config from '../config/env';
import { withRetry, toSyncError, SyncError, SyncErrorCode, SyncNextAction } from '../utils/retryUtils';
import {
  createSyncFingerprint,
  createCoverageReport,
  createSyncSnapshot,
  SyncCoverage,
  SyncCoverageReport
} from '../utils/syncFingerprint';
import { resolveTenantSlug } from '../utils/tenantEventRouting';
import capacityGovernanceService from './capacityGovernanceService';
import operationalControlService from './operationalControlService';
import runtimeCapacityService from './runtimeCapacityService';

// Standardized status values - use database values consistently
export type SyncStatus = 'idle' | 'running' | 'detecting' | 'completed' | 'failed' | 'cancelled';

export interface SyncJobStatus {
  syncId: string;
  userId: string;
  tenantId?: string;
  tenantSlug?: string;
  storeId?: string; // Track which store this sync belongs to
  status: SyncStatus;
  progress: number;
  message: string;
  startedAt: string;
  completedAt?: string;
  estimatedCompletion?: string;
  ordersProcessed?: number;
  totalOrders?: number;
  claimsDetected?: number;
  totalRecoverableValue?: number; // Actual calculated value from detection results
  inventoryCount?: number;
  shipmentsCount?: number;
  returnsCount?: number;
  settlementsCount?: number;
  feesCount?: number;
  error?: string;
  // Enhanced error tracking (Pillar 1: Reliability)
  errorCode?: SyncErrorCode;
  errorDetails?: SyncError;
  retryCount?: number;
  nextRetryAt?: string;
  // Coverage tracking (Pillar 3: Completeness)
  coverage?: SyncCoverage[];
  coverageComplete?: boolean;
  // Fingerprint for idempotency (Pillar 1: Reliability)
  syncFingerprint?: string;
  lastSuccessfulSyncAt?: string;
}

interface PersistedSyncResults {
  ordersProcessed: number;
  totalOrders: number;
  inventoryCount: number;
  shipmentsCount: number;
  returnsCount: number;
  settlementsCount: number;
  feesCount: number;
  claimsDetected: number;
  totalItemsSynced: number;
}

class SyncJobManager {
  private runningJobs: Map<string, { status: SyncJobStatus; cancel: () => void }> = new Map();

  constructor() {
    // Agent 2 Data Sync Service is imported and used directly
  }

  private matchesScope(syncStatus: SyncJobStatus, tenantId?: string, storeId?: string): boolean {
    if (tenantId && syncStatus.tenantId !== tenantId) {
      return false;
    }

    if (storeId && syncStatus.storeId !== storeId) {
      return false;
    }

    return true;
  }

  private applySyncProgressScope(query: any, tenantId?: string, storeId?: string): any {
    let scopedQuery = query;

    if (tenantId) {
      scopedQuery = scopedQuery.eq('tenant_id', tenantId);
    }

    if (storeId) {
      scopedQuery = scopedQuery.eq('store_id', storeId);
    }

    return scopedQuery;
  }

  private async resolveRequiredTenantContext(userId: string, tenantId?: string): Promise<{ tenantId: string; tenantSlug?: string }> {
    const normalizedTenantId = String(tenantId || '').trim();
    if (!normalizedTenantId) {
      throw new Error('An active workspace is required to run a sync.');
    }

    const { data: membership, error } = await supabaseAdmin
      .from('tenant_memberships')
      .select('tenant_id')
      .eq('user_id', userId)
      .eq('tenant_id', normalizedTenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to validate workspace access: ${error.message}`);
    }

    if (!membership?.tenant_id) {
      throw new Error('You do not belong to the active workspace.');
    }

    return {
      tenantId: normalizedTenantId,
      tenantSlug: await resolveTenantSlug(normalizedTenantId)
    };
  }

  private async validateStoreForTenant(userId: string, tenantId: string, storeId?: string): Promise<string | undefined> {
    const normalizedStoreId = String(storeId || '').trim();
    if (!normalizedStoreId) {
      return undefined;
    }

    const { data: store, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id')
      .eq('id', normalizedStoreId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (storeError) {
      throw new Error(`Failed to validate store scope: ${storeError.message}`);
    }

    if (store?.id) {
      return normalizedStoreId;
    }

    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from('tokens')
      .select('id')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('provider', 'amazon')
      .eq('store_id', normalizedStoreId)
      .limit(1)
      .maybeSingle();

    if (tokenError) {
      throw new Error(`Failed to validate store token scope: ${tokenError.message}`);
    }

    if (!tokenRow?.id) {
      throw new Error('The selected Amazon store does not belong to the active workspace.');
    }

    return normalizedStoreId;
  }

  private async assertTenantScopedAmazonConnection(userId: string, tenantId: string, storeId?: string): Promise<void> {
    let query = supabaseAdmin
      .from('tokens')
      .select('id, expires_at, refresh_token_iv, refresh_token_data')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('provider', 'amazon')
      .order('expires_at', { ascending: false })
      .limit(10);

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to validate Amazon connection scope: ${error.message}`);
    }

    const usableRows = (data || []).filter((row: any) => {
      const hasRefreshToken = !!row?.refresh_token_iv && !!row?.refresh_token_data;
      const hasLiveAccessToken = !!row?.expires_at && new Date(row.expires_at).getTime() > Date.now();
      return hasLiveAccessToken || hasRefreshToken;
    });

    if (!usableRows.length) {
      throw new Error(
        storeId
          ? 'Amazon connection not found for the active workspace and selected store.'
          : 'Amazon connection not found for the active workspace. Please connect your Amazon account first.'
      );
    }
  }

  private toPersistedSyncResults(metadata: any): PersistedSyncResults {
    const ordersProcessed = metadata.ordersProcessed || 0;
    const inventoryCount = metadata.inventoryCount || 0;
    const shipmentsCount = metadata.shipmentsCount || 0;
    const returnsCount = metadata.returnsCount || 0;
    const settlementsCount = metadata.settlementsCount || 0;
    const feesCount = metadata.feesCount || 0;
    const claimsDetected = metadata.claimsDetected || 0;

    return {
      ordersProcessed,
      totalOrders: metadata.totalOrders || ordersProcessed,
      inventoryCount,
      shipmentsCount,
      returnsCount,
      settlementsCount,
      feesCount,
      claimsDetected,
      totalItemsSynced: ordersProcessed + inventoryCount + shipmentsCount + returnsCount + settlementsCount + feesCount
    };
  }

  private buildSyncJobStatusFromRow(row: any, countsOverride?: Partial<PersistedSyncResults>): SyncJobStatus {
    const metadata = (row.metadata as any) || {};
    const counts = {
      ...this.toPersistedSyncResults(metadata),
      ...countsOverride
    };

    let normalizedStatus: SyncStatus = 'idle';
    if (row.status === 'running' || row.status === 'in_progress') {
      normalizedStatus = 'running';
    } else if (row.status === 'detecting') {
      normalizedStatus = 'detecting';
    } else if (row.status === 'completed' || row.status === 'complete') {
      normalizedStatus = 'completed';
    } else if (row.status === 'failed') {
      normalizedStatus = 'failed';
    } else if (row.status === 'cancelled') {
      normalizedStatus = 'cancelled';
    }

    return {
      syncId: row.sync_id,
      userId: row.user_id,
      tenantId: row.tenant_id || undefined,
      storeId: row.store_id || undefined,
      status: normalizedStatus,
      progress: row.progress || 0,
      message: row.current_step || 'Unknown',
      startedAt: row.created_at,
      completedAt: row.updated_at,
      ordersProcessed: counts.ordersProcessed,
      totalOrders: counts.totalOrders,
      inventoryCount: counts.inventoryCount,
      shipmentsCount: counts.shipmentsCount,
      returnsCount: counts.returnsCount,
      settlementsCount: counts.settlementsCount,
      feesCount: counts.feesCount,
      claimsDetected: counts.claimsDetected,
      error: metadata.error
    };
  }

  /**
   * Start a new sync job asynchronously
   */
  async startSync(userId: string, tenantId?: string, storeId?: string): Promise<{ syncId: string; status: string }> {
    const syncId = `sync_${userId}_${Date.now()}`;
    const tenantContext = await this.resolveRequiredTenantContext(userId, tenantId);
    const scopedStoreId = await this.validateStoreForTenant(userId, tenantContext.tenantId, storeId);

    if (!(await operationalControlService.isEnabled('new_ingestion', true))) {
      runtimeCapacityService.setCircuitBreaker('new-ingestion', 'open', 'operator_disabled');
      throw new Error('New ingestion is temporarily paused by operator control.');
    }
    runtimeCapacityService.setCircuitBreaker('new-ingestion', 'closed', null);

    // Strict truth: sync is allowed only with a valid DB-backed Amazon token.
    await this.assertTenantScopedAmazonConnection(userId, tenantContext.tenantId, scopedStoreId);

    const intakeDecision = await capacityGovernanceService.getIntakeAdmissionDecision(tenantContext.tenantId);
    if (!intakeDecision.allowed) {
      runtimeCapacityService.setCircuitBreaker('new-ingestion', 'open', intakeDecision.reason || 'capacity_blocked');
      logger.warn('🚦 [SYNC JOB MANAGER] Sync admission blocked by downstream backlog', {
        userId,
        syncId,
        tenantId: tenantContext.tenantId,
        storeId: scopedStoreId,
        reason: intakeDecision.reason,
        metrics: intakeDecision.metrics
      });
      throw new Error(`Sync temporarily paused due to downstream backlog (${intakeDecision.reason}).`);
    }
    runtimeCapacityService.setCircuitBreaker('new-ingestion', 'closed', null);

    // 🧹 AUTO-CLEANUP: Clear stale syncs stuck in 'running' for 2+ minutes
    // This prevents orphaned syncs from blocking new sync requests
    const STALE_SYNC_THRESHOLD_MINUTES = 2;
    try {
      const staleSyncQuery = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .update({
            status: 'failed',
            current_step: 'Auto-cleared: Sync timed out after 10 minutes of inactivity',
            error_code: 'TIMEOUT',
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId)
          .eq('status', 'running')
          .lt('updated_at', new Date(Date.now() - STALE_SYNC_THRESHOLD_MINUTES * 60 * 1000).toISOString()),
        tenantContext.tenantId,
        scopedStoreId
      );
      const { data: staleSyncs, error: staleError } = await staleSyncQuery.select('sync_id');

      if (staleSyncs && staleSyncs.length > 0) {
        logger.info('🧹 [SYNC JOB MANAGER] Auto-cleared stale syncs', {
          userId,
          clearedCount: staleSyncs.length,
          clearedSyncIds: staleSyncs.map(s => s.sync_id)
        });
      }
    } catch (cleanupError: any) {
      // Non-fatal - log and continue
      logger.warn('⚠️ [SYNC JOB MANAGER] Failed to cleanup stale syncs (non-fatal)', {
        userId,
        error: cleanupError.message
      });
    }

    // Check if there's already a running sync (both in-memory and database)
    const existingSync = await this.getActiveSync(userId, tenantContext.tenantId, scopedStoreId);
    if (existingSync && existingSync.status === 'running') {
      throw new Error(`Sync already in progress (${existingSync.syncId}). Please wait for it to complete or cancel it first.`);
    }

    // Also check database for any active syncs
    const dbActiveSyncQuery = this.applySyncProgressScope(
      supabase
        .from('sync_progress')
        .select('sync_id, status, updated_at')
        .eq('user_id', userId)
        .eq('status', 'running')
        .order('created_at', { ascending: false })
        .limit(1),
      tenantContext.tenantId,
      scopedStoreId
    );
    const { data: dbActiveSync } = await dbActiveSyncQuery.maybeSingle();

    if (dbActiveSync && dbActiveSync.status === 'running') {
      // Double-check it's not stale (should have been cleaned above, but check again)
      const updatedAt = new Date(dbActiveSync.updated_at).getTime();
      const isStale = Date.now() - updatedAt > STALE_SYNC_THRESHOLD_MINUTES * 60 * 1000;

      if (isStale) {
        // Force clear this stale sync
        await this.applySyncProgressScope(
          supabase
            .from('sync_progress')
            .update({
              status: 'failed',
              current_step: 'Auto-cleared: Sync was stale',
              error_code: 'TIMEOUT',
              updated_at: new Date().toISOString()
            })
            .eq('sync_id', dbActiveSync.sync_id),
          tenantContext.tenantId,
          scopedStoreId
        );

        logger.info('🧹 [SYNC JOB MANAGER] Force-cleared stale sync', {
          userId,
          staleSyncId: dbActiveSync.sync_id
        });
      } else {
        // It's a real active sync - block the new sync
        throw new Error(`Sync already in progress (${dbActiveSync.sync_id}). Please wait for it to complete or cancel it first.`);
      }
    }

    // 🔐 PILLAR 1: IDEMPOTENT JOB DETECTION
    // Check if a sync with the same fingerprint completed recently (within 5 minutes)
    const defaultSyncDays = parseInt(process.env.SYNC_DAYS || '90', 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - defaultSyncDays);
    const endDate = new Date();
    const syncFingerprint = createSyncFingerprint(userId, startDate, endDate, 5, scopedStoreId);

    const recentSyncQuery = this.applySyncProgressScope(
      supabase
        .from('sync_progress')
        .select('sync_id, status, updated_at, sync_fingerprint')
        .eq('user_id', userId)
        .eq('sync_fingerprint', syncFingerprint)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(1),
      tenantContext.tenantId,
      scopedStoreId
    );
    const { data: recentSync } = await recentSyncQuery.maybeSingle();

    if (recentSync && recentSync.updated_at) {
      const completedAt = new Date(recentSync.updated_at);
      const minutesAgo = (Date.now() - completedAt.getTime()) / (1000 * 60);

      if (minutesAgo < 5) {
        logger.info('⏭️ [SYNC JOB MANAGER] Skipping duplicate sync - recent sync exists', {
          userId,
          recentSyncId: recentSync.sync_id,
          minutesAgo: Math.round(minutesAgo * 10) / 10,
          fingerprint: syncFingerprint
        });
        return {
          syncId: recentSync.sync_id,
          status: 'skipped',
          message: `Recent sync completed ${Math.round(minutesAgo)} minutes ago. Skipping duplicate.`
        } as any; // Return with skipped status
      }
    }

    const allowDestructiveSyncReset =
      process.env.ALLOW_DESTRUCTIVE_SYNC_RESET === 'true' &&
      process.env.NODE_ENV !== 'production';

    if (allowDestructiveSyncReset) {
      logger.warn('⚠️ [SYNC JOB MANAGER] Destructive sync reset is explicitly enabled outside production', {
        userId,
        syncId
      });
    } else {
      logger.info('🛡️ [SYNC JOB MANAGER] Preserving existing financial truth at sync start', {
        userId,
        syncId
      });
    }

    const syncStatus: SyncJobStatus = {
      syncId,
      userId,
      tenantId: tenantContext.tenantId,
      tenantSlug: tenantContext.tenantSlug,
      storeId: scopedStoreId,
      status: 'running',
      progress: 0,
      message: 'Sync starting...',
      startedAt: new Date().toISOString(),
      ordersProcessed: 0,
      totalOrders: 0,
      claimsDetected: 0,
      syncFingerprint, // Store fingerprint for idempotency (Pillar 1)
      retryCount: 0
    };

    // Create cancel function
    let cancelled = false;
    const cancelFn = () => {
      cancelled = true;
      syncStatus.status = 'cancelled';
      syncStatus.message = 'Sync cancelled by user';
      this.updateSyncStatus(syncStatus);
    };

    // Store job
    this.runningJobs.set(syncId, { status: syncStatus, cancel: cancelFn });

    // Save to database
    await this.saveSyncToDatabase(syncStatus);

    // 🎯 AGENT 2: Send SSE event for sync started with connection verification
    logger.info('🔍 [SYNC JOB MANAGER] Checking SSE connection before sending sync.started event', {
      userId,
      syncId,
      hasConnection: sseHub.hasConnection(userId),
      connectionCount: sseHub.getConnectionCount(userId),
      connectedUsers: sseHub.getConnectedUsers()
    });

    const sseStarted = sseHub.sendEvent(userId, 'sync.started', {
      type: 'sync',
      status: 'started',
      tenant_id: syncStatus.tenantId,
      tenant_slug: syncStatus.tenantSlug,
      store_id: syncStatus.storeId,
      syncId: syncId,
      message: 'Data sync started',
      timestamp: new Date().toISOString()
    });

    if (!sseStarted) {
      logger.warn('⚠️ [SYNC JOB MANAGER] No SSE connection found for sync.started event', {
        userId,
        syncId,
        connectedUsers: sseHub.getConnectedUsers(),
        suggestion: 'Frontend may not have SSE connection open, or user ID mismatch'
      });
    } else {
      logger.info('✅ [SYNC JOB MANAGER] SSE event sync.started sent successfully', { userId, syncId });
    }

    // 🔔 PERSIST: Sync started notification (survives offline)
    try {
      const notificationHelper = (await import('./notificationHelper')).default;
      const { NotificationType, NotificationPriority, NotificationChannel } = await import('../notifications/models/notification');
      await notificationHelper.notifyUser(
        userId,
        NotificationType.SYNC_STARTED,
        'Amazon Update Started',
        'We\'re pulling your latest Amazon records, including recent FBA activity.',
        NotificationPriority.LOW,
        NotificationChannel.IN_APP,
        { syncId }
      );
    } catch (notifErr: any) {
      logger.debug('Failed to persist sync.started notification', { error: notifErr.message });
    }

    // Also send as 'message' event for backward compatibility
    sseHub.sendEvent(userId, 'message', {
      type: 'sync',
      status: 'started',
      tenant_id: syncStatus.tenantId,
      tenant_slug: syncStatus.tenantSlug,
      store_id: syncStatus.storeId,
      syncId: syncId,
      message: 'Data sync started',
      timestamp: new Date().toISOString()
    });

    // Send initial SSE event (progress update)
    this.sendProgressUpdate(userId, syncStatus);

    // Start async sync (don't await)
    this.runSync(syncId, userId, () => cancelled, scopedStoreId, tenantContext.tenantId).catch((error) => {
      logger.error(`Sync job ${syncId} failed:`, error);
      syncStatus.status = 'failed';
      syncStatus.error = error.message;
      syncStatus.message = 'We hit a temporary issue while updating your Amazon records.';
      this.updateSyncStatus(syncStatus);
    });

    return {
      syncId,
      status: 'in_progress'
    };
  }

  /**
   * Send a log event via SSE for frontend log display
   */
  private sendLogEvent(userId: string, syncId: string, log: {
    type: 'info' | 'success' | 'warning' | 'error' | 'progress';
    category: 'orders' | 'inventory' | 'shipments' | 'returns' | 'settlements' | 'fees' | 'claims' | 'detection' | 'system';
    message: string;
    count?: number;
  }): void {
    sseHub.sendEvent(userId, 'sync.log', {
      type: 'log',
      syncId,
      log: {
        ...log,
        timestamp: new Date().toISOString()
      }
    });
    // Also send as 'message' for backward compatibility
    sseHub.sendEvent(userId, 'message', {
      type: 'log',
      syncId,
      log: {
        ...log,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Run the actual sync job asynchronously with timeout protection
   */
  private async runSync(
    syncId: string,
    userId: string,
    isCancelled: () => boolean,
    storeId?: string,
    tenantId?: string
  ): Promise<void> {
    // Set timeout for sync operation (configurable, default 300 seconds - allows ML detection to complete)
    // Can be overridden via SYNC_TIMEOUT_MS environment variable
    const SYNC_TIMEOUT_MS = config.SYNC_TIMEOUT_MS; // Default: 300 seconds (5 minutes)
    const syncStartTime = Date.now();

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Sync timeout after ${SYNC_TIMEOUT_MS / 1000} seconds`));
      }, SYNC_TIMEOUT_MS);
    });
    const job = this.runningJobs.get(syncId);
    if (!job) {
      throw new Error(`Sync job ${syncId} not found`);
    }

    const syncStatus = job.status;
    let syncResult: any = null; // Store Agent 2 sync result for use throughout method

    // Wrap sync execution with timeout
    const syncExecution = async (): Promise<void> => {
      try {
        // Update progress: 10% - Starting Agent 2 sync
        syncStatus.progress = 10;
        syncStatus.message = 'Establishing secure connection...';
        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);

        // Indicate Demo Mode in logs if enabled
        if (process.env.DEMO_MODE === 'true') {
          this.sendLogEvent(userId, syncId, {
            type: 'info',
            category: 'system',
            message: `🧪 [DEMO MODE] Initializing with generated enterprise dataset (${process.env.MOCK_SCENARIO || 'realistic'})`
          });
        }

        this.sendLogEvent(userId, syncId, { type: 'info', category: 'system', message: 'Connecting to Amazon SP-API Secure Tunnel...' });
        this.sendLogEvent(userId, syncId, { type: 'success', category: 'system', message: '[CONNECTED] Secure tunnel established' });

        if (isCancelled()) {
          syncStatus.status = 'cancelled';
          syncStatus.message = 'Sync cancelled';
          this.updateSyncStatus(syncStatus);
          return;
        }

        // Update progress: 20% - Fetching orders
        syncStatus.progress = 20;
        syncStatus.message = 'Accessing seller ledger...';
        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'system', message: 'Requesting access to Seller Central ledger...' });
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'system', message: 'Scanning 18-month transaction window...' });

        if (isCancelled()) {
          syncStatus.status = 'cancelled';
          syncStatus.message = 'Sync cancelled';
          this.updateSyncStatus(syncStatus);
          return;
        }

        // Update progress: 40% - Running Agent 2 data sync
        syncStatus.progress = 40;
        syncStatus.message = 'Reviewing your latest Amazon records...';
        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'system', message: 'Reviewing FBA inventory, orders, returns, and fees...' });
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'system', message: 'Checking your account for missed reimbursements and fee discrepancies...' });

        // Run Agent 2 Data Sync Service (comprehensive data sync with normalization)
        // CRITICAL: This must complete quickly to meet 30s timeout
        logger.info('🔄 [SYNC JOB MANAGER] Starting Agent 2 data sync', { userId, syncId, tenantId, storeId });
        const agent2StartTime = Date.now();
        syncResult = await agent2DataSyncService.syncUserData(userId, storeId, undefined, undefined, syncId, tenantId);
        const agent2Duration = Date.now() - agent2StartTime;
        logger.info('⏱️ [SYNC JOB MANAGER] Agent 2 sync duration', {
          userId,
          syncId,
          duration: `${agent2Duration}ms (${(agent2Duration / 1000).toFixed(2)}s)`
        });

        syncStatus.storeId = syncResult?.storeId || syncStatus.storeId;
        syncStatus.ordersProcessed = syncResult?.summary?.ordersCount || 0;
        syncStatus.totalOrders = syncResult?.summary?.ordersCount || 0;
        syncStatus.inventoryCount = syncResult?.summary?.inventoryCount || 0;
        syncStatus.shipmentsCount = syncResult?.summary?.shipmentsCount || 0;
        syncStatus.returnsCount = syncResult?.summary?.returnsCount || 0;
        syncStatus.settlementsCount = syncResult?.summary?.settlementsCount || 0;
        syncStatus.feesCount = syncResult?.summary?.feesCount || 0;

        // Check if Agent 2 sync failed
        if (!syncResult.success) {
          const partialItemsPersisted =
            (syncStatus.ordersProcessed || 0) +
            (syncStatus.inventoryCount || 0) +
            (syncStatus.shipmentsCount || 0) +
            (syncStatus.returnsCount || 0) +
            (syncStatus.settlementsCount || 0) +
            (syncStatus.feesCount || 0);

          logger.error('❌ [SYNC JOB MANAGER] Agent 2 sync failed', {
            userId,
            syncId,
            errors: syncResult.errors,
            summary: syncResult.summary,
            partialItemsPersisted
          });

          syncStatus.progress = Math.max(syncStatus.progress, 70);
          syncStatus.message = partialItemsPersisted > 0
            ? 'We synced part of your Amazon data, but this run did not finish cleanly.'
            : 'We hit a temporary issue while updating your Amazon records.';
          syncStatus.error = syncResult.errors.join(', ') || 'Unknown Agent 2 sync error';

          throw new Error(
            partialItemsPersisted > 0
              ? `Agent 2 sync partially failed after persisting ${partialItemsPersisted} records: ${syncStatus.error}`
              : `Agent 2 sync failed: ${syncStatus.error}`
          );
        }

        // Log Agent 2 summary in detail to debug wrong counts
        logger.info('✅ [SYNC JOB MANAGER] Agent 2 sync completed', {
          userId,
          syncId,
          success: syncResult.success,
          summary: syncResult.summary,
          isMock: syncResult.isMock,
          ordersCount: syncResult.summary?.ordersCount,
          inventoryCount: syncResult.summary?.inventoryCount,
          shipmentsCount: syncResult.summary?.shipmentsCount,
          returnsCount: syncResult.summary?.returnsCount,
          settlementsCount: syncResult.summary?.settlementsCount,
          feesCount: syncResult.summary?.feesCount,
          claimsCount: syncResult.summary?.claimsCount
        });

        if (isCancelled()) {
          syncStatus.status = 'cancelled';
          syncStatus.message = 'Sync cancelled';
          this.updateSyncStatus(syncStatus);
          return;
        }

        // Update progress: 70% - Data normalization complete
        syncStatus.progress = 70;
        syncStatus.message = 'Your Amazon records are in. Preparing the results...';
        // Store all data type counts from Agent 2 at this point
        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);

        // Send completion log events - machine dialogue style
        if (syncStatus.ordersProcessed && syncStatus.ordersProcessed > 0) {
          this.sendLogEvent(userId, syncId, {
            type: 'success',
            category: 'orders',
            message: `[FOUND] ${syncStatus.ordersProcessed.toLocaleString()} orders in ledger`,
            count: syncStatus.ordersProcessed
          });
          this.sendLogEvent(userId, syncId, {
            type: 'info',
            category: 'orders',
            message: 'Cross-referencing order IDs with fulfillment records...'
          });
        }
        if (syncStatus.inventoryCount && syncStatus.inventoryCount > 0) {
          this.sendLogEvent(userId, syncId, {
            type: 'success',
            category: 'inventory',
            message: `[FOUND] ${syncStatus.inventoryCount.toLocaleString()} active SKUs in warehouse`,
            count: syncStatus.inventoryCount
          });
          this.sendLogEvent(userId, syncId, {
            type: 'info',
            category: 'inventory',
            message: 'Checking unit counts against inbound shipments...'
          });
        }
        if (syncStatus.shipmentsCount && syncStatus.shipmentsCount > 0) {
          this.sendLogEvent(userId, syncId, {
            type: 'success',
            category: 'shipments',
            message: `[FOUND] ${syncStatus.shipmentsCount.toLocaleString()} shipments to fulfillment centers`,
            count: syncStatus.shipmentsCount
          });
          this.sendLogEvent(userId, syncId, {
            type: 'info',
            category: 'shipments',
            message: 'Verifying received quantities match shipped quantities...'
          });
        }
        if (syncStatus.returnsCount && syncStatus.returnsCount > 0) {
          this.sendLogEvent(userId, syncId, {
            type: 'success',
            category: 'returns',
            message: `[FOUND] ${syncStatus.returnsCount.toLocaleString()} customer returns processed`,
            count: syncStatus.returnsCount
          });
          this.sendLogEvent(userId, syncId, {
            type: 'info',
            category: 'returns',
            message: 'Checking if returns were properly credited to seller account...'
          });
        }
        if (syncStatus.settlementsCount && syncStatus.settlementsCount > 0) {
          this.sendLogEvent(userId, syncId, {
            type: 'success',
            category: 'settlements',
            message: `[FOUND] ${syncStatus.settlementsCount.toLocaleString()} settlement periods`,
            count: syncStatus.settlementsCount
          });
          this.sendLogEvent(userId, syncId, {
            type: 'info',
            category: 'settlements',
            message: 'Reconciling payouts with expected amounts...'
          });
        }
        if (syncStatus.feesCount && syncStatus.feesCount > 0) {
          this.sendLogEvent(userId, syncId, {
            type: 'success',
            category: 'fees',
            message: `[FOUND] ${syncStatus.feesCount.toLocaleString()} fee line items`,
            count: syncStatus.feesCount
          });
          this.sendLogEvent(userId, syncId, {
            type: 'info',
            category: 'fees',
            message: 'Analyzing fee calculations for overcharges...'
          });
        }

        if (isCancelled()) {
          syncStatus.status = 'cancelled';
          syncStatus.message = 'Sync cancelled';
          this.updateSyncStatus(syncStatus);
          return;
        }

        // Update progress: 80% - DETECTION PHASE (now blocking)
        // Agent 2 now runs detection as part of the sync, so we have results immediately
        syncStatus.progress = 80;
        syncStatus.status = 'detecting'; // New status phase!
        syncStatus.message = 'Checking your account for discrepancies...';
        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'detection', message: 'Scanning for missing reimbursements, losses, and fee issues...' });
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'detection', message: 'Comparing shipped, received, and returned units...' });
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'detection', message: 'Checking for units Amazon may owe you for...' });
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'detection', message: 'Reviewing fee charges against your product data...' });

        // Get detection results from Agent 2 (now included in syncResult)
        const detectionResult = syncResult?.detectionResult;

        if (detectionResult && detectionResult.completed) {
          if (detectionResult.totalDetected > 0) {
            syncStatus.claimsDetected = detectionResult.totalDetected;

            // Query ACTUAL total value from detection results - no fallback
            let actualValue = 0;
            try {
              const { data: amounts } = await supabase
                .from('detection_results')
                .select('estimated_value')
                .eq('seller_id', userId)
                .eq('sync_id', syncId);

              if (amounts && amounts.length > 0) {
                actualValue = amounts.reduce((sum, r) => sum + (parseFloat(r.estimated_value) || 0), 0);
              }
            } catch (err) {
              logger.debug('Could not query detection amounts', { error: err });
            }

            syncStatus.totalRecoverableValue = actualValue;
            const formattedValue = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(actualValue);

            logger.info('✅ [SYNC JOB MANAGER] Detection completed with results', {
              userId,
              syncId,
              totalDetected: detectionResult.totalDetected,
              totalRecoverableValue: actualValue
            });

            this.sendLogEvent(userId, syncId, {
              type: 'warning',
              category: 'detection',
              message: '[ALERT] Discrepancies detected in seller data'
            });
            this.sendLogEvent(userId, syncId, {
              type: 'success',
              category: 'detection',
              message: `[RESULT] ${detectionResult.totalDetected.toLocaleString()} recoverable items identified`,
              count: detectionResult.totalDetected
            });
            this.sendLogEvent(userId, syncId, {
              type: 'success',
              category: 'detection',
              message: `[RECOVERY] Potential recovery: ${formattedValue}`
            });
          } else if (detectionResult.skipped) {
            logger.info('ℹ️ [SYNC JOB MANAGER] Detection skipped', {
              userId,
              syncId,
              reason: detectionResult.reason
            });
            this.sendLogEvent(userId, syncId, { type: 'info', category: 'detection', message: `[SKIPPED] ${detectionResult.reason || 'Insufficient data for analysis'}` });
          } else {
            logger.info('ℹ️ [SYNC JOB MANAGER] Detection completed - no discrepancies found', {
              userId,
              syncId
            });
            this.sendLogEvent(userId, syncId, { type: 'info', category: 'detection', message: 'Scan complete. All records appear aligned.' });
            this.sendLogEvent(userId, syncId, { type: 'success', category: 'detection', message: '[RESULT] No discrepancies detected in current window' });
          }
        } else if (detectionResult && detectionResult.error) {
          logger.warn('⚠️ [SYNC JOB MANAGER] Detection failed', {
            userId,
            syncId,
            error: detectionResult.error
          });
          this.sendLogEvent(userId, syncId, { type: 'warning', category: 'detection', message: `[ERROR] Analysis interrupted: ${detectionResult.error}` });
        } else {
          // Fallback: Check database for detection results - get ACTUAL values, no fallback
          try {
            // Query both count and sum of actual amounts
            const { data: detectionStats, error: statsError } = await supabase
              .from('detection_results')
              .select('estimated_value')
              .eq('seller_id', userId)
              .eq('sync_id', syncId);

            if (!statsError && detectionStats && detectionStats.length > 0) {
              const count = detectionStats.length;
              const totalValue = detectionStats.reduce((sum, r) => sum + (parseFloat(r.estimated_value) || 0), 0);

              syncStatus.claimsDetected = count;
              syncStatus.totalRecoverableValue = totalValue;

              const formattedValue = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalValue);
              this.sendLogEvent(userId, syncId, {
                type: 'success',
                category: 'detection',
                message: `✓ ${count.toLocaleString()} potential recoveries found (${formattedValue})`,
                count: count
              });
            } else {
              this.sendLogEvent(userId, syncId, { type: 'info', category: 'detection', message: '✓ Detection complete - no discrepancies in this data' });
            }
          } catch (error: any) {
            logger.debug('Detection check error (non-critical)', { error: error.message, userId, syncId });
          }
        }

        // Update status back to completing
        syncStatus.status = 'running';
        this.updateSyncStatus(syncStatus);

        // Update progress: 95% - Finalizing
        syncStatus.progress = 95;
        syncStatus.message = 'Finalizing your sync results...';
        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'system', message: 'Compiling analysis results...' });
        this.sendLogEvent(userId, syncId, { type: 'info', category: 'system', message: 'Generating recovery report...' });

        // Get sync results from database (now includes detection results if completed)
        const syncResults = await this.getSyncResults(userId, syncId, syncStatus.tenantId, syncStatus.storeId);

        // Use Agent 2 sync result data if available, otherwise use database results
        // NOTE: Claims are NOT included - they're detected FROM the data, not synced data
        const totalItemsSynced = syncResult
          ? ((syncResult.summary?.ordersCount || 0) +
            (syncResult.summary?.shipmentsCount || 0) +
            (syncResult.summary?.returnsCount || 0) +
            (syncResult.summary?.settlementsCount || 0) +
            (syncResult.summary?.inventoryCount || 0) +
            (syncResult.summary?.feesCount || 0))
          : ((syncResults.ordersProcessed || 0) + (syncResults.totalOrders || 0));

        // Debug logging to trace where "48 items" comes from
        logger.info('🔍 [SYNC JOB MANAGER] Calculating totalItemsSynced', {
          userId,
          syncId,
          hasSyncResult: !!syncResult,
          hasSummary: !!(syncResult?.summary),
          agent2Counts: syncResult?.summary ? {
            ordersCount: syncResult.summary.ordersCount || 0,
            shipmentsCount: syncResult.summary.shipmentsCount || 0,
            returnsCount: syncResult.summary.returnsCount || 0,
            settlementsCount: syncResult.summary.settlementsCount || 0,
            inventoryCount: syncResult.summary.inventoryCount || 0,
            feesCount: syncResult.summary.feesCount || 0,
            claimsCount: syncResult.summary.claimsCount || 0  // Note: claims are detected, not synced
          } : null,
          databaseCounts: !syncResult ? {
            ordersProcessed: syncResults.ordersProcessed || 0,
            totalOrders: syncResults.totalOrders || 0
          } : null,
          calculatedTotal: totalItemsSynced
        });

        // Update progress: 100% - Complete (use 'completed' to match database)
        syncStatus.progress = 100;
        syncStatus.status = 'completed';
        syncStatus.message = syncResults.claimsDetected > 0
          ? `Amazon sync finished. ${syncResults.claimsDetected} potential discrepanc${syncResults.claimsDetected === 1 ? 'y was' : 'ies were'} found.`
          : 'Your Amazon records are up to date. No discrepancies found.';
        syncStatus.completedAt = new Date().toISOString();
        // Store all data type counts from Agent 2 - ALWAYS use Agent 2 result, never fall back to database
        // The database might have old/incomplete data from previous updates
        if (syncResult && syncResult.summary) {
          syncStatus.ordersProcessed = syncResult.summary.ordersCount || 0;
          syncStatus.totalOrders = syncResult.summary.ordersCount || 0;
          syncStatus.inventoryCount = syncResult.summary.inventoryCount || 0;
          syncStatus.shipmentsCount = syncResult.summary.shipmentsCount || 0;
          syncStatus.returnsCount = syncResult.summary.returnsCount || 0;
          syncStatus.settlementsCount = syncResult.summary.settlementsCount || 0;
          syncStatus.feesCount = syncResult.summary.feesCount || 0;

          // Log what we're saving to debug wrong counts
          logger.info('💾 [SYNC JOB MANAGER] Saving sync completion with Agent 2 counts', {
            userId,
            syncId,
            ordersProcessed: syncStatus.ordersProcessed,
            totalOrders: syncStatus.totalOrders,
            inventoryCount: syncStatus.inventoryCount,
            shipmentsCount: syncStatus.shipmentsCount,
            returnsCount: syncStatus.returnsCount,
            settlementsCount: syncStatus.settlementsCount,
            feesCount: syncStatus.feesCount,
            totalItemsSynced
          });
        } else {
          // Only use database results if Agent 2 result is not available (shouldn't happen)
          logger.warn('⚠️ [SYNC JOB MANAGER] Agent 2 sync result not available, using database results (may be incomplete)', {
            userId,
            syncId,
            hasSyncResult: !!syncResult,
            hasSummary: !!(syncResult?.summary),
            databaseOrdersProcessed: syncResults.ordersProcessed,
            databaseTotalOrders: syncResults.totalOrders
          });
          syncStatus.ordersProcessed = syncResults.ordersProcessed || 0;
          syncStatus.totalOrders = syncResults.totalOrders || 0;
          syncStatus.inventoryCount = 0;
          syncStatus.shipmentsCount = 0;
          syncStatus.returnsCount = 0;
          syncStatus.settlementsCount = 0;
          syncStatus.feesCount = 0;
        }

        // Always use database count for claimsDetected (most accurate)
        syncStatus.claimsDetected = syncResults.claimsDetected || 0;
        logger.info('💾 [SYNC JOB MANAGER] Setting claimsDetected before final save', {
          userId,
          syncId,
          claimsDetected: syncStatus.claimsDetected,
          fromSyncResults: syncResults.claimsDetected
        });

        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);

        // Send final completion log - machine dialogue style
        this.sendLogEvent(userId, syncId, {
          type: 'success',
          category: 'system',
          message: `[COMPLETE] Analysis finished. ${totalItemsSynced.toLocaleString()} records processed.`
        });
        if (syncStatus.claimsDetected > 0) {
          // Use ACTUAL totalRecoverableValue - no fallback
          const finalValue = syncStatus.totalRecoverableValue || 0;
          const finalFormattedValue = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(finalValue);
          this.sendLogEvent(userId, syncId, {
            type: 'success',
            category: 'detection',
            message: `[READY] ${syncStatus.claimsDetected} claims ready for recovery (${finalFormattedValue} potential)`
          });
        } else {
          this.sendLogEvent(userId, syncId, {
            type: 'info',
            category: 'system',
            message: 'Monitoring active. Will alert on new discrepancies.'
          });
        }

        // 🎯 AGENT 2: Send SSE event for sync completed with connection verification
        logger.info('🔍 [SYNC JOB MANAGER] Checking SSE connection before sending sync.completed event', {
          userId,
          syncId,
          hasConnection: sseHub.hasConnection(userId),
          connectionCount: sseHub.getConnectionCount(userId),
          connectedUsers: sseHub.getConnectedUsers()
        });

        const sseCompleted = sseHub.sendEvent(userId, 'sync.completed', {
          type: 'sync',
          status: 'completed',
          tenant_id: syncStatus.tenantId,
          tenant_slug: syncStatus.tenantSlug,
          store_id: syncStatus.storeId,
          syncId: syncId,
          ordersProcessed: syncStatus.ordersProcessed || 0,
          totalOrders: syncStatus.totalOrders || 0,
          inventoryCount: syncStatus.inventoryCount || 0,
          shipmentsCount: syncStatus.shipmentsCount || 0,
          returnsCount: syncStatus.returnsCount || 0,
          settlementsCount: syncStatus.settlementsCount || 0,
          feesCount: syncStatus.feesCount || 0,
          claimsDetected: syncStatus.claimsDetected || 0,
          totalRecoverableValue: syncStatus.totalRecoverableValue || 0, // ACTUAL VALUE - no fallback
          message: syncStatus.message,
          timestamp: new Date().toISOString()
        });

        if (!sseCompleted) {
          logger.warn('⚠️ [SYNC JOB MANAGER] No SSE connection found for sync.completed event', {
            userId,
            syncId,
            connectedUsers: sseHub.getConnectedUsers(),
            suggestion: 'Frontend may not have SSE connection open, or user ID mismatch'
          });
        } else {
          logger.info('✅ [SYNC JOB MANAGER] SSE event sync.completed sent successfully', { userId, syncId });
        }

        // 🔔 PERSIST: Sync completed notification (survives offline)
        try {
          const notificationHelper = (await import('./notificationHelper')).default;
          const { NotificationType, NotificationPriority, NotificationChannel } = await import('../notifications/models/notification');
          const claimMsg = syncStatus.claimsDetected && syncStatus.claimsDetected > 0
            ? ` ${syncStatus.claimsDetected} potential recover${syncStatus.claimsDetected === 1 ? 'y was' : 'ies were'} found.`
            : ' No discrepancies found.';
          const valueMsg = syncStatus.totalRecoverableValue && syncStatus.totalRecoverableValue > 0
            ? ` Estimated value: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(syncStatus.totalRecoverableValue)}.`
            : '';
          await notificationHelper.notifyUser(
            userId,
            NotificationType.SYNC_COMPLETED,
            'Amazon Update Complete',
            `Your Amazon update finished successfully.${claimMsg}${valueMsg}`,
            syncStatus.claimsDetected && syncStatus.claimsDetected > 0 ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
            NotificationChannel.IN_APP,
            {
              syncId,
              ordersProcessed: syncStatus.ordersProcessed || 0,
              claimsDetected: syncStatus.claimsDetected || 0,
              totalRecoverableValue: syncStatus.totalRecoverableValue || 0
            }
          );
        } catch (notifErr: any) {
          logger.debug('Failed to persist sync.completed notification', { error: notifErr.message });
        }

        // Also send as 'message' event for backward compatibility
        sseHub.sendEvent(userId, 'message', {
          type: 'sync',
          status: 'completed',
          tenant_id: syncStatus.tenantId,
          tenant_slug: syncStatus.tenantSlug,
          store_id: syncStatus.storeId,
          syncId: syncId,
          ordersProcessed: syncStatus.ordersProcessed || 0,
          totalOrders: syncStatus.totalOrders || 0,
          inventoryCount: syncStatus.inventoryCount || 0,
          shipmentsCount: syncStatus.shipmentsCount || 0,
          returnsCount: syncStatus.returnsCount || 0,
          settlementsCount: syncStatus.settlementsCount || 0,
          feesCount: syncStatus.feesCount || 0,
          claimsDetected: syncStatus.claimsDetected || 0,
          message: syncStatus.message,
          timestamp: new Date().toISOString()
        });

        // Remove from running jobs after a delay
        setTimeout(() => {
          this.runningJobs.delete(syncId);
        }, 60000); // Keep for 1 minute after completion

      } catch (error: any) {
        logger.error(`Sync job ${syncId} error:`, error);

        // 🔐 PILLAR 1: STRUCTURED ERROR HANDLING
        const structuredError = toSyncError(error);

        syncStatus.status = 'failed';
        syncStatus.error = error.message;
        syncStatus.errorCode = structuredError.code;
        syncStatus.errorDetails = structuredError;
        const partialItemsPersisted =
          (syncStatus.ordersProcessed || 0) +
          (syncStatus.inventoryCount || 0) +
          (syncStatus.shipmentsCount || 0) +
          (syncStatus.returnsCount || 0) +
          (syncStatus.settlementsCount || 0) +
          (syncStatus.feesCount || 0);
        syncStatus.message = partialItemsPersisted > 0
          ? 'We synced part of your Amazon data, but this run did not finish cleanly.'
          : 'We hit a temporary issue while updating your Amazon records.';
        syncStatus.completedAt = new Date().toISOString();

        // Log structured error with next action
        logger.info('🔐 [SYNC JOB MANAGER] Structured error captured', {
          userId,
          syncId,
          errorCode: structuredError.code,
          nextAction: structuredError.nextAction,
          retryInSeconds: structuredError.retryInSeconds
        });

        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);

        // 🎯 AGENT 2: Send SSE event for sync failed with connection verification
        logger.info('🔍 [SYNC JOB MANAGER] Checking SSE connection before sending sync.failed event', {
          userId,
          syncId,
          hasConnection: sseHub.hasConnection(userId),
          connectionCount: sseHub.getConnectionCount(userId),
          error: error.message
        });

        const sseFailed = sseHub.sendEvent(userId, 'sync.failed', {
          type: 'sync',
          status: 'failed',
          tenant_id: syncStatus.tenantId,
          tenant_slug: syncStatus.tenantSlug,
          store_id: syncStatus.storeId,
          syncId: syncId,
          ordersProcessed: syncStatus.ordersProcessed || 0,
          inventoryCount: syncStatus.inventoryCount || 0,
          shipmentsCount: syncStatus.shipmentsCount || 0,
          returnsCount: syncStatus.returnsCount || 0,
          settlementsCount: syncStatus.settlementsCount || 0,
          feesCount: syncStatus.feesCount || 0,
          error: error.message,
          message: syncStatus.message,
          timestamp: new Date().toISOString()
        });

        if (!sseFailed) {
          logger.warn('⚠️ [SYNC JOB MANAGER] No SSE connection found for sync.failed event', {
            userId,
            syncId,
            connectedUsers: sseHub.getConnectedUsers(),
            error: error.message
          });
        } else {
          logger.info('✅ [SYNC JOB MANAGER] SSE event sync.failed sent successfully', { userId, syncId });
        }

        // 🔔 PERSIST: Sync failed notification (survives offline)
        try {
          const notificationHelper = (await import('./notificationHelper')).default;
          const { NotificationType, NotificationPriority, NotificationChannel } = await import('../notifications/models/notification');
          await notificationHelper.notifyUser(
            userId,
            NotificationType.SYNC_FAILED,
            'Amazon Update Paused',
            'We hit a temporary issue while updating your Amazon records. We\'ll retry automatically.',
            NotificationPriority.HIGH,
            NotificationChannel.IN_APP,
            { syncId, errorCode: structuredError.code, error: error.message }
          );
        } catch (notifErr: any) {
          logger.debug('Failed to persist sync.failed notification', { error: notifErr.message });
        }

        // Also send as 'message' event for backward compatibility
        sseHub.sendEvent(userId, 'message', {
          type: 'sync',
          status: 'failed',
          tenant_id: syncStatus.tenantId,
          tenant_slug: syncStatus.tenantSlug,
          syncId: syncId,
          error: error.message,
          message: syncStatus.message,
          timestamp: new Date().toISOString()
        });

        throw error;
      }
    };

    // Race between sync execution and timeout
    try {
      await Promise.race([syncExecution(), timeoutPromise]);
    } catch (error: any) {
      // Check if it's a timeout error
      if (error.message && error.message.includes('timeout')) {
        logger.error(`⏱️ [SYNC JOB MANAGER] Sync timeout after ${SYNC_TIMEOUT_MS / 1000} seconds`, {
          userId,
          syncId,
          duration: Date.now() - syncStartTime
        });

        syncStatus.status = 'failed';
        syncStatus.error = `Sync timeout after ${SYNC_TIMEOUT_MS / 1000} seconds`;
        syncStatus.message = 'Updating your Amazon records took longer than expected and has been stopped. Please try again.';
        syncStatus.completedAt = new Date().toISOString();
        this.updateSyncStatus(syncStatus);
        this.sendProgressUpdate(userId, syncStatus);

        // Send SSE timeout event
        sseHub.sendEvent(userId, 'sync.failed', {
          type: 'sync',
          status: 'failed',
          syncId: syncId,
          error: syncStatus.error,
          message: syncStatus.message,
          timestamp: new Date().toISOString()
        });

        throw error;
      } else {
        // Re-throw other errors
        throw error;
      }
    }
  }

  /**
   * Get sync status by syncId
   */
  async getSyncStatus(syncId: string, userId: string, tenantId?: string, storeId?: string): Promise<SyncJobStatus | null> {
    // Check running jobs first
    const job = this.runningJobs.get(syncId);
    if (job) {
      // Verify it belongs to the user
      if (job.status.userId === userId && this.matchesScope(job.status, tenantId, storeId)) {
        return job.status;
      }
      return null;
    }

    // Check database
    try {
      const scopedQuery = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .select('*')
          .eq('sync_id', syncId)
          .eq('user_id', userId),
        tenantId,
        storeId
      );
      const { data, error } = await scopedQuery.single();

      if (error || !data) {
        return null;
      }

      const shouldRefreshFromDatabase =
        data.status === 'completed' ||
        data.status === 'complete' ||
        data.status === 'failed' ||
        data.status === 'cancelled' ||
        (data.progress && data.progress >= 80);

      if (shouldRefreshFromDatabase) {
        const syncResults = await this.getSyncResults(data.user_id, data.sync_id, tenantId, storeId);
        return this.buildSyncJobStatusFromRow(data, syncResults);
      }

      return this.buildSyncJobStatusFromRow(data);
    } catch (error) {
      logger.error(`Error getting sync status for ${syncId}:`, error);
      return null;
    }
  }

  /**
   * Cancel a sync job (both in-memory and database)
   */
  async cancelSync(syncId: string, userId: string, tenantId: string, storeId?: string): Promise<boolean> {
    const job = this.runningJobs.get(syncId);

    // Check if job exists in memory
    if (job) {
      // Verify it belongs to the user and current scope
      if (job.status.userId !== userId || !this.matchesScope(job.status, tenantId, storeId)) {
        return false;
      }

      // Cancel the job
      job.cancel();

      // Update database
      await this.updateSyncStatusInDatabase(syncId, userId, {
        status: 'cancelled',
        message: 'Sync cancelled by user',
        completedAt: new Date().toISOString()
      }, tenantId, storeId);

      return true;
    }

    // If not in memory, check database and cancel there
    try {
      const scopedQuery = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .select('*')
          .eq('sync_id', syncId)
          .eq('user_id', userId),
        tenantId,
        storeId
      );
      const { data, error } = await scopedQuery.single();

      if (error || !data) {
        return false;
      }

      // Only cancel if it's actually running or detecting
      if (data.status === 'running' || data.status === 'in_progress' || data.status === 'detecting') {
        await this.updateSyncStatusInDatabase(syncId, userId, {
          status: 'cancelled',
          message: 'Sync cancelled by user',
          completedAt: new Date().toISOString()
        }, tenantId, storeId);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error cancelling sync ${syncId}:`, error);
      return false;
    }
  }

  /**
   * Update sync status in database (helper method)
   */
  private async updateSyncStatusInDatabase(
    syncId: string,
    userId: string,
    updates: Partial<SyncJobStatus>,
    tenantId?: string,
    storeId?: string
  ): Promise<void> {
    try {
      const scopedUpdate = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .update({
            status: updates.status === 'running' ? 'running' :
              updates.status === 'detecting' ? 'detecting' :
                updates.status === 'completed' ? 'completed' :
                  updates.status === 'failed' ? 'failed' :
                    updates.status === 'cancelled' ? 'cancelled' : 'running',
            current_step: updates.message,
            progress: updates.progress,
            updated_at: new Date().toISOString(),
            metadata: {
              ...(updates.ordersProcessed !== undefined && { ordersProcessed: updates.ordersProcessed }),
              ...(updates.totalOrders !== undefined && { totalOrders: updates.totalOrders }),
              ...(updates.inventoryCount !== undefined && { inventoryCount: updates.inventoryCount }),
              ...(updates.shipmentsCount !== undefined && { shipmentsCount: updates.shipmentsCount }),
              ...(updates.returnsCount !== undefined && { returnsCount: updates.returnsCount }),
              ...(updates.settlementsCount !== undefined && { settlementsCount: updates.settlementsCount }),
              ...(updates.feesCount !== undefined && { feesCount: updates.feesCount }),
              ...(updates.claimsDetected !== undefined && { claimsDetected: updates.claimsDetected }),
              ...(updates.error && { error: updates.error }),
              ...(updates.completedAt && { completedAt: updates.completedAt })
            }
          })
          .eq('sync_id', syncId)
          .eq('user_id', userId),
        tenantId,
        storeId
      );
      const { error } = await scopedUpdate;

      if (error) {
        logger.error(`Error updating sync status in database:`, error);
      }
    } catch (error) {
      logger.error(`Error in updateSyncStatusInDatabase:`, error);
    }
  }

  /**
   * Get sync history for a user
   */
  async getSyncHistory(userId: string, limit: number = 20, offset: number = 0, tenantId?: string, storeId?: string): Promise<{
    syncs: SyncJobStatus[];
    total: number;
  }> {
    try {
      const query = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .select('*', { count: 'exact' })
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1),
        tenantId,
        storeId
      );

      const { data, error, count } = await query;

      if (error) {
        logger.error(`Error getting sync history for ${userId}:`, error);
        return { syncs: [], total: 0 };
      }

      const syncs = (data || []).map((row: any) => this.buildSyncJobStatusFromRow(row));

      return {
        syncs,
        total: count || 0
      };
    } catch (error) {
      logger.error(`Error getting sync history for ${userId}:`, error);
      return { syncs: [], total: 0 };
    }
  }

  /**
   * Get active sync status for a user (for frontend monitoring)
   * Returns format: { hasActiveSync: boolean, lastSync: { syncId, status, ... } | null }
   */
  async getActiveSyncStatus(userId: string, tenantId?: string, storeId?: string): Promise<{
    hasActiveSync: boolean;
    lastSync: {
      syncId: string;
      status: string;
      progress?: number;
      message?: string;
      startedAt?: string;
      completedAt?: string;
      ordersProcessed?: number;
      totalOrders?: number;
      inventoryCount?: number;
      shipmentsCount?: number;
      returnsCount?: number;
      settlementsCount?: number;
      feesCount?: number;
      claimsDetected?: number;
    } | null;
  }> {
    // Check running jobs first
    for (const job of this.runningJobs.values()) {
      if (job.status.userId === userId && job.status.status === 'running' && this.matchesScope(job.status, tenantId, storeId)) {
        return {
          hasActiveSync: true,
          lastSync: {
            syncId: job.status.syncId,
            status: job.status.status,
            progress: job.status.progress,
            message: job.status.message,
            startedAt: job.status.startedAt,
            completedAt: job.status.completedAt,
            ordersProcessed: job.status.ordersProcessed,
            totalOrders: job.status.totalOrders,
            inventoryCount: job.status.inventoryCount,
            shipmentsCount: job.status.shipmentsCount,
            returnsCount: job.status.returnsCount,
            settlementsCount: job.status.settlementsCount,
            feesCount: job.status.feesCount,
            claimsDetected: job.status.claimsDetected
          }
        };
      }
    }

    // Check database for active syncs
    try {
      const activeQuery = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'running')
          .order('created_at', { ascending: false })
          .limit(1),
        tenantId,
        storeId
      );
      const { data, error } = await activeQuery.maybeSingle();

      if (!error && data) {
        const syncResults =
          (data.progress || 0) >= 80
            ? await this.getSyncResults(userId, data.sync_id, tenantId, storeId)
            : undefined;
        const hydrated = this.buildSyncJobStatusFromRow(data, syncResults);

        return {
          hasActiveSync: true,
          lastSync: {
            syncId: hydrated.syncId,
            status: hydrated.status,
            progress: hydrated.progress,
            message: hydrated.message,
            startedAt: hydrated.startedAt,
            completedAt: hydrated.completedAt,
            ordersProcessed: hydrated.ordersProcessed,
            totalOrders: hydrated.totalOrders,
            inventoryCount: hydrated.inventoryCount,
            shipmentsCount: hydrated.shipmentsCount,
            returnsCount: hydrated.returnsCount,
            settlementsCount: hydrated.settlementsCount,
            feesCount: hydrated.feesCount,
            claimsDetected: hydrated.claimsDetected
          }
        };
      }

      // No active sync, get last sync (completed or failed)
      const lastSyncQuery = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .select('*')
          .eq('user_id', userId)
          .in('status', ['completed', 'failed', 'cancelled', 'complete'])
          .order('created_at', { ascending: false })
          .limit(1),
        tenantId,
        storeId
      );
      const { data: lastSyncData } = await lastSyncQuery.maybeSingle();

      if (lastSyncData) {
        const syncResults = await this.getSyncResults(userId, lastSyncData.sync_id, tenantId, storeId);
        const hydrated = this.buildSyncJobStatusFromRow(lastSyncData, syncResults);
        const progress = hydrated.status === 'completed' && hydrated.progress < 100 ? 100 : hydrated.progress;

        return {
          hasActiveSync: false,
          lastSync: {
            syncId: hydrated.syncId,
            status: hydrated.status,
            progress,
            message: hydrated.message,
            startedAt: hydrated.startedAt,
            completedAt: hydrated.completedAt,
            ordersProcessed: hydrated.ordersProcessed,
            totalOrders: hydrated.totalOrders,
            inventoryCount: hydrated.inventoryCount,
            shipmentsCount: hydrated.shipmentsCount,
            returnsCount: hydrated.returnsCount,
            settlementsCount: hydrated.settlementsCount,
            feesCount: hydrated.feesCount,
            claimsDetected: hydrated.claimsDetected
          }
        };
      }

      return {
        hasActiveSync: false,
        lastSync: null
      };
    } catch (error) {
      logger.error(`Error getting active sync status for ${userId}:`, error);
      return {
        hasActiveSync: false,
        lastSync: null
      };
    }
  }

  /**
   * Get active sync for a user (private helper)
   */
  private async getActiveSync(userId: string, tenantId?: string, storeId?: string): Promise<SyncJobStatus | null> {
    // Check running jobs first
    for (const job of this.runningJobs.values()) {
      if (job.status.userId === userId && job.status.status === 'running' && this.matchesScope(job.status, tenantId, storeId)) {
        return job.status;
      }
    }

    // Check database
    try {
      const scopedQuery = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'running')
          .order('created_at', { ascending: false })
          .limit(1),
        tenantId,
        storeId
      );
      const { data, error } = await scopedQuery.maybeSingle();

      if (error || !data) {
        return null;
      }

      return this.buildSyncJobStatusFromRow(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * Save sync status to database (normalized to database status values)
   */
  private async saveSyncToDatabase(syncStatus: SyncJobStatus): Promise<void> {
    try {
      // Normalize status to database format (status is already in correct format)
      const dbStatus: string = syncStatus.status;

      const metadataToSave = {
        ordersProcessed: syncStatus.ordersProcessed || 0,
        totalOrders: syncStatus.totalOrders || 0,
        inventoryCount: syncStatus.inventoryCount || 0,
        shipmentsCount: syncStatus.shipmentsCount || 0,
        returnsCount: syncStatus.returnsCount || 0,
        settlementsCount: syncStatus.settlementsCount || 0,
        feesCount: syncStatus.feesCount || 0,
        claimsDetected: syncStatus.claimsDetected || 0,
        totalItemsSynced:
          (syncStatus.ordersProcessed || 0) +
          (syncStatus.inventoryCount || 0) +
          (syncStatus.shipmentsCount || 0) +
          (syncStatus.returnsCount || 0) +
          (syncStatus.settlementsCount || 0) +
          (syncStatus.feesCount || 0),
        error: syncStatus.error,
        startedAt: syncStatus.startedAt,
        completedAt: syncStatus.completedAt,
        // Pillar 1: Enhanced error tracking
        errorCode: syncStatus.errorCode,
        errorDetails: syncStatus.errorDetails,
        retryCount: syncStatus.retryCount || 0,
        // Pillar 3: Coverage tracking
        coverage: syncStatus.coverage,
        coverageComplete: syncStatus.coverageComplete
      };

      logger.info('💾 [SYNC JOB MANAGER] Saving sync to database', {
        userId: syncStatus.userId,
        tenantId: syncStatus.tenantId,
        storeId: syncStatus.storeId,
        syncId: syncStatus.syncId,
        status: dbStatus,
        progress: syncStatus.progress,
        claimsDetected: metadataToSave.claimsDetected,
        syncStatusClaimsDetected: syncStatus.claimsDetected
      });

      // Use insert with update fallback instead of upsert (onConflict may fail)
      const existingSync = await supabase
        .from('sync_progress')
        .select('id')
        .eq('sync_id', syncStatus.syncId)
        .maybeSingle();

      // Fields to save for Pillar 1 & 3 enhancements
      const enhancedFields: Record<string, any> = {
        tenant_id: syncStatus.tenantId || null,
        store_id: syncStatus.storeId || null,
        step: Math.round(syncStatus.progress / 20),
        total_steps: 5,
        current_step: syncStatus.message,
        status: dbStatus,
        progress: syncStatus.progress,
        metadata: metadataToSave,
        updated_at: new Date().toISOString(),
        // Pillar 1: Idempotency
        sync_fingerprint: syncStatus.syncFingerprint,
        // Pillar 1: Reliability - error tracking
        error_code: syncStatus.errorCode,
        error_details: syncStatus.errorDetails ? JSON.stringify(syncStatus.errorDetails) : null,
        retry_count: syncStatus.retryCount || 0,
        // Pillar 3: Coverage tracking
        coverage: syncStatus.coverage ? JSON.stringify(syncStatus.coverage) : null,
        coverage_complete: syncStatus.coverageComplete || false
      };

      // Add last_successful_sync_at if completed successfully
      if (dbStatus === 'completed') {
        enhancedFields.last_successful_sync_at = new Date().toISOString();
      }

      if (existingSync.data) {
        // Update existing record
        const { error: updateErr } = await supabase
          .from('sync_progress')
          .update(enhancedFields)
          .eq('sync_id', syncStatus.syncId);
        if (updateErr) throw updateErr;
      } else {
        if (!syncStatus.tenantId) {
          throw new Error('Cannot create sync_progress row without an active tenant.');
        }

        // Insert new record
        const { error: insertErr } = await supabase
          .from('sync_progress')
          .insert({
            user_id: syncStatus.userId,
            tenant_id: syncStatus.tenantId || null,
            store_id: syncStatus.storeId || null,
            sync_id: syncStatus.syncId,
            ...enhancedFields
          });
        if (insertErr) throw insertErr;
      }

      logger.info('✅ [SYNC JOB MANAGER] Successfully saved sync to database', {
        userId: syncStatus.userId,
        syncId: syncStatus.syncId,
        claimsDetected: metadataToSave.claimsDetected,
        hasFingerprint: !!syncStatus.syncFingerprint,
        hasCoverage: !!syncStatus.coverage
      });
    } catch (error) {
      logger.error(`Error in saveSyncToDatabase:`, error);
    }
  }

  /**
   * Update sync status
   */
  private async updateSyncStatus(syncStatus: SyncJobStatus): Promise<void> {
    // Update in-memory
    const job = this.runningJobs.get(syncStatus.syncId);
    if (job) {
      job.status = syncStatus;
    }

    // Update database
    await this.saveSyncToDatabase(syncStatus);
  }

  /**
   * Send progress update via SSE with connection verification
   */
  private sendProgressUpdate(userId: string, syncStatus: SyncJobStatus): void {
    // Only log connection status for important progress updates (every 20%)
    const shouldLog = syncStatus.progress % 20 === 0 || syncStatus.progress === 100;

    if (shouldLog) {
      logger.debug('🔍 [SYNC JOB MANAGER] Sending progress update', {
        userId,
        syncId: syncStatus.syncId,
        progress: syncStatus.progress,
        hasConnection: sseHub.hasConnection(userId),
        connectionCount: sseHub.getConnectionCount(userId)
      });
    }

    const sent = sseHub.sendEvent(userId, 'sync_progress', {
      tenant_id: syncStatus.tenantId,
      tenant_slug: syncStatus.tenantSlug,
      store_id: syncStatus.storeId,
      syncId: syncStatus.syncId,
      status: syncStatus.status,
      progress: syncStatus.progress,
      message: syncStatus.message,
      ordersProcessed: syncStatus.ordersProcessed,
      totalOrders: syncStatus.totalOrders,
      inventoryCount: syncStatus.inventoryCount,
      shipmentsCount: syncStatus.shipmentsCount,
      returnsCount: syncStatus.returnsCount,
      settlementsCount: syncStatus.settlementsCount,
      feesCount: syncStatus.feesCount,
      claimsDetected: syncStatus.claimsDetected,
      timestamp: new Date().toISOString()
    });

    if (!sent && shouldLog) {
      logger.warn('⚠️ [SYNC JOB MANAGER] Progress update not sent - no SSE connection', {
        userId,
        syncId: syncStatus.syncId,
        progress: syncStatus.progress,
        connectedUsers: sseHub.getConnectedUsers()
      });
    }
  }

  /**
   * Get sync results from database (real implementation)
   */
  private async getSyncResults(userId: string, syncId: string, tenantId?: string, storeId?: string): Promise<PersistedSyncResults> {
    try {
      // Get sync metadata from database
      const { data: syncData, error } = await supabase
        .from('sync_progress')
        .select('metadata')
        .eq('sync_id', syncId)
        .eq('user_id', userId)
        .single();

      if (error || !syncData) {
        logger.warn(`Sync results not found for ${syncId}, using defaults`);
        return this.toPersistedSyncResults({});
      }

      const metadata = (syncData.metadata as any) || {};
      const scopedAdminCount = (table: string, userColumn: string = 'user_id') => {
        let query = supabaseAdmin
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq(userColumn, userId)
          .eq('sync_id', syncId);

        if (tenantId) {
          query = query.eq('tenant_id', tenantId);
        }

        if (storeId) {
          query = query.eq('store_id', storeId);
        }

        return query;
      };

      const [
        ordersCount,
        inventoryCount,
        shipmentsCount,
        returnsCount,
        settlementsCount,
        feesCount,
        claimsCount
      ] = await Promise.all([
        scopedAdminCount('orders'),
        scopedAdminCount('inventory_items'),
        scopedAdminCount('shipments'),
        scopedAdminCount('returns'),
        scopedAdminCount('settlements'),
        (() => {
          let query = supabaseAdmin
            .from('financial_events')
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', userId)
            .eq('sync_id', syncId)
            .eq('event_type', 'fee');

          if (tenantId) {
            query = query.eq('tenant_id', tenantId);
          }

          if (storeId) {
            query = query.eq('store_id', storeId);
          }

          return query;
        })(),
        (() => {
          let query = supabaseAdmin
            .from('detection_results')
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', userId)
            .eq('sync_id', syncId);

          if (tenantId) {
            query = query.eq('tenant_id', tenantId);
          }

          if (storeId) {
            query = query.eq('store_id', storeId);
          }

          return query;
        })()
      ]);

      const exactCounts: PersistedSyncResults = {
        ordersProcessed: (ordersCount.count ?? metadata.ordersProcessed ?? 0) as number,
        totalOrders: (ordersCount.count ?? metadata.totalOrders ?? 0) as number,
        inventoryCount: (inventoryCount.count ?? metadata.inventoryCount ?? 0) as number,
        shipmentsCount: (shipmentsCount.count ?? metadata.shipmentsCount ?? 0) as number,
        returnsCount: (returnsCount.count ?? metadata.returnsCount ?? 0) as number,
        settlementsCount: (settlementsCount.count ?? metadata.settlementsCount ?? 0) as number,
        feesCount: (feesCount.count ?? metadata.feesCount ?? 0) as number,
        claimsDetected: (claimsCount.count ?? metadata.claimsDetected ?? 0) as number,
        totalItemsSynced: 0
      };
      exactCounts.totalItemsSynced =
        exactCounts.ordersProcessed +
        exactCounts.inventoryCount +
        exactCounts.shipmentsCount +
        exactCounts.returnsCount +
        exactCounts.settlementsCount +
        exactCounts.feesCount;

      logger.info('🔍 [SYNC JOB MANAGER] getSyncResults query results', {
        userId,
        syncId,
        tenantId: tenantId || null,
        storeId: storeId || null,
        exactCounts
      });

      return exactCounts;
    } catch (error) {
      logger.error(`Error getting sync results for ${syncId}:`, error);
      // Return metadata values if available, otherwise defaults
      try {
        const { data: syncData } = await supabase
          .from('sync_progress')
          .select('metadata')
          .eq('sync_id', syncId)
          .eq('user_id', userId)
          .single();

        if (syncData && syncData.metadata) {
          return this.toPersistedSyncResults(syncData.metadata as any);
        }
      } catch (fallbackError) {
        logger.error(`Fallback sync results query failed:`, fallbackError);
      }

      return this.toPersistedSyncResults({});
    }
  }

  /**
   * Force-clear all stuck syncs for a user
   * Used when user gets "Sync already in progress" but no sync is actually running
   */
  async forceClearSyncs(userId: string, tenantId: string, storeId?: string): Promise<number> {
    logger.info(`🔓 [SYNC JOB MANAGER] Force-clearing stuck syncs for user: ${userId}`, { tenantId, storeId });

    try {
      // Find all running syncs for this user
      const scopedFind = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .select('sync_id, tenant_id, store_id')
          .eq('user_id', userId)
          .eq('status', 'running'),
        tenantId,
        storeId
      );
      const { data: runningSyncs, error: findError } = await scopedFind;

      if (findError) {
        logger.error('Failed to find running syncs:', findError);
        throw new Error(`Failed to find running syncs: ${findError.message}`);
      }

      if (!runningSyncs || runningSyncs.length === 0) {
        logger.info('No stuck syncs found');
        return 0;
      }

      // Clear all running syncs
      const scopedUpdate = this.applySyncProgressScope(
        supabase
          .from('sync_progress')
          .update({
            status: 'failed',
            current_step: 'Force-cleared by user',
            error_code: 'USER_CLEARED',
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId)
          .eq('status', 'running'),
        tenantId,
        storeId
      );
      const { error: updateError } = await scopedUpdate;

      if (updateError) {
        logger.error('Failed to clear syncs:', updateError);
        throw new Error(`Failed to clear syncs: ${updateError.message}`);
      }

      // Also clear from in-memory cache
      for (const sync of runningSyncs) {
        const runningJob = this.runningJobs.get(sync.sync_id);
        if (runningJob && this.matchesScope(runningJob.status, tenantId, storeId)) {
          this.runningJobs.delete(sync.sync_id);
        }
      }

      logger.info(`✅ [SYNC JOB MANAGER] Cleared ${runningSyncs.length} stuck sync(s) for user: ${userId}`);
      return runningSyncs.length;
    } catch (error: any) {
      logger.error('Force-clear syncs failed:', error);
      throw error;
    }
  }
}

export const syncJobManager = new SyncJobManager();



