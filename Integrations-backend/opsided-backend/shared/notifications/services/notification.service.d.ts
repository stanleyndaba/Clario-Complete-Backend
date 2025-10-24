import { Notification } from '../models/notification.model';
import { QueueMessage } from '../utils/queue';
export interface NotificationEvent {
    type: string;
    userId: string;
    data: Record<string, any>;
    channels?: ('email' | 'push' | 'inapp' | 'slack')[];
    priority?: number;
    scheduledAt?: Date;
}
export interface NotificationTemplate {
    id: string;
    name: string;
    channels: ('email' | 'push' | 'inapp' | 'slack')[];
    subject?: string;
    title?: string;
    message?: string;
    html?: string;
    text?: string;
}
declare class NotificationService {
    private templates;
    constructor();
    private initializeTemplates;
    processEvent(event: NotificationEvent): Promise<void>;
    private getUserPreferences;
    private getDefaultChannels;
    private createNotification;
    processQueuedNotification(message: QueueMessage): Promise<void>;
    private sendEmailNotification;
    private sendPushNotification;
    private sendInAppNotification;
    private sendSlackNotification;
    private getUser;
    private replacePlaceholders;
    getNotificationHistory(userId: string, limit?: number, offset?: number): Promise<Notification[]>;
    updateUserPreferences(userId: string, preferences: Array<{
        channel: 'email' | 'push' | 'inapp' | 'slack';
        type: string;
        enabled: boolean;
    }>): Promise<void>;
    getNotificationStats(userId: string): Promise<{
        total: number;
        sent: number;
        failed: number;
        pending: number;
        byChannel: Record<string, number>;
    }>;
    onFbaReportReady(userId: string, reportId: string, reportType: string): Promise<void>;
    onLowStockAlert(userId: string, productName: string, sku: string, currentStock: number): Promise<void>;
    onDisputeApproved(userId: string, disputeId: string, amount: number): Promise<void>;
    onSyncCompleted(userId: string, recordCount: number): Promise<void>;
}
export declare const notificationService: NotificationService;
export default notificationService;
//# sourceMappingURL=notification.service.d.ts.map