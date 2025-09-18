import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { integrationService } from '../services/integrationService';
import logger from '../utils/logger';
import { createError } from '../utils/errorHandler';

class IntegrationController {
  /**
   * Get integration status for a specific provider
   */
  async getIntegrationStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { provider } = req.params;
      const userId = req.user!.id;

      logger.info('Fetching integration status', {
        userId,
        provider,
        endpoint: req.url
      });

      const status = await integrationService.getIntegrationStatus(userId, provider);

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      logger.error('Error fetching integration status', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id,
        provider: req.params.provider,
        endpoint: req.url
      });

      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          message: 'Integration status not found'
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to fetch integration status'
      });
    }
  }

  /**
   * Get all integration statuses for the authenticated user
   */
  async getAllIntegrationStatuses(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;

      logger.info('Fetching all integration statuses', {
        userId,
        endpoint: req.url
      });

      const statuses = await integrationService.getAllIntegrationStatuses(userId);

      res.json({
        success: true,
        data: statuses
      });
    } catch (error) {
      logger.error('Error fetching all integration statuses', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id,
        endpoint: req.url
      });

      res.status(500).json({
        success: false,
        message: 'Failed to fetch integration statuses'
      });
    }
  }

  /**
   * Reconnect integration for a specific provider
   */
  async reconnectIntegration(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { provider } = req.params;
      const userId = req.user!.id;

      logger.info('Initiating integration reconnect', {
        userId,
        provider,
        endpoint: req.url
      });

      const reconnectUrl = await integrationService.reconnectIntegration(userId, provider);

      res.json({
        success: true,
        data: {
          reconnectUrl,
          message: `Redirect to this URL to reconnect your ${provider} integration`
        }
      });
    } catch (error) {
      logger.error('Error reconnecting integration', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id,
        provider: req.params.provider,
        endpoint: req.url
      });

      if (error instanceof Error && error.message.includes('not supported')) {
        res.status(400).json({
          success: false,
          message: 'Provider not supported for reconnection'
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to initiate reconnection'
      });
    }
  }
}

export const integrationController = new IntegrationController();
