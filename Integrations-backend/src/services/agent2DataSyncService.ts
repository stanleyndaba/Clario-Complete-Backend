/**
 * Agent 2: Continuous Data Sync / Classification Agent
 * 
 * Purpose:
 * - Receives raw FBA data from Agent 1 (OAuth credentials)
 * - Normalizes, validates, and enriches the data
 * - Prepares structured datasets for Agent 3 (Claim Detection)
 * - Handles mock data generation for sandbox mode
 * - Logs events to agent_events table
 * 
 * Key Responsibilities:
 * 1. Continuous Data Sync - periodic background jobs
 * 2. Data Normalization - converts Amazon raw JSON to internal schema
 * 3. Event Logging - logs to agent_events table
 * 4. Error Handling & Retries - handles API failures gracefully
 * 5. Integration with Agent 3 - makes normalized data available
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
    endDate?: Date
  ): Promise<SyncResult> {
    const syncId = `agent2_sync_${userId}_${Date.now()}`;
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

      // Step 7: Trigger Agent 3 (Claim Detection) after successful sync
      if (result.success && result.summary.ordersCount + result.summary.shipmentsCount + result.summary.returnsCount > 0) {
        try {
          const agent3ClaimDetectionService = (await import('./agent3ClaimDetectionService')).default;
          logger.info('🔍 [AGENT 2→3] Triggering Agent 3 claim detection', { userId, syncId });
          
          // Run detection in background (don't wait)
          agent3ClaimDetectionService.detectClaims(userId, syncId, result.normalized).then((detectionResult) => {
            logger.info('✅ [AGENT 2→3] Agent 3 detection completed', {
              userId,
              syncId,
              detectionId: detectionResult.detectionId,
              totalDetected: detectionResult.summary.totalDetected,
              isMock: detectionResult.isMock
            });
          }).catch((detectionError: any) => {
            logger.error('❌ [AGENT 2→3] Agent 3 detection failed', {
              error: detectionError.message,
              userId,
              syncId
            });
          });
        } catch (importError: any) {
          logger.warn('⚠️ [AGENT 2→3] Failed to trigger Agent 3 (non-critical)', {
            error: importError.message,
            userId,
            syncId
          });
        }
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
}

export const agent2DataSyncService = new Agent2DataSyncService();
export default agent2DataSyncService;

