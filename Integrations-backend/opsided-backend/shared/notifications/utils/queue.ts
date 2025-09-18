import { getLogger } from '../../utils/logger';
import amqp from 'amqplib';

const logger = getLogger('NotificationQueue');

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

class NotificationQueue {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private config: QueueConfig;

  constructor() {
    this.config = {
      url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
      exchange: 'notifications',
      queue: 'notification_queue',
      routingKey: 'notification',
    };
  }

  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.config.url);
      this.channel = await this.connection.createChannel();
      
      // Declare exchange
      await this.channel.assertExchange(this.config.exchange, 'topic', { durable: true });
      
      // Declare queue
      await this.channel.assertQueue(this.config.queue, { durable: true });
      
      // Bind queue to exchange
      await this.channel.bindQueue(this.config.queue, this.config.exchange, this.config.routingKey);
      
      logger.info('Connected to notification queue');
    } catch (error) {
      logger.error('Failed to connect to notification queue:', error);
      throw error;
    }
  }

  async publish(message: QueueMessage): Promise<boolean> {
    if (!this.channel) {
      await this.connect();
    }

    try {
      const messageBuffer = Buffer.from(JSON.stringify(message));
      const result = this.channel!.publish(
        this.config.exchange,
        this.config.routingKey,
        messageBuffer,
        {
          persistent: true,
          priority: message.priority || 0,
          headers: {
            'x-retry-count': message.retryCount || 0,
          },
        }
      );

      if (result) {
        logger.info(`Published notification message ${message.id} for user ${message.userId}`);
      } else {
        logger.warn(`Failed to publish notification message ${message.id}`);
      }

      return result;
    } catch (error) {
      logger.error('Failed to publish notification message:', error);
      return false;
    }
  }

  async consume(handler: (message: QueueMessage) => Promise<void>): Promise<void> {
    if (!this.channel) {
      await this.connect();
    }

    try {
      await this.channel!.consume(
        this.config.queue,
        async (msg) => {
          if (!msg) return;

          try {
            const message: QueueMessage = JSON.parse(msg.content.toString());
            logger.info(`Processing notification message ${message.id}`);

            await handler(message);
            this.channel!.ack(msg);
          } catch (error) {
            logger.error(`Failed to process notification message ${msg.content.toString()}:`, error);
            
            // Reject and requeue if retry count is less than 3
            const retryCount = msg.properties.headers?.['x-retry-count'] || 0;
            if (retryCount < 3) {
              this.channel!.nack(msg, false, true);
            } else {
              this.channel!.nack(msg, false, false);
            }
          }
        },
        { noAck: false }
      );

      logger.info('Started consuming notification messages');
    } catch (error) {
      logger.error('Failed to start consuming notification messages:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      logger.info('Closed notification queue connection');
    } catch (error) {
      logger.error('Failed to close notification queue connection:', error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.connection || !this.channel) {
        await this.connect();
      }
      return true;
    } catch (error) {
      logger.error('Notification queue health check failed:', error);
      return false;
    }
  }
}

export const notificationQueue = new NotificationQueue();
export default notificationQueue; 