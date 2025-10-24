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
export declare class Notification {
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
    constructor(data: NotificationData);
    static findById(id: string): Promise<Notification | null>;
    static findByUserId(userId: string, limit?: number, offset?: number): Promise<Notification[]>;
    static findByStatus(status: NotificationData['status']): Promise<Notification[]>;
    static create(data: Omit<NotificationData, 'id' | 'createdAt' | 'updatedAt'>): Promise<Notification>;
    update(data: Partial<Omit<NotificationData, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Promise<void>;
    markAsSent(): Promise<void>;
    markAsDelivered(): Promise<void>;
    markAsOpened(): Promise<void>;
    markAsFailed(errorMessage: string): Promise<void>;
    toJSON(): NotificationData;
}
export declare class UserNotificationPreference {
    id: string;
    userId: string;
    channel: 'email' | 'push' | 'inapp' | 'slack';
    type: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    constructor(data: UserNotificationPreferenceData);
    static findByUserId(userId: string): Promise<UserNotificationPreference[]>;
    static findByUserIdAndType(userId: string, type: string): Promise<UserNotificationPreference[]>;
    static create(data: Omit<UserNotificationPreferenceData, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserNotificationPreference>;
    update(data: Partial<Omit<UserNotificationPreferenceData, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>): Promise<void>;
    toJSON(): UserNotificationPreferenceData;
}
//# sourceMappingURL=notification.model.d.ts.map