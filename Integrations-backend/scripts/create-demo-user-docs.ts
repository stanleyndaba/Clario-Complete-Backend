/**
 * Create matching documents for demo-user's claims
 * This will enable matching to work in sandbox mode
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createDemoUserDocuments() {
    console.log('=== Creating documents for demo-user ===\n');

    // Get demo-user's claims with ASINs
    const { data: claims, error } = await supabase
        .from('detection_results')
        .select('id, claim_number, evidence, anomaly_type')
        .eq('seller_id', 'demo-user')
        .not('evidence', 'is', null)
        .limit(10);

    if (error) {
        console.error('Error fetching claims:', error.message);
        return;
    }

    console.log(`Found ${claims?.length || 0} claims for demo-user`);

    // Extract unique ASINs from claims
    const asins = new Set<string>();
    const skus = new Set<string>();

    for (const claim of claims || []) {
        const ev = typeof claim.evidence === 'string'
            ? JSON.parse(claim.evidence)
            : claim.evidence;

        if (ev?.asin) asins.add(ev.asin);
        if (ev?.sku) skus.add(ev.sku);

        console.log(`  Claim ${claim.claim_number}: ASIN=${ev?.asin}, SKU=${ev?.sku}`);
    }

    console.log(`\nUnique ASINs: ${[...asins].join(', ')}`);
    console.log(`Unique SKUs: ${[...skus].join(', ')}`);

    if (asins.size === 0) {
        console.log('\n⚠️ No ASINs found in demo-user claims. Adding test ASINs to claims...');

        // Update first 3 claims with test ASINs
        const testAsins = ['B09XK7M2P4', 'B09YH3N8R1', 'B09ZK8P7T3'];
        const claimsToUpdate = (claims || []).slice(0, 3);

        for (let i = 0; i < claimsToUpdate.length; i++) {
            const claim = claimsToUpdate[i];
            const ev = typeof claim.evidence === 'string'
                ? JSON.parse(claim.evidence)
                : (claim.evidence || {});

            ev.asin = testAsins[i];
            ev.sku = `SKU-${testAsins[i].slice(-4)}`;

            const { error: updateError } = await supabase
                .from('detection_results')
                .update({ evidence: ev })
                .eq('id', claim.id);

            if (updateError) {
                console.log(`  ❌ Failed to update claim ${claim.id}: ${updateError.message}`);
            } else {
                console.log(`  ✅ Updated claim ${claim.claim_number} with ASIN=${testAsins[i]}`);
                asins.add(testAsins[i]);
            }
        }
    }

    // Now create documents with these ASINs
    console.log('\n--- Creating documents with matching ASINs ---');

    // Copy existing parsed documents from real user to demo-user
    const { data: existingDocs } = await supabase
        .from('evidence_documents')
        .select('*')
        .eq('seller_id', '07b4f03d-352e-473f-a316-af97d9017d69')
        .eq('parser_status', 'completed')
        .limit(5);

    if (!existingDocs || existingDocs.length === 0) {
        console.log('No existing docs to copy. Creating new ones...');
        return;
    }

    console.log(`Found ${existingDocs.length} docs from real user to copy`);

    for (const doc of existingDocs) {
        // Create copy for demo-user
        const newDoc = {
            ...doc,
            id: undefined, // Let DB generate new ID
            seller_id: 'demo-user',
            user_id: 'demo-user',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        delete newDoc.id;

        const { data: inserted, error: insertError } = await supabase
            .from('evidence_documents')
            .insert(newDoc)
            .select()
            .single();

        if (insertError) {
            console.log(`  ❌ Failed to copy ${doc.filename}: ${insertError.message}`);
        } else {
            console.log(`  ✅ Copied ${doc.filename} to demo-user`);
        }
    }

    console.log('\n=== Done! demo-user should now have matching documents ===');
}

createDemoUserDocuments().catch(console.error);
