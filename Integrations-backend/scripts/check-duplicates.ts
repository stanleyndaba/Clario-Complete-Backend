/**
 * Check for duplicate documents in the database
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDuplicates() {
    console.log('🔍 Checking for duplicate documents...\n');

    const { data, count, error } = await supabase
        .from('evidence_documents')
        .select('id, filename, provider, storage_path, created_at', { count: 'exact' })
        .order('filename');

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log(`Total documents: ${count || data?.length || 0}`);

    // Group by filename
    const byName: { [key: string]: any[] } = {};
    (data || []).forEach((d: any) => {
        if (!byName[d.filename]) byName[d.filename] = [];
        byName[d.filename].push(d);
    });

    const uniqueCount = Object.keys(byName).length;
    const duplicates = Object.entries(byName).filter(([_, docs]) => docs.length > 1);

    console.log(`Unique filenames: ${uniqueCount}`);
    console.log(`Duplicate filenames: ${duplicates.length}`);

    if (duplicates.length > 0) {
        console.log('\n📋 Duplicate examples:');
        duplicates.slice(0, 10).forEach(([name, docs]) => {
            console.log(`  - "${name}": ${docs.length} copies`);
            docs.forEach((d: any) => {
                console.log(`      ID: ${d.id.slice(0, 8)}... | Provider: ${d.provider} | Created: ${d.created_at}`);
            });
        });
    }

    // Group by provider
    const byProvider: { [key: string]: number } = {};
    (data || []).forEach((d: any) => {
        const prov = d.provider || 'unknown';
        byProvider[prov] = (byProvider[prov] || 0) + 1;
    });

    console.log('\n📊 Documents by provider:');
    Object.entries(byProvider).forEach(([prov, count]) => {
        console.log(`  ${prov}: ${count}`);
    });
}

checkDuplicates().catch(console.error);
