import { getDatabase } from '../../db/connection';
import { getLogger } from '../../utils/logger';

const logger = getLogger('NotificationModel');

export interface NotificationData {
  id: string;
  userId: string;
  type: string;
  channel: 'email' | 'push' | 'inapp' | 'slack';
  templateId: string;
  payload: Record<string, any>;
  status: 'pending' | 'sent' | 'failed' | 'delivered' | 'opened';
  errorMessage?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserNotificationPreferenceData {
  id: string;
  userId: string;
  channel: 'email' | 'push' | 'inapp' | 'slack';
  type: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Notification {
  id: string;
  userId: string;
  type: string;
  channel: 'email' | 'push' | 'inapp' | 'slack';
  templateId: string;
  payload: Record<string, any>;
  status: 'pending' | 'sent' | 'failed' | 'delivered' | 'opened';
  errorMessage?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  constructor(data: NotificationData) {
    this.id = data.id;
    this.userId = data.userId;
    this.type = data.type;
    this.channel = data.channel;
    this.templateId = data.templateId;
    this.payload = data.payload;
    this.status = data.status;
    this.errorMessage = data.errorMessage;
    this.sentAt = data.sentAt;
    this.deliveredAt = data.deliveredAt;
    this.openedAt = data.openedAt;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static async findById(id: string): Promise<Notification | null> {
    const db = getDatabase();
    const notification = await db('notifications').where({ id }).first();
    return notification ? new Notification(notification) : null;
  }

  static async findByUserId(userId: string, limit: number = 50, offset: number = 0): Promise<Notification[]> {
    const db = getDatabase();
    const notifications = await db('notifications')
      .where({ userId })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset);
    
    return notifications.map(n => new Notification(n));
  }

  static async findByStatus(status: NotificationData['status']): Promise<Notification[]> {
    const db = getDatabase();
    const notifications = await db('notifications')
      .where({ status })
      .orderBy('createdAt', 'desc');
    
    return notifications.map(n => new Notification(n));
  }

  static async create(data: Omit<NotificationData, 'id' | 'createdAt' | 'updatedAt'>): Promise<Notification> {
    const db = getDatabase();
    const now = new Date();
    const [notification] = await db('notifications').insert({
      ...data,
      createdAt: now,
      updatedAt: now,
    }).returning('*');
    
    logger.info(`Created notification ${notification.id} for user ${data.userId}`);
    return new Notification(notification);
  }

  async update(data: Partial<Omit<NotificationData, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    const db = getDatabase();
    await db('notifications').where({ id: this.id }).update({
      ...data,
      updatedAt: new Date(),
    });
    
    // Update local instance
    Object.assign(this, data, { updatedAt: new Date() });
  }

  async markAsSent(): Promise<void> {
    await this.update({ status: 'sent', sentAt: new Date() });
  }

  async markAsDelivered(): Promise<void> {
    await this.update({ status: 'delivered', deliveredAt: new Date() });
  }

  async markAsOpened(): Promise<void> {
    await this.update({ status: 'opened', openedAt: new Date() });
  }

  async markAsFailed(errorMessage: string): Promise<void> {
    await this.update({ status: 'failed', errorMessage });
  }

  toJSON(): NotificationData {
    return {
      id: this.id,
      userId: this.userId,
      type: this.type,
      channel: this.channel,
      templateId: this.templateId,
      payload: this.payload,
      status: this.status,
      errorMessage: this.errorMessage,
      sentAt: this.sentAt,
      deliveredAt: this.deliveredAt,
      openedAt: this.openedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export class UserNotificationPreference {
  id: string;
  userId: string;
  channel: 'email' | 'push' | 'inapp' | 'slack';
  type: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(data: UserNotificationPreferenceData) {
    this.id = data.id;
    this.userId = data.userId;
    this.channel = data.channel;
    this.type = data.type;
    this.enabled = data.enabled;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static async findByUserId(userId: string): Promise<UserNotificationPreference[]> {
    const db = getDatabase();
    const preferences = await db('user_notification_preferences').where({ userId });
    return preferences.map(p => new UserNotificationPreference(p));
  }

  static async findByUserIdAndType(userId: string, type: string): Promise<UserNotificationPreference[]> {
    const db = getDatabase();
    const preferences = await db('user_notification_preferences').where({ userId, type });
    return preferences.map(p => new UserNotificationPreference(p));
  }

  static async create(data: Omit<UserNotificationPreferenceData, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserNotificationPreference> {
    const db = getDatabase();
    const now = new Date();
    const [preference] = await db('user_notification_preferences').insert({
      ...data,
      createdAt: now,
      updatedAt: now,
    }).returning('*');
    
    return new UserNotificationPreference(preference);
  }

  async update(data: Partial<Omit<UserNotificationPreferenceData, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    const db = getDatabase();
    await db('user_notification_preferences').where({ id: this.id }).update({
      ...data,
      updatedAt: new Date(),
    });
    
    // Update local instance
    Object.assign(this, data, { updatedAt: new Date() });
  }

  toJSON(): UserNotificationPreferenceData {
    return {
      id: this.id,
      userId: this.userId,
      channel: this.channel,
      type: this.type,
      enabled: this.enabled,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
} 