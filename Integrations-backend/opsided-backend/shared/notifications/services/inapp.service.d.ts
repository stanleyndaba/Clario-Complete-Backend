export interface InAppNotification {
    id: string;
    userId: string;
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    priority: 'low' | 'medium' | 'high';
    actions?: Array<{
        label: string;
        action: string;
        url?: string;
    }>;
    metadata?: Record<string, any>;
    expiresAt?: Date;
    category?: string;
    read: boolean;
    createdAt: Date;
}
export interface InAppNotificationOptions {
    userId: string;
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    priority?: 'low' | 'medium' | 'high';
    actions?: Array<{
        label: string;
        action: string;
        url?: string;
    }>;
    metadata?: Record<string, any>;
    expiresAt?: Date;
    category?: string;
}
declare class InAppService {
    private io;
    private userConnections;
    constructor();
    private initializeSocketIO;
    private setupSocketHandlers;
    private addUserConnection;
    private removeUserConnection;
    createNotification(options: InAppNotificationOptions): Promise<InAppNotification>;
    private sendRealTimeNotification;
    getNotifications(userId: string, limit?: number, offset?: number): Promise<InAppNotification[]>;
    getUnreadCount(userId: string): Promise<number>;
    markAsRead(notificationId: string): Promise<void>;
    markAllAsRead(userId: string): Promise<void>;
    deleteNotification(notificationId: string): Promise<void>;
    deleteExpiredNotifications(): Promise<number>;
    getNotificationStats(userId: string): Promise<{
        total: number;
        unread: number;
        read: number;
        byType: Record<string, number>;
    }>;
    sendNotification(userId: string, templateId: string, data: Record<string, any>): Promise<boolean>;
    private loadTemplate;
    private replacePlaceholders;
}
export declare const inAppService: InAppService;
export default inAppService;
//# sourceMappingURL=inapp.service.d.ts.map