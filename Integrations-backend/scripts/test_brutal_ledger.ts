import * as fs from 'fs';
import * as path from 'path';
import { parse as csvParse } from 'csv-parse/sync';

async function runTest() {
    const csvPath = path.resolve(__dirname, '../brutal_ledger_test.csv');
    console.log(`📄 Reading Brutal Ledger from: ${csvPath}`);

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

    // Tracking for SKU X00Z9Y8X
    const sku = 'X00Z9Y8X';
    const lifecycle = records.filter((r: any) => r.FNSKU === sku);

    console.log(`\n🔍 Analyzing Lifecycle for FNSKU: ${sku}`);

    let netQuantity = 0;
    let netFinancial = 0;
    let pendingReimbursement = false;
    let lastEvent = '';

    lifecycle.forEach((r: any, idx: number) => {
        const qty = parseInt(r.Qty);
        const impact = parseFloat(r.Financial_Impact.replace('$', '').replace('+', '')) || 0;

        netQuantity += qty;
        netFinancial += impact;
        lastEvent = r.Ledger_Event;

        console.log(`Step ${idx + 1}: ${r.Ledger_Event} | Qty: ${qty} | Impact: ${impact} | Running Qty: ${netQuantity} | Net $: ${netFinancial}`);

        if (r.Ledger_Event === 'Inventory Misplaced') pendingReimbursement = true;
        if (r.Ledger_Event === 'Reimbursement') pendingReimbursement = false;
        if (r.Ledger_Event === 'Inventory Found') {
            // Note: If found, Amazon usually claws back
        }
    });

    console.log('\n--- BRUTAL TEST ANALYSIS ---');
    console.log(`Final State: ${lastEvent}`);
    console.log(`Net Inventory Change: ${netQuantity}`);
    console.log(`Net Financial Impact: $${netFinancial.toFixed(2)}`);

    const discrepancies = [];

    // Logic: If the item ended as 'Disposed' or 'Damaged' without a corresponding positive financial impact, it's a claim.
    // In this ledger:
    // - Misplaced (-1) -> Reimbursed (+$45) -> Found (+1) -> Reversal (-$45) => NET 0, $0 (Correct)
    // - THEN: Warehouse Damage (0) -> Inventory Disposed (-1) => NET -1, $0 (WRONG!)

    if (netQuantity < 0 && netFinancial <= 0) {
        discrepancies.push({
            sku,
            issue: 'Inventory Disposed/Destroyed without Reimbursement',
            missingQty: Math.abs(netQuantity),
            estimatedLoss: 45.00 // Based on previous reimbursement value
        });
    }

    if (discrepancies.length > 0) {
        console.log('❌ DISCREPANCY DETECTED!');
        discrepancies.forEach(d => {
            console.log(`- ${d.issue} for ${d.sku}. Missing: ${d.missingQty} unit(s). Estimated Loss: $${d.estimatedLoss.toFixed(2)}`);
        });
    } else {
        console.log('✅ Ledger looks clean (no discrepancies found).');
    }

    console.log('\n🚀 Triggering Life-Cycle Sentinel Analysis Simulation...');
}

runTest().catch(console.error);
