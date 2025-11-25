/**
 * Agent 2: Continuous Data Sync / Classification Agent
 * 
 * Purpose:
 * - Receives raw FBA data from Agent 1 (OAuth credentials)
 * - Normalizes, validates, and enriches the data
 * - Calls Discovery Agent (Python ML) for claim detection
 * - Handles mock data generation for sandbox mode
 * - Logs events to agent_events table
 * 
 * Key Responsibilities:
 * 1. Continuous Data Sync - periodic background jobs
 * 2. Data Normalization - converts Amazon raw JSON to internal schema
 * 3. Event Logging - logs to agent_events table
 * 4. Error Handling & Retries - handles API failures gracefully
 * 5. Discovery Agent Integration - calls Python ML API for predictions
 */

import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { supabaseAdmin } from '../database/supabaseClient';
import amazonService from './amazonService';
import { OrdersService } from './ordersService';
import { ShipmentsService } from './shipmentsService';
import { ReturnsService } from './returnsService';
import { SettlementsService } from './settlementsService';
import { MockDataGenerator, MockScenario } from './mockDataGenerator';
import agentEventLogger from './agentEventLogger';
import { upsertDisputesAndRecoveriesFromDetections } from './disputeBackfillService';
import axios from 'axios';

export interface SyncResult {
  success: boolean;
  syncId: string;
  userId: string;
  summary: {
    ordersCount: number;
    shipmentsCount: number;
    returnsCount: number;
    settlementsCount: number;
    inventoryCount: number;
    claimsCount: number;
    feesCount: number;
  };
  normalized: {
    orders: any[];
    shipments: any[];
    returns: any[];
    settlements: any[];
    inventory: any[];
    claims: any[];
  };
  errors: string[];
  duration: number; // ms
  isMock: boolean;
  mockScenario?: MockScenario;
}

export class Agent2DataSyncService {
  private ordersService: OrdersService;
  private shipmentsService: ShipmentsService;
  private returnsService: ReturnsService;
  private settlementsService: SettlementsService;
  private readonly pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-7.onrender.com';

  constructor() {
    this.ordersService = new OrdersService();
    this.shipmentsService = new ShipmentsService();
    this.returnsService = new ReturnsService();
    this.settlementsService = new SettlementsService();
  }

  /**
   * Main sync method - orchestrates all data fetching and normalization
   */
  async syncUserData(
    userId: string,
    startDate?: Date,
    endDate?: Date,
    parentSyncId?: string
  ): Promise<SyncResult> {
    const syncId = `agent2_sync_${userId}_${Date.now()}`;
    const detectionSyncId = parentSyncId || syncId;
    const startTime = Date.now();
    const errors: string[] = [];

    logger.info('🔄 [AGENT 2] Starting data sync', {
      userId,
      syncId,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString()
    });

    // Check if user has valid Amazon token from Agent 1
    const isConnected = await tokenManager.isTokenValid(userId, 'amazon');
    const isMockMode = !isConnected || process.env.ENABLE_MOCK_SP_API === 'true' || process.env.USE_MOCK_DATA_GENERATOR !== 'false';
    const mockScenario: MockScenario = (process.env.MOCK_SCENARIO as MockScenario) || 'normal_week';

    if (isMockMode) {
      logger.info('🧪 [AGENT 2] Using mock data generator (sandbox mode)', {
        userId,
        syncId,
        scenario: mockScenario
      });
    }

    // Default to last 18 months for initial sync
    const syncStartDate = startDate || new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000);
    const syncEndDate = endDate || new Date();

    const result: SyncResult = {
      success: true,
      syncId,
      userId,
      summary: {
        ordersCount: 0,
        shipmentsCount: 0,
        returnsCount: 0,
        settlementsCount: 0,
        inventoryCount: 0,
        claimsCount: 0,
        feesCount: 0
      },
      normalized: {
        orders: [],
        shipments: [],
        returns: [],
        settlements: [],
        inventory: [],
        claims: []
      },
      errors: [],
      duration: 0,
      isMock: isMockMode,
      mockScenario: isMockMode ? mockScenario : undefined
    };

    try {
      // 1. Sync Orders
      try {
        logger.info('📦 [AGENT 2] Fetching orders...', { userId, syncId });
        const ordersResult = await this.syncOrders(userId, syncStartDate, syncEndDate, isMockMode, mockScenario);
        result.normalized.orders = ordersResult.data || [];
        result.summary.ordersCount = result.normalized.orders.length;
        logger.info('✅ [AGENT 2] Orders synced', {
          userId,
          syncId,
          count: result.summary.ordersCount
        });
      } catch (error: any) {
        const errorMsg = `Failed to sync orders: ${error.message}`;
        errors.push(errorMsg);
        logger.error('❌ [AGENT 2] Orders sync failed', { userId, syncId, error: error.message });
      }

      // 2. Sync Shipments
      try {
        logger.info('🚚 [AGENT 2] Fetching shipments...', { userId, syncId });
        const shipmentsResult = await this.syncShipments(userId, syncStartDate, syncEndDate, isMockMode, mockScenario);
        result.normalized.shipments = shipmentsResult.data || [];
        result.summary.shipmentsCount = result.normalized.shipments.length;
        logger.info('✅ [AGENT 2] Shipments synced', {
          userId,
          syncId,
          count: result.summary.shipmentsCount
        });
      } catch (error: any) {
        const errorMsg = `Failed to sync shipments: ${error.message}`;
        errors.push(errorMsg);
        logger.error('❌ [AGENT 2] Shipments sync failed', { userId, syncId, error: error.message });
      }

      // 3. Sync Returns
      try {
        logger.info('↩️ [AGENT 2] Fetching returns...', { userId, syncId });
        const returnsResult = await this.syncReturns(userId, syncStartDate, syncEndDate, isMockMode, mockScenario);
        result.normalized.returns = returnsResult.data || [];
        result.summary.returnsCount = result.normalized.returns.length;
        logger.info('✅ [AGENT 2] Returns synced', {
          userId,
          syncId,
          count: result.summary.returnsCount
        });
      } catch (error: any) {
        const errorMsg = `Failed to sync returns: ${error.message}`;
        errors.push(errorMsg);
        logger.error('❌ [AGENT 2] Returns sync failed', { userId, syncId, error: error.message });
      }

      // 4. Sync Settlements
      try {
        logger.info('💰 [AGENT 2] Fetching settlements...', { userId, syncId });
        const settlementsResult = await this.syncSettlements(userId, syncStartDate, syncEndDate, isMockMode, mockScenario);
        result.normalized.settlements = settlementsResult.data || [];
        result.summary.settlementsCount = result.normalized.settlements.length;
        logger.info('✅ [AGENT 2] Settlements synced', {
          userId,
          syncId,
          count: result.summary.settlementsCount
        });
      } catch (error: any) {
        const errorMsg = `Failed to sync settlements: ${error.message}`;
        errors.push(errorMsg);
        logger.error('❌ [AGENT 2] Settlements sync failed', { userId, syncId, error: error.message });
      }

      // 5. Sync Inventory
      try {
        logger.info('📊 [AGENT 2] Fetching inventory...', { userId, syncId });
        const inventoryResult = await this.syncInventory(userId, isMockMode, mockScenario);
        result.normalized.inventory = inventoryResult.data || [];
        result.summary.inventoryCount = result.normalized.inventory.length;
        logger.info('✅ [AGENT 2] Inventory synced', {
          userId,
          syncId,
          count: result.summary.inventoryCount
        });
      } catch (error: any) {
        const errorMsg = `Failed to sync inventory: ${error.message}`;
        errors.push(errorMsg);
        logger.error('❌ [AGENT 2] Inventory sync failed', { userId, syncId, error: error.message });
      }

      // 6. Sync Claims (from financial events)
      try {
        logger.info('🎯 [AGENT 2] Fetching claims...', { userId, syncId });
        const claimsResult = await this.syncClaims(userId, syncStartDate, syncEndDate, isMockMode, mockScenario);
        result.normalized.claims = claimsResult.data || [];
        result.summary.claimsCount = result.normalized.claims.length;
        logger.info('✅ [AGENT 2] Claims synced', {
          userId,
          syncId,
          count: result.summary.claimsCount
        });
      } catch (error: any) {
        const errorMsg = `Failed to sync claims: ${error.message}`;
        errors.push(errorMsg);
        logger.error('❌ [AGENT 2] Claims sync failed', { userId, syncId, error: error.message });
      }

      // Calculate duration
      result.duration = Date.now() - startTime;
      result.errors = errors;
      result.success = errors.length === 0;

      // Log event to agent_events table (using generic logEvent method if available)
      try {
        // Use a simple direct insert since agent_events might not have 'data_sync' as an agent type yet
        const { error: logError } = await supabaseAdmin
          .from('agent_events')
          .insert({
            user_id: userId,
            agent: 'data_sync', // Will need migration update, but works for now
            event_type: result.success ? 'sync_completed' : 'sync_failed',
            success: result.success,
            metadata: {
              syncId,
              summary: result.summary,
              duration: result.duration,
              isMock: result.isMock,
              mockScenario: result.mockScenario,
              errors: result.errors
            },
            created_at: new Date().toISOString()
          });
        
        if (logError) {
          logger.warn('⚠️ [AGENT 2] Failed to log event (may need migration update)', { error: logError.message });
        }
      } catch (logError: any) {
        logger.warn('⚠️ [AGENT 2] Failed to log event', { error: logError.message });
      }

      logger.info('✅ [AGENT 2] Data sync completed', {
        userId,
        syncId,
        success: result.success,
        summary: result.summary,
        duration: result.duration,
        errorsCount: errors.length
      });

      // Step 7: Call Discovery Agent (Python ML) asynchronously - don't block sync completion
      // OPTIMIZATION: Detection runs in background to meet 30s sync timeout requirement
      if (result.success && result.summary.ordersCount + result.summary.shipmentsCount + result.summary.returnsCount > 0) {
        // Start detection asynchronously - don't await it
        const detectionPromise = (async () => {
          try {
            logger.info('🔍 [AGENT 2] Starting Discovery Agent (Python ML) - async background', { userId, syncId });
            
            const detectionId = `detection_${userId}_${Date.now()}`;
            const detectionResult = await this.callDiscoveryAgent(
              userId,
              syncId,
              detectionId,
              result.normalized,
              detectionSyncId
            );
            
            logger.info('✅ [AGENT 2] Discovery Agent completed (async)', {
              userId,
              syncId,
              detectionId,
              totalDetected: detectionResult?.totalDetected || 0
            });
          } catch (detectionError: any) {
            logger.error('❌ [AGENT 2] Discovery Agent failed (async)', {
              error: detectionError.message,
              stack: detectionError.stack,
              userId,
              syncId
            });
            // Don't fail sync - detection errors are logged but sync continues
          }
        })();
        
        // Don't await - let detection run in background
        // Sync completes immediately, detection continues async
        logger.info('🚀 [AGENT 2] Discovery Agent started asynchronously (non-blocking)', { 
          userId, 
          syncId,
          note: 'Sync will complete immediately, detection continues in background'
        });
      }

      return result;
    } catch (error: any) {
      result.success = false;
      result.errors.push(`Fatal error: ${error.message}`);
      result.duration = Date.now() - startTime;

      logger.error('❌ [AGENT 2] Fatal sync error', {
        userId,
        syncId,
        error: error.message,
        stack: error.stack
      });

      // Log error event
      try {
        const { error: logError } = await supabaseAdmin
          .from('agent_events')
          .insert({
            user_id: userId,
            agent: 'data_sync',
            event_type: 'sync_failed',
            success: false,
            metadata: {
              syncId,
              error: error.message,
              duration: result.duration
            },
            created_at: new Date().toISOString()
          });
        
        if (logError) {
          logger.warn('⚠️ [AGENT 2] Failed to log error event', { error: logError.message });
        }
      } catch (logError: any) {
        logger.warn('⚠️ [AGENT 2] Failed to log error event', { error: logError.message });
      }

      return result;
    }
  }

  /**
   * Sync Orders with mock fallback
   */
  private async syncOrders(
    userId: string,
    startDate: Date,
    endDate: Date,
    isMockMode: boolean,
    mockScenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    if (isMockMode) {
      return this.generateMockOrders(userId, startDate, endDate, mockScenario);
    }

    return await this.ordersService.fetchOrders(userId, startDate, endDate);
  }

  /**
   * Sync Shipments with mock fallback
   */
  private async syncShipments(
    userId: string,
    startDate: Date,
    endDate: Date,
    isMockMode: boolean,
    mockScenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    if (isMockMode) {
      return this.generateMockShipments(userId, startDate, endDate, mockScenario);
    }

    return await this.shipmentsService.fetchShipments(userId, startDate, endDate);
  }

  /**
   * Sync Returns with mock fallback
   */
  private async syncReturns(
    userId: string,
    startDate: Date,
    endDate: Date,
    isMockMode: boolean,
    mockScenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    if (isMockMode) {
      return this.generateMockReturns(userId, startDate, endDate, mockScenario);
    }

    return await this.returnsService.fetchReturns(userId, startDate, endDate);
  }

  /**
   * Sync Settlements with mock fallback
   */
  private async syncSettlements(
    userId: string,
    startDate: Date,
    endDate: Date,
    isMockMode: boolean,
    mockScenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    if (isMockMode) {
      return this.generateMockSettlements(userId, startDate, endDate, mockScenario);
    }

    return await this.settlementsService.fetchSettlements(userId, startDate, endDate);
  }

  /**
   * Sync Inventory with mock fallback
   */
  private async syncInventory(
    userId: string,
    isMockMode: boolean,
    mockScenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    if (isMockMode) {
      return this.generateMockInventory(userId, mockScenario);
    }

    const inventoryResult = await amazonService.fetchInventory(userId);
    const inventory = inventoryResult.data || inventoryResult;
    return {
      success: true,
      data: Array.isArray(inventory) ? inventory : [],
      message: `Fetched ${Array.isArray(inventory) ? inventory.length : 0} inventory items`
    };
  }

  /**
   * Sync Claims with mock fallback
   */
  private async syncClaims(
    userId: string,
    startDate: Date,
    endDate: Date,
    isMockMode: boolean,
    mockScenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    if (isMockMode) {
      return this.generateMockClaims(userId, startDate, endDate, mockScenario);
    }

    const claimsResult = await amazonService.fetchClaims(userId, startDate, endDate);
    const claims = claimsResult.data || claimsResult;
    return {
      success: true,
      data: Array.isArray(claims) ? claims : [],
      message: `Fetched ${Array.isArray(claims) ? claims.length : 0} claims`
    };
  }

  /**
   * Generate mock orders
   */
  private async generateMockOrders(
    userId: string,
    startDate: Date,
    endDate: Date,
    scenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    // Use 75 as default to match amazonService.ts and backend logs
    const recordCount = process.env.MOCK_RECORD_COUNT ? parseInt(process.env.MOCK_RECORD_COUNT, 10) : 75;
    const generator = new MockDataGenerator({
      scenario,
      recordCount,
      startDate,
      endDate
    });

    const orders: any[] = [];
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    for (let i = 0; i < recordCount; i++) {
      const orderDate = this.randomDate(startDate, endDate);
      const orderId = `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`;
      
      orders.push({
        AmazonOrderId: orderId,
        PurchaseDate: orderDate.toISOString(),
        OrderStatus: ['Shipped', 'Pending', 'Canceled'][Math.floor(Math.random() * 3)],
        FulfillmentChannel: ['Amazon', 'Merchant'][Math.floor(Math.random() * 2)],
        OrderItems: [{
          SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
          ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
          QuantityOrdered: Math.floor(Math.random() * 5) + 1,
          ItemPrice: {
            Amount: (Math.random() * 100 + 10).toFixed(2),
            CurrencyCode: 'USD'
          },
          Title: `Product ${i + 1}`
        }],
        MarketplaceId: 'ATVPDKIKX0DER',
        isMock: true,
        mockScenario: scenario
      });
    }

    // Normalize orders
    const normalized = this.ordersService.normalizeOrders(orders, userId);

    return {
      success: true,
      data: normalized,
      message: `Generated ${normalized.length} mock orders (scenario: ${scenario})`
    };
  }

  /**
   * Generate mock shipments
   */
  private async generateMockShipments(
    userId: string,
    startDate: Date,
    endDate: Date,
    scenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    // Use 75 as base default to match orders
    const recordCount = Math.floor((process.env.MOCK_RECORD_COUNT ? parseInt(process.env.MOCK_RECORD_COUNT, 10) : 75) * 0.7);
    const shipments: any[] = [];

    for (let i = 0; i < recordCount; i++) {
      const shippedDate = this.randomDate(startDate, endDate);
      const receivedDate = new Date(shippedDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000);
      
      shipments.push({
        ShipmentId: `SHIP-${Date.now()}-${i}`,
        ShippedDate: shippedDate.toISOString(),
        ReceivedDate: receivedDate.toISOString(),
        Status: ['RECEIVED', 'IN_TRANSIT', 'CHECKED_IN'][Math.floor(Math.random() * 3)],
        Items: [{
          SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
          ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
          QuantityShipped: Math.floor(Math.random() * 10) + 1
        }],
        FulfillmentCenterId: `FBA${Math.floor(Math.random() * 5) + 1}`,
        isMock: true,
        mockScenario: scenario
      });
    }

    const normalized = this.shipmentsService.normalizeShipments(shipments, userId);

    return {
      success: true,
      data: normalized,
      message: `Generated ${normalized.length} mock shipments (scenario: ${scenario})`
    };
  }

  /**
   * Generate mock returns
   */
  private async generateMockReturns(
    userId: string,
    startDate: Date,
    endDate: Date,
    scenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    // Use 75 as base default to match orders
    const recordCount = Math.floor((process.env.MOCK_RECORD_COUNT ? parseInt(process.env.MOCK_RECORD_COUNT, 10) : 75) * 0.5);
    const returns: any[] = [];

    for (let i = 0; i < recordCount; i++) {
      const returnDate = this.randomDate(startDate, endDate);
      
      returns.push({
        ReturnId: `RET-${Date.now()}-${i}`,
        AmazonOrderId: `112-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 1000000)}`,
        ReturnedDate: returnDate.toISOString(),
        ReturnStatus: ['APPROVED', 'PENDING', 'DENIED'][Math.floor(Math.random() * 3)],
        ReturnReason: ['Defective', 'Wrong Item', 'Not as Described', 'Customer Changed Mind'][Math.floor(Math.random() * 4)],
        Items: [{
          SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
          ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
          QuantityReturned: Math.floor(Math.random() * 3) + 1,
          RefundAmount: {
            Amount: (Math.random() * 50 + 10).toFixed(2),
            CurrencyCode: 'USD'
          }
        }],
        isMock: true,
        mockScenario: scenario
      });
    }

    const normalized = this.returnsService.normalizeReturns(returns, userId);

    return {
      success: true,
      data: normalized,
      message: `Generated ${normalized.length} mock returns (scenario: ${scenario})`
    };
  }

  /**
   * Generate mock settlements
   */
  private async generateMockSettlements(
    userId: string,
    startDate: Date,
    endDate: Date,
    scenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    // Use 75 as base default to match orders
    const recordCount = Math.floor((process.env.MOCK_RECORD_COUNT ? parseInt(process.env.MOCK_RECORD_COUNT, 10) : 75) * 0.6);
    const settlements: any[] = [];

    for (let i = 0; i < recordCount; i++) {
      const settlementDate = this.randomDate(startDate, endDate);
      
      settlements.push({
        SettlementId: `SETTLE-${Date.now()}-${i}`,
        SettlementDate: settlementDate.toISOString(),
        TotalAmount: {
          Amount: (Math.random() * 1000 + 100).toFixed(2),
          CurrencyCode: 'USD'
        },
        FeeList: [{
          FeeType: ['FBA_FULFILLMENT', 'REFERRAL', 'CLOSING'][Math.floor(Math.random() * 3)],
          FeeAmount: {
            Amount: (Math.random() * 50 + 5).toFixed(2),
            CurrencyCode: 'USD'
          }
        }],
        isMock: true,
        mockScenario: scenario
      });
    }

    const normalized = this.settlementsService.normalizeSettlements(settlements, userId);

    return {
      success: true,
      data: normalized,
      message: `Generated ${normalized.length} mock settlements (scenario: ${scenario})`
    };
  }

  /**
   * Generate mock inventory
   */
  private async generateMockInventory(
    userId: string,
    scenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    // Use same default as orders (75) for consistency
    const recordCount = process.env.MOCK_RECORD_COUNT ? parseInt(process.env.MOCK_RECORD_COUNT, 10) : 75;
    const inventory: any[] = [];

    for (let i = 0; i < recordCount; i++) {
      inventory.push({
        SellerSKU: `SKU-${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
        ASIN: `B0${String(Math.floor(Math.random() * 10000000)).padStart(8, '0')}`,
        FulfillableQuantity: Math.floor(Math.random() * 100) + 1,
        InboundQuantity: Math.floor(Math.random() * 50),
        ReservedQuantity: Math.floor(Math.random() * 10),
        FulfillmentCenterId: `FBA${Math.floor(Math.random() * 5) + 1}`,
        isMock: true,
        mockScenario: scenario
      });
    }

    return {
      success: true,
      data: inventory,
      message: `Generated ${inventory.length} mock inventory items (scenario: ${scenario})`
    };
  }

  /**
   * Generate mock claims
   */
  private async generateMockClaims(
    userId: string,
    startDate: Date,
    endDate: Date,
    scenario: MockScenario
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    const generator = new MockDataGenerator({
      scenario,
      recordCount: process.env.MOCK_RECORD_COUNT ? parseInt(process.env.MOCK_RECORD_COUNT, 10) : 75,
      startDate,
      endDate
    });

    const financialEvents = generator.generateFinancialEvents();
    const claims: any[] = [];

    // Extract reimbursements
    const reimbursements = financialEvents.payload?.FinancialEvents?.FBALiquidationEventList || [];
    for (const reimbursement of reimbursements) {
      claims.push({
        id: reimbursement.OriginalRemovalOrderId || `RMB-${Date.now()}`,
        orderId: reimbursement.OriginalRemovalOrderId,
        amount: parseFloat(reimbursement.LiquidationProceedsAmount?.CurrencyAmount || '0'),
        status: 'approved',
        type: 'liquidation_reimbursement',
        currency: reimbursement.LiquidationProceedsAmount?.CurrencyCode || 'USD',
        createdAt: reimbursement.PostedDate || new Date().toISOString(),
        isMock: true,
        mockScenario: scenario
      });
    }

    // Extract adjustments
    const adjustments = financialEvents.payload?.FinancialEvents?.AdjustmentEventList || [];
    for (const adjustment of adjustments) {
      const amount = parseFloat(adjustment.AdjustmentAmount?.CurrencyAmount || '0');
      if (amount > 0) {
        claims.push({
          id: adjustment.AdjustmentEventId || `ADJ-${Date.now()}`,
          orderId: adjustment.AmazonOrderId || adjustment.AdjustmentEventId,
          amount: amount,
          status: 'approved',
          type: 'adjustment_reimbursement',
          currency: adjustment.AdjustmentAmount?.CurrencyCode || 'USD',
          createdAt: adjustment.PostedDate || new Date().toISOString(),
          isMock: true,
          mockScenario: scenario
        });
      }
    }

    return {
      success: true,
      data: claims,
      message: `Generated ${claims.length} mock claims (scenario: ${scenario})`
    };
  }

  /**
   * Helper: Generate random date between start and end
   */
  private randomDate(start: Date, end: Date): Date {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  }

  /**
   * Call Discovery Agent (Python ML) - Replaces Agent 3
   * This orchestrates: data transformation → Discovery Agent API → storage → completion signal
   */
  private async callDiscoveryAgent(
    userId: string,
    syncId: string,
    detectionId: string,
    normalizedData: {
      orders?: any[];
      shipments?: any[];
      returns?: any[];
      settlements?: any[];
      inventory?: any[];
      claims?: any[];
    },
    parentSyncId?: string
  ): Promise<{ totalDetected: number }> {
    const storageSyncId = parentSyncId || syncId;

    // Step 1: Validate and normalize input contract
    const validatedData = this.validateAndNormalizeInputContract(normalizedData, userId, syncId);

    // Step 2: Transform normalized data into Discovery Agent claim format
    const allClaimsToDetect = this.prepareClaimsFromNormalizedData(validatedData, userId);

    if (allClaimsToDetect.length === 0) {
      logger.info('ℹ️ [AGENT 2] No claims to detect', { userId, syncId, storageSyncId });
      console.log('[AGENT 2] No claims to detect - skipping Discovery Agent call');
      console.log('[AGENT 2] Normalized data summary:', {
        ordersCount: validatedData.orders?.length || 0,
        shipmentsCount: validatedData.shipments?.length || 0,
        returnsCount: validatedData.returns?.length || 0,
        settlementsCount: validatedData.settlements?.length || 0
      });
      await this.signalDetectionCompletion(userId, storageSyncId, detectionId, { totalDetected: 0 }, true);
      return { totalDetected: 0 };
    }

    // Process claims in batches to avoid Python API crashes on large batches
    const MAX_CLAIMS_PER_BATCH = 50;
    const totalBatches = Math.ceil(allClaimsToDetect.length / MAX_CLAIMS_PER_BATCH);
    
    logger.info('🎯 [AGENT 2] Processing claims in batches', {
      userId,
      syncId,
      totalClaims: allClaimsToDetect.length,
      batchSize: MAX_CLAIMS_PER_BATCH,
      totalBatches
    });
    
    console.log(`[AGENT 2] Processing ${allClaimsToDetect.length} claims in ${totalBatches} batches of ${MAX_CLAIMS_PER_BATCH}`);

    // Step 3: Create detection_queue entry BEFORE calling API (so syncJobManager can track it)
    try {
      const { data: existingQueue } = await supabaseAdmin
        .from('detection_queue')
        .select('id')
        .eq('seller_id', userId)
        .eq('sync_id', storageSyncId)
        .maybeSingle();

      if (!existingQueue) {
        // Create initial detection_queue entry with 'processing' status
        await supabaseAdmin
          .from('detection_queue')
          .insert({
            seller_id: userId,
            sync_id: storageSyncId,
            status: 'processing',
            priority: 1,
            payload: { detectionId, claimCount: allClaimsToDetect.length, totalBatches },
            updated_at: new Date().toISOString()
          });
        logger.info('📝 [AGENT 2] Created detection_queue entry', { 
          userId, 
          syncId: storageSyncId,
          totalClaims: allClaimsToDetect.length,
          totalBatches
        });
      } else {
        // Update existing entry to 'processing'
        await supabaseAdmin
          .from('detection_queue')
          .update({
            status: 'processing',
            payload: { detectionId, claimCount: allClaimsToDetect.length, totalBatches },
            updated_at: new Date().toISOString()
          })
          .eq('id', existingQueue.id);
        logger.info('📝 [AGENT 2] Updated detection_queue entry to processing', { 
          userId, 
          syncId: storageSyncId,
          totalClaims: allClaimsToDetect.length,
          totalBatches
        });
      }
    } catch (queueError: any) {
      logger.warn('⚠️ [AGENT 2] Failed to create/update detection_queue (non-critical)', {
        error: queueError.message,
        userId,
        syncId: storageSyncId
      });
      // Continue anyway - we'll still call the API
    }

    // Step 4: Process all claims in batches
    const allPredictions: any[] = [];
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds base delay
    
    console.log('[AGENT 2] Python API URL:', this.pythonApiUrl);
    console.log('[AGENT 2] Sync ID:', syncId);
    console.log('[AGENT 2] Storage Sync ID:', storageSyncId);
    console.log('[AGENT 2] User ID:', userId);

    // Check Python API health before processing batches
    try {
      const healthCheck = await axios.get(`${this.pythonApiUrl}/health`, { timeout: 5000 });
      console.log('[AGENT 2] Python API health check:', healthCheck.data);
    } catch (healthError: any) {
      console.warn('[AGENT 2] Python API health check failed, but continuing:', healthError.message);
    }

    // Process each batch - wrap in try-catch to ensure completion is signaled on error
    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * MAX_CLAIMS_PER_BATCH;
      const batchEnd = Math.min(batchStart + MAX_CLAIMS_PER_BATCH, allClaimsToDetect.length);
      const batchClaims = allClaimsToDetect.slice(batchStart, batchEnd);
      
      logger.info(`🔄 [AGENT 2] Processing batch ${batchIndex + 1}/${totalBatches}`, {
        userId,
        syncId,
        batchIndex: batchIndex + 1,
        totalBatches,
        batchSize: batchClaims.length,
        batchStart,
        batchEnd
      });
      
      console.log(`[AGENT 2] Processing batch ${batchIndex + 1}/${totalBatches} (claims ${batchStart + 1}-${batchEnd} of ${allClaimsToDetect.length})`);

      let batchPredictions: any[] = [];
      let batchSuccess = false;
      let lastBatchError: any = null;

      // Retry logic for this batch
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[AGENT 2] Batch ${batchIndex + 1} - API call attempt ${attempt}/${maxRetries}`);
          
          const response = await axios.post(
            `${this.pythonApiUrl}/api/v1/claim-detector/predict/batch`,
            { claims: batchClaims },
            {
              timeout: 90000, // 90 seconds timeout
              headers: { 'Content-Type': 'application/json' }
            }
          );

          batchPredictions = response.data?.predictions || [];
          console.log(`[AGENT 2] Batch ${batchIndex + 1} - API response received`);
          console.log(`[AGENT 2] Batch ${batchIndex + 1} - Predictions count:`, batchPredictions.length);
          
          if (!Array.isArray(batchPredictions)) {
            console.error(`[AGENT 2] Batch ${batchIndex + 1} - Invalid response format:`, typeof batchPredictions, response.data);
            throw new Error(`Discovery Agent returned invalid format: expected array, got ${typeof batchPredictions}`);
          }
          
          batchSuccess = true;
          break; // Success - break out of retry loop
        } catch (apiError: any) {
          lastBatchError = apiError;
          const status = apiError.response?.status;
          const isRetryable = status === 502 || status === 503 || status === 504 || 
                             apiError.code === 'ECONNABORTED' || apiError.code === 'ETIMEDOUT' ||
                             apiError.code === 'ECONNREFUSED';
          
          if (isRetryable && attempt < maxRetries) {
            const delay = retryDelay * attempt; // Exponential backoff: 2s, 4s, 6s
            console.warn(`[AGENT 2] Batch ${batchIndex + 1} - API failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`, {
              status,
              error: apiError.message,
              code: apiError.code
            });
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; // Retry
          } else {
            // Not retryable or out of retries - throw error
            throw apiError;
          }
        }
      }

      if (!batchSuccess) {
        // Enhanced error logging for failed batch
        const errorDetails = {
          error: lastBatchError?.message,
          errorCode: lastBatchError?.code,
          status: lastBatchError?.response?.status,
          statusText: lastBatchError?.response?.statusText,
          responseData: lastBatchError?.response?.data,
          url: `${this.pythonApiUrl}/api/v1/claim-detector/predict/batch`,
          userId,
          syncId,
          storageSyncId,
          batchIndex: batchIndex + 1,
          totalBatches,
          batchClaimCount: batchClaims.length,
          timeout: lastBatchError?.code === 'ECONNABORTED' || lastBatchError?.code === 'ETIMEDOUT',
          connectionError: lastBatchError?.code === 'ECONNREFUSED' || lastBatchError?.code === 'ENOTFOUND'
        };

        logger.error(`❌ [AGENT 2] Batch ${batchIndex + 1} failed after all retries`, errorDetails);
        console.error(`[AGENT 2] Batch ${batchIndex + 1} FAILED:`, JSON.stringify(errorDetails, null, 2));
        
        if (batchClaims.length > 0) {
          console.error(`[AGENT 2] Batch ${batchIndex + 1} - Sample claim format:`, JSON.stringify(batchClaims[0], null, 2));
        }

        // If this is the first batch and it fails, fail the entire operation
        // Otherwise, log error but continue with other batches
        if (batchIndex === 0) {
          await this.signalDetectionCompletion(userId, storageSyncId, detectionId, { totalDetected: 0 }, false);
          throw new Error(`Discovery Agent API failed on first batch: ${lastBatchError?.message}`);
        } else {
          logger.warn(`⚠️ [AGENT 2] Batch ${batchIndex + 1} failed, but continuing with remaining batches`, {
            userId,
            syncId,
            batchIndex: batchIndex + 1
          });
          console.warn(`[AGENT 2] Batch ${batchIndex + 1} failed, skipping this batch and continuing...`);
          continue; // Skip this batch and continue with next
        }
      }

      // Add batch predictions to accumulated results
      allPredictions.push(...batchPredictions);
      console.log(`[AGENT 2] Batch ${batchIndex + 1} completed: ${batchPredictions.length} predictions (total so far: ${allPredictions.length})`);
      
      // Small delay between batches to avoid overwhelming the API
      if (batchIndex < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between batches
      }
      } // Close for loop
    } catch (batchProcessingError: any) {
      // If batch processing fails, ensure we signal completion with error
      logger.error('❌ [AGENT 2] Batch processing failed with unhandled error', {
        error: batchProcessingError.message,
        stack: batchProcessingError.stack,
        userId,
        syncId,
        storageSyncId,
        totalBatches,
        batchesProcessed: allPredictions.length
      });
      console.error('[AGENT 2] Batch processing error:', batchProcessingError);
      
      // Signal completion with failed status
      await this.signalDetectionCompletion(
        userId,
        storageSyncId,
        detectionId,
        { totalDetected: allPredictions.length },
        false
      );
      
      throw new Error(`Batch processing failed: ${batchProcessingError.message}`);
    }

    logger.info('✅ [AGENT 2] All batches processed', {
      userId,
      syncId,
      totalClaims: allClaimsToDetect.length,
      totalPredictions: allPredictions.length,
      totalBatches
    });
    
    console.log(`[AGENT 2] All ${totalBatches} batches completed: ${allPredictions.length} total predictions from ${allClaimsToDetect.length} claims`);

    // Step 5: Transform predictions to detection results format
    const detectionResults = allPredictions
      .filter((p: any) => p.claimable) // Only store claimable predictions
      .map((prediction: any) => {
        const claim = allClaimsToDetect.find(c => c.claim_id === prediction.claim_id);
        return {
          claim_id: prediction.claim_id,
          seller_id: userId,
          anomaly_type: this.mapCategoryToAnomalyType(claim?.category, claim?.subcategory),
          severity: this.mapConfidenceToSeverity(prediction.probability || prediction.confidence || 0.5),
          estimated_value: claim?.amount || 0,
          currency: claim?.currency || 'USD',
          confidence_score: prediction.probability || prediction.confidence || 0.5,
          evidence: claim?.evidence || {},
          related_event_ids: [claim?.order_id].filter(Boolean),
          discovery_date: new Date(claim?.claim_date || Date.now()),
          deadline_date: this.calculateDeadline(new Date(claim?.claim_date || Date.now())),
          days_remaining: this.calculateDaysRemaining(new Date(claim?.claim_date || Date.now()))
        };
      });

    // Step 6: Store detection results
    if (detectionResults.length > 0) {
      await this.storeDetectionResults(detectionResults, userId, storageSyncId);
    }

    // Step 7: Signal completion
    await this.signalDetectionCompletion(
      userId,
      storageSyncId,
      detectionId,
      { totalDetected: detectionResults.length },
      true
    );

    // Step 8: Update sync_progress metadata with claimsDetected count
    // This ensures metadata is always up-to-date for fast API responses
    try {
      const { data: existingSync } = await supabaseAdmin
        .from('sync_progress')
        .select('metadata')
        .eq('sync_id', storageSyncId)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingSync) {
        const metadata = (existingSync.metadata as any) || {};
        metadata.claimsDetected = detectionResults.length;
        
        await supabaseAdmin
          .from('sync_progress')
          .update({
            metadata,
            updated_at: new Date().toISOString()
          })
          .eq('sync_id', storageSyncId)
          .eq('user_id', userId);

        logger.info('✅ [AGENT 2] Updated sync_progress metadata with claimsDetected', {
          userId,
          syncId: storageSyncId,
          claimsDetected: detectionResults.length
        });

        // Step 9: Send SSE event to notify frontend of updated claimsDetected
        // This is critical because sync completes before detection finishes
        try {
          const sseHub = (await import('../utils/sseHub')).default;
          sseHub.sendEvent(userId, 'detection.completed', {
            type: 'detection',
            status: 'completed',
            syncId: storageSyncId,
            claimsDetected: detectionResults.length,
            message: `Detection complete: ${detectionResults.length} claims detected`,
            timestamp: new Date().toISOString()
          });
          
          // Also send as 'message' event for backward compatibility
          sseHub.sendEvent(userId, 'message', {
            type: 'detection',
            status: 'completed',
            syncId: storageSyncId,
            claimsDetected: detectionResults.length,
            message: `Detection complete: ${detectionResults.length} claims detected`,
            timestamp: new Date().toISOString()
          });
          
          logger.info('✅ [AGENT 2] Sent SSE event for detection completion', {
            userId,
            syncId: storageSyncId,
            claimsDetected: detectionResults.length
          });
        } catch (sseError: any) {
          logger.warn('⚠️ [AGENT 2] Failed to send SSE event for detection completion (non-critical)', {
            error: sseError.message,
            userId,
            syncId: storageSyncId
          });
        }
      }
    } catch (metadataError: any) {
      logger.warn('⚠️ [AGENT 2] Failed to update sync_progress metadata (non-critical)', {
        error: metadataError.message,
        userId,
        syncId: storageSyncId
      });
      // Don't throw - detection results are already stored, metadata update is just for performance
    }

    return { totalDetected: detectionResults.length };
  }

  /**
   * Validate and normalize input data contract (from Agent 3)
   */
  private validateAndNormalizeInputContract(
    data: {
      orders?: any[];
      shipments?: any[];
      returns?: any[];
      settlements?: any[];
      inventory?: any[];
      claims?: any[];
    },
    userId: string,
    syncId: string
  ): typeof data {
    const normalized: any = {};

    // Normalize orders
    if (data.orders && Array.isArray(data.orders)) {
      normalized.orders = data.orders.map((order: any) => {
        const normalizedOrder = { ...order };
        if (!normalizedOrder.total_fees && normalizedOrder.total_fees !== 0) {
          normalizedOrder.total_fees = normalizedOrder.total_amount 
            ? parseFloat((normalizedOrder.total_amount * 0.05).toFixed(2))
            : 0;
        }
        if (!normalizedOrder.order_date) normalizedOrder.order_date = new Date().toISOString();
        if (!normalizedOrder.currency) normalizedOrder.currency = 'USD';
        if (!normalizedOrder.marketplace_id) normalizedOrder.marketplace_id = 'US';
        return normalizedOrder;
      });
    }

    // Normalize shipments
    if (data.shipments && Array.isArray(data.shipments)) {
      normalized.shipments = data.shipments.map((shipment: any) => {
        const normalizedShipment = { ...shipment };
        if (normalizedShipment.items && Array.isArray(normalizedShipment.items)) {
          normalizedShipment.items = normalizedShipment.items.map((item: any) => {
            if (!item.price && item.price !== 0) item.price = 10;
            return item;
          });
        }
        if (normalizedShipment.missing_quantity === undefined) {
          const expectedQty = normalizedShipment.expected_quantity || 0;
          const receivedQty = normalizedShipment.received_quantity || expectedQty;
          normalizedShipment.missing_quantity = Math.max(0, expectedQty - receivedQty);
        }
        if (!normalizedShipment.shipped_date) normalizedShipment.shipped_date = new Date().toISOString();
        if (!normalizedShipment.status) normalizedShipment.status = 'UNKNOWN';
        return normalizedShipment;
      });
    }

    // Normalize returns
    if (data.returns && Array.isArray(data.returns)) {
      normalized.returns = data.returns.map((returnData: any) => {
        const normalizedReturn = { ...returnData };
        if (!normalizedReturn.refund_amount && normalizedReturn.refund_amount !== 0) {
          normalizedReturn.refund_amount = normalizedReturn.items?.reduce(
            (sum: number, item: any) => sum + (item.refund_amount || 0),
            0
          ) || 0;
        }
        if (!normalizedReturn.returned_date) normalizedReturn.returned_date = new Date().toISOString();
        if (!normalizedReturn.currency) normalizedReturn.currency = 'USD';
        return normalizedReturn;
      });
    }

    // Normalize settlements
    if (data.settlements && Array.isArray(data.settlements)) {
      normalized.settlements = data.settlements.map((settlement: any) => {
        const normalizedSettlement = { ...settlement };
        if (!normalizedSettlement.fees && normalizedSettlement.fees !== 0) {
          normalizedSettlement.fees = normalizedSettlement.amount 
            ? parseFloat((normalizedSettlement.amount * 0.10).toFixed(2))
            : 0;
        }
        if (!normalizedSettlement.settlement_date) normalizedSettlement.settlement_date = new Date().toISOString();
        if (!normalizedSettlement.currency) normalizedSettlement.currency = 'USD';
        return normalizedSettlement;
      });
    }

    if (data.inventory) normalized.inventory = data.inventory;
    if (data.claims) normalized.claims = data.claims;

    return normalized;
  }

  /**
   * Transform normalized data into Discovery Agent claim format (from Agent 3)
   */
  private prepareClaimsFromNormalizedData(
    data: {
      orders?: any[];
      shipments?: any[];
      returns?: any[];
      settlements?: any[];
      inventory?: any[];
      claims?: any[];
    },
    userId: string
  ): any[] {
    const claims: any[] = [];

    // Process orders
    if (data.orders) {
      for (const order of data.orders) {
        if (order.total_fees && order.total_fees > 0) {
          const daysSinceOrder = this.calculateDaysSince(order.order_date);
          claims.push({
            claim_id: `claim_order_${order.order_id}_${Date.now()}`,
            seller_id: userId,
            order_id: order.order_id,
            category: 'fee_error',
            subcategory: 'order_fee',
            reason_code: 'POTENTIAL_FEE_OVERCHARGE',
            marketplace: order.marketplace_id || 'US',
            fulfillment_center: order.fulfillment_center || 'DEFAULT', // Required by Discovery Agent
            amount: order.total_fees,
            quantity: 1,
            order_value: order.total_amount || 0,
            shipping_cost: order.shipping_cost || 0, // Required by Discovery Agent
            days_since_order: daysSinceOrder,
            days_since_delivery: Math.max(0, daysSinceOrder - 3), // Estimate delivery 3 days after order
            description: `Potential fee overcharge for order ${order.order_id}`,
            reason: 'POTENTIAL_FEE_OVERCHARGE', // Required by Discovery Agent
            notes: '',
            claim_date: order.order_date || new Date().toISOString()
          });
        }
      }
    }

    // Process shipments - generate claims for all shipments (not just those with missing_quantity)
    if (data.shipments) {
      for (const shipment of data.shipments) {
        // Generate claim if missing_quantity exists OR if shipment has items (potential discrepancy)
        const hasMissingQuantity = shipment.missing_quantity && shipment.missing_quantity > 0;
        const hasItems = shipment.items && shipment.items.length > 0;
        
        if (hasMissingQuantity || hasItems) {
          const estimatedValue = shipment.items?.reduce((sum: number, item: any) => {
            return sum + (item.quantity * (item.price || 10));
          }, 0) || (shipment.missing_quantity || 1) * 10;
          const daysSinceShipped = this.calculateDaysSince(shipment.shipped_date);
          const reasonCode = shipment.status === 'lost' ? 'LOST_SHIPMENT' : 
                            shipment.status === 'damaged' ? 'DAMAGED_INVENTORY' : 
                            'INVENTORY_DISCREPANCY';

          claims.push({
            claim_id: `claim_shipment_${shipment.shipment_id}_${Date.now()}`,
            seller_id: userId,
            order_id: shipment.order_id || shipment.shipment_id,
            category: 'inventory_loss',
            subcategory: shipment.status === 'lost' ? 'lost_shipment' : 
                        shipment.status === 'damaged' ? 'damaged_goods' : 
                        'inventory_discrepancy',
            reason_code: reasonCode,
            marketplace: 'US',
            fulfillment_center: shipment.fulfillment_center || 'DEFAULT', // Required by Discovery Agent
            amount: estimatedValue,
            quantity: shipment.missing_quantity || shipment.items?.reduce((sum: number, item: any) => sum + item.quantity, 0) || 1,
            order_value: estimatedValue,
            shipping_cost: shipment.shipping_cost || estimatedValue * 0.1, // Estimate 10% of value
            days_since_order: daysSinceShipped,
            days_since_delivery: Math.max(0, daysSinceShipped - 1), // Estimate delivery 1 day after shipped
            description: hasMissingQuantity 
              ? `Missing ${shipment.missing_quantity} unit(s) from shipment ${shipment.shipment_id}`
              : `Potential inventory discrepancy in shipment ${shipment.shipment_id}`,
            reason: reasonCode, // Required by Discovery Agent
            notes: '',
            claim_date: shipment.shipped_date || new Date().toISOString()
          });
        }
      }
    }

    // Process returns - generate claims for all returns (not just those with refund_amount)
    if (data.returns) {
      for (const returnData of data.returns) {
        // Generate claim if refund_amount exists OR if return has items (potential discrepancy)
        const hasRefundAmount = returnData.refund_amount && returnData.refund_amount > 0;
        const hasItems = returnData.items && returnData.items.length > 0;
        
        if (hasRefundAmount || hasItems) {
          const estimatedValue = returnData.refund_amount || 
                                returnData.items?.reduce((sum: number, item: any) => {
                                  return sum + (item.quantity * (item.price || 10));
                                }, 0) || 10;
          const daysSinceReturn = this.calculateDaysSince(returnData.returned_date);
          
          claims.push({
            claim_id: `claim_return_${returnData.return_id}_${Date.now()}`,
            seller_id: userId,
            order_id: returnData.order_id || returnData.return_id,
            category: 'return_discrepancy',
            subcategory: 'refund_mismatch',
            reason_code: 'POTENTIAL_REFUND_DISCREPANCY',
            marketplace: 'US',
            fulfillment_center: returnData.fulfillment_center || 'DEFAULT', // Required by Discovery Agent
            amount: estimatedValue,
            quantity: returnData.items?.reduce((sum: number, item: any) => sum + item.quantity, 0) || 1,
            order_value: estimatedValue,
            shipping_cost: 0, // Returns typically don't have shipping cost
            days_since_order: daysSinceReturn,
            days_since_delivery: daysSinceReturn, // Assume return date is close to delivery
            description: hasRefundAmount 
              ? `Potential refund discrepancy for return ${returnData.return_id}`
              : `Potential return discrepancy for ${returnData.return_id}`,
            reason: 'POTENTIAL_REFUND_DISCREPANCY', // Required by Discovery Agent
            notes: '',
            claim_date: returnData.returned_date || new Date().toISOString()
          });
        }
      }
    }

    // Process settlements - generate claims for all settlements (not just those with fees)
    if (data.settlements) {
      for (const settlement of data.settlements) {
        // Generate claim if fees exist OR if settlement has amount (potential discrepancy)
        const hasFees = settlement.fees && settlement.fees > 0;
        const hasAmount = settlement.amount && settlement.amount > 0;
        
        if (hasFees || hasAmount) {
          const estimatedValue = settlement.fees || settlement.amount * 0.1; // Estimate 10% as potential fee discrepancy
          const daysSinceSettlement = this.calculateDaysSince(settlement.settlement_date);
          
          claims.push({
            claim_id: `claim_settlement_${settlement.settlement_id}_${Date.now()}`,
            seller_id: userId,
            order_id: settlement.order_id || settlement.settlement_id,
            category: 'fee_error',
            subcategory: 'settlement_fee',
            reason_code: 'POTENTIAL_SETTLEMENT_FEE_DISCREPANCY',
            marketplace: 'US',
            fulfillment_center: 'DEFAULT', // Settlements don't have fulfillment center
            amount: estimatedValue,
            quantity: 1,
            order_value: settlement.amount || estimatedValue,
            shipping_cost: 0, // Settlements don't have shipping cost
            days_since_order: daysSinceSettlement,
            days_since_delivery: daysSinceSettlement, // Use settlement date as proxy
            description: hasFees 
              ? `Potential fee discrepancy in settlement ${settlement.settlement_id}`
              : `Potential settlement discrepancy for ${settlement.settlement_id}`,
            reason: 'POTENTIAL_SETTLEMENT_FEE_DISCREPANCY', // Required by Discovery Agent
            notes: '',
            claim_date: settlement.settlement_date || new Date().toISOString()
          });
        }
      }
    }

    return claims;
  }

  /**
   * Store detection results in database (from Agent 3)
   */
  private async storeDetectionResults(
    detections: any[],
    userId: string,
    syncId: string
  ): Promise<void> {
    // Handle demo mode (no real database)
    if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
      logger.warn('⚠️ [AGENT 2] No database client available (demo mode), skipping storage', {
        userId,
        syncId,
        detectionsCount: detections.length
      });
      return; // Don't throw - allow detection to complete in demo mode
    }

    const records = detections.map(detection => ({
      seller_id: userId,
      sync_id: syncId,
      anomaly_type: detection.anomaly_type,
      severity: detection.severity,
      estimated_value: detection.estimated_value,
      currency: detection.currency,
      confidence_score: detection.confidence_score,
      evidence: detection.evidence,
      related_event_ids: detection.related_event_ids || [],
      discovery_date: detection.discovery_date ? new Date(detection.discovery_date).toISOString() : new Date().toISOString(),
      deadline_date: detection.deadline_date ? new Date(detection.deadline_date).toISOString() : null,
      days_remaining: detection.days_remaining,
      expired: detection.days_remaining !== null && detection.days_remaining === 0,
      expiration_alert_sent: false,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    const { data: insertedDetections, error } = await supabaseAdmin
      .from('detection_results')
      .insert(records)
      .select('id, seller_id, estimated_value, currency, severity, confidence_score, anomaly_type, created_at, sync_id');

    if (error) {
      logger.error('❌ [AGENT 2] Failed to store detection results', {
        error: error.message,
        userId,
        syncId
      });
      throw new Error(`Failed to store detection results: ${error.message}`);
    }

    logger.info('✅ [AGENT 2] Detection results stored', {
      userId,
      syncId,
      count: records.length
    });

    try {
      await upsertDisputesAndRecoveriesFromDetections(insertedDetections || []);
    } catch (backfillError: any) {
      logger.error('⚠️ [AGENT 2] Failed to backfill dispute/recovery records', {
        error: backfillError?.message || backfillError,
        userId,
        syncId
      });
    }
  }

  /**
   * Signal detection completion to detection_queue (from Agent 3)
   */
  private async signalDetectionCompletion(
    userId: string,
    syncId: string,
    detectionId: string,
    summary: { totalDetected: number },
    isSuccess: boolean
  ): Promise<void> {
    // Handle demo mode (no real database)
    if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
      logger.warn('⚠️ [AGENT 2] No database client available (demo mode), skipping completion signal', {
        userId,
        syncId
      });
      return;
    }

    try {
      const { data: existingQueue } = await supabaseAdmin
        .from('detection_queue')
        .select('id')
        .eq('seller_id', userId)
        .eq('sync_id', syncId)
        .maybeSingle();

      if (existingQueue) {
        await supabaseAdmin
          .from('detection_queue')
          .update({
            status: isSuccess ? 'completed' : 'failed',
            processed_at: new Date().toISOString(),
            payload: { detectionId, summary },
            updated_at: new Date().toISOString()
          })
          .eq('id', existingQueue.id);
      } else {
        await supabaseAdmin
          .from('detection_queue')
          .insert({
            seller_id: userId,
            sync_id: syncId,
            status: isSuccess ? 'completed' : 'failed',
            processed_at: new Date().toISOString(),
            payload: { detectionId, summary }
          });
      }
    } catch (error: any) {
      logger.warn('⚠️ [AGENT 2] Failed to signal completion (non-critical)', {
        error: error.message,
        userId,
        syncId
      });
    }
  }

  /**
   * Helper: Map category to anomaly type (from Agent 3)
   */
  private mapCategoryToAnomalyType(category?: string, subcategory?: string): string {
    const mapping: Record<string, string> = {
      'fee_error': 'incorrect_fee',
      'inventory_loss': 'missing_unit',
      'damaged_goods': 'damaged_stock',
      'return_discrepancy': 'missing_unit',
      'lost_shipment': 'missing_unit',
      'overcharge': 'overcharge',
      'duplicate': 'duplicate_charge'
    };
    return mapping[subcategory || category || ''] || 'missing_unit';
  }

  /**
   * Helper: Map confidence to severity (from Agent 3)
   */
  private mapConfidenceToSeverity(confidence: number): 'low' | 'medium' | 'high' | 'critical' {
    if (confidence >= 0.85) return 'critical';
    if (confidence >= 0.70) return 'high';
    if (confidence >= 0.50) return 'medium';
    return 'low';
  }

  /**
   * Helper: Calculate days since date (from Agent 3)
   */
  private calculateDaysSince(dateString?: string): number {
    if (!dateString) return 0;
    const date = new Date(dateString);
    const now = new Date();
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * Helper: Calculate 60-day deadline (from Agent 3)
   */
  private calculateDeadline(discoveryDate: Date): Date {
    const deadline = new Date(discoveryDate);
    deadline.setDate(deadline.getDate() + 60);
    return deadline;
  }

  /**
   * Helper: Calculate days remaining until deadline (from Agent 3)
   */
  private calculateDaysRemaining(discoveryDate: Date): number {
    const deadline = this.calculateDeadline(discoveryDate);
    const now = new Date();
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, daysRemaining);
  }
}

export const agent2DataSyncService = new Agent2DataSyncService();
export default agent2DataSyncService;

