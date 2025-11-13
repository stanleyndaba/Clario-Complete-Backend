/**
 * Orders Service - Fetches and normalizes Amazon orders data
 * Phase 2: Continuous Data Sync
 */

import axios from 'axios';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';

export interface OrderItem {
  sku: string;
  asin: string;
  quantity: number;
  price: number;
  title?: string;
}

export interface NormalizedOrder {
  order_id: string;
  seller_id?: string;
  marketplace_id: string;
  order_date: string;
  shipment_date?: string;
  fulfillment_channel: string;
  items: OrderItem[];
  quantities: Record<string, number>;
  status: string;
  total_amount?: number;
  currency: string;
  metadata?: any;
}

export class OrdersService {
  private baseUrl: string;
  private isSandboxMode: boolean;

  constructor() {
    this.baseUrl = process.env.AMAZON_SPAPI_BASE_URL || 'https://sellingpartnerapi-na.amazon.com';
    this.isSandboxMode = this.baseUrl.includes('sandbox') || process.env.NODE_ENV === 'development';
  }

  private isSandbox(): boolean {
    return this.isSandboxMode;
  }

  /**
   * Fetch orders from Amazon SP-API
   */
  async fetchOrders(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{ success: boolean; data: NormalizedOrder[]; message: string }> {
    const environment = this.isSandbox() ? 'SANDBOX' : 'PRODUCTION';
    const dataType = this.isSandbox() ? 'SANDBOX_TEST_DATA' : 'LIVE_PRODUCTION_DATA';

    try {
      logger.info('Fetching orders from SP-API', {
        userId,
        environment,
        dataType,
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
        isSandbox: this.isSandbox()
      });

      // Get access token (this should be handled by amazonService, but for now we'll use a placeholder)
      // In production, this should use the tokenManager
      const accessToken = await this.getAccessToken(userId);
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';

      // Default to last 18 months for Phase 1 (first sync)
      // If no dates provided, fetch 18 months of historical data
      const createdAfter = startDate || new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000);
      const createdBefore = endDate || new Date();

      const params: any = {
        MarketplaceIds: marketplaceId,
        CreatedAfter: createdAfter.toISOString(),
        CreatedBefore: createdBefore.toISOString()
      };

      // Fetch orders from SP-API
      const response = await axios.get(`${this.baseUrl}/orders/v0/orders`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        },
        params,
        timeout: 30000
      });

      const payload = response.data?.payload || response.data;
      const orders = payload?.Orders || (Array.isArray(payload) ? payload : []);

      logger.info(`Successfully fetched ${orders.length} orders from SP-API ${environment}`, {
        orderCount: orders.length,
        userId,
        isSandbox: this.isSandbox(),
        dataType
      });

      // Normalize orders
      const normalizedOrders = this.normalizeOrders(orders, userId);

      return {
        success: true,
        data: normalizedOrders,
        message: `Fetched ${normalizedOrders.length} orders from SP-API ${environment} (${dataType})`
      };
    } catch (error: any) {
      const errorDetails = error.response?.data?.errors?.[0] || {};
      logger.error('Error fetching orders from SP-API', {
        error: error.message,
        status: error.response?.status,
        errorCode: errorDetails.code,
        errorMessage: errorDetails.message,
        userId,
        isSandbox: this.isSandbox()
      });

      // Log audit event
      await logAuditEvent({
        event_type: 'orders_sync_failed',
        user_id: userId,
        metadata: {
          error: error.message,
          status: error.response?.status,
          isSandbox: this.isSandbox()
        },
        severity: 'high'
      });

      // For sandbox, return empty array instead of error
      if (this.isSandbox() && (error.response?.status === 404 || error.response?.status === 400)) {
        logger.info('Sandbox returned empty/error response - returning empty orders (normal for sandbox)', {
          status: error.response?.status,
          userId
        });
        return {
          success: true,
          data: [],
          message: 'Sandbox returned no orders data (normal for testing)'
        };
      }

      // For production, throw error
      throw new Error(`Failed to fetch orders: ${errorDetails.message || error.message}`);
    }
  }

  /**
   * Normalize SP-API orders to Clario schema
   */
  normalizeOrders(orders: any[], userId: string): NormalizedOrder[] {
    return orders.map((order: any) => {
      // Extract order items
      const items: OrderItem[] = (order.OrderItems || []).map((item: any) => ({
        sku: item.SellerSKU || item.sku || '',
        asin: item.ASIN || item.asin || '',
        quantity: item.QuantityOrdered || item.quantity || 0,
        price: parseFloat(item.ItemPrice?.Amount || item.price || '0'),
        title: item.Title || item.title
      }));

      // Calculate quantities summary
      const quantities: Record<string, number> = {};
      items.forEach(item => {
        quantities[item.sku] = (quantities[item.sku] || 0) + item.quantity;
      });

      // Extract dates
      const orderDate = order.PurchaseDate || order.order_date || order.CreatedDate;
      const shipmentDate = order.EarliestShipDate || order.shipment_date || order.ShipServiceLevelCategory;

      return {
        order_id: order.AmazonOrderId || order.order_id || order.OrderId || '',
        seller_id: order.SellerId || order.seller_id,
        marketplace_id: order.MarketplaceId || order.marketplace_id || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER',
        order_date: orderDate ? new Date(orderDate).toISOString() : new Date().toISOString(),
        shipment_date: shipmentDate ? new Date(shipmentDate).toISOString() : undefined,
        fulfillment_channel: order.FulfillmentChannel || order.fulfillment_channel || 'FBA',
        items,
        quantities,
        status: order.OrderStatus || order.status || 'Pending',
        total_amount: parseFloat(order.OrderTotal?.Amount || order.total_amount || '0'),
        currency: order.OrderTotal?.CurrencyCode || order.currency || 'USD',
        metadata: {
          orderType: order.OrderType || order.order_type,
          salesChannel: order.SalesChannel || order.sales_channel,
          shipServiceLevel: order.ShipServiceLevelCategory || order.ship_service_level,
          numberOfItemsShipped: order.NumberOfItemsShipped || order.number_of_items_shipped,
          numberOfItemsUnshipped: order.NumberOfItemsUnshipped || order.number_of_items_unshipped,
          isPrime: order.IsPrime || order.is_prime,
          isBusinessOrder: order.IsBusinessOrder || order.is_business_order,
          isPremiumOrder: order.IsPremiumOrder || order.is_premium_order
        }
      };
    });
  }

  /**
   * Save normalized orders to database
   */
  async saveOrdersToDatabase(userId: string, orders: NormalizedOrder[]): Promise<void> {
    try {
      logger.info('Saving orders to database', { userId, count: orders.length });

      if (orders.length === 0) {
        logger.info('No orders to save', { userId });
        return;
      }

      if (typeof supabase.from !== 'function') {
        logger.warn('Demo mode: Orders save skipped', { userId });
        return;
      }

      // Prepare orders for database insertion
      const ordersToInsert = orders.map(order => ({
        user_id: userId,
        order_id: order.order_id,
        seller_id: order.seller_id || null,
        marketplace_id: order.marketplace_id,
        order_date: order.order_date,
        shipment_date: order.shipment_date || null,
        fulfillment_channel: order.fulfillment_channel,
        order_status: order.status,
        items: order.items,
        quantities: order.quantities,
        total_amount: order.total_amount || null,
        currency: order.currency,
        metadata: order.metadata || {},
        source_report: 'SP-API_Orders',
        sync_timestamp: new Date().toISOString(),
        is_sandbox: this.isSandbox(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Check for existing orders to avoid duplicates
      const orderIds = ordersToInsert.map(o => o.order_id).filter(Boolean);
      if (orderIds.length > 0) {
        const { data: existingOrders, error: fetchError } = await supabase
          .from('orders')
          .select('order_id')
          .eq('user_id', userId)
          .in('order_id', orderIds);

        if (fetchError) {
          logger.warn('Error fetching existing orders, proceeding with inserts', { error: fetchError, userId });
        } else {
          const existingOrderIds = new Set(existingOrders?.map((o: any) => o.order_id) || []);
          const newOrders = ordersToInsert.filter(o => !existingOrderIds.has(o.order_id));

          if (newOrders.length > 0) {
            const { error: insertError } = await supabase
              .from('orders')
              .insert(newOrders);

            if (insertError) {
              logger.error('Error inserting orders', { error: insertError, userId, count: newOrders.length });
              throw new Error(`Failed to insert orders: ${insertError.message}`);
            }

            logger.info('Orders saved to database successfully', {
              userId,
              inserted: newOrders.length,
              total: ordersToInsert.length
            });
          } else {
            logger.info('All orders already exist in database', { userId, count: ordersToInsert.length });
          }

          // Update existing orders
          const ordersToUpdate = ordersToInsert.filter(o => existingOrderIds.has(o.order_id));
          if (ordersToUpdate.length > 0) {
            for (const order of ordersToUpdate) {
              const { error: updateError } = await supabase
                .from('orders')
                .update({
                  order_status: order.order_status,
                  items: order.items,
                  quantities: order.quantities,
                  total_amount: order.total_amount,
                  metadata: order.metadata,
                  sync_timestamp: order.sync_timestamp,
                  updated_at: order.updated_at
                })
                .eq('user_id', userId)
                .eq('order_id', order.order_id);

              if (updateError) {
                logger.warn('Error updating order', { error: updateError, userId, orderId: order.order_id });
              }
            }
            logger.info('Updated existing orders', { userId, count: ordersToUpdate.length });
          }

          return;
        }
      }

      // Insert all orders if no existing check or if check failed
      const { error: insertError } = await supabase
        .from('orders')
        .insert(ordersToInsert);

      if (insertError) {
        logger.error('Error inserting orders', { error: insertError, userId, count: ordersToInsert.length });
        throw new Error(`Failed to insert orders: ${insertError.message}`);
      }

      logger.info('Orders saved to database successfully', { userId, inserted: ordersToInsert.length });

      // Log audit event
      await logAuditEvent({
        event_type: 'orders_synced',
        user_id: userId,
        metadata: {
          count: ordersToInsert.length,
          isSandbox: this.isSandbox()
        },
        severity: 'low'
      });
    } catch (error: any) {
      logger.error('Error saving orders to database', { error: error.message, userId });
      throw error;
    }
  }

  /**
   * Get access token from amazonService
   */
  private async getAccessToken(userId: string): Promise<string> {
    const amazonService = (await import('./amazonService')).default;
    return amazonService.getAccessTokenForService(userId);
  }
}

export default new OrdersService();

