/**
 * Cleanup duplicate documents - keeps oldest version of each filename
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function cleanupDuplicates() {
    console.log('🧹 Cleaning up duplicate documents...\n');

    // Get all documents grouped by filename
    const { data: docs, error } = await supabase
        .from('evidence_documents')
        .select('id, filename, storage_path, created_at')
        .order('filename')
        .order('created_at'); // Oldest first

    if (error || !docs) {
        console.error('Error:', error?.message);
        return;
    }

    console.log(`Total documents: ${docs.length}`);

    // Group by filename
    const byName: { [key: string]: any[] } = {};
    docs.forEach((d: any) => {
        if (!byName[d.filename]) byName[d.filename] = [];
        byName[d.filename].push(d);
    });

    // Find duplicates (keep first/oldest, delete rest)
    const toDelete: string[] = [];
    const storagePaths: string[] = [];

    Object.entries(byName).forEach(([filename, copies]) => {
        if (copies.length > 1) {
            // Keep first (oldest), delete rest
            const keep = copies[0];
            const duplicates = copies.slice(1);
            duplicates.forEach((d: any) => {
                toDelete.push(d.id);
                if (d.storage_path) storagePaths.push(d.storage_path);
            });
            console.log(`  ${filename}: keeping 1, deleting ${duplicates.length} duplicates`);
        }
    });

    if (toDelete.length === 0) {
        console.log('\n✅ No duplicates found!');
        return;
    }

    console.log(`\n📊 Summary:`);
    console.log(`  Documents to delete: ${toDelete.length}`);
    console.log(`  Documents to keep: ${docs.length - toDelete.length}`);

    // Delete duplicates from database in batches
    console.log('\n🗑️ Deleting duplicates from database...');
    for (let i = 0; i < toDelete.length; i += 100) {
        const batch = toDelete.slice(i, i + 100);
        const { error: deleteError } = await supabase
            .from('evidence_documents')
            .delete()
            .in('id', batch);

        if (deleteError) {
            console.error(`  ❌ Delete error (batch ${Math.floor(i / 100) + 1}):`, deleteError.message);
        } else {
            console.log(`  ✅ Deleted batch ${Math.floor(i / 100) + 1}: ${batch.length} records`);
        }
    }

    // Delete from storage
    if (storagePaths.length > 0) {
        console.log('\n🗑️ Deleting files from storage...');
        // Delete in batches to avoid timeout
        for (let i = 0; i < storagePaths.length; i += 50) {
            const batch = storagePaths.slice(i, i + 50);
            const { error: storageError } = await supabase.storage
                .from('evidence-documents')
                .remove(batch);

            if (storageError) {
                console.log(`  ⚠️ Storage error (batch ${i / 50 + 1}): ${storageError.message}`);
            } else {
                console.log(`  ✅ Deleted batch ${i / 50 + 1}: ${batch.length} files`);
            }
        }
    }

    // Final count
    const { count: finalCount } = await supabase
        .from('evidence_documents')
        .select('*', { count: 'exact', head: true });

    console.log(`\n✅ Cleanup complete! Documents remaining: ${finalCount}`);
}

cleanupDuplicates().catch(console.error);
