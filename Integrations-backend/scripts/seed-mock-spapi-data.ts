#!/usr/bin/env ts-node
/**
 * Seed Mock SP-API Data
 * 
 * Populates Supabase with realistic Amazon SP-API data for testing.
 * This is the ONLY mock layer - all downstream processing uses real code.
 * 
 * Usage: npx ts-node scripts/seed-mock-spapi-data.ts
 * 
 * Options:
 *   --clean     Clear existing data before seeding
 *   --scenario  Choose scenario: normal_week, high_volume, with_issues, realistic
 *   --count     Number of base records (default: 500)
 */

import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';
import { MockDataGenerator, createMockDataGenerator, MockScenario } from '../src/services/mockDataGenerator';

// Parse command line args
const args = process.argv.slice(2);
const cleanMode = args.includes('--clean');
const scenarioArg = args.find(a => a.startsWith('--scenario='))?.split('=')[1] as MockScenario || 'with_issues';
const countArg = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '500');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test user ID for seeding - must be a valid UUID
// This UUID is randomly generated for testing purposes
const TEST_USER_ID = process.env.TEST_USER_ID || '00000000-0000-0000-0000-000000000001';

interface SeedStats {
    orders: number;
    shipments: number;
    returns: number;
    settlements: number;
    financialEvents: number;
    inventoryAdjustments: number;
    discrepanciesInjected: number;
    errors: string[];
}

async function clearExistingData(): Promise<void> {
    console.log('🧹 Clearing existing mock data...');

    const tables = [
        'orders',
        'shipments',
        'returns',
        'settlements',
        'financial_events',
        'inventory',
        'detection_results',
        'detection_queue',
        'claims'
    ];

    for (const table of tables) {
        try {
            const { error } = await supabase
                .from(table)
                .delete()
                .eq('user_id', TEST_USER_ID);

            if (error && !error.message.includes('does not exist')) {
                console.log(`  ⚠️ ${table}: ${error.message}`);
            } else {
                console.log(`  ✓ ${table} cleared`);
            }
        } catch (e: any) {
            // Try with seller_id instead
            try {
                const { error } = await supabase
                    .from(table)
                    .delete()
                    .eq('seller_id', TEST_USER_ID);

                if (!error) {
                    console.log(`  ✓ ${table} cleared (seller_id)`);
                }
            } catch (e2) {
                console.log(`  ⚠️ ${table}: skipped`);
            }
        }
    }
}

async function seedOrders(generator: MockDataGenerator, stats: SeedStats): Promise<any[]> {
    console.log('\n📦 Seeding Orders...');

    const ordersData = generator.generateOrders();
    const orders = ordersData.payload.Orders;

    const dbOrders = orders.map((order: any, idx: number) => ({
        user_id: TEST_USER_ID,
        order_id: order.AmazonOrderId,
        seller_id: order.SellerId,
        marketplace_id: order.MarketplaceId,
        order_date: order.PurchaseDate,
        shipment_date: order.EarliestShipDate,
        fulfillment_channel: order.FulfillmentChannel,
        order_status: order.OrderStatus,
        items: order.OrderItems || [],
        total_amount: order.OrderTotal?.Amount || 0,
        currency: order.OrderTotal?.CurrencyCode || 'USD',
        metadata: { mockGenerated: true, scenario: generator.scenario },
        is_sandbox: true,
        sync_timestamp: new Date().toISOString()
    }));

    // Insert in batches of 50
    const batchSize = 50;
    for (let i = 0; i < dbOrders.length; i += batchSize) {
        const batch = dbOrders.slice(i, i + batchSize);
        const { error } = await supabase.from('orders').upsert(batch, { onConflict: 'user_id,order_id' });
        if (error) {
            stats.errors.push(`Orders batch ${i}: ${error.message}`);
        }
    }

    stats.orders = orders.length;
    console.log(`  ✓ ${orders.length} orders seeded`);

    return orders;
}

async function seedShipments(generator: MockDataGenerator, orders: any[], stats: SeedStats): Promise<void> {
    console.log('\n🚚 Seeding Shipments...');

    const shipmentsData = generator.generateShipments(orders);
    const shipments = shipmentsData.payload.shipments;

    const dbShipments = shipments.map((shipment: any) => {
        // 5% discrepancy: missing quantity
        const hasDiscrepancy = Math.random() < 0.05;
        const expectedQty = shipment.expected_quantity || Math.floor(Math.random() * 20) + 1;
        const receivedQty = hasDiscrepancy
            ? Math.max(0, expectedQty - Math.floor(Math.random() * 5) - 1)
            : expectedQty;

        if (hasDiscrepancy) {
            stats.discrepanciesInjected++;
        }

        return {
            user_id: TEST_USER_ID,
            shipment_id: shipment.shipment_id,
            order_id: shipment.order_id,
            tracking_number: shipment.tracking_number,
            shipped_date: shipment.shipped_date,
            received_date: shipment.received_date,
            status: hasDiscrepancy ? 'discrepancy' : shipment.status,
            carrier: shipment.carrier,
            warehouse_location: shipment.warehouse_location,
            items: shipment.items || [],
            expected_quantity: expectedQty,
            received_quantity: receivedQty,
            missing_quantity: expectedQty - receivedQty,
            metadata: { mockGenerated: true, hasDiscrepancy },
            is_sandbox: true,
            sync_timestamp: new Date().toISOString()
        };
    });

    const batchSize = 50;
    for (let i = 0; i < dbShipments.length; i += batchSize) {
        const batch = dbShipments.slice(i, i + batchSize);
        const { error } = await supabase.from('shipments').upsert(batch, { onConflict: 'user_id,shipment_id' });
        if (error) {
            stats.errors.push(`Shipments batch ${i}: ${error.message}`);
        }
    }

    stats.shipments = shipments.length;
    console.log(`  ✓ ${shipments.length} shipments seeded (${stats.discrepanciesInjected} with discrepancies)`);
}

async function seedReturns(generator: MockDataGenerator, orders: any[], stats: SeedStats): Promise<void> {
    console.log('\n↩️ Seeding Returns...');

    const returnsData = generator.generateReturns(orders);
    const returns = returnsData.payload.returns;

    const dbReturns = returns.map((ret: any) => {
        // 5% discrepancy: refunded but item "lost" (not restocked)
        const hasDiscrepancy = Math.random() < 0.05;

        if (hasDiscrepancy) {
            stats.discrepanciesInjected++;
        }

        return {
            user_id: TEST_USER_ID,
            return_id: ret.return_id,
            order_id: ret.order_id,
            reason: ret.reason,
            returned_date: ret.returned_date,
            status: hasDiscrepancy ? 'refunded_not_restocked' : ret.status,
            refund_amount: ret.refund_amount,
            currency: ret.currency || 'USD',
            items: ret.items || [],
            is_partial: ret.is_partial || false,
            metadata: { mockGenerated: true, hasDiscrepancy },
            is_sandbox: true,
            sync_timestamp: new Date().toISOString()
        };
    });

    const batchSize = 50;
    for (let i = 0; i < dbReturns.length; i += batchSize) {
        const batch = dbReturns.slice(i, i + batchSize);
        const { error } = await supabase.from('returns').upsert(batch, { onConflict: 'user_id,return_id' });
        if (error) {
            stats.errors.push(`Returns batch ${i}: ${error.message}`);
        }
    }

    stats.returns = returns.length;
    console.log(`  ✓ ${returns.length} returns seeded`);
}

async function seedFinancialEvents(generator: MockDataGenerator, stats: SeedStats): Promise<void> {
    console.log('\n💰 Seeding Financial Events (64 types)...');

    const financialData = generator.generateFinancialEvents();
    const events = financialData.payload.FinancialEvents;

    // Combine all event types
    const allEvents: any[] = [
        ...(events.AdjustmentEventList || []),
        ...(events.FBALiquidationEventList || []),
        ...(events.ServiceFeeEventList || []),
        ...(events.OrderEventList || [])
    ];

    const dbEvents = allEvents.map((event: any) => {
        // 5% discrepancy: fee overcharge or missing reimbursement
        const hasDiscrepancy = Math.random() < 0.05;

        if (hasDiscrepancy) {
            stats.discrepanciesInjected++;
        }

        // Determine event type for DB
        let eventType = 'fee';
        if (event.AdjustmentType?.includes('Reimbursement') || event.AdjustmentType?.includes('Recovery')) {
            eventType = 'reimbursement';
        } else if (event.AdjustmentType?.includes('Return') || event.AdjustmentType?.includes('Refund')) {
            eventType = 'return';
        } else if (event.AdjustmentType?.includes('Shipment') || event.AdjustmentType?.includes('FBA')) {
            eventType = 'shipment';
        }

        return {
            seller_id: TEST_USER_ID,
            event_type: eventType,
            amount: hasDiscrepancy
                ? Math.abs(event.Amount?.Amount || event.TotalAmount || 0) * 1.1 // 10% overcharge
                : Math.abs(event.Amount?.Amount || event.TotalAmount || 0),
            currency: event.Amount?.CurrencyCode || 'USD',
            raw_payload: {
                ...event,
                mockGenerated: true,
                hasDiscrepancy,
                adjustmentType: event.AdjustmentType || event.EventType
            },
            amazon_event_id: event.AmazonEventId || `EVENT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            amazon_order_id: event.AmazonOrderId,
            amazon_sku: event.SKU,
            event_date: event.PostedDate || new Date().toISOString()
        };
    });

    const batchSize = 50;
    for (let i = 0; i < dbEvents.length; i += batchSize) {
        const batch = dbEvents.slice(i, i + batchSize);
        const { error } = await supabase.from('financial_events').insert(batch);
        if (error) {
            stats.errors.push(`Financial events batch ${i}: ${error.message}`);
        }
    }

    stats.financialEvents = allEvents.length;
    console.log(`  ✓ ${allEvents.length} financial events seeded (64 types covered)`);
}

async function seedSettlements(generator: MockDataGenerator, stats: SeedStats): Promise<void> {
    console.log('\n📊 Seeding Settlements...');

    const settlementsData = generator.generateSettlements();
    const settlements = settlementsData.payload.settlements;

    const dbSettlements = settlements.map((settlement: any) => ({
        user_id: TEST_USER_ID,
        settlement_id: settlement.settlement_id,
        order_id: settlement.order_id,
        transaction_type: settlement.transaction_type,
        amount: settlement.amount,
        fees: settlement.fees || 0,
        currency: settlement.currency || 'USD',
        settlement_date: settlement.settlement_date,
        fee_breakdown: settlement.fee_breakdown || {},
        metadata: { mockGenerated: true },
        is_sandbox: true,
        sync_timestamp: new Date().toISOString()
    }));

    const batchSize = 50;
    for (let i = 0; i < dbSettlements.length; i += batchSize) {
        const batch = dbSettlements.slice(i, i + batchSize);
        const { error } = await supabase.from('settlements').upsert(batch, { onConflict: 'user_id,settlement_id,transaction_type' });
        if (error) {
            stats.errors.push(`Settlements batch ${i}: ${error.message}`);
        }
    }

    stats.settlements = settlements.length;
    console.log(`  ✓ ${settlements.length} settlements seeded`);
}

async function printSummary(stats: SeedStats): Promise<void> {
    console.log('\n' + '='.repeat(50));
    console.log('📈 SEED SUMMARY');
    console.log('='.repeat(50));
    console.log(`  Orders:           ${stats.orders}`);
    console.log(`  Shipments:        ${stats.shipments}`);
    console.log(`  Returns:          ${stats.returns}`);
    console.log(`  Settlements:      ${stats.settlements}`);
    console.log(`  Financial Events: ${stats.financialEvents}`);
    console.log(`  ---`);
    console.log(`  Total Records:    ${stats.orders + stats.shipments + stats.returns + stats.settlements + stats.financialEvents}`);
    console.log(`  Discrepancies:    ${stats.discrepanciesInjected} (~5% of records)`);

    if (stats.errors.length > 0) {
        console.log('\n⚠️ Errors:');
        stats.errors.forEach(err => console.log(`  - ${err}`));
    }

    console.log('\n✅ Mock SP-API data seeded successfully!');
    console.log('   Next: Run a sync to trigger Agent 2 + 3 detection');
    console.log('   Command: curl -X POST http://localhost:3001/api/sync/start');
}

async function main(): Promise<void> {
    console.log('🚀 Mock SP-API Data Seeder');
    console.log('='.repeat(50));
    console.log(`  Scenario:  ${scenarioArg}`);
    console.log(`  Records:   ${countArg}`);
    console.log(`  User ID:   ${TEST_USER_ID}`);
    console.log(`  Clean:     ${cleanMode}`);
    console.log('='.repeat(50));

    const stats: SeedStats = {
        orders: 0,
        shipments: 0,
        returns: 0,
        settlements: 0,
        financialEvents: 0,
        inventoryAdjustments: 0,
        discrepanciesInjected: 0,
        errors: []
    };

    try {
        // Clear existing data if requested
        if (cleanMode) {
            await clearExistingData();
        }

        // Create generator with specified scenario
        const generator = createMockDataGenerator(scenarioArg, countArg);

        // Seed each data type
        const orders = await seedOrders(generator, stats);
        await seedShipments(generator, orders, stats);
        await seedReturns(generator, orders, stats);
        await seedFinancialEvents(generator, stats);
        await seedSettlements(generator, stats);

        // Print summary
        await printSummary(stats);

    } catch (error: any) {
        console.error('\n❌ Fatal error:', error.message);
        process.exit(1);
    }
}

main();
