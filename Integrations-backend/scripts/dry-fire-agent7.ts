
import 'dotenv/config';
import { randomUUID } from 'crypto';
import refundFilingService from '../src/services/refundFilingService';
import { supabaseAdmin } from '../src/database/supabaseClient';

// ENABLE DRY RUN
(global as any).DRY_RUN = true;
process.env.DRY_RUN = 'true';

async function dryFireTest() {
    console.log('\n🦁 Agent 7 Hardening Audit: Dry Fire Verification (v1.0)\n');
    console.log('='.repeat(80));

    const testSellerId = '07b4f03d-352e-473f-a316-af97d9017d69'; // Use real seller ID for RLS if needed, or admin client

    // 1. Setup Test Data (3 cases)
    const cases = [
        {
            type: 'missing_inbound_shipment',
            amount: 149.50,
            order_id: 'ORDER-DRY-001',
            shipment_id: 'FBA18JKL9M',
            sku: 'PREMIUM-WIDGET-001',
            asin: 'B00XYZ123',
            quantity: 5
        },
        {
            type: 'damaged_warehouse',
            amount: 85.00,
            order_id: 'ADJ-1769099974747-0001',
            sku: 'LUXURY-CASE-77',
            asin: 'B00DAM999',
            quantity: 1
        },
        {
            type: 'refund_without_return',
            amount: 210.25,
            order_id: '114-9988776-5544332',
            sku: 'HIGH-END-GEAR',
            asin: 'B00REF456',
            date: '2026-01-15'
        }
    ];

    // Use existing evidence doc IDs
    const evidenceDocIds = [
        'dfcdcdc4-9b81-4036-a366-84fbb2f19c39', // 1_Invoice_INV-2024-087432.pdf
        'e10d7805-9963-4ffa-b4c9-219aa0d487f2'  // FBA Reimbursement Invoice 3.pdf
    ];

    console.log('\n🚀 Starting Filing Pipeline for 3 Cases...');

    for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        console.log(`\n📄 Case #${i + 1}: ${c.type}`);
        console.log(`   - Order/Shipment: ${c.order_id || c.shipment_id}`);
        console.log(`   - Amount: ${c.amount} USD`);

        const request = {
            dispute_id: randomUUID(),
            user_id: testSellerId,
            order_id: c.order_id || '',
            asin: c.asin,
            sku: c.sku,
            claim_type: c.type,
            amount_claimed: c.amount,
            currency: 'USD',
            evidence_document_ids: evidenceDocIds,
            confidence_score: 0.98
        };

        // Hacky injection of extra fields for the brief generator
        (request as any).shipment_id = c.shipment_id;
        (request as any).quantity = c.quantity;
        (request as any).date = (c as any).date;

        const result = await refundFilingService.fileDispute(request);

        if (result.success) {
            console.log(`   ✅ SUCCESS: ${result.submission_id}`);
        } else {
            console.error(`   ❌ FAILED: ${result.error_message}`);
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n💎 Dry Fire Complete! Payloads generated in test_output/');
}

dryFireTest().catch(console.error);
