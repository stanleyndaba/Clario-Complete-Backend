import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function testApiLogic() {
    // Use one of the 2 cases with matched evidence
    const caseId = 'bbb8246a-1a9b-45cb-b6bc-4ae8dd2bd0d4';

    console.log(`\n=== Testing API logic for case ${caseId} ===\n`);

    // Step 1: Fetch dispute case
    const { data: disputeCase, error: caseError } = await supabaseAdmin
        .from('dispute_cases')
        .select('*')
        .eq('id', caseId)
        .single();

    if (caseError || !disputeCase) {
        console.log('Case not found:', caseError);
        return;
    }

    console.log('Dispute Case found:', {
        id: disputeCase.id,
        case_type: disputeCase.case_type,
        status: disputeCase.status,
        evidence_attachments: disputeCase.evidence_attachments
    });

    // Step 2: Check dispute_evidence_links (like the API does)
    const { data: docLinks, error: linksError } = await supabaseAdmin
        .from('dispute_evidence_links')
        .select('evidence_document_id')
        .eq('dispute_case_id', caseId);

    console.log('\nDispute Evidence Links:', docLinks, 'Error:', linksError);

    let documents: any[] = [];

    // Step 3: Same logic as recoveryRoutes.ts
    if (docLinks && docLinks.length > 0) {
        console.log('Using docLinks path...');
        const docIds = docLinks.map(l => l.evidence_document_id);
        const { data: docs } = await supabaseAdmin
            .from('evidence_documents')
            .select('id, filename, doc_type, source_type, created_at, metadata')
            .in('id', docIds);
        documents = docs || [];
    } else if (disputeCase.evidence_attachments?.document_id) {
        console.log('Using evidence_attachments path...');
        const { data: matchedDoc, error: docError } = await supabaseAdmin
            .from('evidence_documents')
            .select('id, filename, doc_type, source_type, created_at, metadata')
            .eq('id', disputeCase.evidence_attachments.document_id)
            .single();

        console.log('Matched doc result:', matchedDoc, 'Error:', docError);

        if (matchedDoc) {
            documents = [{
                ...matchedDoc,
                matchConfidence: disputeCase.evidence_attachments?.match_confidence,
                matchType: disputeCase.evidence_attachments?.match_type,
                matchedFields: disputeCase.evidence_attachments?.matched_fields,
            }];
        }
    } else {
        console.log('No evidence path matched!');
        console.log('evidence_attachments:', disputeCase.evidence_attachments);
    }

    console.log('\n=== FINAL DOCUMENTS ARRAY ===');
    console.log(JSON.stringify(documents, null, 2));
    console.log(`Total documents found: ${documents.length}`);
}

testApiLogic().catch(console.error);
