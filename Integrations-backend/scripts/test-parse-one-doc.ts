/**
 * Manual test to parse ONE document and see what happens
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import documentParsingWorker from '../src/workers/documentParsingWorker';
import documentParsingService from '../src/services/documentParsingService';

async function main() {
    console.log('\n=== Manual Document Parsing Test ===\n');

    // Get one pending document
    const { data: doc, error } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, seller_id, filename, content_type, storage_path')
        .eq('parser_status', 'pending')
        .limit(1)
        .single();

    if (error || !doc) {
        console.log('No pending document to test with');
        console.log('Error:', error?.message);
        return;
    }

    console.log('Found document to test:');
    console.log('  ID:', doc.id);
    console.log('  Seller:', doc.seller_id);
    console.log('  Filename:', doc.filename);
    console.log('  Storage Path:', doc.storage_path);
    console.log('  Content Type:', doc.content_type);

    // Try to trigger parsing
    console.log('\nAttempting to parse via service...');
    try {
        const result = await documentParsingService.triggerParsing(doc.id, doc.seller_id);
        console.log('Trigger result:', JSON.stringify(result, null, 2));
    } catch (err: any) {
        console.log('ERROR from triggerParsing:', err.message);
        if (err.response?.data) {
            console.log('API Response:', JSON.stringify(err.response.data, null, 2));
        }
    }

    // Check document status after attempt
    const { data: updated } = await supabaseAdmin
        .from('evidence_documents')
        .select('parser_status, parser_error')
        .eq('id', doc.id)
        .single();

    console.log('\nDocument status after parsing attempt:', updated);

    console.log('\n=== End Test ===\n');
}

main().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e); process.exit(1); });
