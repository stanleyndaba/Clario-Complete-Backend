import { Request, Response } from 'express';
import { getLogger } from '../../../shared/utils/logger';
import { ApiResponse, SyncResponse } from '../../../shared/types/api';
import { syncService } from '../services/syncService';

const logger = getLogger('SyncController');

export const startSync = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, source } = req.body;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Starting sync for user ${userId}, source: ${source || 'all'}`);

    const result = await syncService.startSync(userId, source);

    const response: SyncResponse = {
      success: result.success,
      synced_items: result.syncedItems,
      errors: result.errors,
      message: result.message,
    };

    res.status(200).json({
      success: true,
      message: 'Sync operation completed',
      data: response,
      timestamp: new Date().toISOString(),
    } as ApiResponse<SyncResponse>);

  } catch (error) {
    logger.error('Sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Sync operation failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getSyncStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Getting sync status for user ${userId}`);

    const status = await syncService.getSyncStatus(userId);

    res.status(200).json({
      success: true,
      message: 'Sync status retrieved successfully',
      data: status,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get sync status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to get sync status',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getDiscrepancies = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { source, location } = req.query;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Getting discrepancies for user ${userId}`);

    const discrepancies = await syncService.getDiscrepancies(
      userId,
      source as string,
      location as string
    );

    res.status(200).json({
      success: true,
      message: 'Discrepancies retrieved successfully',
      data: discrepancies,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get discrepancies error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to get discrepancies',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const reconcileInventory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { discrepancies } = req.body;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    if (!discrepancies || !Array.isArray(discrepancies)) {
      res.status(400).json({
        success: false,
        message: 'Discrepancies array is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Reconciling inventory for user ${userId}`);

    const result = await syncService.reconcileInventory(userId, discrepancies);

    res.status(200).json({
      success: true,
      message: 'Inventory reconciliation completed',
      data: result,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Reconcile inventory error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Inventory reconciliation failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
}; 