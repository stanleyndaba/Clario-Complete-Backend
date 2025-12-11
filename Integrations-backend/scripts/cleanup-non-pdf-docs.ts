/**
 * Cleanup Non-PDF Documents Script
 * Removes all non-PDF documents from the database
 * Run this to clean up accidentally ingested PNG/image files
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

async function cleanupNonPdfDocs() {
    console.log('🧹 Starting non-PDF document cleanup...\n');

    let totalDeleted = 0;
    let totalSkipped = 0;

    // Get all non-PDF documents
    console.log('📝 Finding non-PDF documents...');
    try {
        // Get documents that are NOT PDFs (PNG, JPG, etc.)
        const { data: nonPdfDocs, error: listError } = await supabase
            .from('evidence_documents')
            .select('id, filename, content_type, storage_path')
            .not('content_type', 'ilike', '%pdf%')
            .limit(2000);

        if (listError) {
            console.error('❌ Error listing documents:', listError.message);
            return;
        }

        if (!nonPdfDocs || nonPdfDocs.length === 0) {
            console.log('✅ No non-PDF documents found');
            return;
        }

        console.log(`   Found ${nonPdfDocs.length} non-PDF documents`);

        // Group by content type for summary
        const byType: Record<string, number> = {};
        for (const doc of nonPdfDocs) {
            const type = doc.content_type || 'unknown';
            byType[type] = (byType[type] || 0) + 1;
        }

        console.log('\n   By type:');
        for (const [type, count] of Object.entries(byType)) {
            console.log(`   - ${type}: ${count}`);
        }

        console.log('\n🗑️ Deleting non-PDF documents...');

        for (const doc of nonPdfDocs) {
            try {
                // Delete from storage if storage_path exists
                if (doc.storage_path) {
                    const { error: storageError } = await supabase
                        .storage
                        .from('evidence-documents')
                        .remove([doc.storage_path]);

                    if (storageError) {
                        console.log(`   ⚠️ Could not delete from storage: ${doc.storage_path}`);
                    }
                }

                // Delete from database
                const { error: deleteError } = await supabase
                    .from('evidence_documents')
                    .delete()
                    .eq('id', doc.id);

                if (!deleteError) {
                    totalDeleted++;
                    if (totalDeleted % 100 === 0) {
                        console.log(`   ✅ Deleted ${totalDeleted} documents...`);
                    }
                } else {
                    console.log(`   ⚠️ Failed to delete ${doc.id}: ${deleteError.message}`);
                    totalSkipped++;
                }
            } catch (e: any) {
                console.log(`   ⚠️ Error deleting ${doc.id}: ${e.message}`);
                totalSkipped++;
            }
        }

    } catch (e: any) {
        console.log(`   ⚠️ Error: ${e.message}`);
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('✅ CLEANUP COMPLETE!');
    console.log('='.repeat(50));
    console.log(`   Documents deleted: ${totalDeleted}`);
    console.log(`   Documents skipped: ${totalSkipped}`);
    console.log('\nNote: Only PDF documents can be parsed by the current system.');
    console.log('Non-PDF documents (PNG, JPG, etc.) require OCR which is not yet implemented.');
}

cleanupNonPdfDocs().catch(console.error);
