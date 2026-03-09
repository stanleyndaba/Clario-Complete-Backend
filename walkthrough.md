# Database Leak Fixes — Walkthrough

## Changes Made

### 1. [agentEventLogger.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/agentEventLogger.ts) — 2 bugs fixed

```diff:agentEventLogger.ts
/**
 * Agent Event Logger Service
 * Centralized event logging for all agents (2-11)
 * Collects rich metadata for continuous learning and improvement
 */

import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';

export enum AgentType {
  DATA_SYNC = 'data_sync',          // Agent 2
  DETECTION = 'detection',          // Agent 3
  EVIDENCE_INGESTION = 'evidence_ingestion',
  DOCUMENT_PARSING = 'document_parsing',
  EVIDENCE_MATCHING = 'evidence_matching',
  REFUND_FILING = 'refund_filing',
  RECOVERIES = 'recoveries',
  BILLING = 'billing',
  NOTIFICATIONS = 'notifications',  // Agent 10
  LEARNING = 'learning'             // Agent 11
}

export enum EventType {
  // Agent 3 - Detection
  DETECTION_COMPLETED = 'detection_completed',
  DETECTION_FAILED = 'detection_failed',
  // Agent 4 - Evidence Ingestion
  INGESTION_STARTED = 'ingestion_started',
  INGESTION_COMPLETED = 'ingestion_completed',
  INGESTION_FAILED = 'ingestion_failed',
  // Agent 5 - Document Parsing
  PARSING_STARTED = 'parsing_started',
  PARSING_COMPLETED = 'parsing_completed',
  PARSING_FAILED = 'parsing_failed',
  // Agent 6 - Evidence Matching
  MATCHING_STARTED = 'matching_started',
  MATCHING_COMPLETED = 'matching_completed',
  MATCHING_FAILED = 'matching_failed',
  // Agent 7 - Refund Filing
  FILING_STARTED = 'filing_started',
  FILING_COMPLETED = 'filing_completed',
  FILING_FAILED = 'filing_failed',
  CASE_APPROVED = 'case_approved',
  CASE_DENIED = 'case_denied',
  // Agent 8 - Recoveries
  RECOVERY_DETECTED = 'recovery_detected',
  RECOVERY_RECONCILED = 'recovery_reconciled',
  // Agent 9 - Billing
  BILLING_COMPLETED = 'billing_completed',
  BILLING_FAILED = 'billing_failed',
  // Agent 10 - Evidence Matching Trigger
  EVIDENCE_MATCHING_TRIGGER_FAILED = 'evidence_matching_trigger_failed',
  EVIDENCE_MATCHING_QUEUED = 'evidence_matching_queued',
  // Agent 11 - Learning
  ANALYST_CORRECTION = 'analyst_correction',
  SCHEMA_CHANGE_DETECTED = 'schema_change_detected',
  RULE_UPDATED = 'rule_updated',
  THRESHOLD_OPTIMIZED = 'threshold_optimized',
  // Agent 2 - Data Sync
  SYNC_COMPLETED = 'sync_completed',
  SYNC_FAILED = 'sync_failed',
  // Agent 10 - Notifications
  NOTIFICATION_DELIVERED = 'notification_delivered',
  NOTIFICATION_FAILED = 'notification_failed'
}

export interface AgentEventData {
  userId: string;
  tenantId?: string; // Optional, will be resolved from userId if not provided
  agent: AgentType;
  eventType: EventType;
  success: boolean;
  metadata: {
    // Common fields
    duration?: number; // milliseconds
    error?: string;
    errorType?: string;

    // Agent-specific fields
    documentCount?: number;
    confidence?: number;
    amount?: number;
    currency?: string;
    disputeId?: string;
    documentId?: string;
    rejectionReason?: string;
    amazonCaseId?: string;
    recoveryId?: string;
    billingTransactionId?: string;

    // Performance metrics
    precision?: number;
    recall?: number;
    accuracy?: number;

    // Additional context
    [key: string]: any;
  };
}

export interface IngestionEventData {
  userId: string;
  success: boolean;
  documentsIngested: number;
  documentsSkipped: number;
  documentsFailed: number;
  duration: number;
  provider: string;
  errors?: string[];
}

export interface ParsingEventData {
  userId: string;
  documentId: string;
  success: boolean;
  confidence: number;
  extractionMethod: string;
  duration: number;
  error?: string;
}

export interface MatchingEventData {
  userId: string;
  disputeId: string;
  success: boolean;
  confidence: number;
  action: 'auto_submit' | 'smart_prompt' | 'hold';
  duration: number;
  error?: string;
}

export interface FilingEventData {
  userId: string;
  disputeId: string;
  success: boolean;
  amazonCaseId?: string;
  status: 'filed' | 'approved' | 'denied' | 'failed';
  rejectionReason?: string;
  duration: number;
  retryCount?: number;
}

export interface RecoveryEventData {
  userId: string;
  disputeId: string;
  success: boolean;
  recoveryId?: string;
  expectedAmount: number;
  actualAmount?: number;
  reconciliationStatus: 'reconciled' | 'discrepancy' | 'failed';
  duration: number;
}

export interface BillingEventData {
  userId: string;
  disputeId: string;
  success: boolean;
  amountRecovered: number;
  platformFee: number;
  sellerPayout: number;
  stripeTransactionId?: string;
  duration: number;
  error?: string;
}

export interface DetectionEventData {
  userId: string;
  syncId: string;
  success: boolean;
  claimsDetected: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  totalValue: number;
  currency: string;
  algorithmsUsed: string[];
  confidenceDistribution: { min: number; max: number; avg: number };
  duration: number;
  error?: string;
  isSandbox?: boolean;
}

export interface SyncEventData {
  userId: string;
  syncId: string;
  success: boolean;
  duration: number;
  ordersProcessed?: number;
  shipmentsProcessed?: number;
  returnsProcessed?: number;
  settlementsProcessed?: number;
  errors?: string[];
  isMock?: boolean;
  mockScenario?: string;
}

export interface NotificationDeliveryEventData {
  userId: string;
  notificationType: string;
  success: boolean;
  channel: string;  // 'websocket', 'email', 'both'
  duration: number;
  error?: string;
}

class AgentEventLogger {
  // Rate limiting: max 100 events per user per minute
  private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();
  private readonly maxEventsPerMinute = 100;
  private readonly rateLimitWindow = 60 * 1000; // 1 minute in ms

  /**
   * Check and update rate limit for a user
   * Returns true if the event should be logged, false if rate limited
   */
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      // Reset or create new rate limit window
      this.rateLimitMap.set(userId, { count: 1, resetTime: now + this.rateLimitWindow });
      return true;
    }

    if (userLimit.count >= this.maxEventsPerMinute) {
      // Rate limit exceeded - log warning only once per window
      if (userLimit.count === this.maxEventsPerMinute) {
        logger.warn('⚠️ [AGENT EVENT LOGGER] Rate limit exceeded for user', {
          userId,
          limit: this.maxEventsPerMinute,
          window: '1 minute',
          message: 'Subsequent events will be skipped to protect database'
        });
      }
      userLimit.count++;
      return false;
    }

    userLimit.count++;
    return true;
  }

  /**
   * Log a generic agent event
   */
  async logEvent(data: AgentEventData): Promise<void> {
    // Rate limit check - prevents logging explosions
    if (!this.checkRateLimit(data.userId)) {
      return; // Skip this event to protect the database
    }

    // Resolve tenantId if not provided
    let tenantId = data.tenantId;
    if (!tenantId) {
      try {
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('tenant_id')
          .eq('id', data.userId)
          .single();
        if (userData?.tenant_id) {
          tenantId = userData.tenant_id;
        }
      } catch (e) {
        logger.warn('⚠️ [AGENT EVENT LOGGER] Failed to resolve tenantId for event', { userId: data.userId });
      }
    }

    try {
      const { error } = await supabaseAdmin
        .from('agent_events')
        .insert({
          user_id: data.userId,
          tenant_id: tenantId,
          agent: data.agent,
          event_type: data.eventType,
          success: data.success,
          metadata: data.metadata,
          created_at: new Date().toISOString()
        });

      if (error) {
        logger.error('❌ [AGENT EVENT LOGGER] Failed to log event', {
          agent: data.agent,
          eventType: data.eventType,
          error: error.message
        });
      } else {
        logger.debug('📊 [AGENT EVENT LOGGER] Event logged', {
          agent: data.agent,
          eventType: data.eventType,
          success: data.success
        });
      }
    } catch (error: any) {
      logger.error('❌ [AGENT EVENT LOGGER] Error logging event', {
        agent: data.agent,
        error: error.message
      });
    }
  }

  /**
   * Log evidence ingestion event
   */
  async logEvidenceIngestion(data: IngestionEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.EVIDENCE_INGESTION,
      eventType: data.success ? EventType.INGESTION_COMPLETED : EventType.INGESTION_FAILED,
      success: data.success,
      metadata: {
        duration: data.duration,
        documentCount: data.documentsIngested,
        documentsSkipped: data.documentsSkipped,
        documentsFailed: data.documentsFailed,
        provider: data.provider,
        errors: data.errors
      }
    });
  }

  /**
   * Log document parsing event
   */
  async logDocumentParsing(data: ParsingEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.DOCUMENT_PARSING,
      eventType: data.success ? EventType.PARSING_COMPLETED : EventType.PARSING_FAILED,
      success: data.success,
      metadata: {
        documentId: data.documentId,
        duration: data.duration,
        confidence: data.confidence,
        extractionMethod: data.extractionMethod,
        error: data.error
      }
    });
  }

  /**
   * Log evidence matching event
   */
  async logEvidenceMatching(data: MatchingEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.EVIDENCE_MATCHING,
      eventType: data.success ? EventType.MATCHING_COMPLETED : EventType.MATCHING_FAILED,
      success: data.success,
      metadata: {
        disputeId: data.disputeId,
        duration: data.duration,
        confidence: data.confidence,
        action: data.action,
        error: data.error
      }
    });
  }

  /**
   * Log refund filing event
   */
  async logRefundFiling(data: FilingEventData): Promise<void> {
    let eventType: EventType;

    if (data.status === 'approved') {
      eventType = EventType.CASE_APPROVED;
    } else if (data.status === 'denied') {
      eventType = EventType.CASE_DENIED;
    } else if (data.success && data.status === 'filed') {
      eventType = EventType.FILING_COMPLETED;
    } else {
      eventType = EventType.FILING_FAILED;
    }

    await this.logEvent({
      userId: data.userId,
      agent: AgentType.REFUND_FILING,
      eventType,
      success: data.success,
      metadata: {
        disputeId: data.disputeId,
        duration: data.duration,
        amazonCaseId: data.amazonCaseId,
        status: data.status,
        rejectionReason: data.rejectionReason,
        retryCount: data.retryCount
      }
    });
  }

  /**
   * Log recovery event
   */
  async logRecovery(data: RecoveryEventData): Promise<void> {
    const eventType = data.reconciliationStatus === 'reconciled'
      ? EventType.RECOVERY_RECONCILED
      : EventType.RECOVERY_DETECTED;

    await this.logEvent({
      userId: data.userId,
      agent: AgentType.RECOVERIES,
      eventType,
      success: data.success,
      metadata: {
        disputeId: data.disputeId,
        recoveryId: data.recoveryId,
        duration: data.duration,
        expectedAmount: data.expectedAmount,
        actualAmount: data.actualAmount,
        reconciliationStatus: data.reconciliationStatus
      }
    });
  }

  /**
   * Log billing event
   */
  async logBilling(data: BillingEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.BILLING,
      eventType: data.success ? EventType.BILLING_COMPLETED : EventType.BILLING_FAILED,
      success: data.success,
      metadata: {
        disputeId: data.disputeId,
        duration: data.duration,
        amountRecovered: data.amountRecovered,
        platformFee: data.platformFee,
        sellerPayout: data.sellerPayout,
        stripeTransactionId: data.stripeTransactionId,
        error: data.error
      }
    });
  }

  /**
   * Log detection event (Agent 3 → Agent 11 feed)
   * Feeds detection outcomes into the learning loop so Agent 11 can:
   * - Track algorithm accuracy across detection types
   * - Identify confidence score patterns and calibration drift
   * - Adjust thresholds based on detection→filing→outcome correlation
   */
  async logDetection(data: DetectionEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.DETECTION,
      eventType: data.success ? EventType.DETECTION_COMPLETED : EventType.DETECTION_FAILED,
      success: data.success,
      metadata: {
        syncId: data.syncId,
        duration: data.duration,
        claimsDetected: data.claimsDetected,
        highConfidenceCount: data.highConfidenceCount,
        mediumConfidenceCount: data.mediumConfidenceCount,
        lowConfidenceCount: data.lowConfidenceCount,
        totalValue: data.totalValue,
        currency: data.currency,
        algorithmsUsed: data.algorithmsUsed,
        confidenceDistribution: data.confidenceDistribution,
        isSandbox: data.isSandbox,
        error: data.error
      }
    });
  }

  /**
   * Log data sync event (Agent 2 → Agent 11 feed)
   * Tracks sync performance, data volumes, and failure patterns
   */
  async logDataSync(data: SyncEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.DATA_SYNC,
      eventType: data.success ? EventType.SYNC_COMPLETED : EventType.SYNC_FAILED,
      success: data.success,
      metadata: {
        syncId: data.syncId,
        duration: data.duration,
        ordersProcessed: data.ordersProcessed,
        shipmentsProcessed: data.shipmentsProcessed,
        returnsProcessed: data.returnsProcessed,
        settlementsProcessed: data.settlementsProcessed,
        errors: data.errors,
        isMock: data.isMock,
        mockScenario: data.mockScenario
      }
    });
  }

  /**
   * Log notification delivery event (Agent 10 → Agent 11 feed)
   * Tracks delivery success rates across channels for reliability monitoring
   */
  async logNotificationDelivery(data: NotificationDeliveryEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.NOTIFICATIONS,
      eventType: data.success ? EventType.NOTIFICATION_DELIVERED : EventType.NOTIFICATION_FAILED,
      success: data.success,
      metadata: {
        notificationType: data.notificationType,
        channel: data.channel,
        duration: data.duration,
        error: data.error
      }
    });
  }

  /**
   * Get events for analysis
   */
  async getEvents(filters: {
    userId?: string;
    agent?: AgentType;
    eventType?: EventType;
    success?: boolean;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<any[]> {
    try {
      let query = supabaseAdmin
        .from('agent_events')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters.agent) {
        query = query.eq('agent', filters.agent);
      }
      if (filters.eventType) {
        query = query.eq('event_type', filters.eventType);
      }
      if (filters.success !== undefined) {
        query = query.eq('success', filters.success);
      }
      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate.toISOString());
      }
      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate.toISOString());
      }
      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('❌ [AGENT EVENT LOGGER] Failed to get events', {
          error: error.message
        });
        return [];
      }

      return data || [];
    } catch (error: any) {
      logger.error('❌ [AGENT EVENT LOGGER] Error getting events', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get success rate for an agent
   */
  async getSuccessRate(agent: AgentType, userId?: string, days: number = 30): Promise<number> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const events = await this.getEvents({
        agent,
        userId,
        startDate,
        endDate
      });

      if (events.length === 0) {
        return 0;
      }

      const successful = events.filter(e => e.success).length;
      return successful / events.length;
    } catch (error: any) {
      logger.error('❌ [AGENT EVENT LOGGER] Error calculating success rate', {
        agent,
        error: error.message
      });
      return 0;
    }
  }
}

// Export singleton instance
const agentEventLogger = new AgentEventLogger();
export default agentEventLogger;

===
/**
 * Agent Event Logger Service
 * Centralized event logging for all agents (2-11)
 * Collects rich metadata for continuous learning and improvement
 */

import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';

export enum AgentType {
  DATA_SYNC = 'data_sync',          // Agent 2
  DETECTION = 'detection',          // Agent 3
  EVIDENCE_INGESTION = 'evidence_ingestion',
  DOCUMENT_PARSING = 'document_parsing',
  EVIDENCE_MATCHING = 'evidence_matching',
  REFUND_FILING = 'refund_filing',
  RECOVERIES = 'recoveries',
  BILLING = 'billing',
  NOTIFICATIONS = 'notifications',  // Agent 10
  LEARNING = 'learning'             // Agent 11
}

export enum EventType {
  // Agent 3 - Detection
  DETECTION_COMPLETED = 'detection_completed',
  DETECTION_FAILED = 'detection_failed',
  // Agent 4 - Evidence Ingestion
  INGESTION_STARTED = 'ingestion_started',
  INGESTION_COMPLETED = 'ingestion_completed',
  INGESTION_FAILED = 'ingestion_failed',
  // Agent 5 - Document Parsing
  PARSING_STARTED = 'parsing_started',
  PARSING_COMPLETED = 'parsing_completed',
  PARSING_FAILED = 'parsing_failed',
  // Agent 6 - Evidence Matching
  MATCHING_STARTED = 'matching_started',
  MATCHING_COMPLETED = 'matching_completed',
  MATCHING_FAILED = 'matching_failed',
  // Agent 7 - Refund Filing
  FILING_STARTED = 'filing_started',
  FILING_COMPLETED = 'filing_completed',
  FILING_FAILED = 'filing_failed',
  CASE_APPROVED = 'case_approved',
  CASE_DENIED = 'case_denied',
  // Agent 8 - Recoveries
  RECOVERY_DETECTED = 'recovery_detected',
  RECOVERY_RECONCILED = 'recovery_reconciled',
  // Agent 9 - Billing
  BILLING_COMPLETED = 'billing_completed',
  BILLING_FAILED = 'billing_failed',
  // Agent 10 - Evidence Matching Trigger
  EVIDENCE_MATCHING_TRIGGER_FAILED = 'evidence_matching_trigger_failed',
  EVIDENCE_MATCHING_QUEUED = 'evidence_matching_queued',
  // Agent 11 - Learning
  ANALYST_CORRECTION = 'analyst_correction',
  SCHEMA_CHANGE_DETECTED = 'schema_change_detected',
  RULE_UPDATED = 'rule_updated',
  THRESHOLD_OPTIMIZED = 'threshold_optimized',
  // Agent 2 - Data Sync
  SYNC_COMPLETED = 'sync_completed',
  SYNC_FAILED = 'sync_failed',
  // Agent 10 - Notifications
  NOTIFICATION_DELIVERED = 'notification_delivered',
  NOTIFICATION_FAILED = 'notification_failed'
}

export interface AgentEventData {
  userId: string;
  tenantId?: string; // Optional, will be resolved from userId if not provided
  agent: AgentType;
  eventType: EventType;
  success: boolean;
  metadata: {
    // Common fields
    duration?: number; // milliseconds
    error?: string;
    errorType?: string;

    // Agent-specific fields
    documentCount?: number;
    confidence?: number;
    amount?: number;
    currency?: string;
    disputeId?: string;
    documentId?: string;
    rejectionReason?: string;
    amazonCaseId?: string;
    recoveryId?: string;
    billingTransactionId?: string;

    // Performance metrics
    precision?: number;
    recall?: number;
    accuracy?: number;

    // Additional context
    [key: string]: any;
  };
}

export interface IngestionEventData {
  userId: string;
  success: boolean;
  documentsIngested: number;
  documentsSkipped: number;
  documentsFailed: number;
  duration: number;
  provider: string;
  errors?: string[];
}

export interface ParsingEventData {
  userId: string;
  documentId: string;
  success: boolean;
  confidence: number;
  extractionMethod: string;
  duration: number;
  error?: string;
}

export interface MatchingEventData {
  userId: string;
  disputeId: string;
  success: boolean;
  confidence: number;
  action: 'auto_submit' | 'smart_prompt' | 'hold';
  duration: number;
  error?: string;
}

export interface FilingEventData {
  userId: string;
  disputeId: string;
  success: boolean;
  amazonCaseId?: string;
  status: 'filed' | 'approved' | 'denied' | 'failed';
  rejectionReason?: string;
  duration: number;
  retryCount?: number;
}

export interface RecoveryEventData {
  userId: string;
  disputeId: string;
  success: boolean;
  recoveryId?: string;
  expectedAmount: number;
  actualAmount?: number;
  reconciliationStatus: 'reconciled' | 'discrepancy' | 'failed';
  duration: number;
}

export interface BillingEventData {
  userId: string;
  disputeId: string;
  success: boolean;
  amountRecovered: number;
  platformFee: number;
  sellerPayout: number;
  stripeTransactionId?: string;
  duration: number;
  error?: string;
}

export interface DetectionEventData {
  userId: string;
  syncId: string;
  success: boolean;
  claimsDetected: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  totalValue: number;
  currency: string;
  algorithmsUsed: string[];
  confidenceDistribution: { min: number; max: number; avg: number };
  duration: number;
  error?: string;
  isSandbox?: boolean;
}

export interface SyncEventData {
  userId: string;
  syncId: string;
  success: boolean;
  duration: number;
  ordersProcessed?: number;
  shipmentsProcessed?: number;
  returnsProcessed?: number;
  settlementsProcessed?: number;
  errors?: string[];
  isMock?: boolean;
  mockScenario?: string;
}

export interface NotificationDeliveryEventData {
  userId: string;
  notificationType: string;
  success: boolean;
  channel: string;  // 'websocket', 'email', 'both'
  duration: number;
  error?: string;
}

class AgentEventLogger {
  // Rate limiting: max 100 events per user per minute
  private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();
  private readonly maxEventsPerMinute = 100;
  private readonly rateLimitWindow = 60 * 1000; // 1 minute in ms

  /**
   * Check and update rate limit for a user
   * Returns true if the event should be logged, false if rate limited
   */
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      // Reset or create new rate limit window
      this.rateLimitMap.set(userId, { count: 1, resetTime: now + this.rateLimitWindow });
      return true;
    }

    if (userLimit.count >= this.maxEventsPerMinute) {
      // Rate limit exceeded - log warning only once per window
      if (userLimit.count === this.maxEventsPerMinute) {
        logger.warn('⚠️ [AGENT EVENT LOGGER] Rate limit exceeded for user', {
          userId,
          limit: this.maxEventsPerMinute,
          window: '1 minute',
          message: 'Subsequent events will be skipped to protect database'
        });
      }
      userLimit.count++;
      return false;
    }

    userLimit.count++;
    return true;
  }

  /**
   * Log a generic agent event
   */
  async logEvent(data: AgentEventData): Promise<void> {
    // Rate limit check - prevents logging explosions
    if (!this.checkRateLimit(data.userId)) {
      return; // Skip this event to protect the database
    }

    // Resolve tenantId if not provided
    let tenantId = data.tenantId;
    if (!tenantId) {
      try {
        // Convert prefixed user IDs (e.g. "stress-test-user-UUID") to valid UUID
        // before querying the users table which requires UUID format
        const { convertUserIdToUuid } = require('../database/supabaseClient');
        const dbUserId = convertUserIdToUuid(data.userId);

        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('tenant_id')
          .eq('id', dbUserId)
          .single();
        if (userData?.tenant_id) {
          tenantId = userData.tenant_id;
        }
      } catch (e) {
        logger.warn('⚠️ [AGENT EVENT LOGGER] Failed to resolve tenantId for event', { userId: data.userId });
      }
    }

    // CRITICAL: Do not insert without a tenant_id — the column has a NOT NULL constraint
    if (!tenantId) {
      logger.warn('⚠️ [AGENT EVENT LOGGER] Skipping event — no tenant_id could be resolved', {
        userId: data.userId,
        agent: data.agent,
        eventType: data.eventType
      });
      return;
    }

    try {
      // Convert userId to valid UUID for the user_id column as well
      const { convertUserIdToUuid } = require('../database/supabaseClient');
      const dbUserId = convertUserIdToUuid(data.userId);

      const { error } = await supabaseAdmin
        .from('agent_events')
        .insert({
          user_id: dbUserId,
          tenant_id: tenantId,
          agent: data.agent,
          event_type: data.eventType,
          success: data.success,
          metadata: data.metadata,
          created_at: new Date().toISOString()
        });

      if (error) {
        logger.error('❌ [AGENT EVENT LOGGER] Failed to log event', {
          agent: data.agent,
          eventType: data.eventType,
          error: error.message
        });
      } else {
        logger.debug('📊 [AGENT EVENT LOGGER] Event logged', {
          agent: data.agent,
          eventType: data.eventType,
          success: data.success
        });
      }
    } catch (error: any) {
      logger.error('❌ [AGENT EVENT LOGGER] Error logging event', {
        agent: data.agent,
        error: error.message
      });
    }
  }

  /**
   * Log evidence ingestion event
   */
  async logEvidenceIngestion(data: IngestionEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.EVIDENCE_INGESTION,
      eventType: data.success ? EventType.INGESTION_COMPLETED : EventType.INGESTION_FAILED,
      success: data.success,
      metadata: {
        duration: data.duration,
        documentCount: data.documentsIngested,
        documentsSkipped: data.documentsSkipped,
        documentsFailed: data.documentsFailed,
        provider: data.provider,
        errors: data.errors
      }
    });
  }

  /**
   * Log document parsing event
   */
  async logDocumentParsing(data: ParsingEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.DOCUMENT_PARSING,
      eventType: data.success ? EventType.PARSING_COMPLETED : EventType.PARSING_FAILED,
      success: data.success,
      metadata: {
        documentId: data.documentId,
        duration: data.duration,
        confidence: data.confidence,
        extractionMethod: data.extractionMethod,
        error: data.error
      }
    });
  }

  /**
   * Log evidence matching event
   */
  async logEvidenceMatching(data: MatchingEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.EVIDENCE_MATCHING,
      eventType: data.success ? EventType.MATCHING_COMPLETED : EventType.MATCHING_FAILED,
      success: data.success,
      metadata: {
        disputeId: data.disputeId,
        duration: data.duration,
        confidence: data.confidence,
        action: data.action,
        error: data.error
      }
    });
  }

  /**
   * Log refund filing event
   */
  async logRefundFiling(data: FilingEventData): Promise<void> {
    let eventType: EventType;

    if (data.status === 'approved') {
      eventType = EventType.CASE_APPROVED;
    } else if (data.status === 'denied') {
      eventType = EventType.CASE_DENIED;
    } else if (data.success && data.status === 'filed') {
      eventType = EventType.FILING_COMPLETED;
    } else {
      eventType = EventType.FILING_FAILED;
    }

    await this.logEvent({
      userId: data.userId,
      agent: AgentType.REFUND_FILING,
      eventType,
      success: data.success,
      metadata: {
        disputeId: data.disputeId,
        duration: data.duration,
        amazonCaseId: data.amazonCaseId,
        status: data.status,
        rejectionReason: data.rejectionReason,
        retryCount: data.retryCount
      }
    });
  }

  /**
   * Log recovery event
   */
  async logRecovery(data: RecoveryEventData): Promise<void> {
    const eventType = data.reconciliationStatus === 'reconciled'
      ? EventType.RECOVERY_RECONCILED
      : EventType.RECOVERY_DETECTED;

    await this.logEvent({
      userId: data.userId,
      agent: AgentType.RECOVERIES,
      eventType,
      success: data.success,
      metadata: {
        disputeId: data.disputeId,
        recoveryId: data.recoveryId,
        duration: data.duration,
        expectedAmount: data.expectedAmount,
        actualAmount: data.actualAmount,
        reconciliationStatus: data.reconciliationStatus
      }
    });
  }

  /**
   * Log billing event
   */
  async logBilling(data: BillingEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.BILLING,
      eventType: data.success ? EventType.BILLING_COMPLETED : EventType.BILLING_FAILED,
      success: data.success,
      metadata: {
        disputeId: data.disputeId,
        duration: data.duration,
        amountRecovered: data.amountRecovered,
        platformFee: data.platformFee,
        sellerPayout: data.sellerPayout,
        stripeTransactionId: data.stripeTransactionId,
        error: data.error
      }
    });
  }

  /**
   * Log detection event (Agent 3 → Agent 11 feed)
   * Feeds detection outcomes into the learning loop so Agent 11 can:
   * - Track algorithm accuracy across detection types
   * - Identify confidence score patterns and calibration drift
   * - Adjust thresholds based on detection→filing→outcome correlation
   */
  async logDetection(data: DetectionEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.DETECTION,
      eventType: data.success ? EventType.DETECTION_COMPLETED : EventType.DETECTION_FAILED,
      success: data.success,
      metadata: {
        syncId: data.syncId,
        duration: data.duration,
        claimsDetected: data.claimsDetected,
        highConfidenceCount: data.highConfidenceCount,
        mediumConfidenceCount: data.mediumConfidenceCount,
        lowConfidenceCount: data.lowConfidenceCount,
        totalValue: data.totalValue,
        currency: data.currency,
        algorithmsUsed: data.algorithmsUsed,
        confidenceDistribution: data.confidenceDistribution,
        isSandbox: data.isSandbox,
        error: data.error
      }
    });
  }

  /**
   * Log data sync event (Agent 2 → Agent 11 feed)
   * Tracks sync performance, data volumes, and failure patterns
   */
  async logDataSync(data: SyncEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.DATA_SYNC,
      eventType: data.success ? EventType.SYNC_COMPLETED : EventType.SYNC_FAILED,
      success: data.success,
      metadata: {
        syncId: data.syncId,
        duration: data.duration,
        ordersProcessed: data.ordersProcessed,
        shipmentsProcessed: data.shipmentsProcessed,
        returnsProcessed: data.returnsProcessed,
        settlementsProcessed: data.settlementsProcessed,
        errors: data.errors,
        isMock: data.isMock,
        mockScenario: data.mockScenario
      }
    });
  }

  /**
   * Log notification delivery event (Agent 10 → Agent 11 feed)
   * Tracks delivery success rates across channels for reliability monitoring
   */
  async logNotificationDelivery(data: NotificationDeliveryEventData): Promise<void> {
    await this.logEvent({
      userId: data.userId,
      agent: AgentType.NOTIFICATIONS,
      eventType: data.success ? EventType.NOTIFICATION_DELIVERED : EventType.NOTIFICATION_FAILED,
      success: data.success,
      metadata: {
        notificationType: data.notificationType,
        channel: data.channel,
        duration: data.duration,
        error: data.error
      }
    });
  }

  /**
   * Get events for analysis
   */
  async getEvents(filters: {
    userId?: string;
    agent?: AgentType;
    eventType?: EventType;
    success?: boolean;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<any[]> {
    try {
      let query = supabaseAdmin
        .from('agent_events')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters.agent) {
        query = query.eq('agent', filters.agent);
      }
      if (filters.eventType) {
        query = query.eq('event_type', filters.eventType);
      }
      if (filters.success !== undefined) {
        query = query.eq('success', filters.success);
      }
      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate.toISOString());
      }
      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate.toISOString());
      }
      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('❌ [AGENT EVENT LOGGER] Failed to get events', {
          error: error.message
        });
        return [];
      }

      return data || [];
    } catch (error: any) {
      logger.error('❌ [AGENT EVENT LOGGER] Error getting events', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get success rate for an agent
   */
  async getSuccessRate(agent: AgentType, userId?: string, days: number = 30): Promise<number> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const events = await this.getEvents({
        agent,
        userId,
        startDate,
        endDate
      });

      if (events.length === 0) {
        return 0;
      }

      const successful = events.filter(e => e.success).length;
      return successful / events.length;
    } catch (error: any) {
      logger.error('❌ [AGENT EVENT LOGGER] Error calculating success rate', {
        agent,
        error: error.message
      });
      return 0;
    }
  }
}

// Export singleton instance
const agentEventLogger = new AgentEventLogger();
export default agentEventLogger;

```

**Root cause:** [logEvent()](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/agentEventLogger.ts#244-322) received raw user IDs like `"stress-test-user-UUID"` and:
1. Passed them to `.eq('id', userId)` on a UUID column → `invalid input syntax for type uuid`
2. Inserted `user_id: userId` with the raw string → second UUID error
3. If user lookup failed, `tenantId` stayed `undefined` → `null value in column "tenant_id"` constraint violation

**Fix:** Use [convertUserIdToUuid()](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/database/supabaseClient.ts#303-337) before both the lookup and insert. Skip the insert entirely if no `tenantId` can be resolved.

---

### 2. [evidenceIngestionWorker.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/evidenceIngestionWorker.ts) — 4 leak sites fixed

```diff:evidenceIngestionWorker.ts
/**
 * Evidence Ingestion Worker
 * Automated background worker for continuous evidence ingestion from all connected sources
 * Runs every 5 minutes, ingests from Gmail, Outlook, Google Drive, and Dropbox
 * 
 * MULTI-TENANT: Uses tenant-scoped queries for data isolation
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import { createTenantScopedQueryById } from '../database/tenantScopedClient';
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
   * MULTI-TENANT: Iterates through each tenant first, then processes users per tenant
   */
  private async runEvidenceIngestionForAllTenants(): Promise<void> {
    const runStartTime = Date.now();

    try {
      logger.info('🔍 [EVIDENCE WORKER] Starting scheduled evidence ingestion', {
        timestamp: new Date().toISOString()
      });

      // MULTI-TENANT: Get all active tenants first
      const { data: tenants, error: tenantError } = await supabaseAdmin
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
   * MULTI-TENANT: Get list of active user IDs for a specific tenant
   * Uses tenant-scoped query to only get users belonging to this tenant
   */
  private async getActiveUserIdsForTenant(tenantId: string): Promise<string[]> {
    try {
      // Use tenant-scoped query to get evidence sources for this tenant only
      const tenantQuery = createTenantScopedQueryById(tenantId, 'evidence_sources');
      const { data: sources, error } = await tenantQuery
        .select('user_id, seller_id')
        .eq('status', 'connected')
        .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);

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

      // Get connected sources for this user (try seller_id first, fallback to user_id)
      let { data: sources, error } = await client
        .from('evidence_sources')
        .select('id, provider, last_synced_at, metadata')
        .eq('seller_id', userId)
        .eq('status', 'connected')
        .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);

      // If seller_id column doesn't exist or no results, try user_id
      if ((error && error.message?.includes('column') && error.message?.includes('seller_id')) || (!error && (!sources || sources.length === 0))) {
        const retry = await client
          .from('evidence_sources')
          .select('id, provider, last_synced_at, metadata')
          .eq('user_id', userId)
          .eq('status', 'connected')
          .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);
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
          // Check if user has valid Gmail token before attempting ingestion
          const hasGmailToken = await tokenManager.isTokenValid(userId, 'gmail');
          if (!hasGmailToken) {
            logger.info(`⏭️ [EVIDENCE WORKER] Skipping Gmail ingestion - no valid token for user ${userId}`);
            stats.skipped = 1;
            break;
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

        default:
          throw new Error(`Unknown provider: ${source.provider}`);
      }

      // Only process result if it was actually returned (handles skip case)
      if (result) {
        stats.ingested = result.documentsIngested || 0;
        stats.skipped = (result.itemsProcessed || 0) - stats.ingested;
        stats.failed = result.errors?.length || 0;
        stats.errors = result.errors || [];
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
          const { data: recentDocs } = await supabaseAdmin
            .from('evidence_documents')
            .select('id, filename, source')
            .eq('seller_id', userId)
            .eq('source', source.provider)
            .order('created_at', { ascending: false })
            .limit(stats.ingested);

          if (recentDocs && recentDocs.length > 0) {
            for (const doc of recentDocs) {
              await notificationHelper.notifyEvidenceFound(userId, {
                documentId: doc.id,
                source: source.provider as 'gmail' | 'outlook' | 'drive' | 'dropbox',
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

      const { error: insertError } = await client
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

===
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
   * MULTI-TENANT: Iterates through each tenant first, then processes users per tenant
   */
  private async runEvidenceIngestionForAllTenants(): Promise<void> {
    const runStartTime = Date.now();

    try {
      logger.info('🔍 [EVIDENCE WORKER] Starting scheduled evidence ingestion', {
        timestamp: new Date().toISOString()
      });

      // MULTI-TENANT: Get all active tenants first
      const { data: tenants, error: tenantError } = await supabaseAdmin
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
   * MULTI-TENANT: Get list of active user IDs for a specific tenant
   * Uses tenant-scoped query to only get users belonging to this tenant
   */
  private async getActiveUserIdsForTenant(tenantId: string): Promise<string[]> {
    try {
      // Use tenant-scoped query to get evidence sources for this tenant only
      const tenantQuery = createTenantScopedQueryById(tenantId, 'evidence_sources');
      const { data: sources, error } = await tenantQuery
        .select('user_id, seller_id')
        .eq('status', 'connected')
        .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);

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
        .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);

      // If seller_id column doesn't exist or no results, try user_id
      if ((error && error.message?.includes('column') && error.message?.includes('seller_id')) || (!error && (!sources || sources.length === 0))) {
        const retry = await client
          .from('evidence_sources')
          .select('id, provider, last_synced_at, metadata')
          .eq('user_id', dbUserId)
          .eq('status', 'connected')
          .in('provider', ['gmail', 'outlook', 'gdrive', 'dropbox']);
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
          // Check if user has valid Gmail token before attempting ingestion
          const hasGmailToken = await tokenManager.isTokenValid(userId, 'gmail');
          if (!hasGmailToken) {
            logger.info(`⏭️ [EVIDENCE WORKER] Skipping Gmail ingestion - no valid token for user ${userId}`);
            stats.skipped = 1;
            break;
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

        default:
          throw new Error(`Unknown provider: ${source.provider}`);
      }

      // Only process result if it was actually returned (handles skip case)
      if (result) {
        stats.ingested = result.documentsIngested || 0;
        stats.skipped = (result.itemsProcessed || 0) - stats.ingested;
        stats.failed = result.errors?.length || 0;
        stats.errors = result.errors || [];
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
          const { data: recentDocs } = await supabaseAdmin
            .from('evidence_documents')
            .select('id, filename, source')
            .eq('seller_id', dbUserIdForDocs)
            .eq('source', source.provider)
            .order('created_at', { ascending: false })
            .limit(stats.ingested);

          if (recentDocs && recentDocs.length > 0) {
            for (const doc of recentDocs) {
              await notificationHelper.notifyEvidenceFound(userId, {
                documentId: doc.id,
                source: source.provider as 'gmail' | 'outlook' | 'drive' | 'dropbox',
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

```

**Root cause:** The worker received `stress-test-user-*` IDs from `evidence_sources` and passed them raw to multiple DB queries/inserts.

**Leak sites fixed:**
- [ingestForUser()](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/evidenceIngestionWorker.ts#481-609) — queries `evidence_sources` with `.eq('seller_id', userId)` and `.eq('user_id', userId)`
- [ingestFromSource()](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/evidenceIngestionWorker.ts#610-770) — queries `evidence_documents` with `.eq('seller_id', userId)` for notifications
- [storeRawFilesForNewDocuments()](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/evidenceIngestionWorker.ts#771-823) — queries `evidence_documents` with `.eq('user_id', userId)` and `.eq('seller_id', userId)`
- [logError()](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/refundFilingWorker.ts#2051-2087) — inserts `user_id: userId` into `evidence_ingestion_errors`

---

### 3. [recoveriesWorker.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/workers/recoveriesWorker.ts) — 1 bug fixed

```diff:recoveriesWorker.ts
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
        store_id,
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

===
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

```

**Root cause:** SELECT included `store_id` which doesn't exist on `dispute_cases`.
**Fix:** Removed the non-existent column from the select list.

## Verification

- All 3 modified files transpile successfully
- After deploy, all 3 error categories should stop:
  - ~~`invalid input syntax for type uuid: "stress-test-user-..."`~~
  - ~~`null value in column "tenant_id" of relation "agent_events"`~~
  - ~~`column dispute_cases.store_id does not exist`~~
