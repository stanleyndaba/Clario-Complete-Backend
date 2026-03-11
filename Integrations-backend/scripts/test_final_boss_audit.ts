import * as fs from 'fs';
import * as path from 'path';
import { parse as csvParse } from 'csv-parse/sync';

async function runTest() {
    const csvPath = path.resolve(__dirname, '../final-boss-audit.csv');
    console.log(`📄 Reading Final Boss Audit from: ${csvPath}`);

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

    const fnsquGroups = new Map<string, any[]>();
    records.forEach((r: any) => {
        const fnsqu = r.FNSKU;
        if (!fnsquGroups.has(fnsqu)) {
            fnsquGroups.set(fnsqu, []);
        }
        fnsquGroups.get(fnsqu)!.push(r);
    });

    console.log('\n🔍 Processing Transaction Timeline by FNSKU:');

    let totalDiscrepancies = 0;

    fnsquGroups.forEach((events, fnsku) => {
        console.log(`\n--- Analyzing FNSKU: ${fnsku} ---`);
        let netQuantity = 0;
        let pendingReimbursement = false;
        let hasCustomerDamage = false;

        events.forEach((r, idx) => {
            const qty = parseInt(r.Quantity) || 0;
            const eventType = r['Event Type'];
            const disposition = r.Disposition;
            const reason = r.Reason;
            
            netQuantity += qty;
            
            console.log(`[${r.Date}] ${eventType} | Reason: ${reason || 'N/A'} | Disp: ${disposition} | Qty: %+d | Net: ${netQuantity}`, qty);

            if (eventType === 'CustomerReturns' && disposition === 'CUSTOMER_DAMAGED') {
                hasCustomerDamage = true;
            }
            if (eventType === 'Adjustments') {
                if (reason === 'E' || reason === 'M') { 
                    pendingReimbursement = true;
                }
                if (reason === 'F' || reason === 'P') { 
                    pendingReimbursement = false;
                }
            }
        });

        console.log(`Final Net Quantity: ${netQuantity}`);
        
        let discrepancy = false;
        if (netQuantity < 0 && pendingReimbursement) {
            console.log(`❌ DISCREPANCY DETECTED for ${fnsku}: Missing units (${netQuantity}) with no corresponding reimbursement found.`);
            discrepancy = true;
        } else if (netQuantity < 0 && !hasCustomerDamage) {
             console.log(`❌ POTENTIAL DISCREPANCY DETECTED for ${fnsku}: Net negative units ${netQuantity}. Need to verify sales or other events.`);
             discrepancy = true;
        } else {
            console.log(`✅ No immediate discrepancy found based on ledger rules.`);
        }
        
        if (discrepancy) totalDiscrepancies++;
    });

    console.log('\n--- FINAL AUDIT RESULT ---');
    if (totalDiscrepancies > 0) {
        console.log(`🚨 Found ${totalDiscrepancies} discrepant FNSKUs require filing.`);
    } else {
        console.log(`✅ All inventory accounted for.`);
    }
}

runTest().catch(console.error);
