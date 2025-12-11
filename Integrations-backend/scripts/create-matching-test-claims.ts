/**
 * Create Matching Test Claims
 * This script:
 * 1. Reads what was extracted from uploaded documents
 * 2. Creates claims that match those order IDs/ASINs/SKUs
 * 3. This allows testing the evidence matching flow
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface ExtractedData {
    order_ids: string[];
    asins: string[];
    skus: string[];
    amounts: string[];
}

async function createMatchingTestClaims() {
    console.log('🔍 Creating matching test claims...\n');

    // Step 1: Get parsed documents with extracted data
    console.log('📄 Step 1: Reading extracted data from documents...');
    const { data: docs, error: docsError } = await supabase
        .from('evidence_documents')
        .select('id, filename, parsed_metadata, seller_id')
        .not('parsed_metadata', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);

    if (docsError) {
        console.error('Error fetching documents:', docsError.message);
        return;
    }

    if (!docs || docs.length === 0) {
        console.error('No parsed documents found. Please upload and parse documents first.');
        return;
    }

    console.log(`   Found ${docs.length} parsed documents`);

    // Collect all extracted data
    const allExtracted: ExtractedData = {
        order_ids: [],
        asins: [],
        skus: [],
        amounts: []
    };

    let userId: string | null = null;

    for (const doc of docs) {
        const metadata = doc.parsed_metadata || {};
        userId = doc.seller_id || userId;

        console.log(`   - ${doc.filename}:`);
        console.log(`     ASINs: ${(metadata.asins || []).join(', ') || 'None'}`);
        console.log(`     SKUs: ${(metadata.skus || []).join(', ') || 'None'}`);
        console.log(`     Order IDs: ${(metadata.order_ids || []).join(', ') || 'None'}`);
        console.log(`     Amounts: ${(metadata.amounts || []).slice(0, 3).join(', ') || 'None'}`);

        if (metadata.asins) allExtracted.asins.push(...metadata.asins);
        if (metadata.skus) allExtracted.skus.push(...metadata.skus);
        if (metadata.order_ids) allExtracted.order_ids.push(...metadata.order_ids);
        if (metadata.amounts) allExtracted.amounts.push(...metadata.amounts);
    }

    // Deduplicate
    allExtracted.order_ids = [...new Set(allExtracted.order_ids)];
    allExtracted.asins = [...new Set(allExtracted.asins)];
    allExtracted.skus = [...new Set(allExtracted.skus)];
    allExtracted.amounts = [...new Set(allExtracted.amounts)];

    console.log('\n📊 Combined extracted data:');
    console.log(`   Unique ASINs: ${allExtracted.asins.length}`);
    console.log(`   Unique SKUs: ${allExtracted.skus.length}`);
    console.log(`   Unique Order IDs: ${allExtracted.order_ids.length}`);
    console.log(`   Unique Amounts: ${allExtracted.amounts.length}`);

    if (allExtracted.asins.length === 0 && allExtracted.skus.length === 0) {
        console.error('\n❌ No ASINs or SKUs extracted from documents. Cannot create matching claims.');
        return;
    }

    if (!userId) {
        console.error('\n❌ No user ID found in documents.');
        return;
    }

    // Step 2: Create matching claims
    console.log('\n🎯 Step 2: Creating matching claims...');

    // Valid anomaly_type values (based on database check constraint)
    const claimTypes = [
        { type: 'missing_unit', status: 'pending', description: 'Lost in warehouse - missing unit' },
        { type: 'missing_unit', status: 'pending', description: 'Damaged in warehouse' },
        { type: 'missing_unit', status: 'submitted', description: 'Customer return not received' }
    ];

    let createdCount = 0;

    // Create claims for each ASIN
    for (let i = 0; i < Math.min(allExtracted.asins.length, 3); i++) {
        const asin = allExtracted.asins[i];
        const sku = allExtracted.skus[i] || `SKU-${asin}`;
        const amount = allExtracted.amounts[i] ? parseFloat(allExtracted.amounts[i].replace(/[^0-9.]/g, '')) : 34.99;
        const claimType = claimTypes[i % claimTypes.length];

        const claimId = uuidv4();
        const orderId = allExtracted.order_ids[0] || `ORDER-${Date.now()}`;

        // Try to insert into detection_results (where claims live)
        // Schema: id, seller_id, sync_id, anomaly_type, severity, estimated_value, currency, 
        //         confidence_score, evidence (JSONB), status, claim_number
        const { error: insertError } = await supabase
            .from('detection_results')
            .insert({
                id: claimId,
                seller_id: userId,  // Uses seller_id
                sync_id: `test-sync-${Date.now()}`,
                anomaly_type: claimType.type,
                severity: 'medium',
                estimated_value: amount,
                currency: 'USD',
                confidence_score: 0.85,
                status: claimType.status,
                claim_number: `TEST-${Date.now().toString().slice(-6)}`,
                // ASIN, SKU, Order ID go in evidence JSONB
                evidence: {
                    test_claim: true,
                    created_for_matching_test: true,
                    asin: asin,
                    sku: sku,
                    order_id: orderId,
                    description: claimType.description,
                    title: `Test Claim: ${claimType.description} - ${asin}`
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });

        if (insertError) {
            console.log(`   ⚠️ Could not insert into detection_results: ${insertError.message}`);

            // Try dispute_cases instead
            const { error: disputeError } = await supabase
                .from('dispute_cases')
                .insert({
                    id: claimId,
                    seller_id: userId,
                    claim_type: claimType.type,
                    status: claimType.status,
                    amount: amount,
                    currency: 'USD',
                    order_id: orderId,
                    asin: asin,
                    sku: sku,
                    description: `Test claim for matching: ${claimType.description}`,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });

            if (disputeError) {
                console.log(`   ⚠️ Could not insert into dispute_cases: ${disputeError.message}`);
            } else {
                createdCount++;
                console.log(`   ✅ Created claim in dispute_cases: ${claimType.type} for ASIN ${asin} ($${amount})`);
            }
        } else {
            createdCount++;
            console.log(`   ✅ Created claim: ${claimType.type} for ASIN ${asin} ($${amount})`);
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST CLAIMS CREATED!');
    console.log('='.repeat(60));
    console.log(`   Claims created: ${createdCount}`);
    console.log('');
    console.log('📍 Next steps:');
    console.log('   1. Go to the Evidence Matching tab');
    console.log('   2. Click "Run Matching"');
    console.log('   3. You should now see matches between your documents and these claims!');
    console.log('');
    console.log('   The matching will find claims where:');
    console.log(`   - ASIN matches: ${allExtracted.asins.slice(0, 3).join(', ')}`);
    console.log(`   - SKU matches: ${allExtracted.skus.slice(0, 3).join(', ')}`);
}

createMatchingTestClaims().catch(console.error);
