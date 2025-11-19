/**
 * View synced data from Agent 2 (Data Ingestion + Data Sync)
 * 
 * This script displays all data that was synced and ingested by Agent 2:
 * - Orders
 * - Shipments
 * - Returns
 * - Settlements
 * - Inventory
 * - Claims
 * 
 * Run with: npx ts-node scripts/view-synced-data.ts [userId]
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import logger from '../src/utils/logger';

const USER_ID_OR_SELLER_ID = process.argv[2] || 'demo-user';

async function viewSyncedData() {
  console.log('🔍 Viewing synced data from Agent 2\n');
  console.log(`Looking for user/seller: ${USER_ID_OR_SELLER_ID}\n`);
  console.log('=' .repeat(60));

  // First, find the user ID if a seller_id was provided
  let USER_ID = USER_ID_OR_SELLER_ID;
  
  // Check if it's a seller_id (non-UUID format)
  if (!USER_ID_OR_SELLER_ID.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    console.log('📋 Looking up user...\n');
    
    // First, check recent syncs to find users with data
    const { data: recentSyncs } = await supabaseAdmin
      .from('sync_progress')
      .select('user_id, sync_id, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (recentSyncs && recentSyncs.length > 0) {
      // If looking for "demo-user", try to match by sync_id pattern
      if (USER_ID_OR_SELLER_ID === 'demo-user' || USER_ID_OR_SELLER_ID.includes('demo')) {
        const demoSync = recentSyncs.find(s => s.sync_id?.includes('demo-user'));
        if (demoSync) {
          USER_ID = demoSync.user_id;
          console.log(`   ✅ Found demo-user from recent syncs`);
          console.log(`   User ID: ${USER_ID}`);
          console.log(`   Sync ID: ${demoSync.sync_id}\n`);
        } else {
          // Use first recent sync
          USER_ID = recentSyncs[0].user_id;
          console.log(`   ⚠️  Using user from most recent sync:`);
          console.log(`   User ID: ${USER_ID}`);
          console.log(`   Sync ID: ${recentSyncs[0].sync_id}\n`);
        }
      } else {
        // Try to find by seller_id in users table
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('id, email, amazon_seller_id')
          .like('amazon_seller_id', `${USER_ID_OR_SELLER_ID}%`)
          .limit(5);
        
        if (users && users.length > 0) {
          USER_ID = users[0].id;
          console.log(`   ✅ Found user: ${users[0].email || 'N/A'}`);
          console.log(`   User ID: ${USER_ID}`);
          console.log(`   Seller ID: ${users[0].amazon_seller_id || 'N/A'}\n`);
        } else {
          // Use first recent sync
          USER_ID = recentSyncs[0].user_id;
          console.log(`   ⚠️  User not found, using user from most recent sync:`);
          console.log(`   User ID: ${USER_ID}`);
          console.log(`   Sync ID: ${recentSyncs[0].sync_id}\n`);
        }
      }
    } else {
      // No syncs found, try users table directly
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, email, amazon_seller_id')
        .ilike('amazon_seller_id', `${USER_ID_OR_SELLER_ID}%`)
        .limit(1);
      
      if (users && users.length > 0) {
        USER_ID = users[0].id;
        console.log(`   ✅ Found user: ${users[0].email || 'N/A'}`);
        console.log(`   User ID: ${USER_ID}\n`);
      } else {
        console.log('   ⚠️  User not found. Listing recent syncs to find users with data...\n');
        
        // Show recent syncs
        if (recentSyncs && recentSyncs.length > 0) {
          console.log('   Recent syncs:');
          recentSyncs.slice(0, 5).forEach((sync, i) => {
            console.log(`   ${i + 1}. User: ${sync.user_id.substring(0, 8)}... (Sync: ${sync.sync_id?.substring(0, 20)}...)`);
          });
          USER_ID = recentSyncs[0].user_id;
          console.log(`\n   Using first sync's user: ${USER_ID}\n`);
        } else {
          console.log('   ⚠️  No syncs found. Cannot determine user ID.\n');
          return;
        }
      }
    }
  }
  
  console.log(`Using User ID: ${USER_ID}\n`);

  try {
    // 1. Orders (try both seller_id and user_id)
    console.log('\n📦 ORDERS:');
    console.log('-'.repeat(60));
    let orders: any[] = [];
    let ordersError: any = null;
    
    // Try seller_id first (non-UUID format)
    if (!USER_ID.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const { data: ordersBySeller, error: sellerError } = await supabaseAdmin
        .from('orders')
        .select('order_id, order_date, order_status, total_amount, currency, fulfillment_channel, items, sync_timestamp')
        .eq('seller_id', USER_ID)
        .order('order_date', { ascending: false })
        .limit(10);
      
      if (!sellerError && ordersBySeller) {
        orders = ordersBySeller;
      } else {
        ordersError = sellerError;
      }
    } else {
      // Try user_id (UUID format)
      const { data: ordersByUser, error: userError } = await supabaseAdmin
        .from('orders')
        .select('order_id, order_date, order_status, total_amount, currency, fulfillment_channel, items, sync_timestamp')
        .eq('user_id', USER_ID)
        .order('order_date', { ascending: false })
        .limit(10);
      
      if (!userError && ordersByUser) {
        orders = ordersByUser;
      } else {
        ordersError = userError;
      }
    }

    if (ordersError) {
      console.log(`   ⚠️  Error: ${ordersError.message}`);
    } else if (orders && orders.length > 0) {
      console.log(`   ✅ Found ${orders.length} orders (showing latest 10):\n`);
      orders.forEach((order, index) => {
        console.log(`   ${index + 1}. Order ID: ${order.order_id}`);
        console.log(`      Date: ${order.order_date || 'N/A'}`);
        console.log(`      Status: ${order.order_status || 'N/A'}`);
        console.log(`      Amount: ${order.currency || 'USD'} ${order.total_amount || 0}`);
        console.log(`      Channel: ${order.fulfillment_channel || 'N/A'}`);
        if (order.items && Array.isArray(order.items)) {
          console.log(`      Items: ${order.items.length} item(s)`);
        }
        console.log(`      Synced: ${order.sync_timestamp || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  No orders found');
    }

    // Get total count
    const { count: ordersCount } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', USER_ID);
    console.log(`   📊 Total orders in database: ${ordersCount || 0}`);

    // 2. Shipments
    console.log('\n🚚 SHIPMENTS:');
    console.log('-'.repeat(60));
    const { data: shipments, error: shipmentsError } = await supabaseAdmin
      .from('shipments')
      .select('shipment_id, order_id, status, shipped_date, received_date, carrier, expected_quantity, received_quantity, sync_timestamp')
      .eq('user_id', USER_ID)
      .order('shipped_date', { ascending: false })
      .limit(10);

    if (shipmentsError) {
      console.error('   ❌ Error:', shipmentsError.message);
    } else if (shipments && shipments.length > 0) {
      console.log(`   ✅ Found ${shipments.length} shipments (showing latest 10):\n`);
      shipments.forEach((shipment, index) => {
        console.log(`   ${index + 1}. Shipment ID: ${shipment.shipment_id}`);
        console.log(`      Order ID: ${shipment.order_id || 'N/A'}`);
        console.log(`      Status: ${shipment.status || 'N/A'}`);
        console.log(`      Shipped: ${shipment.shipped_date || 'N/A'}`);
        console.log(`      Received: ${shipment.received_date || 'N/A'}`);
        console.log(`      Carrier: ${shipment.carrier || 'N/A'}`);
        console.log(`      Quantity: ${shipment.received_quantity || 0} / ${shipment.expected_quantity || 0}`);
        console.log(`      Synced: ${shipment.sync_timestamp || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  No shipments found');
    }

    const { count: shipmentsCount } = await supabaseAdmin
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', USER_ID);
    console.log(`   📊 Total shipments in database: ${shipmentsCount || 0}`);

    // 3. Returns
    console.log('\n↩️  RETURNS:');
    console.log('-'.repeat(60));
    const { data: returns, error: returnsError } = await supabaseAdmin
      .from('returns')
      .select('return_id, order_id, reason, returned_date, status, refund_amount, currency, sync_timestamp')
      .eq('user_id', USER_ID)
      .order('returned_date', { ascending: false })
      .limit(10);

    if (returnsError) {
      console.error('   ❌ Error:', returnsError.message);
    } else if (returns && returns.length > 0) {
      console.log(`   ✅ Found ${returns.length} returns (showing latest 10):\n`);
      returns.forEach((returnItem, index) => {
        console.log(`   ${index + 1}. Return ID: ${returnItem.return_id}`);
        console.log(`      Order ID: ${returnItem.order_id || 'N/A'}`);
        console.log(`      Reason: ${returnItem.reason || 'N/A'}`);
        console.log(`      Date: ${returnItem.returned_date || 'N/A'}`);
        console.log(`      Status: ${returnItem.status || 'N/A'}`);
        console.log(`      Refund: ${returnItem.currency || 'USD'} ${returnItem.refund_amount || 0}`);
        console.log(`      Synced: ${returnItem.sync_timestamp || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  No returns found');
    }

    const { count: returnsCount } = await supabaseAdmin
      .from('returns')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', USER_ID);
    console.log(`   📊 Total returns in database: ${returnsCount || 0}`);

    // 4. Settlements
    console.log('\n💰 SETTLEMENTS:');
    console.log('-'.repeat(60));
    const { data: settlements, error: settlementsError } = await supabaseAdmin
      .from('settlements')
      .select('settlement_id, order_id, transaction_type, amount, fees, currency, settlement_date, sync_timestamp')
      .eq('user_id', USER_ID)
      .order('settlement_date', { ascending: false })
      .limit(10);

    if (settlementsError) {
      console.error('   ❌ Error:', settlementsError.message);
    } else if (settlements && settlements.length > 0) {
      console.log(`   ✅ Found ${settlements.length} settlements (showing latest 10):\n`);
      settlements.forEach((settlement, index) => {
        console.log(`   ${index + 1}. Settlement ID: ${settlement.settlement_id}`);
        console.log(`      Order ID: ${settlement.order_id || 'N/A'}`);
        console.log(`      Type: ${settlement.transaction_type || 'N/A'}`);
        console.log(`      Amount: ${settlement.currency || 'USD'} ${settlement.amount || 0}`);
        console.log(`      Fees: ${settlement.currency || 'USD'} ${settlement.fees || 0}`);
        console.log(`      Date: ${settlement.settlement_date || 'N/A'}`);
        console.log(`      Synced: ${settlement.sync_timestamp || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  No settlements found');
    }

    const { count: settlementsCount } = await supabaseAdmin
      .from('settlements')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', USER_ID);
    console.log(`   📊 Total settlements in database: ${settlementsCount || 0}`);

    // 5. Inventory (try multiple table names)
    console.log('\n📊 INVENTORY:');
    console.log('-'.repeat(60));
    let inventory: any[] = [];
    let inventoryError: any = null;
    
    // Try inventory_items first
    const { data: invItems, error: invError1 } = await supabaseAdmin
      .from('inventory_items')
      .select('sku, asin, product_name, quantity_available, quantity_reserved, condition, warehouse_location, synced_at, updated_at')
      .eq('user_id', USER_ID)
      .order('updated_at', { ascending: false })
      .limit(10);
    
    if (!invError1 && invItems && invItems.length > 0) {
      inventory = invItems;
    } else {
      // Try amazon_inventory
      const { data: amazonInv, error: invError2 } = await supabaseAdmin
        .from('amazon_inventory')
        .select('sku, asin, product_name, quantity_available, quantity_reserved, condition, warehouse_location, synced_at')
        .eq('user_id', USER_ID)
        .order('synced_at', { ascending: false })
        .limit(10);
      
      if (!invError2 && amazonInv) {
        inventory = amazonInv;
        inventoryError = null;
      } else {
        inventoryError = invError2 || invError1;
      }
    }

    if (inventoryError) {
      console.log(`   ⚠️  Table not found or error: ${inventoryError.message}`);
    } else if (inventory && inventory.length > 0) {
      console.log(`   ✅ Found ${inventory.length} inventory items (showing latest 10):\n`);
      inventory.forEach((item, index) => {
        console.log(`   ${index + 1}. SKU: ${item.sku}`);
        console.log(`      ASIN: ${item.asin || 'N/A'}`);
        console.log(`      Product: ${item.product_name || item.title || 'N/A'}`);
        console.log(`      Available: ${item.quantity_available || 0}`);
        console.log(`      Reserved: ${item.quantity_reserved || 0}`);
        console.log(`      Condition: ${item.condition || 'N/A'}`);
        console.log(`      Warehouse: ${item.warehouse_location || 'N/A'}`);
        console.log(`      Synced: ${item.synced_at || item.updated_at || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  No inventory items found');
    }

    // Count from both tables
    const { count: invCount1 } = await supabaseAdmin
      .from('inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', USER_ID);
    const { count: invCount2 } = await supabaseAdmin
      .from('amazon_inventory')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', USER_ID);
    const inventoryCount = (invCount1 || 0) + (invCount2 || 0);
    console.log(`   📊 Total inventory items in database: ${inventoryCount}`);

    // 6. Claims (detection_results table - where Agent 3 stores detected claims)
    console.log('\n🎯 DETECTED CLAIMS (from Agent 3):');
    console.log('-'.repeat(60));
    const { data: detectedClaims, error: detectedError } = await supabaseAdmin
      .from('detection_results')
      .select('id, claim_id, order_id, amount, currency, status, anomaly_type, confidence_score, description, created_at')
      .eq('seller_id', USER_ID)
      .order('created_at', { ascending: false })
      .limit(10);

    if (detectedError) {
      console.log(`   ⚠️  Error or table not found: ${detectedError.message}`);
    } else if (detectedClaims && detectedClaims.length > 0) {
      console.log(`   ✅ Found ${detectedClaims.length} detected claims (showing latest 10):\n`);
      detectedClaims.forEach((claim, index) => {
        console.log(`   ${index + 1}. Claim ID: ${claim.claim_id || claim.id}`);
        console.log(`      Order ID: ${claim.order_id || 'N/A'}`);
        console.log(`      Amount: ${claim.currency || 'USD'} ${claim.amount || 0}`);
        console.log(`      Status: ${claim.status || 'N/A'}`);
        console.log(`      Type: ${claim.anomaly_type || 'N/A'}`);
        console.log(`      Confidence: ${(claim.confidence_score * 100).toFixed(1)}%`);
        console.log(`      Description: ${claim.description || 'N/A'}`);
        console.log(`      Created: ${claim.created_at || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  No detected claims found');
    }

    const { count: detectedCount } = await supabaseAdmin
      .from('detection_results')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', USER_ID);
    console.log(`   📊 Total detected claims in database: ${detectedCount || 0}`);
    
    // Also try amazon_claims table if it exists
    const { data: amazonClaims, error: amazonClaimsError } = await supabaseAdmin
      .from('amazon_claims')
      .select('claim_id, order_id, amount, currency, status, type, description, created_at, synced_at')
      .eq('user_id', USER_ID)
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (!amazonClaimsError && amazonClaims && amazonClaims.length > 0) {
      console.log(`\n   📋 Also found ${amazonClaims.length} raw claims from amazon_claims table:`);
      amazonClaims.forEach((claim, index) => {
        console.log(`   ${index + 1}. ${claim.claim_id} - ${claim.type || 'N/A'} - ${claim.currency || 'USD'} ${claim.amount || 0}`);
      });
    }

    // 7. Sync Progress (Recent syncs)
    console.log('\n🔄 RECENT SYNCS:');
    console.log('-'.repeat(60));
    const { data: syncs, error: syncsError } = await supabaseAdmin
      .from('sync_progress')
      .select('sync_id, status, progress, metadata, created_at, updated_at')
      .eq('user_id', USER_ID)
      .order('created_at', { ascending: false })
      .limit(5);

    if (syncsError) {
      console.error('   ❌ Error:', syncsError.message);
    } else if (syncs && syncs.length > 0) {
      console.log(`   ✅ Found ${syncs.length} recent syncs:\n`);
      syncs.forEach((sync, index) => {
        const metadata = (sync.metadata as any) || {};
        console.log(`   ${index + 1}. Sync ID: ${sync.sync_id}`);
        console.log(`      Status: ${sync.status || 'N/A'}`);
        console.log(`      Progress: ${sync.progress || 0}%`);
        if (metadata.ordersProcessed) {
          console.log(`      Orders: ${metadata.ordersProcessed} / ${metadata.totalOrders || 'N/A'}`);
        }
        if (metadata.claimsDetected) {
          console.log(`      Claims Detected: ${metadata.claimsDetected}`);
        }
        console.log(`      Created: ${sync.created_at || 'N/A'}`);
        console.log(`      Updated: ${sync.updated_at || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  No syncs found');
    }

    // Summary
    console.log('\n📊 SUMMARY:');
    console.log('='.repeat(60));
    console.log(`   Orders: ${ordersCount || 0}`);
    console.log(`   Shipments: ${shipmentsCount || 0}`);
    console.log(`   Returns: ${returnsCount || 0}`);
    console.log(`   Settlements: ${settlementsCount || 0}`);
    console.log(`   Inventory Items: ${inventoryCount || 0}`);
    console.log(`   Detected Claims: ${detectedCount || 0}`);
    console.log('\n✅ Data viewing complete!');

  } catch (error: any) {
    console.error('\n❌ Error viewing synced data:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  viewSyncedData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default viewSyncedData;

