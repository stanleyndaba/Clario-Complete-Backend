import cron from 'node-cron';
import logger from '../utils/logger';
import stripeService from '../services/stripeService';
import tokenManager from '../utils/tokenManager';
import { supabase } from '../database/supabaseClient';

export class StripeSyncJob {
  private isRunning = false;

  async syncUserData(userId: string): Promise<void> {
    try {
      logger.info('Starting Stripe sync for user', { userId });

      // Check if user has valid Stripe token
      const isConnected = await tokenManager.isTokenValid(userId, 'stripe');
      if (!isConnected) {
        logger.info('User not connected to Stripe, skipping sync', { userId });
        return;
      }

      // Sync transactions
      const transactions = await stripeService.fetchTransactions(userId);
      await this.saveTransactionsToDatabase(userId, transactions);

      // Sync account info
      const accountInfo = await stripeService.getAccountInfo(userId);
      await this.saveAccountInfoToDatabase(userId, accountInfo);

      logger.info('Stripe sync completed successfully', { userId });
    } catch (error) {
      logger.error('Error during Stripe sync', { error, userId });
    }
  }

  private async saveTransactionsToDatabase(userId: string, transactions: any[]): Promise<void> {
    try {
      // TODO: Implement actual database save for transactions
      // This is a stub implementation
      logger.info('Saving Stripe transactions to database', { userId, count: transactions.length });
      
      // Mock database save
      for (const transaction of transactions) {
        // Simulate database operation
        await new Promise(resolve => {
          const timer = global.setTimeout(resolve, 10);
        });
      }
      
      logger.info('Stripe transactions saved to database', { userId, count: transactions.length });
    } catch (error) {
      logger.error('Error saving Stripe transactions to database', { error, userId });
      throw error;
    }
  }

  private async saveAccountInfoToDatabase(userId: string, accountInfo: any): Promise<void> {
    try {
      // TODO: Implement actual database save for account info
      // This is a stub implementation
      logger.info('Saving Stripe account info to database', { userId });
      
      // Mock database save
      await new Promise(resolve => setTimeout(resolve, 10));
      
      logger.info('Stripe account info saved to database', { userId });
    } catch (error) {
      logger.error('Error saving Stripe account info to database', { error, userId });
      throw error;
    }
  }

  async syncAllUsers(): Promise<void> {
    if (this.isRunning) {
      logger.info('Stripe sync job already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Starting Stripe sync job for all users');

      // TODO: Get all users with Stripe integration
      // This is a stub implementation
      const usersWithStripe = await this.getUsersWithStripeIntegration();

      for (const userId of usersWithStripe) {
        await this.syncUserData(userId);
        // Add delay between users to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('Stripe sync job completed for all users');
    } catch (error) {
      logger.error('Error in Stripe sync job', { error });
    } finally {
      this.isRunning = false;
    }
  }

  private async getUsersWithStripeIntegration(): Promise<string[]> {
    try {
      // TODO: Implement actual database query to get users with Stripe integration
      // This is a stub implementation
      logger.info('Fetching users with Stripe integration');
      
      // Mock response - in production, this would query the database
      const mockUsers = ['user-1', 'user-2', 'user-4'];
      
      logger.info('Found users with Stripe integration', { count: mockUsers.length });
      return mockUsers;
    } catch (error) {
      logger.error('Error fetching users with Stripe integration', { error });
      return [];
    }
  }

  startScheduledSync(): void {
    // Run every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      logger.info('Starting scheduled Stripe sync job');
      await this.syncAllUsers();
    });

    logger.info('Stripe sync job scheduled to run every 30 minutes');
  }

  stopScheduledSync(): void {
    // TODO: Implement job stopping mechanism
    logger.info('Stripe sync job stopped');
  }
}

export const stripeSyncJob = new StripeSyncJob();
export default stripeSyncJob; 