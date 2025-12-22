/**
 * Agent Event Logger Service
 * Centralized event logging for all agents (4-10)
 * Collects rich metadata for continuous learning and improvement
 */

import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';

export enum AgentType {
  EVIDENCE_INGESTION = 'evidence_ingestion',
  DOCUMENT_PARSING = 'document_parsing',
  EVIDENCE_MATCHING = 'evidence_matching',
  REFUND_FILING = 'refund_filing',
  RECOVERIES = 'recoveries',
  BILLING = 'billing',
  LEARNING = 'learning'  // Agent 11
}

export enum EventType {
  INGESTION_STARTED = 'ingestion_started',
  INGESTION_COMPLETED = 'ingestion_completed',
  INGESTION_FAILED = 'ingestion_failed',
  PARSING_STARTED = 'parsing_started',
  PARSING_COMPLETED = 'parsing_completed',
  PARSING_FAILED = 'parsing_failed',
  MATCHING_STARTED = 'matching_started',
  MATCHING_COMPLETED = 'matching_completed',
  MATCHING_FAILED = 'matching_failed',
  FILING_STARTED = 'filing_started',
  FILING_COMPLETED = 'filing_completed',
  FILING_FAILED = 'filing_failed',
  CASE_APPROVED = 'case_approved',
  CASE_DENIED = 'case_denied',
  RECOVERY_DETECTED = 'recovery_detected',
  RECOVERY_RECONCILED = 'recovery_reconciled',
  BILLING_COMPLETED = 'billing_completed',
  BILLING_FAILED = 'billing_failed',
  ANALYST_CORRECTION = 'analyst_correction',  // Agent 11 - manual review feedback
  SCHEMA_CHANGE_DETECTED = 'schema_change_detected',  // Agent 11 - schema monitoring
  RULE_UPDATED = 'rule_updated',  // Agent 11 - rules engine
  THRESHOLD_OPTIMIZED = 'threshold_optimized'  // Agent 11 - learning
}

export interface AgentEventData {
  userId: string;
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

    try {
      const { error } = await supabaseAdmin
        .from('agent_events')
        .insert({
          user_id: data.userId,
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

