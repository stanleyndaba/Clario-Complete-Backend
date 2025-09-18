import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';
import { createError } from '../utils/errorHandler';
import config from '../config/env';

interface IntegrationStatus {
  id: string;
  user_id: string;
  provider: string;
  status: 'active' | 'revoked' | 'expired';
  updated_at: string;
  metadata?: any;
  lastSyncedAt?: string;
  message?: string;
}

class IntegrationService {
  /**
   * Get integration status for a specific provider and user
   */
  async getIntegrationStatus(userId: string, provider: string): Promise<IntegrationStatus> {
    try {
      const { data, error } = await supabase
        .from('integration_status')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', provider)
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows returned
          throw createError('Integration status not found', 404);
        }
        throw error;
      }

      // Add computed fields
      const status: IntegrationStatus = {
        ...data,
        lastSyncedAt: data.metadata?.last_synced_at,
        message: this.getStatusMessage(data.status, provider)
      };

      logger.info('Integration status retrieved', {
        userId,
        provider,
        status: data.status
      });

      return status;
    } catch (error) {
      logger.error('Error getting integration status', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        provider
      });
      throw error;
    }
  }

  /**
   * Get all integration statuses for a user
   */
  async getAllIntegrationStatuses(userId: string): Promise<IntegrationStatus[]> {
    try {
      const { data, error } = await supabase
        .from('integration_status')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) {
        throw error;
      }

      // Add computed fields to each status
      const statuses: IntegrationStatus[] = data.map(status => ({
        ...status,
        lastSyncedAt: status.metadata?.last_synced_at,
        message: this.getStatusMessage(status.status, status.provider)
      }));

      logger.info('All integration statuses retrieved', {
        userId,
        count: statuses.length
      });

      return statuses;
    } catch (error) {
      logger.error('Error getting all integration statuses', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      });
      throw error;
    }
  }

  /**
   * Generate reconnect URL for a specific provider
   */
  async reconnectIntegration(userId: string, provider: string): Promise<string> {
    try {
      // Validate provider
      const supportedProviders = ['amazon', 'stripe', 'gmail'];
      if (!supportedProviders.includes(provider)) {
        throw createError('Provider not supported for reconnection', 400);
      }

      // Generate provider-specific reconnect URLs
      let reconnectUrl: string;

      switch (provider) {
        case 'amazon':
          reconnectUrl = `${config.FRONTEND_URL}/integrations/amazon/connect?reconnect=true&userId=${userId}`;
          break;
        case 'stripe':
          reconnectUrl = `${config.FRONTEND_URL}/integrations/stripe/connect?reconnect=true&userId=${userId}`;
          break;
        case 'gmail':
          reconnectUrl = `${config.FRONTEND_URL}/integrations/gmail/connect?reconnect=true&userId=${userId}`;
          break;
        default:
          throw createError('Provider not supported for reconnection', 400);
      }

      // Update integration status to indicate reconnection attempt
      await this.updateIntegrationStatus(userId, provider, 'expired', {
        reconnection_attempted_at: new Date().toISOString()
      });

      logger.info('Reconnect URL generated', {
        userId,
        provider,
        reconnectUrl
      });

      return reconnectUrl;
    } catch (error) {
      logger.error('Error generating reconnect URL', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        provider
      });
      throw error;
    }
  }

  /**
   * Update integration status in the database
   */
  async updateIntegrationStatus(
    userId: string, 
    provider: string, 
    status: 'active' | 'revoked' | 'expired',
    metadata?: any
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('integration_status')
        .upsert({
          user_id: userId,
          provider,
          status,
          updated_at: new Date().toISOString(),
          metadata: metadata || {}
        }, {
          onConflict: 'user_id,provider'
        });

      if (error) {
        throw error;
      }

      logger.info('Integration status updated', {
        userId,
        provider,
        status,
        metadata
      });
    } catch (error) {
      logger.error('Error updating integration status', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        provider,
        status
      });
      throw error;
    }
  }

  /**
   * Get user-friendly message based on status and provider
   */
  private getStatusMessage(status: string, provider: string): string {
    switch (status) {
      case 'active':
        return `Your ${provider} integration is working properly`;
      case 'expired':
        return `Your ${provider} integration has expired. Please reconnect to continue.`;
      case 'revoked':
        return `Your ${provider} integration has been revoked. Please reconnect to continue.`;
      default:
        return `Unknown status for ${provider} integration`;
    }
  }
}

export const integrationService = new IntegrationService();
