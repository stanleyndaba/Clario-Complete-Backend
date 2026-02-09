#!/usr/bin/env ts-node
/**
 * Seed Full Demo Pipeline
 * 
 * Populates ALL tables needed for end-to-end demo visibility:
 * - detection_results (Agent 3 output)
 * - dispute_cases (Agent 6/7 filing queue)
 * - evidence_documents (Agent 4/5 docs)
 * - dispute_evidence_links (Evidence matching)
 * 
 * Run: npx ts-node scripts/seed-demo-pipeline.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Demo user - use existing or create
const DEMO_USER_ID = process.env.TEST_USER_ID || '00000000-0000-0000-0000-000000000001';
const DEMO_TENANT_ID = process.env.DEMO_TENANT_ID || DEMO_USER_ID;

// Map frontend claim types to database anomaly_type
const CLAIM_SCENARIOS = [
    { anomalyType: 'missing_unit', displayName: 'Lost Inbound Shipment', minAmount: 150, maxAmount: 800, count: 8 },
    { anomalyType: 'damaged_stock', displayName: 'Damaged in Warehouse', minAmount: 50, maxAmount: 300, count: 12 },
    { anomalyType: 'missing_unit', displayName: 'Customer Return Not Received', minAmount: 25, maxAmount: 150, count: 10 },
    { anomalyType: 'overcharge', displayName: 'Fee Overcharge', minAmount: 10, maxAmount: 75, count: 18 },
    { anomalyType: 'incorrect_fee', displayName: 'Missing Reimbursement', minAmount: 100, maxAmount: 500, count: 6 },
    { anomalyType: 'duplicate_charge', displayName: 'Duplicate Charge', minAmount: 75, maxAmount: 250, count: 5 },
];

// detection_results status: 'pending', 'reviewed', 'disputed', 'resolved' (from check constraint)
// dispute_cases status: 'pending', 'submitted', 'approved', 'rejected', 'closed'
const STATUS_DISTRIBUTION = [
    { detectionStatus: 'resolved', disputeStatus: 'approved', weight: 35 },
    { detectionStatus: 'pending', disputeStatus: 'pending', weight: 25 },
    { detectionStatus: 'disputed', disputeStatus: 'submitted', weight: 20 },
    { detectionStatus: 'reviewed', disputeStatus: 'pending', weight: 10 },
    { detectionStatus: 'resolved', disputeStatus: 'rejected', weight: 5 },
    { detectionStatus: 'resolved', disputeStatus: 'closed', weight: 5 },
];

// Generate random values
const randomBetween = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomFloat = (min: number, max: number) => +(Math.random() * (max - min) + min).toFixed(2);
const randomDate = (daysBack: number) => {
    const date = new Date();
    date.setDate(date.getDate() - randomBetween(0, daysBack));
    return date.toISOString();
};
const randomFutureDate = (daysAhead: number) => {
    const date = new Date();
    date.setDate(date.getDate() + randomBetween(1, daysAhead));
    return date.toISOString();
};
const generateOrderId = () => `${randomBetween(100, 999)}-${randomBetween(1000000, 9999999)}-${randomBetween(1000000, 9999999)}`;
const generateAsin = () => `B0${randomBetween(10000000, 99999999)}`;
const generateSku = () => `SKU-${String.fromCharCode(65 + randomBetween(0, 25))}${randomBetween(1000, 9999)}`;
const generateSyncId = () => `sync-${Date.now()}-${randomBetween(1000, 9999)}`;

// Pick weighted random status (returns both detection and dispute statuses)
function pickWeightedStatus() {
    const totalWeight = STATUS_DISTRIBUTION.reduce((sum, s) => sum + s.weight, 0);
    let random = Math.random() * totalWeight;
    for (const s of STATUS_DISTRIBUTION) {
        random -= s.weight;
        if (random <= 0) return s;
    }
    return STATUS_DISTRIBUTION[0];
}

async function ensureTenant(): Promise<string> {
    console.log('🏢 Ensuring demo tenant exists...');

    // Check if tenant exists
    const { data: existingTenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', DEMO_TENANT_ID)
        .single();

    if (existingTenant) {
        console.log(`   ✅ Tenant ${DEMO_TENANT_ID} already exists`);
        return DEMO_TENANT_ID;
    }

    // Create tenant
    const { data: newTenant, error } = await supabase
        .from('tenants')
        .insert({
            id: DEMO_TENANT_ID,
            name: 'Demo Tenant',
            slug: 'demo-tenant',
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

    if (error) {
        console.log(`   ⚠️ Could not create tenant: ${error.message}`);
        const { data: anyTenant } = await supabase.from('tenants').select('id').limit(1).single();
        if (anyTenant) {
            console.log(`   ✅ Using existing tenant: ${anyTenant.id}`);
            return anyTenant.id;
        }
        return DEMO_TENANT_ID;
    }

    console.log(`   ✅ Created demo tenant: ${newTenant.id}`);
    return newTenant.id;
}

async function ensureDemoUser(): Promise<string> {
    console.log('👤 Ensuring demo user exists...');

    // Check if user exists
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('id', DEMO_USER_ID)
        .single();

    if (existingUser) {
        console.log(`   ✅ Demo user ${DEMO_USER_ID} already exists`);
        return DEMO_USER_ID;
    }

    // Create demo user with required fields (amazon_seller_id + tenant_id)
    const { data: newUser, error } = await supabase
        .from('users')
        .insert({
            id: DEMO_USER_ID,
            email: 'demo@margin.com',
            tenant_id: DEMO_TENANT_ID,
            amazon_seller_id: 'DEMO_SELLER_001',
            seller_id: DEMO_USER_ID,
            company_name: 'Demo Business',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select('id')
        .single();

    if (error) {
        console.log(`   ⚠️ Could not create demo user: ${error.message}`);
        return DEMO_USER_ID;  // Return anyway, let evidence seeding handle it gracefully
    }

    console.log(`   ✅ Created demo user: ${newUser.id}`);
    return newUser.id;
}

async function clearDemoData(tenantId: string) {
    console.log('🧹 Clearing existing demo data...');

    // Clear in order of dependencies (child tables first)
    try { await supabase.from('dispute_evidence_links').delete().eq('tenant_id', tenantId); } catch (e) { }
    try { await supabase.from('dispute_cases').delete().eq('seller_id', DEMO_USER_ID); } catch (e) { }
    try { await supabase.from('detection_results').delete().eq('seller_id', DEMO_USER_ID); } catch (e) { }
    try { await supabase.from('evidence_documents').delete().eq('seller_id', DEMO_USER_ID); } catch (e) { }

    console.log('✅ Demo data cleared');
}

async function seedEvidenceDocuments(tenantId: string): Promise<string[]> {
    console.log('📄 Seeding evidence documents...');

    const documents = [];
    const docTypes = ['invoice', 'shipping', 'po', 'other'];
    const providers = ['gmail', 'gdrive', 'dropbox', 'outlook'];

    for (let i = 0; i < 30; i++) {
        const docId = crypto.randomUUID();
        const docDate = randomDate(60);

        documents.push({
            id: docId,
            seller_id: DEMO_USER_ID,
            user_id: DEMO_USER_ID,
            tenant_id: tenantId,
            provider: providers[i % providers.length],
            source_id: null,
            doc_type: docTypes[i % docTypes.length],
            external_id: `email_${i}_${Date.now()}`,  // Required NOT NULL field
            filename: `invoice_${randomBetween(100000, 999999)}.pdf`,  // Required field
            size_bytes: randomBetween(10000, 500000),
            content_type: 'application/pdf',
            supplier_name: ['Amazon Fulfillment', 'FBA Warehouse', 'Amazon Logistics'][randomBetween(0, 2)],
            invoice_number: `INV-${randomBetween(100000, 999999)}`,
            purchase_order_number: `PO-${randomBetween(10000, 99999)}`,
            document_date: docDate,
            currency: 'USD',
            total_amount: randomFloat(25, 500),
            file_url: `https://storage.example.com/evidence/${docId}.pdf`,
            raw_text: `Sample invoice document for order ${generateOrderId()}`,
            extracted: {
                items: [
                    { sku: generateSku(), asin: generateAsin(), quantity: randomBetween(1, 10), unit_cost: randomFloat(10, 50) }
                ]
            },
            metadata: {
                ingestion_method: 'demo_seed',
                ingestion_timestamp: new Date().toISOString()
            },
            processing_status: 'pending',
            ingested_at: new Date().toISOString(),
            created_at: docDate,
            updated_at: new Date().toISOString()
        });
    }

    const { error } = await supabase.from('evidence_documents').insert(documents);
    if (error) {
        console.error('❌ Error seeding evidence documents:', error.message);
        return [];
    }

    console.log(`✅ Seeded ${documents.length} evidence documents`);
    return documents.map(d => d.id);
}

async function seedDetectionResults(tenantId: string): Promise<string[]> {
    console.log('🔍 Seeding detection results...');

    const detections = [];
    const syncId = generateSyncId();
    const severities = ['low', 'medium', 'high', 'critical'];

    for (const scenario of CLAIM_SCENARIOS) {
        for (let i = 0; i < scenario.count; i++) {
            const amount = randomFloat(scenario.minAmount, scenario.maxAmount);
            const confidence = randomFloat(0.75, 0.98);
            const statusInfo = pickWeightedStatus();

            detections.push({
                id: crypto.randomUUID(),
                seller_id: DEMO_USER_ID,
                tenant_id: tenantId,
                sync_id: syncId,
                anomaly_type: scenario.anomalyType,
                severity: severities[randomBetween(0, 3)],
                estimated_value: amount,
                currency: 'USD',
                confidence_score: Math.min(confidence, 1.0),
                status: statusInfo.detectionStatus,  // Use correct enum: pending|reviewed|disputed|resolved
                evidence: {
                    order_id: generateOrderId(),
                    asin: generateAsin(),
                    sku: generateSku(),
                    amount: amount,
                    description: `${scenario.displayName} - ${randomBetween(1, 10)} units`,
                    fc_code: ['PHX5', 'ONT8', 'SBD1', 'LAX9'][randomBetween(0, 3)]
                },
                related_event_ids: [],
                discovery_date: randomDate(45),
                deadline_date: randomFutureDate(60),
                days_remaining: randomBetween(15, 55),
                created_at: randomDate(45),
                updated_at: new Date().toISOString()
            });
        }
    }

    const { error } = await supabase.from('detection_results').insert(detections);
    if (error) {
        console.error('❌ Error seeding detection results:', error.message);
        return [];
    }

    console.log(`✅ Seeded ${detections.length} detection results`);
    return detections.map(d => d.id);
}

async function seedDisputeCases(detectionIds: string[], tenantId: string): Promise<string[]> {
    console.log('⚖️ Seeding dispute cases...');

    const cases = [];
    let approvedTotal = 0;
    let pendingTotal = 0;
    let caseCounter = 100000;

    for (let i = 0; i < detectionIds.length; i++) {
        const detectionId = detectionIds[i];
        const statusInfo = pickWeightedStatus();
        const scenario = CLAIM_SCENARIOS[i % CLAIM_SCENARIOS.length];
        const amount = randomFloat(scenario.minAmount, scenario.maxAmount);

        // Track totals for summary
        if (statusInfo.disputeStatus === 'approved' || statusInfo.disputeStatus === 'closed') {
            approvedTotal += amount;
        } else if (statusInfo.disputeStatus === 'pending' || statusInfo.disputeStatus === 'submitted') {
            pendingTotal += amount;
        }

        caseCounter++;
        const caseId = crypto.randomUUID();
        cases.push({
            id: caseId,
            seller_id: DEMO_USER_ID,
            tenant_id: tenantId,
            detection_result_id: detectionId,
            case_number: `AMZ-${caseCounter}`,
            status: statusInfo.disputeStatus,  // Use correct enum: pending|submitted|approved|rejected|closed
            claim_amount: amount,
            currency: 'USD',
            case_type: 'amazon_fba',
            provider: 'amazon',
            submission_date: statusInfo.disputeStatus !== 'pending' ? randomDate(14) : null,
            resolution_date: statusInfo.disputeStatus === 'approved' || statusInfo.disputeStatus === 'closed' ? randomDate(7) : null,
            resolution_amount: statusInfo.disputeStatus === 'approved' ? amount * 0.95 : null,
            provider_case_id: statusInfo.disputeStatus !== 'pending' ? `${randomBetween(10000000000, 99999999999)}` : null,
            expected_amount: amount,
            expected_paid_date: statusInfo.disputeStatus === 'approved' ? randomFutureDate(14) : null,
            confidence: randomFloat(0.8, 0.98),
            evidence_attachments: {},
            provider_response: {},
            created_at: randomDate(30),
            updated_at: new Date().toISOString()
        });
    }

    const { error } = await supabase.from('dispute_cases').insert(cases);
    if (error) {
        console.error('❌ Error seeding dispute cases:', error.message);
        console.error('   Details:', error);
        return [];
    }

    console.log(`✅ Seeded ${cases.length} dispute cases`);
    console.log(`   💰 Approved/Resolved: $${approvedTotal.toFixed(2)}`);
    console.log(`   ⏳ Pending/Submitted: $${pendingTotal.toFixed(2)}`);

    return cases.map(c => c.id);
}

async function seedEvidenceLinks(caseIds: string[], evidenceIds: string[], tenantId: string) {
    console.log('🔗 Seeding evidence links...');

    if (caseIds.length === 0 || evidenceIds.length === 0) {
        console.log('   ⚠️ No cases or evidence to link, skipping...');
        return;
    }

    const links = [];

    for (const caseId of caseIds) {
        const numLinks = randomBetween(1, 3);
        const usedIds = new Set<string>();

        for (let i = 0; i < numLinks && evidenceIds.length > 0; i++) {
            const evidenceId = evidenceIds[randomBetween(0, evidenceIds.length - 1)];
            if (!usedIds.has(evidenceId)) {
                usedIds.add(evidenceId);
                links.push({
                    id: crypto.randomUUID(),
                    tenant_id: tenantId,
                    dispute_case_id: caseId,
                    evidence_document_id: evidenceId,
                    relevance_score: randomFloat(0.8, 0.99),
                    matched_context: { match_type: 'auto_matched', confidence: randomFloat(0.85, 0.98) },
                    created_at: new Date().toISOString()
                });
            }
        }
    }

    const { error } = await supabase.from('dispute_evidence_links').insert(links);
    if (error) {
        console.error('❌ Error seeding evidence links:', error.message);
        return;
    }

    console.log(`✅ Seeded ${links.length} evidence links`);
}

async function printSummary(tenantId: string) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 DEMO DATA SUMMARY');
    console.log('='.repeat(60));

    const { count: detectionCount } = await supabase.from('detection_results').select('*', { count: 'exact', head: true }).eq('seller_id', DEMO_USER_ID);
    const { count: caseCount } = await supabase.from('dispute_cases').select('*', { count: 'exact', head: true }).eq('seller_id', DEMO_USER_ID);
    const { count: evidenceCount } = await supabase.from('evidence_documents').select('*', { count: 'exact', head: true }).eq('seller_id', DEMO_USER_ID);

    const { data: approvedCases } = await supabase
        .from('dispute_cases')
        .select('claim_amount')
        .eq('seller_id', DEMO_USER_ID)
        .in('status', ['approved', 'closed']);

    const { data: pendingCases } = await supabase
        .from('dispute_cases')
        .select('claim_amount')
        .eq('seller_id', DEMO_USER_ID)
        .in('status', ['pending', 'submitted']);

    const approvedTotal = (approvedCases || []).reduce((sum, c) => sum + (parseFloat(c.claim_amount) || 0), 0);
    const pendingTotal = (pendingCases || []).reduce((sum, c) => sum + (parseFloat(c.claim_amount) || 0), 0);

    console.log(`
📈 Records Created:
   - Detection Results: ${detectionCount || 0}
   - Dispute Cases:     ${caseCount || 0}
   - Evidence Docs:     ${evidenceCount || 0}

💰 Financial Summary:
   - Approved/Recovered: $${approvedTotal.toFixed(2)}
   - Pending/Submitted:  $${pendingTotal.toFixed(2)}
   - Total Pipeline:     $${(approvedTotal + pendingTotal).toFixed(2)}

👤 Demo User ID: ${DEMO_USER_ID}
🏢 Tenant ID:    ${tenantId}
`);
    console.log('='.repeat(60));
    console.log('✅ Demo pipeline ready! Refresh your dashboard to see data.');
    console.log('='.repeat(60) + '\n');
}

async function main() {
    console.log('\n🚀 SEEDING FULL DEMO PIPELINE\n');
    console.log('This will populate all tables for end-to-end demo visibility.\n');

    try {
        const tenantId = await ensureTenant();
        await ensureDemoUser();  // Create demo user for evidence FK constraint
        await clearDemoData(tenantId);
        const evidenceIds = await seedEvidenceDocuments(tenantId);
        const detectionIds = await seedDetectionResults(tenantId);
        const caseIds = await seedDisputeCases(detectionIds, tenantId);
        await seedEvidenceLinks(caseIds, evidenceIds, tenantId);
        await printSummary(tenantId);
    } catch (error: any) {
        console.error('\n❌ FATAL ERROR:', error.message);
        process.exit(1);
    }
}

main();
