export interface QueueMessage {
    id: string;
    type: string;
    userId: string;
    channel: 'email' | 'push' | 'inapp' | 'slack';
    templateId: string;
    payload: Record<string, any>;
    priority?: number;
    scheduledAt?: Date;
    retryCount?: number;
}
export interface QueueConfig {
    url: string;
    exchange: string;
    queue: string;
    routingKey: string;
}
declare class NotificationQueue {
    private connection;
    private channel;
    private config;
    constructor();
    connect(): Promise<void>;
    publish(message: QueueMessage): Promise<boolean>;
    consume(handler: (message: QueueMessage) => Promise<void>): Promise<void>;
    close(): Promise<void>;
    healthCheck(): Promise<boolean>;
}
export declare const notificationQueue: NotificationQueue;
export default notificationQueue;
//# sourceMappingURL=queue.d.ts.map