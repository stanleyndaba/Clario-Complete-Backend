/**
 * Debug Evidence Matching Test
 * Tests the matching logic against the user's actual documents and claims
 */

import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

async function debugEvidenceMatching() {
    const userId = '07b4f03d-352e-473f-a316-af97d9017d69'; // The actual user ID from the database

    console.log('\n========================================');
    console.log('🔍 DEBUG: Evidence Matching Test');
    console.log('========================================\n');

    // 1. Fetch documents
    console.log('📄 STEP 1: Fetching documents...');
    const { data: documents, error: docError } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, filename, extracted, raw_text, parser_status, seller_id')
        .eq('seller_id', userId)
        .limit(10);

    if (docError) {
        console.error('❌ Error fetching documents:', docError.message);
        return;
    }

    console.log(`Found ${documents?.length || 0} documents\n`);

    if (!documents || documents.length === 0) {
        console.log('❌ No documents found for this user!');
        return;
    }

    // 2. Analyze documents
    console.log('📋 STEP 2: Analyzing documents...');
    const docOrderIds: Map<string, any[]> = new Map();

    for (const doc of documents) {
        console.log(`\n--- Document: ${doc.filename} ---`);
        console.log(`  ID: ${doc.id}`);
        console.log(`  Parser Status: ${doc.parser_status}`);
        console.log(`  Seller ID: ${doc.seller_id}`);

        // Check extracted data
        let extracted = doc.extracted;
        if (typeof extracted === 'string') {
            try {
                extracted = JSON.parse(extracted);
            } catch {
                extracted = {};
            }
        }
        extracted = extracted || {};

        console.log(`  Extracted order_ids:`, extracted.order_ids || 'NONE');
        console.log(`  Extracted asins:`, extracted.asins || 'NONE');

        // Check raw_text for order IDs
        const rawText = doc.raw_text || '';
        console.log(`  Raw text length: ${rawText.length} chars`);
        console.log(`  Raw text preview: ${rawText.substring(0, 200)}...`);

        // Extract order IDs from raw text
        const orderIdRegex = /\b\d{3}-\d{7}-\d{7}\b/g;
        const rawOrderIds = rawText.match(orderIdRegex) || [];
        console.log(`  Order IDs found in raw_text:`, rawOrderIds.length > 0 ? rawOrderIds : 'NONE');

        // Build index
        const allOrderIds = [...new Set([...(extracted.order_ids || []), ...rawOrderIds])];
        for (const orderId of allOrderIds) {
            if (!docOrderIds.has(orderId)) docOrderIds.set(orderId, []);
            docOrderIds.get(orderId)!.push(doc);
        }
    }

    console.log('\n📊 Document Order ID Index:');
    console.log(`  Unique Order IDs found: ${docOrderIds.size}`);
    docOrderIds.forEach((docs, orderId) => {
        console.log(`    ${orderId} -> ${docs.map(d => d.filename).join(', ')}`);
    });

    // 3. Fetch claims
    console.log('\n📋 STEP 3: Fetching claims...');
    const { data: claims, error: claimsError } = await supabaseAdmin
        .from('detection_results')
        .select('id, anomaly_type, estimated_value, evidence, related_event_ids, seller_id')
        .eq('seller_id', userId)
        .limit(10);

    if (claimsError) {
        console.error('❌ Error fetching claims:', claimsError.message);
        return;
    }

    console.log(`Found ${claims?.length || 0} claims\n`);

    if (!claims || claims.length === 0) {
        console.log('❌ No claims found for this user!');
        return;
    }

    // 4. Analyze claims
    console.log('📋 STEP 4: Analyzing claims...');
    for (const claim of claims) {
        console.log(`\n--- Claim: ${claim.id} ---`);
        console.log(`  Type: ${claim.anomaly_type}`);
        console.log(`  Value: $${claim.estimated_value}`);
        console.log(`  Seller ID: ${claim.seller_id}`);
        console.log(`  Related Event IDs:`, claim.related_event_ids || 'NONE');

        // Parse evidence
        let evidence = claim.evidence;
        if (typeof evidence === 'string') {
            try {
                evidence = JSON.parse(evidence);
            } catch {
                evidence = {};
            }
        }
        evidence = evidence || {};

        console.log(`  Evidence.order_id:`, evidence.order_id || 'NONE');
        console.log(`  Evidence.asin:`, evidence.asin || 'NONE');
        console.log(`  Evidence.sku:`, evidence.sku || 'NONE');
    }

    // 5. Try matching
    console.log('\n🔗 STEP 5: Attempting matches...');
    let matchCount = 0;

    for (const claim of claims) {
        const relatedEventIds: string[] = claim.related_event_ids || [];

        for (const eventId of relatedEventIds) {
            if (docOrderIds.has(eventId)) {
                const matchedDocs = docOrderIds.get(eventId)!;
                console.log(`✅ MATCH: Claim ${claim.id.substring(0, 8)}... matched to ${matchedDocs[0].filename} via order_id ${eventId}`);
                matchCount++;
                break;
            }
        }
    }

    console.log('\n========================================');
    console.log(`📊 RESULT: ${matchCount} matches out of ${claims.length} claims`);
    console.log('========================================\n');

    // 6. Diagnose issues
    console.log('🔍 DIAGNOSIS:');
    if (docOrderIds.size === 0) {
        console.log('❌ ISSUE: No order IDs extracted from documents!');
        console.log('   -> Documents may not have order IDs in extracted field or raw_text');
        console.log('   -> Check if PDFs were properly parsed');
    }

    if (claims.every(c => !c.related_event_ids || c.related_event_ids.length === 0)) {
        console.log('❌ ISSUE: No claims have related_event_ids!');
    }

    // Show what order IDs are in claims vs documents
    console.log('\n📋 Order IDs in claims:');
    const claimOrderIds = new Set<string>();
    for (const claim of claims) {
        const eventIds = claim.related_event_ids || [];
        eventIds.forEach(id => claimOrderIds.add(id));
    }
    console.log(`  ${claimOrderIds.size > 0 ? Array.from(claimOrderIds).join(', ') : 'NONE'}`);

    console.log('\n📋 Order IDs in documents:');
    console.log(`  ${docOrderIds.size > 0 ? Array.from(docOrderIds.keys()).join(', ') : 'NONE'}`);
}

// Run the debug script
debugEvidenceMatching()
    .then(() => {
        console.log('\n✅ Debug complete');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Debug failed:', error);
        process.exit(1);
    });
