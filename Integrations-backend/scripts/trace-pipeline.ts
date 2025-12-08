import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function traceData() {
    console.log('=== PIPELINE DATA TRACE ===\n');

    // 1. Detection Results (Agent 3 output)
    const { data: detections, count: detCount } = await supabaseAdmin
        .from('detection_results')
        .select('id, status, anomaly_type, estimated_value', { count: 'exact' });
    console.log('1. DETECTION RESULTS (Agent 3):');
    console.log('   Total claims:', detCount);
    const statusCounts = detections?.reduce((acc: any, d: any) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
    }, {});
    console.log('   By status:', statusCounts);
    const typeCounts = detections?.reduce((acc: any, d: any) => {
        acc[d.anomaly_type] = (acc[d.anomaly_type] || 0) + 1;
        return acc;
    }, {});
    console.log('   By type:', typeCounts);

    // 2. Evidence Documents (Agent 4/5 input)
    const { data: docs, count: docCount } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, parser_status, filename', { count: 'exact' });
    console.log('\n2. EVIDENCE DOCUMENTS (Agent 4/5):');
    console.log('   Total docs:', docCount);
    const parserCounts = docs?.reduce((acc: any, d: any) => {
        acc[d.parser_status || 'null'] = (acc[d.parser_status || 'null'] || 0) + 1;
        return acc;
    }, {});
    console.log('   By parser_status:', parserCounts);

    // 3. Evidence Links (Agent 6 output)
    const { data: links, count: linkCount } = await supabaseAdmin
        .from('dispute_evidence_links')
        .select('id, claim_id, document_id, link_type', { count: 'exact' });
    console.log('\n3. EVIDENCE LINKS (Agent 6):');
    console.log('   Total links:', linkCount);
    if (links && links.length > 0) {
        console.log('   Sample:', links.slice(0, 2));
    } else {
        console.log('   >>> NO LINKS - Agent 6 has not matched any documents to claims');
    }

    // 4. Dispute Cases (Agent 7 output)
    const { data: disputes, count: dispCount } = await supabaseAdmin
        .from('dispute_cases')
        .select('id, status, claim_type', { count: 'exact' });
    console.log('\n4. DISPUTE CASES (Agent 7):');
    console.log('   Total cases:', dispCount);
    if (disputes && disputes.length > 0) {
        const caseStatus = disputes.reduce((acc: any, d: any) => {
            acc[d.status] = (acc[d.status] || 0) + 1;
            return acc;
        }, {});
        console.log('   By status:', caseStatus);
    }

    console.log('\n=== PIPELINE SUMMARY ===');
    console.log('Agent 3 (Detection):', detCount, 'claims detected');
    console.log('Agent 4/5 (Documents):', docCount, 'documents ingested');
    console.log('Agent 6 (Matching):', linkCount, 'evidence links created');
    console.log('Agent 7 (Filing):', dispCount, 'dispute cases');

    if (linkCount === 0 && docCount && docCount > 0) {
        console.log('\n>>> BREAKPOINT: Agent 6 has not created any evidence links');
        console.log('    Check if Agent 5 has parsed the documents (parser_status = completed)');
    }
    if (linkCount === 0 && (!docCount || docCount === 0)) {
        console.log('\n>>> BREAKPOINT: No documents for Agent 6 to match');
        console.log('    Run Agent 4 (Evidence Ingestion) first');
    }

    console.log('\n=== END TRACE ===');
}

traceData().catch(console.error);
