/**
 * Generate Realistic Mock Dataset
 * 
 * Generates ~70,000 records of Amazon SP-API data with realistic anomalies.
 * Exports data to CSV files for import and creates a ground truth file for ML calibration.
 * 
 * Usage:
 *   ts-node src/scripts/generate-realistic-dataset.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createMockDataGenerator, MockDataGenerator } from '../services/mockDataGenerator';
import logger from '../utils/logger';

const OUTPUT_DIR = path.join(__dirname, '../../mock_data_realistic');
const RECORD_COUNT = 70000;

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function generateDataset() {
    console.log(`🚀 Starting generation of ${RECORD_COUNT} realistic records...`);

    const generator = createMockDataGenerator('realistic', RECORD_COUNT);

    // 1. Generate Orders
    console.log('📦 Generating Orders...');
    const ordersData = generator.generateOrders();
    const orders = ordersData.payload.Orders;
    await writeCSV('orders.csv', orders);

    // 2. Generate Shipments (derived from orders)
    console.log('🚚 Generating Shipments...');
    const shipmentsData = generator.generateShipments(orders);
    const shipments = shipmentsData.payload.shipments;
    await writeCSV('shipments.csv', shipments);

    // 3. Generate Returns (derived from orders)
    console.log('↩️ Generating Returns...');
    const returnsData = generator.generateReturns(orders);
    const returns = returnsData.payload.returns;
    await writeCSV('returns.csv', returns);

    // 4. Generate Settlements
    console.log('💰 Generating Settlements...');
    const settlementsData = generator.generateSettlements();
    const settlements = settlementsData.payload.settlements;
    await writeCSV('settlements.csv', settlements);

    // 5. Generate Inventory
    console.log('📊 Generating Inventory...');
    const inventoryData = generator.generateInventory();
    const inventory = inventoryData.payload.inventorySummaries;
    await writeCSV('inventory_adjustments.csv', inventory); // Map to inventory table

    // 6. Generate Financial Events
    console.log('💸 Generating Financial Events...');
    const financeData = generator.generateFinancialEvents();
    const financialEvents = financeData.payload.FinancialEvents;

    // Flatten financial events for CSV
    const feeEvents = financialEvents.ServiceFeeEventList.map((e: any) => ({
        AmazonOrderId: e.AmazonOrderId,
        SellerSKU: e.SellerSKU,
        ASIN: e.ASIN,
        PostedDate: e.PostedDate,
        FeeType: e.FeeList[0].FeeType,
        FeeAmount: e.FeeList[0].FeeAmount.CurrencyAmount,
        FeeDescription: e.FeeDescription
    }));
    await writeCSV('fee_events.csv', feeEvents);

    // 7. Generate Ground Truth
    console.log('🎯 Generating Ground Truth...');
    await generateGroundTruth(orders, shipments, returns, settlements, inventory, financialEvents);

    console.log(`✅ Dataset generation complete! Files saved to: ${OUTPUT_DIR}`);
}

async function writeCSV(filename: string, data: any[]) {
    if (!data || data.length === 0) {
        console.warn(`⚠️ No data for ${filename}`);
        return;
    }

    const headers = Object.keys(flattenObject(data[0]));
    const csvContent = [
        headers.join(','),
        ...data.map(row => {
            const flatRow = flattenObject(row);
            return headers.map(header => {
                const value = flatRow[header];
                if (value === null || value === undefined) return '';
                if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
                return value;
            }).join(',');
        })
    ].join('\n');

    fs.writeFileSync(path.join(OUTPUT_DIR, filename), csvContent);
    console.log(`   - Wrote ${data.length} records to ${filename}`);
}

function flattenObject(obj: any, prefix = ''): any {
    return Object.keys(obj).reduce((acc: any, k) => {
        const pre = prefix.length ? prefix + '_' : '';
        if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k]) && !(obj[k] instanceof Date)) {
            Object.assign(acc, flattenObject(obj[k], pre + k));
        } else if (Array.isArray(obj[k])) {
            // For arrays, we usually serialize to JSON string for CSV import if the DB supports it,
            // or skip if it's a relational table. For this simple import, we'll JSON stringify.
            acc[pre + k] = JSON.stringify(obj[k]);
        } else {
            acc[pre + k] = obj[k];
        }
        return acc;
    }, {});
}

async function generateGroundTruth(
    orders: any[],
    shipments: any[],
    returns: any[],
    settlements: any[],
    inventory: any[],
    financialEvents: any
) {
    const groundTruth: any[] = [];

    // Analyze Shipments for anomalies
    shipments.forEach((s: any) => {
        if (s.missing_quantity > 0) {
            groundTruth.push({
                entity_id: s.shipment_id,
                entity_type: 'shipment',
                is_claimable: 1,
                anomaly_type: 'missing_unit',
                confidence_target: 0.95,
                reason: 'Missing quantity in shipment'
            });
        }
    });

    // Analyze Returns for anomalies
    returns.forEach((r: any) => {
        // Check if refund amount is significantly different from item value (simplified logic)
        // In generation, we set refund_amount. If it's partial (and not just restocking fee), it's an anomaly.
        // We need to infer "value" from the order items ideally, but here we can check the generation logic pattern.
        // Or we can rely on the fact that we explicitly introduced anomalies.

        // Heuristic: If refund amount has decimal .xx that looks like a partial calculation (e.g. not ending in .00 or .99 typical of prices)
        // This is weak. Better to check if we can link back to order total.
        const order = orders.find((o: any) => o.AmazonOrderId === r.order_id);
        if (order) {
            const orderTotal = parseFloat(order.OrderTotal.Amount);
            if (r.refund_amount < orderTotal * 0.9 && r.refund_amount > 0) {
                groundTruth.push({
                    entity_id: r.return_id,
                    entity_type: 'return',
                    is_claimable: 1,
                    anomaly_type: 'refund_mismatch',
                    confidence_target: 0.85,
                    reason: 'Partial refund mismatch'
                });
            }
        }
    });

    // Analyze Settlements for anomalies
    settlements.forEach((s: any) => {
        // Fee > 18% of amount is our anomaly trigger in generator
        if (s.fees > s.amount * 0.18) {
            groundTruth.push({
                entity_id: s.settlement_id,
                entity_type: 'settlement',
                is_claimable: 1,
                anomaly_type: 'fee_overcharge',
                confidence_target: 0.90,
                reason: 'High fee percentage'
            });
        }
    });

    // Analyze Inventory for anomalies
    inventory.forEach((i: any) => {
        if (i.discrepancy) {
            groundTruth.push({
                entity_id: i.sellerSku, // SKU as ID for inventory
                entity_type: 'inventory',
                is_claimable: 1,
                anomaly_type: 'inventory_discrepancy',
                confidence_target: 0.75,
                reason: 'Inventory count mismatch'
            });
        }
    });

    // Write Ground Truth CSV
    const headers = ['entity_id', 'entity_type', 'is_claimable', 'anomaly_type', 'confidence_target', 'reason'];
    const csvContent = [
        headers.join(','),
        ...groundTruth.map(row => headers.map(h => row[h]).join(','))
    ].join('\n');

    fs.writeFileSync(path.join(OUTPUT_DIR, 'claims_ground_truth.csv'), csvContent);
    console.log(`   - Wrote ${groundTruth.length} ground truth records`);
}

generateDataset().catch(console.error);
