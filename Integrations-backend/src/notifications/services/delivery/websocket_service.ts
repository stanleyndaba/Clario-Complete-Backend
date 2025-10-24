import { getLogger } from '../../../utils/logger';
import Notification from '../../models/notification';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';

const logger = getLogger('WebSocketService');

export interface WebSocketConfig {
  cors: {
    origin: string | string[];
    methods: string[];
    credentials: boolean;
  };
  pingTimeout: number;
  pingInterval: number;
}

export interface ConnectedUser {
  userId: string;
  socketId: string;
  connectedAt: Date;
  lastActivity: Date;
}

export interface NotificationMessage {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  payload?: Record<string, any>;
  created_at: string;
  read: boolean;
}

export class WebSocketService {
  private io: SocketIOServer | null = null;
  private connectedUsers: Map<string, ConnectedUser> = new Map();
  private config: WebSocketConfig;

  constructor() {
    this.config = {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
      },
      pingTimeout: 60000,
      pingInterval: 25000
    };
  }

  /**
   * Initialize WebSocket server
   */
  initialize(httpServer: HTTPServer): void {
    try {
      this.io = new SocketIOServer(httpServer, {
        cors: this.config.cors,
        pingTimeout: this.config.pingTimeout,
        pingInterval: this.config.pingInterval,
        transports: ['websocket', 'polling']
      });

      this.setupEventHandlers();
      logger.info('WebSocket service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize WebSocket service:', error);
      throw error;
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.io) {
      throw new Error('WebSocket server not initialized');
    }

    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });

    this.io.on('disconnect', () => {
      logger.info('WebSocket server disconnected');
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: Socket): void {
    try {
      logger.info('New WebSocket connection', { socketId: socket.id });

      // Handle user authentication
      socket.on('authenticate', (data: { userId: string; token: string }) => {
        this.handleAuthentication(socket, data);
      });

      // Handle user disconnection
      socket.on('disconnect', () => {
        this.handleDisconnection(socket);
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
      });

      // Handle notification acknowledgment
      socket.on('notification_ack', (data: { notificationId: string }) => {
        this.handleNotificationAck(socket, data);
      });

      // Handle user activity
      socket.on('user_activity', () => {
        this.updateUserActivity(socket.id);
      });

      logger.info('WebSocket connection handlers set up', { socketId: socket.id });
    } catch (error) {
      logger.error('Error handling WebSocket connection:', error);
      socket.disconnect();
    }
  }

  /**
   * Handle user authentication
   */
  private async handleAuthentication(socket: Socket, data: { userId: string; token: string }): Promise<void> {
    try {
      // TODO: Implement proper token validation
      // For now, we'll accept any userId for testing
      const userId = data.userId;
      
      if (!userId) {
        socket.emit('auth_error', { message: 'User ID is required' });
        return;
      }

      // Store user connection
      this.connectedUsers.set(socket.id, {
        userId,
        socketId: socket.id,
        connectedAt: new Date(),
        lastActivity: new Date()
      });

      // Join user-specific room
      socket.join(`user:${userId}`);

      // Send authentication success
      socket.emit('authenticated', { 
        userId,
        message: 'Successfully authenticated',
        timestamp: Date.now()
      });

      // Send any pending notifications
      await this.sendPendingNotifications(userId);

      logger.info('User authenticated via WebSocket', { 
        socketId: socket.id, 
        userId 
      });
    } catch (error) {
      logger.error('Error during WebSocket authentication:', error);
      socket.emit('auth_error', { message: 'Authentication failed' });
    }
  }

  /**
   * Handle user disconnection
   */
  private handleDisconnection(socket: Socket): void {
    try {
      const user = this.connectedUsers.get(socket.id);
      if (user) {
        this.connectedUsers.delete(socket.id);
        logger.info('User disconnected from WebSocket', { 
          socketId: socket.id, 
          userId: user.userId 
        });
      }
    } catch (error) {
      logger.error('Error handling WebSocket disconnection:', error);
    }
  }

  /**
   * Handle notification acknowledgment
   */
  private async handleNotificationAck(socket: Socket, data: { notificationId: string }): Promise<void> {
    try {
      const user = this.connectedUsers.get(socket.id);
      if (!user) {
        socket.emit('error', { message: 'User not authenticated' });
        return;
      }

      // TODO: Mark notification as read in database
      // await notificationService.markAsRead(data.notificationId);

      socket.emit('notification_ack_received', { 
        notificationId: data.notificationId,
        timestamp: Date.now()
      });

      logger.info('Notification acknowledgment received', { 
        socketId: socket.id,
        userId: user.userId,
        notificationId: data.notificationId
      });
    } catch (error) {
      logger.error('Error handling notification acknowledgment:', error);
      socket.emit('error', { message: 'Failed to acknowledge notification' });
    }
  }

  /**
   * Update user activity timestamp
   */
  private updateUserActivity(socketId: string): void {
    const user = this.connectedUsers.get(socketId);
    if (user) {
      user.lastActivity = new Date();
      this.connectedUsers.set(socketId, user);
    }
  }

  /**
   * Send notification to a specific user
   */
  async sendNotification(userId: string, notification: Notification): Promise<void> {
    try {
      if (!this.io) {
        throw new Error('WebSocket server not initialized');
      }

      const notificationMessage: NotificationMessage = {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        payload: notification.payload,
        created_at: notification.created_at.toISOString(),
        read: notification.status === 'read'
      };

      // Send to user-specific room
      this.io.to(`user:${userId}`).emit('notification', notificationMessage);

      logger.info('Notification sent via WebSocket', { 
        userId, 
        notificationId: notification.id,
        type: notification.type
      });
    } catch (error) {
      logger.error('Error sending notification via WebSocket:', error);
      throw error;
    }
  }

  /**
   * Send notification to multiple users
   */
  async sendNotificationToUsers(userIds: string[], notification: Notification): Promise<void> {
    try {
      logger.info('Sending notification to multiple users', { 
        count: userIds.length, 
        notificationId: notification.id 
      });

      const promises = userIds.map(userId => this.sendNotification(userId, notification));
      await Promise.allSettled(promises);

      logger.info('Batch notification sent successfully');
    } catch (error) {
      logger.error('Error sending batch notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to all connected users
   */
  async broadcastNotification(notification: Notification): Promise<void> {
    try {
      if (!this.io) {
        throw new Error('WebSocket server not initialized');
      }

      const notificationMessage: NotificationMessage = {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        payload: notification.payload,
        created_at: notification.created_at.toISOString(),
        read: notification.status === 'read'
      };

      this.io.emit('broadcast_notification', notificationMessage);

      logger.info('Broadcast notification sent to all users', { 
        notificationId: notification.id,
        type: notification.type
      });
    } catch (error) {
      logger.error('Error broadcasting notification:', error);
      throw error;
    }
  }

  /**
   * Send pending notifications to a user
   */
  private async sendPendingNotifications(userId: string): Promise<void> {
    try {
      // TODO: Fetch pending notifications from database
      // const pendingNotifications = await notificationService.getNotifications({
      //   user_id: userId,
      //   status: NotificationStatus.PENDING,
      //   limit: 10
      // });

      // for (const notification of pendingNotifications) {
      //   await this.sendNotification(userId, notification);
      // }

      logger.info('Pending notifications sent to user', { userId });
    } catch (error) {
      logger.error('Error sending pending notifications:', error);
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    totalConnections: number;
    activeUsers: number;
    connectionsByUser: Record<string, number>;
  } {
    const stats = {
      totalConnections: this.connectedUsers.size,
      activeUsers: new Set(Array.from(this.connectedUsers.values()).map(u => u.userId)).size,
      connectionsByUser: {} as Record<string, number>
    };

    // Count connections per user
    for (const user of this.connectedUsers.values()) {
      stats.connectionsByUser[user.userId] = (stats.connectionsByUser[user.userId] || 0) + 1;
    }

    return stats;
  }

  /**
   * Check if a user is connected
   */
  isUserConnected(userId: string): boolean {
    return Array.from(this.connectedUsers.values()).some(user => user.userId === userId);
  }

  /**
   * Get all connected user IDs
   */
  getConnectedUserIds(): string[] {
    return Array.from(new Set(Array.from(this.connectedUsers.values()).map(u => u.userId)));
  }

  /**
   * Disconnect a specific user
   */
  disconnectUser(userId: string): void {
    try {
      const userEntries = Array.from(this.connectedUsers.entries());
      const userSockets = userEntries.filter(([_, user]) => user.userId === userId);

      for (const [socketId, _] of userSockets) {
        const socket = this.io?.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect();
        }
        this.connectedUsers.delete(socketId);
      }

      logger.info('User disconnected by service', { userId, socketCount: userSockets.length });
    } catch (error) {
      logger.error('Error disconnecting user:', error);
    }
  }

  /**
   * Update WebSocket configuration
   */
  updateConfig(newConfig: Partial<WebSocketConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('WebSocket configuration updated', newConfig);
  }

  /**
   * Shutdown WebSocket service
   */
  shutdown(): void {
    try {
      if (this.io) {
        this.io.close();
        this.io = null;
      }
      this.connectedUsers.clear();
      logger.info('WebSocket service shutdown completed');
    } catch (error) {
      logger.error('Error during WebSocket service shutdown:', error);
    }
  }
}

export default WebSocketService;

