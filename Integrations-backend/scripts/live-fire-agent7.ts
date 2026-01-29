
import 'dotenv/config';
import { randomUUID } from 'crypto';
import refundFilingService from '../src/services/refundFilingService';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function liveFireTest() {
    console.log('\n🚀 Agent 7: LIVE FIRE TEST\n');
    console.log('='.repeat(80));

    const claimId = 'd8d13b63-7d30-4d5d-b7eb-2498f6e50c61';
    const sellerId = '99ed4de1-259a-4752-a416-2eb1faeb217c';
    const evidenceId = '0811eef8-5df0-466d-9610-d02ec4653609';

    console.log(`📡 Targeting Claim: ${claimId}`);
    console.log(`💰 Value: $5.27`);
    console.log(`📎 Evidence: live_test_invoice.pdf`);

    const request = {
        dispute_id: claimId,
        user_id: sellerId,
        order_id: '112-5996292-858244',
        asin: 'B0082442YJ0',
        sku: 'SKU-8244',
        claim_type: 'lost_warehouse',
        amount_claimed: 5.27,
        currency: 'USD',
        evidence_document_ids: [evidenceId],
        confidence_score: 0.99
    };

    // Trigger the filing
    console.log('\n⚖️ Sending Forensic Case to Amazon SP-API...');

    try {
        const result = await refundFilingService.fileDispute(request);

        if (result.success) {
            console.log('\n🎯 MISSION ACCOMPLISHED');
            console.log(`✅ Status: Filed`);
            console.log(`✅ Submission ID: ${result.submission_id}`);
            console.log(`✅ Amazon Case ID: ${result.amazon_case_id}`);
        } else {
            console.error('\n❌ LIVE FIRE FAILED');
            console.error(`Reason: ${result.error_message}`);
        }
    } catch (error: any) {
        console.error('\n💥 CRITICAL ERROR');
        console.error(error.message);
    }

    console.log('\n' + '='.repeat(80));
}

liveFireTest().catch(console.error);
