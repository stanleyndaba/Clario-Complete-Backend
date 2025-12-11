/**
 * Test Document Parsing on Real Documents
 * Fetches unparsed documents and tests the pdfExtractor
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testDocumentParsing() {
    console.log('📄 Testing Document Parsing on Real Documents\n');

    // Get recent PDF documents
    const { data: docs, error } = await supabase
        .from('evidence_documents')
        .select('id, filename, content_type, storage_path, parsed_metadata, created_at')
        .or('content_type.ilike.%pdf%,filename.ilike.%.pdf')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error fetching documents:', error.message);
        return;
    }

    console.log(`Found ${docs?.length || 0} PDF documents\n`);

    if (!docs || docs.length === 0) {
        console.log('No PDF documents found in database');
        return;
    }

    // Import pdfExtractor
    const pdfExtractor = (await import('../src/utils/pdfExtractor')).default;

    for (const doc of docs) {
        console.log('='.repeat(60));
        console.log(`📄 Document: ${doc.filename}`);
        console.log(`   ID: ${doc.id}`);
        console.log(`   Created: ${doc.created_at}`);
        console.log(`   Has parsed_metadata: ${!!doc.parsed_metadata}`);

        if (doc.parsed_metadata) {
            console.log(`   Parsed Data:`, JSON.stringify(doc.parsed_metadata, null, 2).substring(0, 500));
            continue;
        }

        // Try to parse
        if (!doc.storage_path) {
            console.log('   ⚠️ No storage_path - cannot parse');
            continue;
        }

        console.log(`   Storage Path: ${doc.storage_path}`);
        console.log('   🔄 Attempting to parse...');

        try {
            // Download PDF
            const { data: fileData, error: downloadError } = await supabase
                .storage
                .from('evidence-documents')
                .download(doc.storage_path);

            if (downloadError || !fileData) {
                console.log(`   ❌ Download failed: ${downloadError?.message}`);
                continue;
            }

            const buffer = Buffer.from(await fileData.arrayBuffer());
            console.log(`   Downloaded: ${buffer.length} bytes`);

            // Extract text
            const extractionResult = await pdfExtractor.extractTextFromPdf(buffer);

            if (!extractionResult.success) {
                console.log(`   ❌ Extraction failed: ${extractionResult.error}`);
                continue;
            }

            console.log(`   ✅ Extracted ${extractionResult.text?.length || 0} characters from ${extractionResult.pageCount} pages`);

            // Show first 500 chars of raw text
            console.log('\n   📝 Raw Text Preview:');
            console.log('   ' + (extractionResult.text?.substring(0, 500).replace(/\n/g, '\n   ') || 'No text'));

            // Extract key fields
            const keyFields = pdfExtractor.extractKeyFieldsFromText(extractionResult.text || '');

            console.log('\n   🔍 Extracted Fields:');
            console.log(`   - Order IDs: ${keyFields.orderIds.join(', ') || 'None'}`);
            console.log(`   - ASINs: ${keyFields.asins.join(', ') || 'None'}`);
            console.log(`   - SKUs: ${keyFields.skus.join(', ') || 'None'}`);
            console.log(`   - Tracking #s: ${keyFields.trackingNumbers.join(', ') || 'None'}`);
            console.log(`   - Invoice #s: ${keyFields.invoiceNumbers.join(', ') || 'None'}`);
            console.log(`   - Amounts: ${keyFields.amounts.join(', ') || 'None'}`);
            console.log(`   - Dates: ${keyFields.dates.join(', ') || 'None'}`);

        } catch (e: any) {
            console.log(`   ❌ Error: ${e.message}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Done!');
}

testDocumentParsing().catch(console.error);
