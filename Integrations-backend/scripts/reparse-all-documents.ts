/**
 * Re-parse all documents to extract ASINs using pdfExtractor directly
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { extractTextFromPdf, extractKeyFieldsFromText } from '../src/utils/pdfExtractor';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function reparseAllDocuments() {
    console.log('🔄 Re-parsing all documents to extract ASINs...\n');

    // Get all documents
    const { data: docs, error } = await supabase
        .from('evidence_documents')
        .select('id, filename, seller_id, storage_path')
        .limit(50);

    if (error || !docs) {
        console.error('Error fetching documents:', error?.message);
        return;
    }

    console.log(`Found ${docs.length} documents to process\n`);

    let successCount = 0;
    let asinCount = 0;

    for (const doc of docs) {
        try {
            console.log(`Processing: ${doc.filename}`);

            // Download file from storage
            const { data: fileData, error: downloadError } = await supabase.storage
                .from('evidence-documents')
                .download(doc.storage_path);

            if (downloadError || !fileData) {
                console.log(`  ❌ Download failed: ${downloadError?.message}`);
                continue;
            }

            // Convert to buffer
            const buffer = Buffer.from(await fileData.arrayBuffer());

            // Extract text from PDF
            const extractionResult = await extractTextFromPdf(buffer);
            if (!extractionResult.success || !extractionResult.text) {
                console.log(`  ⚠️ Could not extract text`);
                continue;
            }

            // Extract key fields from text
            const fields = extractKeyFieldsFromText(extractionResult.text);

            // Build parsed metadata
            const parsedMetadata = {
                ...fields,
                raw_text: extractionResult.text.substring(0, 5000), // First 5000 chars
                extraction_method: 'regex' as const,
                confidence_score: 0.8,
                // Include arrays for matching
                order_ids: fields.orderIds || [],
                asins: fields.asins || [],
                skus: fields.skus || [],
                tracking_numbers: fields.trackingNumbers || [],
                amounts: fields.amounts || [],
                dates: fields.dates || []
            };

            // Check for ASINs
            const asins = parsedMetadata.asins || [];
            if (asins.length > 0) {
                asinCount++;
                console.log(`  ✅ Found ASINs: ${asins.join(', ')}`);
            } else {
                console.log(`  ⚠️ No ASINs found`);
            }

            // Update the document with parsed_metadata
            const { error: updateError } = await supabase
                .from('evidence_documents')
                .update({
                    parsed_metadata: parsedMetadata,
                    parser_status: 'completed'
                })
                .eq('id', doc.id);

            if (updateError) {
                console.log(`  ❌ Update failed: ${updateError.message}`);
            } else {
                successCount++;
            }

        } catch (err: any) {
            console.log(`  ❌ Error: ${err.message}`);
        }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Documents processed: ${successCount}/${docs.length}`);
    console.log(`Documents with ASINs: ${asinCount}`);
}

reparseAllDocuments().catch(console.error);
