import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { getLogger } from '../../../shared/utils/logger';

const logger = getLogger('WebSocketService');

interface SyncProgress {
  userId: string;
  jobId: string;
  current: number;
  total: number;
  reportType?: string;
  status: 'processing' | 'completed' | 'failed';
  message?: string;
  percentage: number;
}

interface UserConnection {
  userId: string;
  socketId: string;
  connectedAt: Date;
}

class WebSocketService {
  private io: SocketIOServer | null = null;
  private userConnections: Map<string, UserConnection> = new Map();

  initialize(server: HTTPServer): void {
    try {
      this.io = new SocketIOServer(server, {
        cors: {
          origin: process.env.FRONTEND_URL || "http://localhost:3000",
          methods: ["GET", "POST"],
          credentials: true,
        },
        transports: ['websocket', 'polling'],
      });

      this.setupEventHandlers();
      logger.info('WebSocket service initialized successfully');

    } catch (error) {
      logger.error('Error initializing WebSocket service:', error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.io) {
      logger.error('Socket.IO server not initialized');
      return;
    }

    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      // Handle user authentication
      socket.on('authenticate', (data: { userId: string; token: string }) => {
        try {
          // TODO: Validate JWT token
          // For now, we'll trust the userId from the client
          const { userId } = data;
          
          this.userConnections.set(socket.id, {
            userId,
            socketId: socket.id,
            connectedAt: new Date(),
          });

          // Join user-specific room
          socket.join(`user_${userId}`);
          
          logger.info(`User ${userId} authenticated via WebSocket`);
          socket.emit('authenticated', { success: true });

        } catch (error) {
          logger.error('WebSocket authentication error:', error);
          socket.emit('authenticated', { success: false, error: 'Authentication failed' });
        }
      });

      // Handle sync progress subscription
      socket.on('subscribe_sync_progress', (data: { jobId: string }) => {
        try {
          const connection = this.userConnections.get(socket.id);
          if (!connection) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
          }

          // Join job-specific room
          socket.join(`job_${data.jobId}`);
          
          logger.info(`User ${connection.userId} subscribed to sync progress for job ${data.jobId}`);
          socket.emit('subscribed', { jobId: data.jobId });

        } catch (error) {
          logger.error('Error subscribing to sync progress:', error);
          socket.emit('error', { message: 'Failed to subscribe to sync progress' });
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        const connection = this.userConnections.get(socket.id);
        if (connection) {
          logger.info(`User ${connection.userId} disconnected from WebSocket`);
          this.userConnections.delete(socket.id);
        } else {
          logger.info(`Anonymous client disconnected: ${socket.id}`);
        }
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error(`WebSocket error for socket ${socket.id}:`, error);
      });
    });
  }

  // Emit sync progress to specific user
  emitSyncProgress(progress: SyncProgress): void {
    try {
      if (!this.io) {
        logger.warn('Socket.IO server not initialized, cannot emit sync progress');
        return;
      }

      // Calculate percentage
      const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
      const progressWithPercentage = { ...progress, percentage };

      // Emit to user-specific room
      this.io.to(`user_${progress.userId}`).emit('sync_progress', progressWithPercentage);
      
      // Also emit to job-specific room
      this.io.to(`job_${progress.jobId}`).emit('sync_progress', progressWithPercentage);

      logger.info(`Emitted sync progress for user ${progress.userId}, job ${progress.jobId}: ${percentage}%`);

    } catch (error) {
      logger.error('Error emitting sync progress:', error);
    }
  }

  // Emit sync completion
  emitSyncCompletion(userId: string, jobId: string, result: any): void {
    try {
      if (!this.io) {
        logger.warn('Socket.IO server not initialized, cannot emit sync completion');
        return;
      }

      const completionData = {
        userId,
        jobId,
        status: 'completed',
        result,
        timestamp: new Date().toISOString(),
      };

      this.io.to(`user_${userId}`).emit('sync_completed', completionData);
      this.io.to(`job_${jobId}`).emit('sync_completed', completionData);

      logger.info(`Emitted sync completion for user ${userId}, job ${jobId}`);

    } catch (error) {
      logger.error('Error emitting sync completion:', error);
    }
  }

  // Emit sync error
  emitSyncError(userId: string, jobId: string, error: any): void {
    try {
      if (!this.io) {
        logger.warn('Socket.IO server not initialized, cannot emit sync error');
        return;
      }

      const errorData = {
        userId,
        jobId,
        status: 'failed',
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      };

      this.io.to(`user_${userId}`).emit('sync_error', errorData);
      this.io.to(`job_${jobId}`).emit('sync_error', errorData);

      logger.info(`Emitted sync error for user ${userId}, job ${jobId}`);

    } catch (emitError) {
      logger.error('Error emitting sync error:', emitError);
    }
  }

  // Emit general notification to user
  emitNotification(userId: string, notification: {
    type: 'info' | 'warning' | 'error' | 'success';
    title: string;
    message: string;
    data?: any;
  }): void {
    try {
      if (!this.io) {
        logger.warn('Socket.IO server not initialized, cannot emit notification');
        return;
      }

      const notificationData = {
        ...notification,
        timestamp: new Date().toISOString(),
      };

      this.io.to(`user_${userId}`).emit('notification', notificationData);

      logger.info(`Emitted notification to user ${userId}: ${notification.title}`);

    } catch (error) {
      logger.error('Error emitting notification:', error);
    }
  }

  // Get connected users count
  getConnectedUsersCount(): number {
    return this.userConnections.size;
  }

  // Get user connections info
  getUserConnections(): UserConnection[] {
    return Array.from(this.userConnections.values());
  }

  // Check if user is connected
  isUserConnected(userId: string): boolean {
    return Array.from(this.userConnections.values()).some(conn => conn.userId === userId);
  }

  // Force disconnect user
  disconnectUser(userId: string): void {
    try {
      if (!this.io) {
        logger.warn('Socket.IO server not initialized, cannot disconnect user');
        return;
      }

      const userConnections = Array.from(this.userConnections.entries())
        .filter(([_, conn]) => conn.userId === userId);

      userConnections.forEach(([socketId, _]) => {
        const socket = this.io!.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
          this.userConnections.delete(socketId);
        }
      });

      logger.info(`Disconnected user ${userId} from WebSocket`);

    } catch (error) {
      logger.error('Error disconnecting user:', error);
    }
  }

  // Broadcast to all connected users
  broadcastToAll(event: string, data: any): void {
    try {
      if (!this.io) {
        logger.warn('Socket.IO server not initialized, cannot broadcast');
        return;
      }

      this.io.emit(event, data);
      logger.info(`Broadcasted event ${event} to all connected users`);

    } catch (error) {
      logger.error('Error broadcasting to all users:', error);
    }
  }

  // Close WebSocket server
  close(): void {
    try {
      if (this.io) {
        this.io.close();
        this.userConnections.clear();
        logger.info('WebSocket service closed');
      }
    } catch (error) {
      logger.error('Error closing WebSocket service:', error);
    }
  }
}

export const websocketService = new WebSocketService();
export default websocketService; 