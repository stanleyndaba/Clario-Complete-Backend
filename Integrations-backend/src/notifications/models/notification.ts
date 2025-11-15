import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getLogger } from '../../utils/logger';

const logger = getLogger('NotificationModel');

// Database schema types
export interface NotificationData {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  channel: NotificationChannel;
  payload?: Record<string, any>;
  read_at?: Date;
  delivered_at?: Date;
  expires_at?: Date;
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
  DISCREPANCY_FOUND = 'discrepancy_found',
  SYSTEM_ALERT = 'system_alert',
  USER_ACTION_REQUIRED = 'user_action_required'
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
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
  type: NotificationType;
  title: string;
  message: string;
  priority?: NotificationPriority;
  channel?: NotificationChannel;
  payload?: Record<string, any>;
  expires_at?: Date;
}

export interface UpdateNotificationRequest {
  status?: NotificationStatus;
  read_at?: Date;
  delivered_at?: Date;
  payload?: Record<string, any>;
}

export interface NotificationFilters {
  user_id?: string;
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
  type: NotificationType;
  title: string;
  message: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  channel: NotificationChannel;
  payload?: Record<string, any>;
  read_at?: Date;
  delivered_at?: Date;
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;

  constructor(data: NotificationData) {
    this.id = data.id;
    this.user_id = data.user_id;
    this.type = data.type;
    this.title = data.title;
    this.message = data.message;
    this.status = data.status;
    this.priority = data.priority;
    this.channel = data.channel;
    this.payload = data.payload;
    this.read_at = data.read_at;
    this.delivered_at = data.delivered_at;
    this.expires_at = data.expires_at;
    this.created_at = data.created_at;
    this.updated_at = data.updated_at;
  }

  /**
   * Create a new notification
   */
  static async create(data: CreateNotificationRequest): Promise<Notification> {
    try {
      // Use admin client to bypass RLS (backend services need to create notifications)
      const { supabaseAdmin } = await import('../../database/supabaseClient');
      const supabase = supabaseAdmin || getSupabaseClient();
      
      const notificationData = {
        ...data,
        status: NotificationStatus.PENDING,
        priority: data.priority || NotificationPriority.NORMAL,
        channel: data.channel || NotificationChannel.IN_APP,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: result, error } = await supabase
        .from('notifications')
        .insert(notificationData)
        .select()
        .single();

      if (error) {
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
      const { supabaseAdmin } = await import('../../database/supabaseClient');
      const supabase = supabaseAdmin || getSupabaseClient();
      
      const { data, error } = await supabase
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
      const { supabaseAdmin } = await import('../../database/supabaseClient');
      const supabase = supabaseAdmin || getSupabaseClient();
      let query = supabase.from('notifications').select('*');

      // Apply filters
      if (filters.user_id) {
        query = query.eq('user_id', filters.user_id);
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
        query = query.eq('status', NotificationStatus.PENDING);
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
   * Update notification
   */
  async update(updates: UpdateNotificationRequest): Promise<Notification> {
    try {
      // Use admin client to bypass RLS (backend services need to update notifications)
      const { supabaseAdmin } = await import('../../database/supabaseClient');
      const supabase = supabaseAdmin || getSupabaseClient();
      
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
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
      read_at: new Date()
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
      const { supabaseAdmin } = await import('../../database/supabaseClient');
      const supabase = supabaseAdmin || getSupabaseClient();
      
      const { error } = await supabase
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
    return this.status === NotificationStatus.PENDING;
  }

  /**
   * Get notification age in minutes
   */
  getAgeInMinutes(): number {
    const now = new Date();
    const created = new Date(this.created_at);
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60));
  }
}

// Helper function to get Supabase client
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required');
  }
  
  return createClient(supabaseUrl, supabaseKey);
}

export default Notification;

