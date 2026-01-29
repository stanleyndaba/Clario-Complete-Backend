
import 'dotenv/config';
import { randomUUID, randomBytes } from 'crypto';
import { supabaseAdmin } from '../src/database/supabaseClient';
import refundFilingWorker from '../src/workers/refundFilingWorker';

async function auditAgent7Hardening() {
    console.log('\n🛡️ Agent 7 Hardening Audit: (v1.15 - UUID Fix)\n');
    console.log('='.repeat(70));

    const testSellerId = randomUUID(); // Fixed: Must be UUID
    const testTenantId = randomUUID();
    console.log(`📡 Using Test Seller: ${testSellerId}`);
    console.log(`📡 Using Test Tenant: ${testTenantId}`);

    // 1. Tenant
    const { error: tErr } = await supabaseAdmin.from('tenants').insert({
        id: testTenantId, name: 'Audit Tenant', slug: `audit-${testTenantId}`, status: 'active'
    });
    if (tErr) { console.error('❌ Tenant Insert Failed:', tErr); return; }

    // Helper
    const createCase = async (caseId: string, orderId: string, amount: number, filingStatus: string, filename: string = 'invoice.pdf') => {
        const detId = randomUUID();
        const syncId = `SYNC-${randomBytes(2).toString('hex')}`;
        const caseNum = `CASE-${randomBytes(4).toString('hex')}`;
        const docId = randomUUID();

        const { error: dErr } = await supabaseAdmin.from('detection_results').insert({
            id: detId, seller_id: testSellerId, tenant_id: testTenantId, sync_id: syncId,
            anomaly_type: 'missing_unit', severity: 'medium', estimated_value: amount,
            currency: 'USD', status: 'pending', evidence: { order_id: orderId }, confidence_score: 0.9, match_confidence: 0.9
        });
        if (dErr) console.error(`❌ Detection (${orderId}) Failed:`, dErr);

        const { error: cErr } = await supabaseAdmin.from('dispute_cases').insert({
            id: caseId, seller_id: testSellerId, tenant_id: testTenantId, detection_result_id: detId,
            case_number: caseNum, case_type: 'amazon_fba', provider: 'amazon',
            claim_amount: amount, currency: 'USD', filing_status: filingStatus, status: 'pending'
        });
        if (cErr) console.error(`❌ Case (${orderId}) Failed:`, cErr);

        const { error: dcErr } = await supabaseAdmin.from('evidence_documents').insert({
            id: docId, seller_id: testSellerId, tenant_id: testTenantId,
            filename: filename, doc_type: 'invoice', provider: 'manual_upload',
            external_id: `ext-${randomBytes(4).toString('hex')}`,
            content_type: 'application/pdf', size_bytes: 100
        });
        if (dcErr) console.error(`❌ Doc (${orderId}) Failed:`, dcErr);

        const { error: lErr } = await supabaseAdmin.from('dispute_evidence_links').insert({
            dispute_case_id: caseId, evidence_document_id: docId, tenant_id: testTenantId
        });
        if (lErr) console.error(`❌ Link (${orderId}) Failed:`, lErr);
    };

    // Setup cases
    console.log('\n🛠️ Setting up test cases...');
    await createCase(randomUUID(), 'ORDER-KILL', 50, 'pending', 'credit_note.pdf');
    await createCase(randomUUID(), 'ORDER-DUPE', 50, 'filed');
    await createCase(randomUUID(), 'ORDER-DUPE', 50, 'pending');
    await createCase(randomUUID(), 'ORDER-HIGH', 1500, 'pending');

    // Verify
    const { data: finalCheck } = await supabaseAdmin.from('dispute_cases').select('id, filing_status').eq('tenant_id', testTenantId);
    console.log(`\n📡 Final Diagnostic: Found ${finalCheck?.length || 0} cases.`);

    if (finalCheck && finalCheck.length > 0) {
        console.log('\n⚡ Executing Agent 7 Audit Run...');
        await (refundFilingWorker as any).runFilingForTenant(testTenantId);

        const { data: results } = await supabaseAdmin.from('dispute_cases')
            .select('id, filing_status, detection_results(evidence)')
            .eq('tenant_id', testTenantId);

        console.log('\n📊 Audit Outcomes:');
        results?.forEach(r => {
            const orderId = (r.detection_results as any)?.evidence?.order_id;
            console.log(`   - Order ${orderId}: ${r.filing_status}`);
        });
    }

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await supabaseAdmin.from('dispute_evidence_links').delete().eq('tenant_id', testTenantId);
    await supabaseAdmin.from('dispute_cases').delete().eq('tenant_id', testTenantId);
    await supabaseAdmin.from('detection_results').delete().eq('tenant_id', testTenantId);
    await supabaseAdmin.from('evidence_documents').delete().eq('tenant_id', testTenantId);
    await supabaseAdmin.from('tenants').delete().eq('id', testTenantId);
}

auditAgent7Hardening().catch(console.error);
