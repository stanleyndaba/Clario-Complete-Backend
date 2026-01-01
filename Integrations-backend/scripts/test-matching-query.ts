import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function testMatchingQuery() {
    console.log('=== Testing Matching Query ===\n');

    try {
        // Query dispute_cases that have evidence_attachments with document_id set
        const { data: casesWithEvidence, error: casesError } = await supabaseAdmin
            .from('dispute_cases')
            .select('id, case_type, status, claim_amount, evidence_attachments, created_at, sku')
            .not('evidence_attachments', 'is', null)
            .order('created_at', { ascending: false })
            .limit(10);

        if (casesError) {
            console.error('Query Error:', casesError);
            return;
        }

        console.log(`Found ${casesWithEvidence?.length || 0} cases with evidence_attachments not null\n`);

        // Filter to only cases that have document_id
        const matchedCases = (casesWithEvidence || []).filter((c: any) =>
            c.evidence_attachments?.document_id
        );

        console.log(`Filtered to ${matchedCases.length} cases with document_id\n`);

        for (const c of matchedCases) {
            console.log(`Case: ${c.id}`);
            console.log(`  Type: ${c.case_type}`);
            console.log(`  Status: ${c.status}`);
            console.log(`  Evidence Attachments: ${JSON.stringify(c.evidence_attachments)}`);
            console.log('');
        }

        // Test fetching a document
        if (matchedCases.length > 0) {
            const docId = matchedCases[0].evidence_attachments?.document_id;
            console.log(`\nFetching document ${docId}...`);

            const { data: doc, error: docError } = await supabaseAdmin
                .from('evidence_documents')
                .select('id, filename, doc_type, created_at, metadata')
                .eq('id', docId)
                .single();

            if (docError) {
                console.error('Document fetch error:', docError);
            } else {
                console.log('Document found:', doc);
            }
        }

        console.log('\n✅ Query works correctly!');
    } catch (err: any) {
        console.error('Exception:', err.message);
        console.error(err.stack);
    }
}

testMatchingQuery();
