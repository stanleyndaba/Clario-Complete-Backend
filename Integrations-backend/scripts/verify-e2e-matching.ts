/**
 * Verify E2E Matching Setup - Fixed version
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifySetup() {
    console.log('=== VERIFICATION: E2E Matching Setup ===\n');

    // Get user ID
    const { data: anyDoc } = await supabase
        .from('evidence_documents')
        .select('seller_id')
        .limit(1)
        .single();

    const userId = anyDoc?.seller_id;
    console.log('User ID:', userId);

    // 1. Get ALL detection_results and check which have ASIN in evidence
    console.log('\n--- DETECTION RESULTS ---');
    const { data: allDetections } = await supabase
        .from('detection_results')
        .select('id, seller_id, evidence, estimated_value, claim_number')
        .eq('seller_id', userId);

    const detectionsWithAsin: any[] = [];
    (allDetections || []).forEach((d: any) => {
        if (d.evidence) {
            const ev = typeof d.evidence === 'string' ? JSON.parse(d.evidence) : d.evidence;
            if (ev.asin) {
                detectionsWithAsin.push({ ...d, asin: ev.asin, sku: ev.sku });
            }
        }
    });

    console.log('Total detection_results:', allDetections?.length || 0);
    console.log('With ASINs in evidence:', detectionsWithAsin.length);
    detectionsWithAsin.forEach(d => {
        console.log(`  - ${d.claim_number}: ASIN=${d.asin}, SKU=${d.sku}, $${d.estimated_value}`);
    });

    // 2. Check if those detection_results have linked dispute_cases
    console.log('\n--- DISPUTE CASES ---');
    const detectionIds = detectionsWithAsin.map(d => d.id);
    const { data: linkedDisputes } = await supabase
        .from('dispute_cases')
        .select('id, case_number, detection_result_id, status')
        .in('detection_result_id', detectionIds.length > 0 ? detectionIds : ['none']);

    console.log('Linked dispute_cases:', linkedDisputes?.length || 0);
    (linkedDisputes || []).forEach((dc: any) => {
        console.log(`  - ${dc.case_number}: status=${dc.status}`);
    });

    // 3. Check parsed documents for ASINs
    console.log('\n--- PARSED DOCUMENTS ---');
    const { data: allDocs } = await supabase
        .from('evidence_documents')
        .select('id, filename, parsed_metadata, parser_status')
        .eq('seller_id', userId);

    const docsWithAsins: any[] = [];
    const allDocAsins: string[] = [];

    (allDocs || []).forEach((d: any) => {
        if (d.parsed_metadata) {
            const meta = typeof d.parsed_metadata === 'string' ? JSON.parse(d.parsed_metadata) : d.parsed_metadata;
            if (meta.asins && meta.asins.length > 0) {
                docsWithAsins.push({ filename: d.filename, asins: meta.asins });
                allDocAsins.push(...meta.asins);
            }
        }
    });

    console.log('Total documents:', allDocs?.length || 0);
    console.log('Parsed documents:', allDocs?.filter((d: any) => d.parser_status === 'completed').length || 0);
    console.log('With ASINs:', docsWithAsins.length);
    docsWithAsins.forEach(d => {
        console.log(`  - ${d.filename}: ${d.asins.join(', ')}`);
    });

    // 4. Check for ASIN overlap
    console.log('\n=== MATCHING POTENTIAL ===');
    const claimAsins = [...new Set(detectionsWithAsin.map(d => d.asin))];
    const docAsins = [...new Set(allDocAsins)];
    const overlap = claimAsins.filter(a => docAsins.includes(a));

    console.log('Claim ASINs:', claimAsins);
    console.log('Document ASINs:', docAsins);
    console.log('OVERLAP:', overlap);

    if (overlap.length > 0) {
        console.log('\n✅ MATCHING SHOULD FIND ' + overlap.length + ' ASIN matches!');
    } else {
        console.log('\n❌ NO OVERLAP - Need to either:');
        console.log('   1. Re-parse documents to extract ASINs');
        console.log('   2. Create claims with ASINs that are in documents');
    }
}

verifySetup().catch(console.error);
