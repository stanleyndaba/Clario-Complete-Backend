/**
 * Check demo-user vs real user claims
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkUsers() {
    // Check if there are any claims for 'demo-user'
    const { data: demoData } = await supabase
        .from('detection_results')
        .select('id')
        .eq('seller_id', 'demo-user');

    console.log('Claims for demo-user:', demoData?.length || 0);

    // Check the real user
    const { data: realData } = await supabase
        .from('detection_results')
        .select('id')
        .eq('seller_id', '07b4f03d-352e-473f-a316-af97d9017d69');

    console.log('Claims for real user (07b4f03d...):', realData?.length || 0);

    // Check documents
    const { data: demoDocs } = await supabase
        .from('evidence_documents')
        .select('id')
        .eq('seller_id', 'demo-user');

    console.log('Documents for demo-user:', demoDocs?.length || 0);

    const { data: realDocs } = await supabase
        .from('evidence_documents')
        .select('id')
        .eq('seller_id', '07b4f03d-352e-473f-a316-af97d9017d69');

    console.log('Documents for real user:', realDocs?.length || 0);
}

checkUsers().catch(console.error);
