/**
 * Create Complete Test Data for Evidence Matching
 * 
 * This script creates COMPLETE test data that works with the matching engine:
 * 1. Uses existing detection_results with ASINs in evidence JSONB
 * 2. Creates dispute_cases linked to those detection_results
 * 3. This allows the Python matching engine to find and match documents
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createCompleteTestData() {
    console.log('🔧 Creating Complete Test Data for Evidence Matching\n');
    console.log('='.repeat(60));

    // Step 1: Get user ID from documents
    console.log('\n📄 Step 1: Finding user with parsed documents...');
    const { data: docs, error: docsError } = await supabase
        .from('evidence_documents')
        .select('seller_id, parsed_metadata')
        .not('parsed_metadata', 'is', null)
        .limit(1);

    if (docsError || !docs || docs.length === 0) {
        console.error('No parsed documents found');
        return;
    }

    const userId = docs[0].seller_id;
    console.log(`   User ID: ${userId}`);

    // Step 2: Get existing test detection_results with ASINs
    console.log('\n🔍 Step 2: Finding detection_results with ASINs in evidence...');
    const { data: detections, error: detectionsError } = await supabase
        .from('detection_results')
        .select('id, seller_id, evidence, estimated_value, anomaly_type, claim_number')
        .eq('seller_id', userId)
        .not('evidence', 'is', null)
        .limit(5);

    if (detectionsError) {
        console.error('Error fetching detection_results:', detectionsError.message);
        return;
    }

    // Filter to ones that have ASIN in evidence
    const detectionsWithAsin = (detections || []).filter(d => {
        const evidence = typeof d.evidence === 'string' ? JSON.parse(d.evidence) : d.evidence;
        return evidence?.asin;
    });

    console.log(`   Found ${detectionsWithAsin.length} detection_results with ASINs`);

    if (detectionsWithAsin.length === 0) {
        console.log('\n⚠️ No detection_results with ASINs. Creating new complete entries...');

        // Get ASINs from parsed documents
        const { data: allDocs } = await supabase
            .from('evidence_documents')
            .select('parsed_metadata')
            .not('parsed_metadata', 'is', null)
            .limit(10);

        const allAsins: string[] = [];
        const allSkus: string[] = [];
        (allDocs || []).forEach((doc: any) => {
            const meta = doc.parsed_metadata || {};
            if (meta.asins) allAsins.push(...meta.asins);
            if (meta.skus) allSkus.push(...meta.skus);
        });

        const uniqueAsins = [...new Set(allAsins)].slice(0, 3);
        const uniqueSkus = [...new Set(allSkus)].slice(0, 3);

        console.log(`   Found ASINs from documents: ${uniqueAsins.join(', ')}`);
        console.log(`   Found SKUs from documents: ${uniqueSkus.join(', ')}`);

        if (uniqueAsins.length === 0) {
            console.error('   No ASINs found in documents. Cannot create test data.');
            return;
        }

        // Create detection_results + dispute_cases pairs
        for (let i = 0; i < uniqueAsins.length; i++) {
            const asin = uniqueAsins[i];
            const sku = uniqueSkus[i] || `SKU-${asin}`;
            const amount = 25 + (i * 10);

            // Create detection_result
            const detectionId = uuidv4();
            const { error: drError } = await supabase
                .from('detection_results')
                .insert({
                    id: detectionId,
                    seller_id: userId,
                    sync_id: `test-sync-${Date.now()}-${i}`,
                    anomaly_type: 'missing_unit',
                    severity: 'medium',
                    estimated_value: amount,
                    currency: 'USD',
                    confidence_score: 0.85,
                    status: 'pending',
                    claim_number: `MATCH-TEST-${Date.now().toString().slice(-4)}-${i}`,
                    evidence: {
                        asin: asin,
                        sku: sku,
                        order_id: `ORDER-TEST-${Date.now()}-${i}`,
                        test_data: true,
                        description: `Test claim for matching - ASIN: ${asin}`
                    }
                });

            if (drError) {
                console.log(`   ❌ Failed to create detection_result: ${drError.message}`);
                continue;
            }

            // Create linked dispute_case
            const disputeId = uuidv4();
            const caseNumber = `CASE-${Date.now().toString().slice(-6)}-${i}`;
            const { error: dcError } = await supabase
                .from('dispute_cases')
                .insert({
                    id: disputeId,
                    seller_id: userId,
                    detection_result_id: detectionId,  // This is the critical link!
                    case_number: caseNumber,
                    status: 'pending',
                    claim_amount: amount,
                    currency: 'USD',
                    case_type: 'amazon_fba',
                    provider: 'amazon',
                    filing_status: 'pending',
                    recovery_status: 'pending'
                });

            if (dcError) {
                console.log(`   ❌ Failed to create dispute_case: ${dcError.message}`);
            } else {
                console.log(`   ✅ Created pair: detection ${detectionId.slice(0, 8)}... → dispute ${caseNumber}`);
                console.log(`      ASIN: ${asin}, SKU: ${sku}, Amount: $${amount}`);
            }
        }
    } else {
        // Create dispute_cases for existing detection_results
        console.log('\n📝 Step 3: Creating dispute_cases for existing detection_results...');

        for (const detection of detectionsWithAsin) {
            const evidence = typeof detection.evidence === 'string'
                ? JSON.parse(detection.evidence)
                : detection.evidence;

            // Check if dispute_case already exists
            const { data: existing } = await supabase
                .from('dispute_cases')
                .select('id')
                .eq('detection_result_id', detection.id)
                .limit(1);

            if (existing && existing.length > 0) {
                console.log(`   ⏭️ Dispute case already exists for ${detection.id.slice(0, 8)}...`);
                continue;
            }

            const disputeId = uuidv4();
            const caseNumber = `CASE-${Date.now().toString().slice(-6)}`;
            const { error: dcError } = await supabase
                .from('dispute_cases')
                .insert({
                    id: disputeId,
                    seller_id: userId,
                    detection_result_id: detection.id,
                    case_number: caseNumber,
                    status: 'pending',
                    claim_amount: detection.estimated_value || 35,
                    currency: 'USD',
                    case_type: 'amazon_fba',
                    provider: 'amazon',
                    filing_status: 'pending',
                    recovery_status: 'pending'
                });

            if (dcError) {
                console.log(`   ❌ Failed to create dispute_case: ${dcError.message}`);
            } else {
                console.log(`   ✅ Created dispute_case ${caseNumber} → ${detection.id.slice(0, 8)}...`);
                console.log(`      ASIN: ${evidence.asin}, SKU: ${evidence.sku}`);
            }
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST DATA SETUP COMPLETE!');
    console.log('='.repeat(60));

    console.log('\n📊 Verify the data:');

    // Count what we have
    const { count: drCount } = await supabase
        .from('detection_results')
        .select('*', { count: 'exact', head: true })
        .eq('seller_id', userId);

    const { count: dcCount } = await supabase
        .from('dispute_cases')
        .select('*', { count: 'exact', head: true })
        .eq('seller_id', userId);

    const { count: docCount } = await supabase
        .from('evidence_documents')
        .select('*', { count: 'exact', head: true })
        .eq('seller_id', userId)
        .eq('parser_status', 'completed');

    console.log(`   detection_results: ${drCount || 0}`);
    console.log(`   dispute_cases: ${dcCount || 0}`);
    console.log(`   parsed documents: ${docCount || 0}`);

    console.log('\n🎯 Next Steps:');
    console.log('   1. Go to the Evidence Matching tab in the frontend');
    console.log('   2. Click "Run Matching"');
    console.log('   3. The matching engine will:');
    console.log('      - Find dispute_cases linked to detection_results');
    console.log('      - Extract ASIN/SKU from evidence JSONB');
    console.log('      - Match against parsed documents');
    console.log('      - Create matches based on confidence scores!');
}

createCompleteTestData().catch(console.error);
