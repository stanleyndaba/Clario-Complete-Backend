import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { supabase, convertUserIdToUuid } from '../database/supabaseClient';

async function debugDocumentsQuery() {
    const userId = 'demo-user';
    const finalUserId = convertUserIdToUuid(userId);

    console.log('🔍 Debugging Documents Query');
    console.log(`User ID: ${userId}`);
    console.log(`Converted UUID: ${finalUserId}`);

    // Check if supabase is mock
    const isMock = (supabase as any).auth?.getSession?.toString().includes('Promise.resolve');
    console.log(`Is Supabase Mock Client? ${isMock ? 'YES' : 'NO'}`);

    try {
        console.log('Executing query...');
        const { data: documents, error } = await supabase
            .from('evidence_documents')
            .select('*')
            .eq('user_id', finalUserId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ Database error:', error);
            return;
        }

        console.log(`✅ Query successful. Found ${documents?.length} documents.`);

        if (documents) {
            // Try the mapping logic to see if it throws
            console.log('Testing mapping logic...');
            const formattedDocuments = documents.map(doc => ({
                id: doc.id,
                name: doc.filename,
                uploadDate: doc.created_at,
                status: doc.status || 'uploaded',
                size: doc.size_bytes,
                type: doc.content_type,
                source: doc.source_id ? 'gmail' : 'upload',
                metadata: doc.metadata
            }));
            console.log('✅ Mapping successful.');
            console.log('Sample document:', formattedDocuments[0]);
        }

    } catch (error: any) {
        console.error('❌ Exception caught:', error);
        console.error('Stack:', error.stack);
    }
}

debugDocumentsQuery().catch(console.error);
