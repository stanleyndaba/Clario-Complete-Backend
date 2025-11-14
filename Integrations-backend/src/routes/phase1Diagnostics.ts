import express, { Request, Response } from 'express';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import tokenManager from '../utils/tokenManager';

const router = express.Router();

/**
 * Phase 1 Diagnostics Endpoint
 * Checks if Phase 1 (Data Intake & Sync) is working correctly
 */
router.get('/api/phase1/diagnostics', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?.user_id || req.query.userId as string || 'demo-user';
    
    logger.info('Phase 1 diagnostics check', { userId });
    
    const diagnostics: any = {
      phase: 'Phase 1: Data Intake & Sync Agent',
      userId,
      timestamp: new Date().toISOString(),
      checks: {}
    };
    
    // Check 1: Amazon Connection
    try {
      const isConnected = await tokenManager.isTokenValid(userId, 'amazon');
      const envToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
      
      diagnostics.checks.connection = {
        status: isConnected || !!envToken ? 'ok' : 'failed',
        hasDatabaseToken: isConnected,
        hasEnvironmentToken: !!envToken,
        message: isConnected || envToken 
          ? 'Amazon connection exists' 
          : 'No Amazon connection found'
      };
    } catch (error: any) {
      diagnostics.checks.connection = {
        status: 'error',
        error: error.message
      };
    }
    
    // Check 2: Synced Data in Database
    try {
      // Check orders
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .limit(10);
      
      // Check claims
      const { data: claims, error: claimsError } = await supabase
        .from('claims')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .limit(10);
      
      // Check inventory
      const { data: inventory, error: inventoryError } = await supabase
        .from('inventory')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .limit(10);
      
      // Check fees
      const { data: fees, error: feesError } = await supabase
        .from('fees')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .limit(10);
      
      diagnostics.checks.database = {
        status: 'ok',
        orders: {
          count: orders?.length || 0,
          hasData: (orders?.length || 0) > 0,
          error: ordersError?.message
        },
        claims: {
          count: claims?.length || 0,
          hasData: (claims?.length || 0) > 0,
          error: claimsError?.message
        },
        inventory: {
          count: inventory?.length || 0,
          hasData: (inventory?.length || 0) > 0,
          error: inventoryError?.message
        },
        fees: {
          count: fees?.length || 0,
          hasData: (fees?.length || 0) > 0,
          error: feesError?.message
        },
        message: 'Database check complete'
      };
    } catch (error: any) {
      diagnostics.checks.database = {
        status: 'error',
        error: error.message
      };
    }
    
    // Check 3: Environment Configuration
    diagnostics.checks.environment = {
      status: 'ok',
      hasRefreshToken: !!process.env.AMAZON_SPAPI_REFRESH_TOKEN,
      hasClientId: !!(process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID),
      hasClientSecret: !!process.env.AMAZON_CLIENT_SECRET,
      hasBaseUrl: !!process.env.AMAZON_SPAPI_BASE_URL,
      baseUrl: process.env.AMAZON_SPAPI_BASE_URL || 'default (sandbox)',
      isSandbox: (process.env.AMAZON_SPAPI_BASE_URL || '').includes('sandbox') || !process.env.AMAZON_SPAPI_BASE_URL,
      message: 'Environment check complete'
    };
    
    // Check 4: Sync Status (from sync_history table if it exists)
    try {
      const { data: syncHistory, error: syncError } = await supabase
        .from('sync_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);
      
      diagnostics.checks.syncStatus = {
        status: 'ok',
        hasSyncHistory: (syncHistory?.length || 0) > 0,
        lastSync: syncHistory?.[0] || null,
        error: syncError?.message,
        message: syncHistory?.[0] 
          ? `Last sync: ${syncHistory[0].status || 'unknown'}` 
          : 'No sync history found'
      };
    } catch (error: any) {
      diagnostics.checks.syncStatus = {
        status: 'error',
        error: error.message,
        message: 'Could not check sync history'
      };
    }
    
    // Overall Status
    const allChecksPassed = 
      diagnostics.checks.connection?.status === 'ok' &&
      diagnostics.checks.environment?.status === 'ok';
    
    diagnostics.overall = {
      status: allChecksPassed ? 'ok' : 'issues',
      message: allChecksPassed 
        ? 'Phase 1 configuration looks good' 
        : 'Some Phase 1 checks failed - see details above',
      phase1Ready: allChecksPassed && diagnostics.checks.database?.status === 'ok'
    };
    
    res.json(diagnostics);
  } catch (error: any) {
    logger.error('Phase 1 diagnostics error', { error: error.message });
    res.status(500).json({
      phase: 'Phase 1: Data Intake & Sync Agent',
      status: 'error',
      error: error.message
    });
  }
});

export default router;

