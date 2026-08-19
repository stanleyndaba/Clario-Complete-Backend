import { supabase, supabaseAdmin } from '../../database/supabaseClient';
import { getLogger } from '../../utils/logger';

const logger = getLogger('NotificationModel');

// Database schema types
export interface NotificationData {
  id: string;
  user_id: string;
  tenant_id: string;
  type: NotificationType;
  title: string;
  message: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  channel: NotificationChannel;
  payload?: Record<string, any>;
  dedupe_key?: string | null;
  delivery_state?: Record<string, any>;
  last_delivery_error?: string | null;
  read_at?: Date;
  delivered_at?: Date;
  expires_at?: Date;
  system_signal_id?: string | null;
  signal_event_type?: string | null;
  signal_event_version?: number | null;
  signal_domain?: string | null;
  signal_severity?: 'critical' | 'action_required' | 'informational' | null;
  signal_sensitivity?: 'operational_private' | 'financial_sensitive' | 'security_sensitive' | null;
  signal_provider_state?: 'provider_outage' | 'seller_auth_failure' | 'business_outcome' | 'none' | null;
  signal_occurred_at?: Date | null;
  signal_correlation_id?: string | null;
  signal_causation_id?: string | null;
  signal_object_type?: string | null;
  signal_object_id?: string | null;
  signal_action_type?: string | null;
  signal_action_route?: Record<string, any> | null;
  signal_delivery_policy?: string | null;
  signal_state?: 'open' | 'resolved' | 'expired' | 'superseded' | 'cancelled' | null;
  seller_state?: 'unseen' | 'seen' | 'read' | 'acknowledged' | null;
  action_state?: 'none' | 'pending' | 'completed' | 'no_longer_needed' | 'expired' | null;
  detailed_body?: string | null;
  external_title?: string | null;
  external_body?: string | null;
  resolved_at?: Date | null;
  resolution_reason?: string | null;
  acknowledged_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Enums for type safety
export enum NotificationType {
  CLAIM_DETECTED = 'claim_detected',
  EVIDENCE_FOUND = 'evidence_found',
  CASE_FILED = 'case_filed',
  REFUND_APPROVED = 'refund_approved',
  FUNDS_DEPOSITED = 'funds_deposited',
  INTEGRATION_COMPLETED = 'integration_completed',
  PAYMENT_PROCESSED = 'payment_processed',
  SYNC_COMPLETED = 'sync_completed',
  SYNC_STARTED = 'sync_started',
  SYNC_FAILED = 'sync_failed',
  DISCREPANCY_FOUND = 'discrepancy_found',
  SYSTEM_ALERT = 'system_alert',
  USER_ACTION_REQUIRED = 'user_action_required',
  AMAZON_CHALLENGE = 'amazon_challenge',
  CLAIM_DENIED = 'claim_denied',
  CLAIM_EXPIRING = 'claim_expiring',
  LEARNING_INSIGHT = 'learning_insight',
  WEEKLY_SUMMARY = 'weekly_summary',
  NEEDS_EVIDENCE = 'needs_evidence',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
  PRODUCT_UPDATE = 'product_update'
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  PARTIAL = 'partial',
  READ = 'read',
  FAILED = 'failed',
  EXPIRED = 'expired'
}

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum NotificationChannel {
  IN_APP = 'in_app',
  EMAIL = 'email',
  BOTH = 'both'
}

// Request/Response types
export interface CreateNotificationRequest {
  user_id: string;
  tenant_id?: string;
  type: NotificationType;
  title: string;
  message: string;
  priority?: NotificationPriority;
  channel?: NotificationChannel;
  payload?: Record<string, any>;
  dedupe_key?: string;
  expires_at?: Date;
  system_signal_id?: string;
  signal_event_type?: string;
  signal_event_version?: number;
  signal_domain?: string;
  signal_severity?: 'critical' | 'action_required' | 'informational';
  signal_sensitivity?: 'operational_private' | 'financial_sensitive' | 'security_sensitive';
  signal_provider_state?: 'provider_outage' | 'seller_auth_failure' | 'business_outcome' | 'none';
  signal_occurred_at?: Date;
  signal_correlation_id?: string;
  signal_causation_id?: string;
  signal_object_type?: string;
  signal_object_id?: string;
  signal_action_type?: string;
  signal_action_route?: Record<string, any>;
  signal_delivery_policy?: string;
  signal_state?: 'open' | 'resolved' | 'expired' | 'superseded' | 'cancelled';
  seller_state?: 'unseen' | 'seen' | 'read' | 'acknowledged';
  action_state?: 'none' | 'pending' | 'completed' | 'no_longer_needed' | 'expired';
  detailed_body?: string;
  external_title?: string;
  external_body?: string;
}

export interface UpdateNotificationRequest {
  status?: NotificationStatus;
  read_at?: Date;
  delivered_at?: Date;
  payload?: Record<string, any>;
  delivery_state?: Record<string, any>;
  last_delivery_error?: string | null;
  seller_state?: 'unseen' | 'seen' | 'read' | 'acknowledged';
  action_state?: 'none' | 'pending' | 'completed' | 'no_longer_needed' | 'expired';
  signal_state?: 'open' | 'resolved' | 'expired' | 'superseded' | 'cancelled';
  resolved_at?: Date;
  resolution_reason?: string;
  acknowledged_at?: Date;
}

export interface NotificationFilters {
  user_id?: string;
  tenant_id?: string;
  type?: NotificationType;
  status?: NotificationStatus;
  priority?: NotificationPriority;
  channel?: NotificationChannel;
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}

export class Notification {
  id: string;
  user_id: string;
  tenant_id: string;
  type: NotificationType;
  title: string;
  message: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  channel: NotificationChannel;
  payload?: Record<string, any>;
  dedupe_key?: string | null;
  delivery_state?: Record<string, any>;
  last_delivery_error?: string | null;
  read_at?: Date;
  delivered_at?: Date;
  expires_at?: Date;
  system_signal_id?: string | null;
  signal_event_type?: string | null;
  signal_event_version?: number | null;
  signal_domain?: string | null;
  signal_severity?: 'critical' | 'action_required' | 'informational' | null;
  signal_sensitivity?: 'operational_private' | 'financial_sensitive' | 'security_sensitive' | null;
  signal_provider_state?: 'provider_outage' | 'seller_auth_failure' | 'business_outcome' | 'none' | null;
  signal_occurred_at?: Date | null;
  signal_correlation_id?: string | null;
  signal_causation_id?: string | null;
  signal_object_type?: string | null;
  signal_object_id?: string | null;
  signal_action_type?: string | null;
  signal_action_route?: Record<string, any> | null;
  signal_delivery_policy?: string | null;
  signal_state?: 'open' | 'resolved' | 'expired' | 'superseded' | 'cancelled' | null;
  seller_state?: 'unseen' | 'seen' | 'read' | 'acknowledged' | null;
  action_state?: 'none' | 'pending' | 'completed' | 'no_longer_needed' | 'expired' | null;
  detailed_body?: string | null;
  external_title?: string | null;
  external_body?: string | null;
  resolved_at?: Date | null;
  resolution_reason?: string | null;
  acknowledged_at?: Date | null;
  created_at: Date;
  updated_at: Date;

  constructor(data: NotificationData) {
    this.id = data.id;
    this.user_id = data.user_id;
    this.tenant_id = data.tenant_id;
    this.type = data.type;
    this.title = data.title;
    this.message = data.message;
    this.status = data.status;
    this.priority = data.priority;
    this.channel = data.channel;
    this.payload = data.payload;
    this.dedupe_key = data.dedupe_key;
    this.delivery_state = data.delivery_state;
    this.last_delivery_error = data.last_delivery_error;
    this.read_at = data.read_at;
    this.delivered_at = data.delivered_at;
    this.expires_at = data.expires_at;
    this.system_signal_id = data.system_signal_id;
    this.signal_event_type = data.signal_event_type;
    this.signal_event_version = data.signal_event_version;
    this.signal_domain = data.signal_domain;
    this.signal_severity = data.signal_severity;
    this.signal_sensitivity = data.signal_sensitivity;
    this.signal_provider_state = data.signal_provider_state;
    this.signal_occurred_at = data.signal_occurred_at;
    this.signal_correlation_id = data.signal_correlation_id;
    this.signal_causation_id = data.signal_causation_id;
    this.signal_object_type = data.signal_object_type;
    this.signal_object_id = data.signal_object_id;
    this.signal_action_type = data.signal_action_type;
    this.signal_action_route = data.signal_action_route;
    this.signal_delivery_policy = data.signal_delivery_policy;
    this.signal_state = data.signal_state;
    this.seller_state = data.seller_state;
    this.action_state = data.action_state;
    this.detailed_body = data.detailed_body;
    this.external_title = data.external_title;
    this.external_body = data.external_body;
    this.resolved_at = data.resolved_at;
    this.resolution_reason = data.resolution_reason;
    this.acknowledged_at = data.acknowledged_at;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  /**
   * Create a new notification
   */
  static async create(data: CreateNotificationRequest): Promise<Notification> {
    try {
      // Use admin client to bypass RLS (backend services need to create notifications)
      const client = supabaseAdmin || supabase;

      if (!data.tenant_id) {
        throw new Error('TENANT_REQUIRED');
      }

      if (!Object.values(NotificationType).includes(data.type)) {
        throw new Error(`INVALID_NOTIFICATION_TYPE:${data.type}`);
      }

      const notificationData = {
        ...data,
        tenant_id: data.tenant_id,
        status: NotificationStatus.PENDING,
        priority: Object.values(NotificationPriority).includes(data.priority as NotificationPriority)
          ? data.priority
          : NotificationPriority.NORMAL,
        channel: Object.values(NotificationChannel).includes(data.channel as NotificationChannel)
          ? data.channel
          : NotificationChannel.IN_APP,
        delivery_state: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: result, error } = await client
        .from('notifications')
        .insert(notificationData)
        .select()
        .single();

      if (error) {
        if (error.code === '23505' && data.dedupe_key) {
          const existing = await Notification.findByDedupeKey(data.user_id, data.tenant_id, data.dedupe_key);
          if (existing) {
            return existing;
          }
        }
        logger.error('Error creating notification:', error);
        throw new Error(`Failed to create notification: ${error.message}`);
      }

      logger.info('Notification created successfully', { id: result.id, type: result.type });
      return new Notification(result);
    } catch (error) {
      logger.error('Error in Notification.create:', error);
      throw error;
    }
  }

  /**
   * Find notification by ID
   */
  static async findById(id: string): Promise<Notification | null> {
    try {
      // Use admin client to bypass RLS (backend services need to read notifications)
      const client = supabaseAdmin || supabase;

      const { data, error } = await client
        .from('notifications')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        logger.error('Error finding notification by ID:', error);
        throw new Error(`Failed to find notification: ${error.message}`);
      }

      return new Notification(data);
    } catch (error) {
      logger.error('Error in Notification.findById:', error);
      throw error;
    }
  }

  /**
   * Find notifications with filters
   */
  static async findMany(filters: NotificationFilters): Promise<Notification[]> {
    try {
      // Use admin client to bypass RLS (backend services need to read notifications)
      const client = supabaseAdmin || supabase;
      let query = client.from('notifications').select('*');

      // Apply filters
      if (filters.user_id) {
        query = query.eq('user_id', filters.user_id);
      }
      if (filters.tenant_id) {
        query = query.eq('tenant_id', filters.tenant_id);
      }
      if (filters.type) {
        query = query.eq('type', filters.type);
      }
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.priority) {
        query = query.eq('priority', filters.priority);
      }
      if (filters.channel) {
        query = query.eq('channel', filters.channel);
      }
      if (filters.unread_only) {
        query = query.in('status', [
          NotificationStatus.PENDING,
          NotificationStatus.DELIVERED,
          NotificationStatus.PARTIAL
        ]);
      }

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.range(filters.offset, (filters.offset + (filters.limit || 10)) - 1);
      }

      // Order by creation date (newest first)
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) {
        logger.error('Error finding notifications:', error);
        throw new Error(`Failed to find notifications: ${error.message}`);
      }

      return data.map(item => new Notification(item));
    } catch (error) {
      logger.error('Error in Notification.findMany:', error);
      throw error;
    }
  }

  /**
   * Find notification by dedupe key
   */
  static async findByDedupeKey(userId: string, tenantId: string, dedupeKey: string): Promise<Notification | null> {
    try {
      const client = supabaseAdmin || supabase;
      const { data, error } = await client
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .eq('dedupe_key', dedupeKey)
        .maybeSingle();

      if (error) {
        logger.error('Error finding notification by dedupe key:', error);
        throw new Error(`Failed to find notification by dedupe key: ${error.message}`);
      }

      return data ? new Notification(data) : null;
    } catch (error) {
      logger.error('Error in Notification.findByDedupeKey:', error);
      throw error;
    }
  }

  /**
   * Update notification
   */
  async update(updates: UpdateNotificationRequest): Promise<Notification> {
    try {
      // Use admin client to bypass RLS (backend services need to update notifications)
      const client = supabaseAdmin || supabase;

      const updateData = {
        ...updates,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await client
        .from('notifications')
        .update(updateData)
        .eq('id', this.id)
        .select()
        .single();

      if (error) {
        logger.error('Error updating notification:', error);
        throw new Error(`Failed to update notification: ${error.message}`);
      }

      // Update local instance
      Object.assign(this, data);

      logger.info('Notification updated successfully', { id: this.id, status: this.status });
      return this;
    } catch (error) {
      logger.error('Error in Notification.update:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(): Promise<Notification> {
    return this.update({
      status: NotificationStatus.READ,
      read_at: new Date(),
      seller_state: this.system_signal_id ? 'read' : undefined
    });
  }

  /**
   * Mark notification as delivered
   */
  async markAsDelivered(): Promise<Notification> {
    return this.update({
      status: NotificationStatus.DELIVERED,
      delivered_at: new Date()
    });
  }

  /**
   * Mark notification as failed
   */
  async markAsFailed(): Promise<Notification> {
    return this.update({
      status: NotificationStatus.FAILED
    });
  }

  /**
   * Delete notification
   */
  async delete(): Promise<void> {
    try {
      // Use admin client to bypass RLS (backend services need to delete notifications)
      const client = supabaseAdmin || supabase;

      const { error } = await client
        .from('notifications')
        .delete()
        .eq('id', this.id);

      if (error) {
        logger.error('Error deleting notification:', error);
        throw new Error(`Failed to delete notification: ${error.message}`);
      }

      logger.info('Notification deleted successfully', { id: this.id });
    } catch (error) {
      logger.error('Error in Notification.delete:', error);
      throw error;
    }
  }

  /**
   * Check if notification is expired
   */
  isExpired(): boolean {
    if (!this.expires_at) return false;
    return new Date() > this.expires_at;
  }

  /**
   * Check if notification is unread
   */
  isUnread(): boolean {
    return [
      NotificationStatus.PENDING,
      NotificationStatus.DELIVERED,
      NotificationStatus.PARTIAL
    ].includes(this.status);
  }

  /**
   * Get notification age in minutes
   */
  getAgeInMinutes(): number {
    const now = new Date();
    const created = new Date(this.created_at);
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60));
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId: string, tenantId?: string): Promise<number> {
    try {
      // Use admin client to bypass RLS (backend services need to update notifications)
      const client = supabaseAdmin || supabase;

      let query = client
        .from('notifications')
        .update({
          status: NotificationStatus.READ,
          read_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .in('status', [
          NotificationStatus.PENDING,
          NotificationStatus.DELIVERED,
          NotificationStatus.PARTIAL
        ]);

      if (tenantId) {
        query = query.eq('tenant_id', tenantId);
      }

      const { data, error, count } = await query.select('id', { count: 'exact' });

      if (error) {
        logger.error('Error marking all notifications as read:', error);
        throw new Error(`Failed to mark all notifications as read: ${error.message}`);
      }

      logger.info('Marked all notifications as read', { userId, tenantId, count: count || 0 });
      return count || 0;
    } catch (error) {
      logger.error('Error in Notification.markAllAsRead:', error);
      throw error;
    }
  }
}



export default Notification;

