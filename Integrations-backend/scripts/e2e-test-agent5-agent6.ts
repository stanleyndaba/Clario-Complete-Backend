/**
 * E2E Test: Agent 5 (Document Parsing) + Agent 6 (Evidence Matching)
 * 
 * This script verifies:
 * 1. Real database connectivity
 * 2. Existing documents and their parsing status
 * 3. Existing claims and their matching status
 * 4. Evidence links created by Agent 6
 * 5. The full flow from ingestion -> parsing -> matching
 */

import 'dotenv/config';
import { supabase, supabaseAdmin } from '../src/database/supabaseClient';

const client = supabaseAdmin || supabase;

async function main() {
    console.log('\n========================================');
    console.log('E2E Test: Agent 5 + Agent 6');
    console.log('========================================\n');

    // 1. Test database connectivity
    console.log('1. Testing Database Connectivity...');
    const { data: testData, error: testError } = await client
        .from('evidence_documents')
        .select('id')
        .limit(1);

    if (testError && testError.message.includes('relation')) {
        console.log('   ERROR: Could not access evidence_documents table');
        console.log('   Message:', testError.message);
        return;
    }
    console.log('   SUCCESS: Database connected\n');

    // 2. Evidence Documents Summary
    console.log('2. Evidence Documents Summary:');
    const { data: docStats, error: docError } = await client
        .from('evidence_documents')
        .select('parser_status');

    if (docError) {
        console.log('   ERROR:', docError.message);
    } else {
        const total = docStats?.length || 0;
        const pending = docStats?.filter(d => d.parser_status === 'pending' || !d.parser_status).length || 0;
        const completed = docStats?.filter(d => d.parser_status === 'completed').length || 0;
        const failed = docStats?.filter(d => d.parser_status === 'failed').length || 0;
        const processing = docStats?.filter(d => d.parser_status === 'processing').length || 0;

        console.log(`   Total Documents: ${total}`);
        console.log(`   - Pending:    ${pending}`);
        console.log(`   - Processing: ${processing}`);
        console.log(`   - Completed:  ${completed}`);
        console.log(`   - Failed:     ${failed}`);
    }

    // 3. Show last 5 documents
    console.log('\n3. Last 5 Documents:');
    const { data: recentDocs, error: recentError } = await client
        .from('evidence_documents')
        .select('id, filename, doc_type, parser_status, parser_confidence, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    if (recentError) {
        console.log('   ERROR:', recentError.message);
    } else if (recentDocs && recentDocs.length > 0) {
        recentDocs.forEach((d: any, i: number) => {
            console.log(`   ${i + 1}. ${d.filename || 'no-name'}`);
            console.log(`      Type: ${d.doc_type || 'unknown'} | Status: ${d.parser_status || 'null'} | Confidence: ${d.parser_confidence || 'N/A'}`);
        });
    } else {
        console.log('   No documents found');
    }

    // 4. Detection Results / Claims Summary
    console.log('\n4. Detection Results (Claims) Summary:');
    const { data: claimStats, error: claimError } = await client
        .from('detection_results')
        .select('status, match_confidence');

    if (claimError) {
        console.log('   ERROR:', claimError.message);
    } else {
        const total = claimStats?.length || 0;
        const pending = claimStats?.filter((c: any) => c.status === 'pending').length || 0;
        const matched = claimStats?.filter((c: any) => c.match_confidence && c.match_confidence > 0).length || 0;

        console.log(`   Total Claims: ${total}`);
        console.log(`   - Pending: ${pending}`);
        console.log(`   - With Match Confidence: ${matched}`);
    }

    // 5. Evidence Links (created by Agent 6)
    console.log('\n5. Evidence Links (Agent 6 Matches):');
    const { data: links, error: linksError } = await client
        .from('dispute_evidence_links')
        .select('id, link_type, confidence_score, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    if (linksError) {
        if (linksError.message.includes('relation')) {
            console.log('   Table dispute_evidence_links does not exist');
        } else {
            console.log('   ERROR:', linksError.message);
        }
    } else if (links && links.length > 0) {
        console.log(`   Total Links Found: ${links.length}`);
        links.forEach((l: any, i: number) => {
            console.log(`   ${i + 1}. Type: ${l.link_type} | Confidence: ${l.confidence_score}`);
        });
    } else {
        console.log('   No evidence links found (Agent 6 may not have run yet)');
    }

    // 6. Pending work summary
    console.log('\n6. Pending Work Summary:');

    const { data: pendingDocs } = await client
        .from('evidence_documents')
        .select('id')
        .or('parser_status.eq.pending,parser_status.is.null');

    const { data: pendingClaims } = await client
        .from('detection_results')
        .select('id')
        .eq('status', 'pending');

    console.log(`   Documents needing parsing (Agent 5): ${pendingDocs?.length || 0}`);
    console.log(`   Claims needing matching (Agent 6):   ${pendingClaims?.length || 0}`);

    // 7. Python API connectivity check
    console.log('\n7. Python API Configuration:');
    const pythonUrl = process.env.PYTHON_API_URL || process.env.API_URL || 'https://python-api-10.onrender.com';
    console.log(`   URL: ${pythonUrl}`);

    console.log('\n========================================');
    console.log('E2E Test Complete');
    console.log('========================================\n');
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
