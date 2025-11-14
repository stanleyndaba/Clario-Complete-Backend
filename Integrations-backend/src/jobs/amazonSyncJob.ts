import cron from 'node-cron';
import logger from '../utils/logger';
import amazonService from '../services/amazonService';
import { notificationService } from '../notifications/services/notification_service';
import tokenManager from '../utils/tokenManager';
import { supabase } from '../database/supabaseClient';
import financialEventsService from '../services/financialEventsService';
import detectionService from '../services/detectionService';

export class AmazonSyncJob {
  private isRunning = false;

  async syncUserData(userId: string): Promise<string> {
    const syncId = `sync_${userId}_${Date.now()}`;
    
    try {
      logger.info('Starting Amazon sync for user', { userId, syncId });

      // Check if user has valid Amazon token (database or environment)
      const isConnected = await tokenManager.isTokenValid(userId, 'amazon');
      if (!isConnected) {
        // Even if no database token, check environment variables for sandbox mode
        const envRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
        const envClientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
        const envClientSecret = process.env.AMAZON_CLIENT_SECRET;
        
        if (envRefreshToken && envClientId && envClientSecret) {
          logger.info('Using environment variables for Amazon connection (sandbox mode)', { 
            userId, 
            syncId,
            hasRefreshToken: !!envRefreshToken,
            hasClientId: !!envClientId,
            hasClientSecret: !!envClientSecret
          });
          // Continue with sync using environment variables
        } else {
          logger.info('User not connected to Amazon (no database token or env vars), skipping sync', { userId, syncId });
          return syncId;
        }
      } else {
        logger.info('User has valid Amazon token, proceeding with sync', { userId, syncId });
      }

      // Calculate 18 months ago for Phase 1 (used for all data syncs)
      const eighteenMonthsAgo = new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000);
      const now = new Date();

      // Sync claims - GETTING SANDBOX TEST DATA FROM SP-API (18 months for Phase 1)
      // Note: Sandbox may return empty or limited test data - this is normal for testing
      logger.info('Fetching claims from SP-API SANDBOX (18 months of data)', { 
        userId, 
        syncId,
        startDate: eighteenMonthsAgo.toISOString(),
        endDate: now.toISOString(),
        months: 18
      });
      const claimsResult = await amazonService.fetchClaims(userId, eighteenMonthsAgo, now);
      const claims = claimsResult.data || claimsResult; // Handle both formats
      await this.saveClaimsToDatabase(userId, Array.isArray(claims) ? claims : []);
      
      logger.info('Claims sync completed (SANDBOX TEST DATA)', {
        userId,
        syncId,
        claimCount: Array.isArray(claims) ? claims.length : 0,
        dataType: 'SANDBOX_TEST_DATA',
        note: (!claims || (Array.isArray(claims) && claims.length === 0))
          ? 'Sandbox returned empty claims - this is normal for testing'
          : 'Sandbox test claims data retrieved successfully'
      });

      // Sync inventory - GETTING SANDBOX TEST DATA FROM SP-API
      // Note: Sandbox may return empty or limited test data - this is normal
      let inventory: any[] = [];
      try {
        const inventoryResult = await amazonService.fetchInventory(userId);
        inventory = inventoryResult.data || inventoryResult; // Handle both formats
        inventory = Array.isArray(inventory) ? inventory : [];
        await this.saveInventoryToDatabase(userId, inventory);
        
        logger.info('Inventory sync completed (SANDBOX TEST DATA)', { 
          userId, 
          syncId, 
          itemCount: inventory.length,
          fromApi: inventoryResult.fromApi || false,
          dataType: 'SANDBOX_TEST_DATA',
          note: inventory.length === 0 
            ? 'Sandbox returned empty inventory - this is normal for testing' 
            : 'Sandbox test inventory data retrieved successfully'
        });
      } catch (inventoryError: any) {
        // Log inventory sync failure but don't fail entire sync
        logger.error('Inventory sync failed (non-critical)', { 
          error: inventoryError.message, 
          userId, 
          syncId 
        });
        
        // Still continue with other sync operations
      }

      // Sync fees and financial events (18 months for Phase 1)
      logger.info('Fetching fees from SP-API SANDBOX (18 months of data)', {
        userId,
        syncId,
        startDate: eighteenMonthsAgo.toISOString(),
        endDate: now.toISOString(),
        months: 18
      });
      const feesResult = await amazonService.fetchFees(userId, eighteenMonthsAgo, now);
      const fees = feesResult.data || feesResult; // Handle both formats
      await this.saveFeesToDatabase(userId, Array.isArray(fees) ? fees : []);
      
      // Ingest financial events
      await this.ingestFinancialEvents(userId, fees);

      // 🎯 PHASE 2: Sync Orders (18 months for Phase 1)
      let orders: any[] = [];
      try {
        logger.info('Fetching orders from SP-API SANDBOX (18 months of data)', { 
          userId, 
          syncId,
          startDate: eighteenMonthsAgo.toISOString(),
          endDate: now.toISOString(),
          months: 18
        });
        const ordersService = (await import('../services/ordersService')).default;
        const ordersResult = await ordersService.fetchOrders(userId, eighteenMonthsAgo, now);
        const normalizedOrders = ordersResult.data || [];
        orders = normalizedOrders; // Store for summary
        await ordersService.saveOrdersToDatabase(userId, normalizedOrders);
        
        logger.info('Orders sync completed (SANDBOX TEST DATA)', {
          userId,
          syncId,
          orderCount: orders.length,
          dataType: 'SANDBOX_TEST_DATA',
          note: orders.length === 0
            ? 'Sandbox returned empty orders - this is normal for testing'
            : 'Sandbox test orders data retrieved successfully'
        });
      } catch (ordersError: any) {
        logger.error('Orders sync failed (non-critical)', {
          error: ordersError.message,
          userId,
          syncId
        });
        // Continue with other sync operations
      }

      // 🎯 PHASE 2: Sync Shipments
      let shipments: any[] = [];
      try {
        logger.info('Fetching shipments from SP-API (report-based)', { userId, syncId });
        const shipmentsService = (await import('../services/shipmentsService')).default;
        const shipmentsResult = await shipmentsService.fetchShipments(userId);
        shipments = shipmentsResult.data || [];
        shipments = Array.isArray(shipments) ? shipments : [];
        
        if (shipments.length > 0) {
          const normalizedShipments = shipmentsService.normalizeShipments(shipments, userId);
          await shipmentsService.saveShipmentsToDatabase(userId, normalizedShipments);
        }
        
        logger.info('Shipments sync completed', {
          userId,
          syncId,
          shipmentCount: shipments.length,
          dataType: 'SANDBOX_TEST_DATA',
          note: shipments.length === 0
            ? 'Sandbox returned empty shipments - this is normal for testing'
            : 'Shipments data retrieved successfully'
        });
      } catch (shipmentsError: any) {
        logger.error('Shipments sync failed (non-critical)', {
          error: shipmentsError.message,
          userId,
          syncId
        });
        // Continue with other sync operations
      }

      // 🎯 PHASE 2: Sync Returns
      let returns: any[] = [];
      try {
        logger.info('Fetching returns from SP-API (report-based)', { userId, syncId });
        const returnsService = (await import('../services/returnsService')).default;
        const returnsResult = await returnsService.fetchReturns(userId);
        returns = returnsResult.data || [];
        returns = Array.isArray(returns) ? returns : [];
        
        if (returns.length > 0) {
          const normalizedReturns = returnsService.normalizeReturns(returns, userId);
          await returnsService.saveReturnsToDatabase(userId, normalizedReturns);
        }
        
        logger.info('Returns sync completed', {
          userId,
          syncId,
          returnCount: returns.length,
          dataType: 'SANDBOX_TEST_DATA',
          note: returns.length === 0
            ? 'Sandbox returned empty returns - this is normal for testing'
            : 'Returns data retrieved successfully'
        });
      } catch (returnsError: any) {
        logger.error('Returns sync failed (non-critical)', {
          error: returnsError.message,
          userId,
          syncId
        });
        // Continue with other sync operations
      }

      // 🎯 PHASE 2: Sync Settlements (Enhanced Financial Events)
      let settlements: any[] = [];
      try {
        logger.info('Fetching settlements from SP-API Financial Events', { userId, syncId });
        const settlementsService = (await import('../services/settlementsService')).default;
        const settlementsResult = await settlementsService.fetchSettlements(userId);
        settlements = settlementsResult.data || [];
        settlements = Array.isArray(settlements) ? settlements : [];
        
        if (settlements.length > 0) {
          const normalizedSettlements = settlementsService.normalizeSettlements(settlements, userId);
          await settlementsService.saveSettlementsToDatabase(userId, normalizedSettlements);
        }
        
        logger.info('Settlements sync completed', {
          userId,
          syncId,
          settlementCount: settlements.length,
          dataType: 'SANDBOX_TEST_DATA',
          note: settlements.length === 0
            ? 'Sandbox returned empty settlements - this is normal for testing'
            : 'Settlements data retrieved successfully'
        });
      } catch (settlementsError: any) {
        logger.error('Settlements sync failed (non-critical)', {
          error: settlementsError.message,
          userId,
          syncId
        });
        // Continue with other sync operations
      }

      // 🎯 PHASE 1: Data Intake & Sync Agent - COMPLETE
      // Phase 1 is ONLY data sync - NO detection, NO analysis, NO orchestration
      // Purpose: Build the "truth pipe" - raw operational datasets
      // Everything downstream (Phase 2+) relies on this data
      
      const summary = {
        userId,
        syncId,
        ordersCount: orders.length,
        claimsCount: Array.isArray(claims) ? claims.length : 0,
        feesCount: Array.isArray(fees) ? fees.length : 0,
        inventoryCount: inventory.length,
        shipmentsCount: shipments.length,
        returnsCount: returns.length,
        settlementsCount: settlements.length
      };
      
      logger.info('✅ Phase 1: Data Intake & Sync Agent completed successfully', {
        ...summary,
        note: 'Raw operational datasets saved to database. Ready for Phase 2 (detection/analysis).',
        phase: 1,
        dataType: 'RAW_OPERATIONAL_DATASETS'
      });
      
      // Send notification that Phase 1 is complete (raw data synced)
      try {
        await notificationService.createNotification({
          type: 'sync_complete' as any,
          user_id: userId,
          title: 'Phase 1: Data Sync Complete',
          message: `Synced ${orders.length} orders, ${Array.isArray(claims) ? claims.length : 0} claims, ${Array.isArray(fees) ? fees.length : 0} fees, ${inventory.length} inventory items from last 18 months`,
          priority: 'medium' as any,
          channel: 'in_app' as any,
          payload: { 
            syncId,
            phase: 1,
            ...summary
          },
          immediate: false,
        });
      } catch (notifError: any) {
        logger.warn('Failed to send Phase 1 completion notification', { error: notifError.message });
      }

      logger.info('Amazon sync completed successfully', { userId, syncId });
      return syncId;
    } catch (error: any) {
      logger.error('Error during Amazon sync', { userId, syncId, error: error?.message });
      if (error.status === 401) {
        await notificationService.createNotification({
          type: 'integration_warning' as any,
          user_id: userId,
          title: 'Amazon connection needs attention',
          message: 'Your Amazon connection appears to be revoked or expired. Please reconnect to continue syncing.',
          priority: 'high' as any,
          channel: 'in_app' as any,
          payload: { provider: 'amazon' },
          immediate: true,
        });
      }
      return syncId;
    }
  }

  private async saveClaimsToDatabase(userId: string, claims: any[]): Promise<void> {
    try {
      logger.info('Saving Amazon claims to database', { userId, count: claims.length });
      
      if (claims.length === 0) {
        logger.info('No claims to save', { userId });
        return;
      }

      // Prepare claims for database insertion
      const claimsToInsert: any[] = [];
      
      for (const claim of claims) {
        // Map claim type to database enum values
        const claimTypeMap: Record<string, string> = {
          'liquidation_reimbursement': 'reimbursement',
          'adjustment_reimbursement': 'reimbursement',
          'reimbursement': 'reimbursement',
          'refund': 'refund',
          'adjustment': 'adjustment',
          'dispute': 'dispute'
        };

        const claimType = claimTypeMap[claim.type] || 'reimbursement';
        
        // Map status to database enum values
        const statusMap: Record<string, string> = {
          'approved': 'approved',
          'pending': 'pending',
          'rejected': 'rejected',
          'processing': 'processing',
          'completed': 'completed'
        };

        const status = statusMap[claim.status] || 'pending';

        const dbClaim: any = {
          user_id: userId,
          claim_type: claimType,
          provider: 'amazon',
          reference_id: claim.orderId || claim.id,
          amount: parseFloat(claim.amount) || 0,
          currency: claim.currency || 'USD',
          status: status,
          reason: claim.description || claim.type || 'Amazon reimbursement',
          evidence: claim.fromApi ? ['SP-API'] : [],
          submitted_at: claim.createdAt ? new Date(claim.createdAt).toISOString() : new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Add notes if available
        if (claim.orderId) {
          dbClaim.notes = `Order ID: ${claim.orderId}`;
        }

        claimsToInsert.push(dbClaim);
      }

      // Check for existing claims to avoid duplicates
      const referenceIds = claimsToInsert.map(c => c.reference_id).filter(Boolean);
      if (referenceIds.length > 0) {
        const { data: existingClaims, error: fetchError } = await supabase
          .from('claims')
          .select('reference_id')
          .eq('user_id', userId)
          .in('reference_id', referenceIds);

        if (fetchError) {
          logger.warn('Error fetching existing claims, proceeding with inserts', { error: fetchError, userId });
        } else {
          const existingRefIds = new Set(existingClaims?.map((c: any) => c.reference_id) || []);
          const filteredClaims = claimsToInsert.filter(c => !existingRefIds.has(c.reference_id));
          
          if (filteredClaims.length < claimsToInsert.length) {
            logger.info('Filtered out duplicate claims', { 
              userId, 
              total: claimsToInsert.length, 
              new: filteredClaims.length,
              duplicates: claimsToInsert.length - filteredClaims.length
            });
          }
          
          // Only insert new claims
          if (filteredClaims.length > 0) {
            const { error: insertError } = await supabase
              .from('claims')
              .insert(filteredClaims);

            if (insertError) {
              logger.error('Error inserting claims', { error: insertError, userId, count: filteredClaims.length });
              throw new Error(`Failed to insert claims: ${insertError.message}`);
            }
            
            logger.info('Amazon claims saved to database successfully', { 
              userId, 
              inserted: filteredClaims.length,
              total: claimsToInsert.length
            });
          } else {
            logger.info('All claims already exist in database', { userId, count: claimsToInsert.length });
          }
          
          return;
        }
      }

      // Insert all claims if no existing check or if check failed
      const { error: insertError } = await supabase
        .from('claims')
        .insert(claimsToInsert);

      if (insertError) {
        logger.error('Error inserting claims', { error: insertError, userId, count: claimsToInsert.length });
        throw new Error(`Failed to insert claims: ${insertError.message}`);
      }
      
      logger.info('Amazon claims saved to database successfully', { 
        userId, 
        inserted: claimsToInsert.length
      });
    } catch (error: any) {
      logger.error('Error saving Amazon claims to database', { error: error.message, userId });
      throw error;
    }
  }

  private async saveInventoryToDatabase(userId: string, inventory: any[]): Promise<void> {
    try {
      logger.info('Saving Amazon inventory to database', { userId, count: inventory.length });
      
      if (inventory.length === 0) {
        logger.info('No inventory items to save', { userId });
        return;
      }

      // Save to Supabase inventory_items table
      // First, get existing items to update vs create
      const { data: existingItems, error: fetchError } = await supabase
        .from('inventory_items')
        .select('sku')
        .eq('user_id', userId);

      if (fetchError) {
        logger.warn('Error fetching existing inventory items, proceeding with inserts', { error: fetchError, userId });
      }

      const existingSkus = new Set(existingItems?.map((item: any) => item.sku) || []);
      const itemsToInsert: any[] = [];
      const itemsToUpdate: any[] = [];

      // Prepare inventory items for database
      for (const item of inventory) {
        // Store additional Amazon-specific data in dimensions JSONB field
        const dimensionsData: any = {
          asin: item.asin,
          fnSku: item.fnSku,
          condition: item.condition,
          location: item.location || 'FBA',
          damaged: item.damaged || 0,
          lastUpdated: item.lastUpdated,
          source: 'amazon',
          syncedAt: new Date().toISOString()
        };

        const dbItem: any = {
          user_id: userId,
          sku: item.sku,
          quantity_available: item.quantity || 0,
          quantity_reserved: item.reserved || 0,
          quantity_shipped: 0,
          is_active: item.status === 'active',
          updated_at: new Date().toISOString(),
          // Store Amazon metadata in dimensions JSONB field (if available)
          dimensions: Object.keys(dimensionsData).some(key => dimensionsData[key]) ? dimensionsData : null
        };

        if (existingSkus.has(item.sku)) {
          itemsToUpdate.push(dbItem);
        } else {
          itemsToInsert.push({
            ...dbItem,
            reorder_point: 10,
            reorder_quantity: 50,
            created_at: new Date().toISOString()
          });
        }
      }

      // Insert new items
      if (itemsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('inventory_items')
          .insert(itemsToInsert);

        if (insertError) {
          logger.error('Error inserting inventory items', { error: insertError, userId, count: itemsToInsert.length });
          throw new Error(`Failed to insert inventory items: ${insertError.message}`);
        }
        logger.info('Inserted new inventory items', { userId, count: itemsToInsert.length });
      }

      // Update existing items
      for (const item of itemsToUpdate) {
        const updateData: any = {
          quantity_available: item.quantity_available,
          quantity_reserved: item.quantity_reserved,
          is_active: item.is_active,
          updated_at: item.updated_at
        };
        
        // Include dimensions if it exists
        if (item.dimensions) {
          updateData.dimensions = item.dimensions;
        }

        const { error: updateError } = await supabase
          .from('inventory_items')
          .update(updateData)
          .eq('user_id', userId)
          .eq('sku', item.sku);

        if (updateError) {
          logger.error('Error updating inventory item', { error: updateError, userId, sku: item.sku });
          // Continue with other items even if one fails
        }
      }

      if (itemsToUpdate.length > 0) {
        logger.info('Updated existing inventory items', { userId, count: itemsToUpdate.length });
      }
      
      logger.info('Amazon inventory saved to database successfully', { 
        userId, 
        total: inventory.length,
        inserted: itemsToInsert.length,
        updated: itemsToUpdate.length
      });
    } catch (error: any) {
      logger.error('Error saving Amazon inventory to database', { error: error.message, userId });
      throw error;
    }
  }

  private async saveFeesToDatabase(userId: string, fees: any[]): Promise<void> {
    try {
      logger.info('Saving Amazon fees to database', { userId, count: fees.length });
      
      if (fees.length === 0) {
        logger.info('No fees to save', { userId });
        return;
      }

      // Fees are already being saved via ingestFinancialEvents() which saves to financial_events table
      // This method can be used for additional fee aggregation or summary storage if needed
      // For now, we'll ensure fees are properly saved to financial_events via ingestFinancialEvents
      
      // Prepare fees for financial_events table
      const financialEventsToInsert: any[] = [];
      
      for (const fee of fees) {
        const financialEvent: any = {
          seller_id: userId,
          event_type: 'fee',
          amount: parseFloat(fee.amount) || 0,
          currency: fee.currency || 'USD',
          raw_payload: {
            type: fee.type,
            orderId: fee.orderId,
            sku: fee.sku,
            asin: fee.asin,
            description: fee.description,
            fromApi: fee.fromApi || false
          },
          amazon_event_id: fee.eventId || `FEE-${fee.orderId || Date.now()}`,
          amazon_order_id: fee.orderId,
          amazon_sku: fee.sku,
          event_date: fee.date ? new Date(fee.date).toISOString() : new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        financialEventsToInsert.push(financialEvent);
      }

      // Check for existing events to avoid duplicates
      const eventIds = financialEventsToInsert.map(e => e.amazon_event_id).filter(Boolean);
      if (eventIds.length > 0) {
        const { data: existingEvents, error: fetchError } = await supabase
          .from('financial_events')
          .select('amazon_event_id')
          .eq('seller_id', userId)
          .eq('event_type', 'fee')
          .in('amazon_event_id', eventIds);

        if (fetchError) {
          logger.warn('Error fetching existing financial events, proceeding with inserts', { error: fetchError, userId });
        } else {
          const existingEventIds = new Set(existingEvents?.map((e: any) => e.amazon_event_id) || []);
          const filteredEvents = financialEventsToInsert.filter(e => !existingEventIds.has(e.amazon_event_id));
          
          if (filteredEvents.length < financialEventsToInsert.length) {
            logger.info('Filtered out duplicate fee events', { 
              userId, 
              total: financialEventsToInsert.length, 
              new: filteredEvents.length,
              duplicates: financialEventsToInsert.length - filteredEvents.length
            });
          }
          
          // Only insert new events
          if (filteredEvents.length > 0) {
            const { error: insertError } = await supabase
              .from('financial_events')
              .insert(filteredEvents);

            if (insertError) {
              logger.error('Error inserting fee events', { error: insertError, userId, count: filteredEvents.length });
              // Don't throw - fees are also saved via ingestFinancialEvents
              logger.warn('Fee events insert failed, but ingestFinancialEvents will handle it', { userId });
            } else {
              logger.info('Amazon fees saved to financial_events table', { 
                userId, 
                inserted: filteredEvents.length,
                total: financialEventsToInsert.length
              });
            }
          } else {
            logger.info('All fee events already exist in database', { userId, count: financialEventsToInsert.length });
          }
          
          return;
        }
      }

      // Insert all events if no existing check or if check failed
      const { error: insertError } = await supabase
        .from('financial_events')
        .insert(financialEventsToInsert);

      if (insertError) {
        logger.error('Error inserting fee events', { error: insertError, userId, count: financialEventsToInsert.length });
        // Don't throw - fees are also saved via ingestFinancialEvents
        logger.warn('Fee events insert failed, but ingestFinancialEvents will handle it', { userId });
      } else {
        logger.info('Amazon fees saved to financial_events table successfully', { 
          userId, 
          inserted: financialEventsToInsert.length
        });
      }
    } catch (error: any) {
      logger.error('Error saving Amazon fees to database', { error: error.message, userId });
      // Don't throw - this is not critical as ingestFinancialEvents handles it
      logger.warn('Fee save failed, but ingestFinancialEvents will handle it', { userId });
    }
  }

  /**
   * Ingest financial events from Amazon data
   */
  private async ingestFinancialEvents(userId: string, fees: any[]): Promise<void> {
    try {
      logger.info('Ingesting financial events', { userId, fees_count: fees.length });

      const financialEvents = fees.map(fee => ({
        seller_id: userId,
        event_type: 'fee' as const,
        amount: fee.amount || 0,
        currency: fee.currency || 'USD',
        raw_payload: fee,
        amazon_event_id: fee.eventId,
        amazon_order_id: fee.orderId,
        amazon_sku: fee.sku,
        event_date: fee.eventDate ? new Date(fee.eventDate) : new Date()
      }));

      if (financialEvents.length > 0) {
        await financialEventsService.ingestEvents(financialEvents);
        
        // Archive to S3
        for (const event of financialEvents) {
          await financialEventsService.archiveToS3(event);
        }
      }

      logger.info('Financial events ingested successfully', { 
        userId, 
        events_count: financialEvents.length 
      });
    } catch (error) {
      logger.error('Error ingesting financial events', { error, userId });
      // Don't throw error as financial events ingestion is not critical for sync
    }
  }

  /**
   * Trigger detection job after sync completion
   */
  private async triggerDetectionJob(userId: string, syncId: string): Promise<void> {
    try {
      const isSandbox = process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox') || 
                        process.env.NODE_ENV === 'development';
      
      logger.info('Triggering detection job (SANDBOX MODE)', { 
        userId, 
        syncId,
        isSandbox,
        mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
      });

      const detectionJob = {
        seller_id: userId,
        sync_id: syncId,
        timestamp: new Date().toISOString(),
        is_sandbox: isSandbox
      };

      await detectionService.enqueueDetectionJob(detectionJob);

      logger.info('Detection job triggered successfully (SANDBOX MODE)', { 
        userId, 
        syncId,
        isSandbox,
        mode: isSandbox ? 'SANDBOX' : 'PRODUCTION'
      });
    } catch (error) {
      logger.error('Error triggering detection job', { error, userId, syncId });
      // Don't throw error as detection is not critical for sync
    }
  }

  async syncAllUsers(): Promise<void> {
    if (this.isRunning) {
      logger.info('Amazon sync job already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Starting Amazon sync job for all users');

      // TODO: Get all users with Amazon integration
      // This is a stub implementation
      const usersWithAmazon = await this.getUsersWithAmazonIntegration();

      for (const userId of usersWithAmazon) {
        await this.syncUserData(userId);
        // Add delay between users to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('Amazon sync job completed for all users');
    } catch (error) {
      logger.error('Error in Amazon sync job', { error });
    } finally {
      this.isRunning = false;
    }
  }

  private async getUsersWithAmazonIntegration(): Promise<string[]> {
    try {
      logger.info('Fetching users with Amazon integration');
      
      // Query users table or integration_tokens table to find users with Amazon tokens
      // Using tokenManager to check for users with valid Amazon tokens
      const { data: tokens, error } = await supabase
        .from('integration_tokens')
        .select('user_id')
        .eq('provider', 'amazon')
        .eq('is_active', true);

      if (error) {
        logger.error('Error fetching users with Amazon integration', { error });
        // Fallback: try users table if integration_tokens doesn't exist
        const { data: users, error: userError } = await supabase
          .from('users')
          .select('id')
          .limit(100); // Limit to prevent too many users

        if (userError) {
          logger.error('Error fetching users as fallback', { error: userError });
          return [];
        }

        const userIds = (users || []).map((u: any) => u.id || u.user_id).filter(Boolean);
        logger.info('Found users with Amazon integration (fallback)', { count: userIds.length });
        return userIds;
      }

      const userIds = (tokens || []).map((t: any) => t.user_id).filter(Boolean);
      
      logger.info('Found users with Amazon integration', { count: userIds.length });
      return userIds;
    } catch (error: any) {
      logger.error('Error fetching users with Amazon integration', { error: error.message });
      return [];
    }
  }

  startScheduledSync(): void {
    // Run every hour
    cron.schedule('0 * * * *', async () => {
      logger.info('Starting scheduled Amazon sync job');
      await this.syncAllUsers();
    });

    logger.info('Amazon sync job scheduled to run every hour');
  }

  stopScheduledSync(): void {
    // TODO: Implement job stopping mechanism
    logger.info('Amazon sync job stopped');
  }
}

export const amazonSyncJob = new AmazonSyncJob();
export default amazonSyncJob; 