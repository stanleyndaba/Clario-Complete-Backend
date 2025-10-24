export interface PushNotification {
    title: string;
    body: string;
    data?: Record<string, string>;
    imageUrl?: string;
    clickAction?: string;
    priority?: 'normal' | 'high';
    ttl?: number;
}
export interface PushNotificationOptions {
    token?: string;
    topic?: string;
    userId?: string;
    notification: PushNotification;
}
declare class PushService {
    private app;
    private isInitialized;
    constructor();
    private initializeFirebase;
    sendNotification(options: PushNotificationOptions): Promise<boolean>;
    sendToTopic(topic: string, notification: PushNotification): Promise<boolean>;
    sendToUser(userId: string, notification: PushNotification): Promise<boolean>;
    sendToDevice(token: string, notification: PushNotification): Promise<boolean>;
    subscribeToTopic(tokens: string[], topic: string): Promise<boolean>;
    unsubscribeFromTopic(tokens: string[], topic: string): Promise<boolean>;
    private getUserTokens;
    validateToken(token: string): Promise<boolean>;
    getTopicSubscribers(topic: string): Promise<number>;
}
export declare const pushService: PushService;
export default pushService;
//# sourceMappingURL=push.service.d.ts.map