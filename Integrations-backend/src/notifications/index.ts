// Main entry point for the Notifications System module
// This file exports all the main components for easy integration

// Core services
export { default as notificationService, NotificationService } from './services/notification_service';
export { default as EmailService } from './services/delivery/email_service';
export { default as WebSocketService } from './services/delivery/websocket_service';
export { default as NotificationWorker } from './workers/notification_worker';

// Models
export { default as Notification, NotificationType, NotificationStatus, NotificationPriority, NotificationChannel } from './models/notification';

// Controllers
export { default as NotificationController } from './controllers/notification_controller';

// Routes
export { default as notificationRoutes } from './routes/notification_routes';

// Types and interfaces
export type {
  NotificationEvent,
  NotificationStats,
  CreateNotificationRequest,
  UpdateNotificationRequest,
  NotificationFilters,
  NotificationData,
  NotificationMessage,
  EmailConfig,
  EmailTemplate,
  WebSocketConfig,
  ConnectedUser,
  NotificationJobData,
  NotificationJobResult
} from './services/notification_service';

export type {
  AuthenticatedRequest
} from './controllers/notification_controller';

// Re-export commonly used enums for convenience
export {
  NotificationType,
  NotificationStatus,
  NotificationPriority,
  NotificationChannel
} from './models/notification';

// Default export for the main service
export default notificationService;

