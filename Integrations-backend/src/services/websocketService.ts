import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import logger from '../utils/logger';
import syncController from '../controllers/syncController';

export interface SyncProgressUpdate {
  syncId: string;
  step: number;
  totalSteps: number;
  currentStep: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  estimatedTimeRemaining?: number;
  metadata?: Record<string, any>;
  updatedAt: string;
}

export interface OrchestrationProgressUpdate {
  syncId: string;
  stage: string;
  percent: number;
  totalCases: number;
  processedCases: number;
  audit: any[];
  updatedAt: string;
}

export class WebSocketService {
  private io: SocketIOServer | null = null;
  private userRooms: Map<string, string> = new Map(); // userId -> roomId

  initialize(server: HTTPServer): void {
    const wsCorsEnv = process.env.CORS_ALLOW_ORIGINS || process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '';
    const wsOrigins = wsCorsEnv
      ? wsCorsEnv.split(',').map((o: string) => o.trim()).filter(Boolean)
      : ['http://localhost:3000'];
    const wsRegex = process.env.ALLOWED_ORIGIN_REGEX;

    this.io = new SocketIOServer(server, {
      cors: {
        origin: wsOrigins.includes('*') ? true : (wsRegex ? new RegExp(wsRegex) : wsOrigins),
        methods: ['GET', 'POST'],
        credentials: !wsOrigins.includes('*')
      }
    });

    this.setupEventHandlers();
    logger.info('WebSocket service initialized');
  }

  private setupEventHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket) => {
      logger.info('Client connected to WebSocket', { socketId: socket.id });

      // Handle user authentication
      socket.on('authenticate', async (data: { userId: string; token: string }) => {
        try {
          // TODO: Validate JWT token here
          const { userId } = data;
          
          // Join user-specific room
          const roomId = `user_${userId}`;
          socket.join(roomId);
          this.userRooms.set(userId, roomId);
          
          logger.info('User authenticated for WebSocket', { userId, socketId: socket.id });
          
          socket.emit('authenticated', { success: true });
        } catch (error) {
          logger.error('WebSocket authentication failed', { error, socketId: socket.id });
          socket.emit('authenticated', { success: false, error: 'Authentication failed' });
        }
      });

      // Handle sync progress subscription
      socket.on('subscribe_sync_progress', async (data: { userId: string; syncId: string }) => {
        try {
          const { userId, syncId } = data;
          const roomId = `sync_${syncId}`;
          
          socket.join(roomId);
          
          // Send current progress immediately
          const currentProgress = {
            syncId,
            step: 1,
            totalSteps: 5,
            currentStep: 'Processing',
            status: 'running',
            progress: 50,
            message: 'Sync in progress',
            metadata: {},
            updatedAt: new Date().toISOString()
          };

      // Handle sync progress unsubscription
      socket.on('unsubscribe_sync_progress', (data: { syncId: string }) => {
        const { syncId } = data;
        const roomId = `sync_${syncId}`;
        
        socket.leave(roomId);
        logger.info('User unsubscribed from sync progress', { syncId, socketId: socket.id });
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        logger.info('Client disconnected from WebSocket', { socketId: socket.id });
      });
    });
  }

  /**
   * Broadcast sync progress update to all subscribers
   */
  broadcastSyncProgress(syncId: string, progressUpdate: OrchestrationProgressUpdate): void {
    if (!this.io) {
      logger.warn('WebSocket service not initialized');
      return;
    }
    const roomId = `sync_${syncId}`;
    this.io.to(roomId).emit('sync_progress_update', progressUpdate);
    logger.info('Sync progress broadcasted', { syncId, percent: progressUpdate.percent });
  }

  /**
   * Send sync progress update to specific user
   */
  sendSyncProgressToUser(userId: string, progressUpdate: SyncProgressUpdate): void {
    if (!this.io) {
      logger.warn('WebSocket service not initialized');
      return;
    }

    const roomId = this.userRooms.get(userId);
    if (roomId) {
      this.io.to(roomId).emit('sync_progress_update', progressUpdate);
      logger.info('Sync progress sent to user', { userId, syncId: progressUpdate.syncId });
    }
  }

  /**
   * Broadcast sync completion notification
   */
  broadcastSyncCompletion(syncId: string, result: { success: boolean; message: string }): void {
    if (!this.io) {
      logger.warn('WebSocket service not initialized');
      return;
    }

    const roomId = `sync_${syncId}`;
    this.io.to(roomId).emit('sync_completed', result);
    
    logger.info('Sync completion broadcasted', { syncId, success: result.success });
  }

  /**
   * Send notification to specific user
   */
  sendNotificationToUser(userId: string, notification: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    data?: any;
  }): void {
    if (!this.io) {
      logger.warn('WebSocket service not initialized');
      return;
    }

    const roomId = this.userRooms.get(userId);
    if (roomId) {
      this.io.to(roomId).emit('notification', notification);
      logger.info('Notification sent to user', { userId, type: notification.type });
    }
  }

  /**
   * Get connected clients count
   */
  getConnectedClientsCount(): number {
    if (!this.io) return 0;
    return this.io.engine.clientsCount;
  }

  /**
   * Get room members count
   */
  getRoomMembersCount(roomId: string): number {
    if (!this.io) return 0;
    const room = this.io.sockets.adapter.rooms.get(roomId);
    return room ? room.size : 0;
  }
}

export const websocketService = new WebSocketService();
export default websocketService; 


