import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function debugEvidence() {
    console.log('=== Checking Dispute Cases with evidence_attachments ===\n');

    // Get ALL dispute cases to see what we have
    const { data: allCases, error: allError } = await supabaseAdmin
        .from('dispute_cases')
        .select('id, case_type, status, evidence_attachments, claim_amount')
        .order('created_at', { ascending: false })
        .limit(10);

    if (allError) {
        console.error('Error fetching cases:', allError);
        return;
    }

    console.log(`Found ${allCases?.length || 0} recent dispute cases:\n`);

    for (const c of allCases || []) {
        console.log(`Case ID: ${c.id}`);
        console.log(`  Type: ${c.case_type}`);
        console.log(`  Status: ${c.status}`);
        console.log(`  Amount: ${c.claim_amount}`);
        console.log(`  Evidence Attachments: ${JSON.stringify(c.evidence_attachments)}`);
        console.log('');
    }

    // Check for cases WITH evidence_attachments.document_id set
    console.log('\n=== Cases with document_id in evidence_attachments ===\n');

    const { data: casesWithDocs } = await supabaseAdmin
        .from('dispute_cases')
        .select('id, evidence_attachments')
        .not('evidence_attachments', 'is', null);

    const withDocId = (casesWithDocs || []).filter((c: any) => c.evidence_attachments?.document_id);
    console.log(`Found ${withDocId.length} cases with document_id in evidence_attachments`);

    for (const c of withDocId) {
        console.log(`  Case ${c.id}: document_id = ${c.evidence_attachments?.document_id}`);
    }

    // Check dispute_evidence_links table
    console.log('\n=== Checking dispute_evidence_links table ===\n');

    const { data: links, error: linksError } = await supabaseAdmin
        .from('dispute_evidence_links')
        .select('dispute_case_id, evidence_document_id')
        .limit(10);

    if (linksError) {
        console.log('Error or table does not exist:', linksError.message);
    } else {
        console.log(`Found ${links?.length || 0} evidence links`);
        for (const l of links || []) {
            console.log(`  Case ${l.dispute_case_id} -> Doc ${l.evidence_document_id}`);
        }
    }

    // Check evidence_documents table
    console.log('\n=== Recent Evidence Documents ===\n');

    const { data: docs } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, filename, doc_type')
        .order('created_at', { ascending: false })
        .limit(5);

    console.log(`Found ${docs?.length || 0} recent documents`);
    for (const d of docs || []) {
        console.log(`  ${d.id}: ${d.filename} (${d.doc_type})`);
    }
}

debugEvidence().catch(console.error);
