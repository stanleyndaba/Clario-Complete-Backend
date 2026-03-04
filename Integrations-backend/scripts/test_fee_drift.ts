import * as fs from 'fs';
import * as path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function runTest() {
    const csvPath = path.resolve(__dirname, '../settlement_fee_ledger.csv');
    console.log(`📄 Reading Settlement Fee Ledger from: ${csvPath}`);

    if (!fs.existsSync(csvPath)) {
        console.error('❌ File not found!');
        return;
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const records = csvParse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true
    });

    console.log(`✅ Parsed ${records.length} records.`);

    // Logic: Identify a baseline and find drift
    const skuGroups = new Map<string, any[]>();
    records.forEach((r: any) => {
        const existing = skuGroups.get(r.SKU) || [];
        existing.push(r);
        skuGroups.set(r.SKU, existing);
    });

    const discrepancies = [];
    let totalOvercharge = 0;

    for (const [sku, history] of skuGroups) {
        // Simple baseline: use the first entry's fee as baseline
        const baselineFee = parseFloat(history[0]['Fulfillment Fee Charged']);

        history.forEach((r, index) => {
            const currentFee = parseFloat(r['Fulfillment Fee Charged']);
            if (currentFee > baselineFee) {
                const overcharge = currentFee - baselineFee;
                discrepancies.push({
                    row: index + 2, // 1-indexed + header
                    orderId: r['Order ID'],
                    sku,
                    baselineFee,
                    currentFee,
                    overcharge
                });
                totalOvercharge += overcharge;
            }
        });
    }

    console.log('\n--- FEE DRIFT DETECTION RESULTS ---');
    console.log(`Total Overcharged Rows: ${discrepancies.length}`);
    console.log(`Total Overcharge Amount: $${totalOvercharge.toFixed(2)}`);
    console.log('----------------------------------\n');

    if (discrepancies.length > 0) {
        console.log('Detailed Overcharges:');
        discrepancies.forEach(d => {
            console.log(`Row ${d.row}: Order ${d.orderId} - Baseline: $${d.baselineFee}, Current: $${d.currentFee} -> OVERCHARGE: $${d.overcharge.toFixed(2)}`);
        });
    }

    console.log('\n🚀 Triggering Fee Drift Trend Analysis Simulation...');
}

runTest().catch(console.error);
