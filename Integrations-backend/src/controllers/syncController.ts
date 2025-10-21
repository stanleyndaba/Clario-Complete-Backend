import { Request, Response } from 'express';

export const startSync = async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      message: 'Sync started successfully',
      syncId: 'mock-sync-123',
      data: {
        claimsFound: 8,
        recoveredAmount: 1250.75,
        status: 'completed'
      }
    });
  } catch (error) {
    console.error('Sync start error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start sync'
    });
  }
};

export const getSyncStatus = async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      status: 'completed',
      progress: 100,
      lastSyncAt: new Date().toISOString(),
      data: {
        totalOrders: 245,
        claimsDetected: 12,
        recoveryEstimate: 1875.50
      }
    });
  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status'
    });
  }
};

export const getSyncHistory = async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      history: [
        {
          id: 'sync-1',
          status: 'completed',
          startedAt: new Date(Date.now() - 86400000).toISOString(),
          completedAt: new Date(Date.now() - 86300000).toISOString(),
          claimsFound: 5,
          amountRecovered: 650.25
        },
        {
          id: 'sync-2', 
          status: 'completed',
          startedAt: new Date(Date.now() - 172800000).toISOString(),
          completedAt: new Date(Date.now() - 171800000).toISOString(),
          claimsFound: 3,
          amountRecovered: 420.50
        }
      ]
    });
  } catch (error) {
    console.error('Sync history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync history'
    });
  }
};

export const forceSync = async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      message: 'Forced sync started',
      syncId: 'force-sync-456',
      estimatedCompletion: new Date(Date.now() + 120000).toISOString()
    });
  } catch (error) {
    console.error('Force sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to force sync'
    });
  }
};

export default {
  startSync,
  getSyncStatus,
  getSyncHistory,
  forceSync
};
