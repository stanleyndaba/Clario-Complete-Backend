/**
 * Simulate the exact matching flow that evidenceMatchingService uses
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function simulateMatchingFlow() {
    console.log('=== SIMULATING MATCHING FLOW ===\n');

    const userId = '07b4f03d-352e-473f-a316-af97d9017d69';

    // Step 1: Fetch claims (exactly like runMatchingWithRetry)
    console.log('Step 1: Fetching claims from detection_results...');
    const { data: detections, error: detError } = await supabase
        .from('detection_results')
        .select('id, seller_id, anomaly_type, estimated_value, currency, evidence, confidence_score, claim_number')
        .eq('seller_id', userId)
        .not('evidence', 'is', null);

    if (detError) {
        console.log('  ❌ Error:', detError.message);
        return;
    }

    const claims = (detections || []).map((d: any) => {
        const ev = typeof d.evidence === 'string' ? JSON.parse(d.evidence) : (d.evidence || {});
        return {
            claim_id: d.id,
            claim_type: d.anomaly_type || 'unknown',
            amount: d.estimated_value || 0,
            evidence: ev,
            asin: ev.asin,
            sku: ev.sku,
            order_id: ev.order_id
        };
    });

    console.log(`  Found ${claims.length} claims`);
    claims.forEach((c: any) => {
        console.log(`    - ${c.claim_id.slice(0, 8)}...: ASIN=${c.asin}, SKU=${c.sku}`);
    });

    // Step 2: Fetch parsed documents (exactly like matchClaimsToDocuments)
    console.log('\nStep 2: Fetching parsed documents...');
    const { data: documents, error: docError } = await supabase
        .from('evidence_documents')
        .select('id, filename, parsed_metadata, storage_path')
        .eq('seller_id', userId)
        .eq('parser_status', 'completed')
        .not('parsed_metadata', 'is', null);

    if (docError) {
        console.log('  ❌ Error:', docError.message);
        return;
    }

    console.log(`  Found ${documents?.length || 0} parsed documents`);

    // Step 3: Build ASIN/SKU index (exactly like matchClaimsToDocuments)
    console.log('\nStep 3: Building ASIN/SKU index...');
    const docAsins: Map<string, any[]> = new Map();
    const docSkus: Map<string, any[]> = new Map();

    for (const doc of documents || []) {
        const meta = typeof doc.parsed_metadata === 'string'
            ? JSON.parse(doc.parsed_metadata)
            : doc.parsed_metadata;

        const asins = meta?.asins || [];
        const skus = meta?.skus || [];

        for (const asin of asins) {
            if (!docAsins.has(asin)) docAsins.set(asin, []);
            docAsins.get(asin)!.push(doc);
        }

        for (const sku of skus) {
            if (!docSkus.has(sku)) docSkus.set(sku, []);
            docSkus.get(sku)!.push(doc);
        }
    }

    console.log(`  Unique ASINs in documents: ${docAsins.size}`);
    console.log(`  ASINs: ${[...docAsins.keys()].join(', ')}`);
    console.log(`  Unique SKUs in documents: ${docSkus.size}`);

    // Step 4: Match claims to documents
    console.log('\nStep 4: Matching claims to documents...');
    let matchCount = 0;

    for (const claim of claims) {
        const claimAsin = claim.asin || claim.evidence?.asin;
        const claimSku = claim.sku || claim.evidence?.sku;

        console.log(`  Checking claim ${claim.claim_id.slice(0, 8)}...`);
        console.log(`    Claim ASIN: "${claimAsin}"`);
        console.log(`    Claim SKU: "${claimSku}"`);

        let matched = false;

        if (claimAsin && docAsins.has(claimAsin)) {
            const docs = docAsins.get(claimAsin)!;
            console.log(`    ✅ ASIN MATCH! Found in ${docs.length} documents`);
            matchCount++;
            matched = true;
        }

        if (!matched && claimSku && docSkus.has(claimSku)) {
            const docs = docSkus.get(claimSku)!;
            console.log(`    ✅ SKU MATCH! Found in ${docs.length} documents`);
            matchCount++;
            matched = true;
        }

        if (!matched) {
            console.log(`    ❌ NO MATCH`);
        }
    }

    console.log('\n=== RESULT ===');
    console.log(`Claims: ${claims.length}`);
    console.log(`Documents: ${documents?.length || 0}`);
    console.log(`Matches: ${matchCount}`);
}

simulateMatchingFlow().catch(console.error);
