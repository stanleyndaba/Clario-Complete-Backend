/**
 * Shipments Service - Fetches and normalizes FBA shipment data
 * Phase 2: Continuous Data Sync
 */

import axios from 'axios';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { logAuditEvent } from '../security/auditLogger';

export interface ShipmentItem {
  sku: string;
  asin: string;
  quantity: number;
  price?: number; // Unit price for value calculation
}

export interface NormalizedShipment {
  shipment_id: string;
  order_id?: string;
  tracking_number?: string;
  shipped_date?: string;
  received_date?: string;
  status: string;
  carrier?: string;
  warehouse_location?: string;
  items: ShipmentItem[];
  expected_quantity: number;
  received_quantity?: number;
  missing_quantity?: number;
  metadata?: any;
}

export class ShipmentsService {
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
   * Fetch shipments from Amazon SP-API Reports
   * Uses FBA Fulfillment Shipment Data report
   */
  async fetchShipments(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{ success: boolean; data: NormalizedShipment[]; message: string }> {
    const environment = this.isSandbox() ? 'SANDBOX' : 'PRODUCTION';
    const dataType = this.isSandbox() ? 'SANDBOX_TEST_DATA' : 'LIVE_PRODUCTION_DATA';

    try {
      logger.info('Fetching shipments from SP-API', {
        userId,
        environment,
        endDate: endDate?.toISOString(),
        isSandbox: this.isSandbox()
      });

      // Check if using mock SP-API (Bypass credentials check)
      if (process.env.USE_MOCK_SPAPI === 'true') {
        logger.info('Using Mock SP-API for shipments (Credentials bypassed)', { userId });
        const mockResponse = await (await import('./mockSPAPIService')).mockSPAPIService.getShipments({});
        const payload = mockResponse.payload || mockResponse;
        const shipments = payload?.Shipments || [];

        // Normalize shipments
        const normalizedShipments = this.normalizeShipments(shipments, userId);

        return {
          success: true,
          data: normalizedShipments,
          message: `Fetched ${normalizedShipments.length} shipments from Mock SP-API`
        };
      }

      // For now, we'll use a placeholder approach
      // In production, this should request and download FBA shipment reports
      // Report type: GET_FBA_FULFILLMENT_SHIPMENT_DATA

      // Since report processing is async, we'll implement a simplified version
      // that can be enhanced later with full report processing

      logger.info('Shipments fetch initiated (report-based sync)', {
        userId,
        isSandbox: this.isSandbox()
      });

      // Return empty array for now - will be implemented with report processing
      return {
        success: true,
        data: [],
        message: `Shipments sync initiated (report processing will be implemented)`
      };
    } catch (error: any) {
      logger.error('Error fetching shipments from SP-API', {
        error: error.message,
        userId,
        isSandbox: this.isSandbox()
      });

      await logAuditEvent({
        event_type: 'shipments_sync_failed',
        user_id: userId,
        metadata: {
          error: error.message,
          isSandbox: this.isSandbox()
        },
        severity: 'high'
      });

      // For sandbox, return empty array
      if (this.isSandbox()) {
        return {
          success: true,
          data: [],
          message: 'Sandbox returned no shipments data (normal for testing)'
        };
      }

      throw new Error(`Failed to fetch shipments: ${error.message}`);
    }
  }

  /**
   * Normalize shipment data to Clario schema
   */
  normalizeShipments(shipments: any[], userId: string): NormalizedShipment[] {
    return shipments.map((shipment: any) => {
      const items: ShipmentItem[] = (shipment.Items || shipment.items || []).map((item: any) => ({
        sku: item.SellerSKU || item.sku || '',
        asin: item.ASIN || item.asin || '',
        quantity: item.QuantityShipped || item.quantity || 0,
        price: parseFloat(item.ItemPrice?.Amount || item.ItemPrice || item.price || '0') || undefined
      }));

      const expectedQuantity = shipment.QuantityShipped || items.reduce((sum, item) => sum + item.quantity, 0);
      const receivedQuantity = shipment.QuantityReceived || shipment.received_quantity || expectedQuantity;
      const missingQuantity = Math.max(0, expectedQuantity - receivedQuantity);

      return {
        shipment_id: shipment.ShipmentId || shipment.shipment_id || shipment.ShipmentID || '',
        order_id: shipment.AmazonOrderId || shipment.order_id || null,
        tracking_number: shipment.TrackingNumber || shipment.tracking_number || null,
        shipped_date: shipment.ShippedDate || shipment.shipped_date ? new Date(shipment.ShippedDate || shipment.shipped_date).toISOString() : null,
        received_date: shipment.ReceivedDate || shipment.received_date ? new Date(shipment.ReceivedDate || shipment.received_date).toISOString() : null,
        status: this.determineShipmentStatus(shipment),
        carrier: shipment.Carrier || shipment.carrier || null,
        warehouse_location: shipment.WarehouseLocation || shipment.warehouse_location || shipment.FulfillmentCenterId || null,
        items,
        expected_quantity: expectedQuantity,
        received_quantity: receivedQuantity,
        missing_quantity: missingQuantity,
        metadata: {
          shipmentType: shipment.ShipmentType || shipment.shipment_type,
          fulfillmentCenterId: shipment.FulfillmentCenterId || shipment.fulfillment_center_id,
          labelPrepType: shipment.LabelPrepType || shipment.label_prep_type
        }
      };
    });
  }

  /**
   * Determine shipment status based on dates and quantities
   */
  private determineShipmentStatus(shipment: any): string {
    if (shipment.ReceivedDate || shipment.received_date) {
      const receivedQty = shipment.QuantityReceived || shipment.received_quantity || 0;
      const expectedQty = shipment.QuantityShipped || shipment.quantity_shipped || 0;
      if (receivedQty < expectedQty) {
        return 'partial';
      }
      return 'received';
    }
    if (shipment.ShippedDate || shipment.shipped_date) {
      return 'in_transit';
    }
    return 'pending';
  }

  /**
   * Save normalized shipments to database
   */
  async saveShipmentsToDatabase(userId: string, shipments: NormalizedShipment[]): Promise<void> {
    try {
      logger.info('Saving shipments to database', { userId, count: shipments.length });

      if (shipments.length === 0) {
        logger.info('No shipments to save', { userId });
        return;
      }

      if (typeof supabase.from !== 'function') {
        logger.warn('Demo mode: Shipments save skipped', { userId });
        return;
      }

      const shipmentsToInsert = shipments.map(shipment => ({
        user_id: userId,
        shipment_id: shipment.shipment_id,
        order_id: shipment.order_id || null,
        tracking_number: shipment.tracking_number || null,
        shipped_date: shipment.shipped_date || null,
        received_date: shipment.received_date || null,
        status: shipment.status,
        carrier: shipment.carrier || null,
        warehouse_location: shipment.warehouse_location || null,
        items: shipment.items,
        expected_quantity: shipment.expected_quantity,
        received_quantity: shipment.received_quantity || null,
        missing_quantity: shipment.missing_quantity || 0,
        metadata: shipment.metadata || {},
        source_report: 'SP-API_FBA_Shipments',
        sync_timestamp: new Date().toISOString(),
        is_sandbox: this.isSandbox(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Check for existing shipments
      const shipmentIds = shipmentsToInsert.map(s => s.shipment_id).filter(Boolean);
      if (shipmentIds.length > 0) {
        const { data: existingShipments, error: fetchError } = await supabase
          .from('shipments')
          .select('shipment_id')
          .eq('user_id', userId)
          .in('shipment_id', shipmentIds);

        if (!fetchError && existingShipments) {
          const existingIds = new Set(existingShipments.map((s: any) => s.shipment_id));
          const newShipments = shipmentsToInsert.filter(s => !existingIds.has(s.shipment_id));

          if (newShipments.length > 0) {
            const { error: insertError } = await supabase
              .from('shipments')
              .insert(newShipments);

            if (insertError) {
              logger.error('Error inserting shipments', { error: insertError, userId });
              throw new Error(`Failed to insert shipments: ${insertError.message}`);
            }

            logger.info('Shipments saved to database', { userId, inserted: newShipments.length });
          }

          // Update existing shipments
          const shipmentsToUpdate = shipmentsToInsert.filter(s => existingIds.has(s.shipment_id));
          for (const shipment of shipmentsToUpdate) {
            const { error: updateError } = await supabase
              .from('shipments')
              .update({
                status: shipment.status,
                received_date: shipment.received_date,
                received_quantity: shipment.received_quantity,
                missing_quantity: shipment.missing_quantity,
                sync_timestamp: shipment.sync_timestamp,
                updated_at: shipment.updated_at
              })
              .eq('user_id', userId)
              .eq('shipment_id', shipment.shipment_id);

            if (updateError) {
              logger.warn('Error updating shipment', { error: updateError, userId, shipmentId: shipment.shipment_id });
            }
          }
          return;
        }
      }

      // Insert all if no existing check
      const { error: insertError } = await supabase
        .from('shipments')
        .insert(shipmentsToInsert);

      if (insertError) {
        logger.error('Error inserting shipments', { error: insertError, userId });
        throw new Error(`Failed to insert shipments: ${insertError.message}`);
      }

      logger.info('Shipments saved to database successfully', { userId, inserted: shipmentsToInsert.length });

      await logAuditEvent({
        event_type: 'shipments_synced',
        user_id: userId,
        metadata: { count: shipmentsToInsert.length, isSandbox: this.isSandbox() },
        severity: 'low'
      });
    } catch (error: any) {
      logger.error('Error saving shipments to database', { error: error.message, userId });
      throw error;
    }
  }
}

export default new ShipmentsService();

