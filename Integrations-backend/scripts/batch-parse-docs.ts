/**
 * Batch Document Parsing Trigger
 * Triggers parsing for multiple pending documents
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import { documentParsingService } from '../src/services/documentParsingService';

const BATCH_SIZE = 10; // How many documents to parse in this batch

async function batchParse() {
    console.log('\n=== BATCH DOCUMENT PARSING ===\n');

    // 1. Get pending documents
    const { data: pendingDocs, error } = await supabaseAdmin
        .from('evidence_documents')
        .select('id, seller_id, filename, storage_path, content_type')
        .eq('parser_status', 'pending')
        .limit(BATCH_SIZE);

    if (error) {
        console.log('Error fetching documents:', error.message);
        return;
    }

    if (!pendingDocs || pendingDocs.length === 0) {
        console.log('No pending documents found');
        return;
    }

    console.log(`Found ${pendingDocs.length} pending documents to parse\n`);

    // 2. Trigger parsing for each document
    const results: Array<{ id: string; success: boolean; job_id?: string; error?: string }> = [];
    for (const doc of pendingDocs) {
        console.log(`Processing: ${doc.filename}`);
        console.log(`  ID: ${doc.id}`);
        console.log(`  User: ${doc.seller_id}`);

        try {
            const result = await documentParsingService.triggerParsing(doc.id, doc.seller_id);
            console.log(`  Result: ${result.status} - ${result.message || result.job_id}`);
            results.push({ id: doc.id, success: true, job_id: result.job_id });
        } catch (err: any) {
            console.log(`  ERROR: ${err.message}`);
            results.push({ id: doc.id, success: false, error: err.message });
        }
        console.log('');
    }

    // 3. Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('=== SUMMARY ===');
    console.log(`Total processed: ${results.length}`);
    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
        console.log('\nFailed documents:');
        results.filter(r => !r.success).forEach(r => {
            console.log(`  ${r.id}: ${r.error}`);
        });
    }

    console.log('\n=== END BATCH PARSING ===\n');
}

batchParse()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
