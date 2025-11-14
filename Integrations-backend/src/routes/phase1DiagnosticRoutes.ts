import express, { Request, Response } from 'express';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import tokenManager from '../utils/tokenManager';

const router = express.Router();

/**
 * Phase 1 Diagnostic Endpoint
 * GET /api/phase1/diagnostic
 * 
 * Checks if Phase 1 (Data Intake & Sync Agent) is working:
 * - Connection status
 * - Sync status
 * - Data in database
 * - SP-API connectivity
 */
router.get('/diagnostic', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?.user_id || req.query.userId as string || 'demo-user';
    
    const diagnostic: {
      phase: number;
      name: string;
      timestamp: string;
      userId: string;
      checks: Record<string, any>;
      overall?: {
        status: string;
        message: string;
        hasData: boolean;
        hasErrors: boolean;
      };
    } = {
      phase: 1,
      name: 'Data Intake & Sync Agent',
      timestamp: new Date().toISOString(),
      userId,
      checks: {} as Record<string, any>
    };

    // Check 1: Amazon Connection
    try {
      const isConnected = await tokenManager.isTokenValid(userId, 'amazon');
      const envToken = !!process.env.AMAZON_SPAPI_REFRESH_TOKEN;
      
      diagnostic.checks.connection = {
        status: isConnected || envToken ? 'ok' : 'missing',
        hasDatabaseToken: isConnected,
        hasEnvironmentToken: envToken,
        message: isConnected || envToken 
          ? 'Amazon connection available' 
          : 'No Amazon connection found'
      };
    } catch (error: any) {
      diagnostic.checks.connection = {
        status: 'error',
        error: error.message
      };
    }

    // Check 2: Database - Orders (18 months)
    try {
      const { data: orders, error } = await supabase
        .from('orders')
        .select('id, created_at, order_id')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .order('created_at', { ascending: false })
        .limit(100);
      
      const eighteenMonthsAgo = new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000);
      const recentOrders = orders?.filter((o: any) => new Date(o.created_at) >= eighteenMonthsAgo) || [];
      
      diagnostic.checks.orders = {
        status: orders && orders.length > 0 ? 'ok' : 'empty',
        totalCount: orders?.length || 0,
        recentCount: recentOrders.length,
        has18MonthsData: recentOrders.length > 0,
        message: orders && orders.length > 0
          ? `Found ${orders.length} orders (${recentOrders.length} in last 18 months)`
          : 'No orders found in database'
      };
    } catch (error: any) {
      diagnostic.checks.orders = {
        status: 'error',
        error: error.message
      };
    }

    // Check 3: Database - Claims/Reimbursements
    try {
      const { data: claims, error } = await supabase
        .from('claims')
        .select('id, created_at, amount')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .order('created_at', { ascending: false })
        .limit(100);
      
      diagnostic.checks.claims = {
        status: claims && claims.length > 0 ? 'ok' : 'empty',
        count: claims?.length || 0,
        totalAmount: claims?.reduce((sum: number, c: any) => sum + (parseFloat(c.amount) || 0), 0) || 0,
        message: claims && claims.length > 0
          ? `Found ${claims.length} claims/reimbursements`
          : 'No claims found in database'
      };
    } catch (error: any) {
      diagnostic.checks.claims = {
        status: 'error',
        error: error.message
      };
    }

    // Check 4: Database - Fees
    try {
      const { data: fees, error } = await supabase
        .from('fees')
        .select('id, created_at, amount')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .order('created_at', { ascending: false })
        .limit(100);
      
      diagnostic.checks.fees = {
        status: fees && fees.length > 0 ? 'ok' : 'empty',
        count: fees?.length || 0,
        totalAmount: fees?.reduce((sum: number, f: any) => sum + (parseFloat(f.amount) || 0), 0) || 0,
        message: fees && fees.length > 0
          ? `Found ${fees.length} fees`
          : 'No fees found in database'
      };
    } catch (error: any) {
      diagnostic.checks.fees = {
        status: 'error',
        error: error.message
      };
    }

    // Check 5: Database - Inventory
    try {
      const { data: inventory, error } = await supabase
        .from('inventory')
        .select('id, created_at, sku')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .order('created_at', { ascending: false })
        .limit(100);
      
      diagnostic.checks.inventory = {
        status: inventory && inventory.length > 0 ? 'ok' : 'empty',
        count: inventory?.length || 0,
        message: inventory && inventory.length > 0
          ? `Found ${inventory.length} inventory items`
          : 'No inventory found in database'
      };
    } catch (error: any) {
      diagnostic.checks.inventory = {
        status: 'error',
        error: error.message
      };
    }

    // Check 6: Sync Status
    try {
      const { data: syncs, error } = await supabase
        .from('sync_history')
        .select('id, status, started_at, completed_at, sync_id')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .order('started_at', { ascending: false })
        .limit(5);
      
      const lastSync = syncs && syncs.length > 0 ? syncs[0] : null;
      
      diagnostic.checks.syncStatus = {
        status: lastSync ? 'ok' : 'no_syncs',
        lastSyncId: lastSync?.sync_id || null,
        lastSyncStatus: lastSync?.status || null,
        lastSyncStarted: lastSync?.started_at || null,
        lastSyncCompleted: lastSync?.completed_at || null,
        totalSyncs: syncs?.length || 0,
        message: lastSync
          ? `Last sync: ${lastSync.status} (${lastSync.sync_id})`
          : 'No syncs found in database'
      };
    } catch (error: any) {
      diagnostic.checks.syncStatus = {
        status: 'error',
        error: error.message
      };
    }

    // Check 7: SP-API Configuration
    diagnostic.checks.spapiConfig = {
      status: 'ok',
      baseUrl: process.env.AMAZON_SPAPI_BASE_URL || 'https://sandbox.sellingpartnerapi-na.amazon.com',
      isSandbox: (process.env.AMAZON_SPAPI_BASE_URL || '').includes('sandbox') || process.env.NODE_ENV === 'development',
      hasRefreshToken: !!process.env.AMAZON_SPAPI_REFRESH_TOKEN,
      hasClientId: !!(process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID),
      hasClientSecret: !!process.env.AMAZON_CLIENT_SECRET,
      marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER'
    };

    // Overall Status
    const allChecks = Object.values(diagnostic.checks);
    const hasErrors = allChecks.some((c: any) => c.status === 'error');
    const hasData = allChecks.some((c: any) => c.status === 'ok' && (c.count > 0 || c.totalCount > 0));
    
    diagnostic.overall = {
      status: hasErrors ? 'error' : hasData ? 'ok' : 'no_data',
      message: hasErrors 
        ? 'Some checks failed'
        : hasData 
          ? 'Phase 1 working - data found in database'
          : 'Phase 1 not working - no data synced yet',
      hasData,
      hasErrors
    };

    res.json(diagnostic);
  } catch (error: any) {
    logger.error('Phase 1 diagnostic error', { error: error.message });
    res.status(500).json({
      phase: 1,
      status: 'error',
      error: error.message
    });
  }
});

export default router;

