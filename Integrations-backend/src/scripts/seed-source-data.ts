
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seedSourceData() {
    console.log('🌱 Starting source data seeding...');

    // 1. Fetch existing claims to base data on
    const { data: claims, error } = await supabase
        .from('detection_results')
        .select('*')
        .limit(500); // Seed data for 500 claims

    if (error || !claims) {
        console.error('Error fetching claims:', error);
        return;
    }

    console.log(`Found ${claims.length} claims. Generating source data...`);

    const orders = [];
    const shipments = [];
    const inventory = [];

    // Use a fixed valid UUID for demo data
    const DEMO_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    for (const claim of claims) {
        // Generate an Order for this claim
        const orderId = claim.order_id || `114-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 10000000)}`;
        const sku = claim.sku || `SKU-${Math.floor(Math.random() * 1000)}`;
        const amount = (Math.random() * 100) + 20;

        orders.push({
            order_id: orderId,
            user_id: DEMO_USER_ID,
            seller_id: claim.seller_id,
            marketplace_id: 'ATVPDKIKX0DER',
            order_date: new Date(new Date(claim.created_at).getTime() - 1000 * 60 * 60 * 24 * 30).toISOString(),
            fulfillment_channel: 'AFN',
            order_status: 'Shipped',
            total_amount: amount,
            currency: 'USD',
            items: [{
                sku: sku,
                quantity: 1,
                item_price: amount,
                title: `Product ${sku}`
            }],
            quantities: { [sku]: 1 },
            source_report: 'Seeded_From_Claims',
            sync_timestamp: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        // Generate a Shipment
        shipments.push({
            shipment_id: `SH-${Math.floor(Math.random() * 1000000)}`,
            user_id: DEMO_USER_ID,
            order_id: orderId,
            status: 'CLOSED',
            warehouse_location: 'JFK8',
            shipped_date: new Date(new Date(claim.created_at).getTime() - 1000 * 60 * 60 * 24 * 45).toISOString(),
            items: [{
                sku: sku,
                quantity: 10,
                price: amount
            }],
            expected_quantity: 10,
            received_quantity: 9,
            missing_quantity: 1,
            source_report: 'Seeded_From_Claims',
            sync_timestamp: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

        // Generate Inventory
        inventory.push({
            seller_id: claim.seller_id,
            sku: sku,
            fnsku: `FNSKU-${sku}`,
            asin: `B0${Math.floor(Math.random() * 100000000)}`,
            product_name: `Product ${sku}`,
            condition: 'New',
            fulfillable_quantity: Math.floor(Math.random() * 100),
            price: amount,
            last_updated: new Date().toISOString()
        });
    }

    // Insert Orders
    if (orders.length > 0) {
        const { error: orderError } = await supabase.from('orders').insert(orders);
        if (orderError) console.error('Error inserting orders:', orderError);
        else console.log(`✅ Seeded ${orders.length} orders`);
    }

    // Insert Shipments
    if (shipments.length > 0) {
        const { error: shipError } = await supabase.from('shipments').insert(shipments);
        if (shipError) console.error('Error inserting shipments:', shipError);
        else console.log(`✅ Seeded ${shipments.length} shipments`);
    }

    // Insert Inventory
    if (inventory.length > 0) {
        // Inventory might not have unique constraint on SKU per seller in DB schema, so just insert
        const { error: invError } = await supabase.from('inventory').upsert(inventory);
        if (invError) console.error('Error inserting inventory:', invError);
        else console.log(`✅ Seeded ${inventory.length} inventory items`);
    }
}

seedSourceData();
