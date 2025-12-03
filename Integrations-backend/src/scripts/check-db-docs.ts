import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { supabase } from '../database/supabaseClient';

async function checkDatabase() {
    const userId = 'demo-user'; // Or the UUID if you know it

    console.log('🔍 Checking evidence_documents table');

    // First get the UUID for demo-user if needed, but let's try querying by user_id column directly
    // The ingestion service uses the UUID, so we should probably look up the user first

    const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('email', 'demo@clario.com') // Assuming demo-user has this email
        .single();

    let searchId = userId;
    if (user) {
        console.log(`Found user UUID: ${user.id}`);
        searchId = user.id;
    } else {
        console.log('Could not find user by email, trying direct ID query...');
    }

    const { data: documents, error } = await supabase
        .from('evidence_documents')
        .select('*')
        .eq('user_id', searchId);

    if (error) {
        console.error('❌ Database error:', error);
        return;
    }

    console.log(`✅ Found ${documents?.length || 0} documents for user ${searchId}`);
    if (documents && documents.length > 0) {
        console.log('Sample document:', JSON.stringify(documents[0], null, 2));
    }
}

checkDatabase().catch(console.error);
