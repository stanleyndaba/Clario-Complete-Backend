/**
 * Clear all evidence documents
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function clearDocuments() {
    console.log('\n=== CLEARING ALL EVIDENCE DOCUMENTS ===\n');

    // First count
    const { count } = await supabase
        .from('evidence_documents')
        .select('*', { count: 'exact', head: true });

    console.log(`Found ${count || 0} documents to delete...`);

    if (count && count > 0) {
        const { error } = await supabase
            .from('evidence_documents')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000');

        if (error) {
            console.error('Error deleting documents:', error);
        } else {
            console.log(`✅ Deleted all ${count} evidence documents`);
        }
    } else {
        console.log('No documents to delete.');
    }
}

clearDocuments().catch(console.error);
