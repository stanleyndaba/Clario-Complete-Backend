import { Request, Response } from 'express';
export declare class NotificationController {
    sendNotification(req: Request, res: Response): Promise<void>;
    getNotifications(req: Request, res: Response): Promise<void>;
    getNotificationStats(req: Request, res: Response): Promise<void>;
    getPreferences(req: Request, res: Response): Promise<void>;
    updatePreferences(req: Request, res: Response): Promise<void>;
    markAsRead(req: Request, res: Response): Promise<void>;
    markAllAsRead(req: Request, res: Response): Promise<void>;
    deleteNotification(req: Request, res: Response): Promise<void>;
    getTemplates(req: Request, res: Response): Promise<void>;
    healthCheck(req: Request, res: Response): Promise<void>;
}
export declare const notificationController: NotificationController;
export default notificationController;
//# sourceMappingURL=notification.controller.d.ts.map