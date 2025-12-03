import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Set a dummy secret for testing if not present
if (!process.env.PYTHON_API_JWT_SECRET) {
    process.env.PYTHON_API_JWT_SECRET = 'test-secret-for-verification';
}

import { supabase } from '../database/supabaseClient';
import documentParsingService from '../services/documentParsingService';

async function verifyAgent5() {
    const userId = 'demo-user';
    console.log('🔍 Verifying Agent 5 (Document Parsing) Integration');

    // 1. Find a document to parse (one that hasn't been parsed yet, or just pick the latest)
    const { data: documents, error } = await supabase
        .from('evidence_documents')
        .select('id, filename, seller_id')
        .eq('user_id', '07b4f03d-352e-473f-a316-af97d9017d69') // Use the UUID we found earlier
        .limit(1);

    if (error || !documents || documents.length === 0) {
        console.error('❌ No documents found to test parsing.');
        return;
    }

    const doc = documents[0];
    console.log(`📄 Testing with document: ${doc.filename} (${doc.id})`);

    try {
        // 2. Trigger parsing via the service (which calls Python API)
        console.log('🚀 Triggering parsing job...');
        const jobResponse = await documentParsingService.triggerParsing(doc.id, doc.seller_id);
        console.log('✅ Job triggered:', jobResponse);

        // 3. Poll for status
        console.log('⏳ Waiting for completion...');
        const result = await documentParsingService.waitForParsingCompletion(
            jobResponse.job_id,
            doc.seller_id,
            120000, // 120s timeout for test (increased for cold start)
            5000   // 5s poll
        );

        if (result) {
            console.log(`✅ Parsing ${result.status}!`);
            console.log('Confidence:', result.confidence_score);

            // 4. Fetch parsed data
            const parsedData = await documentParsingService.getParsedData(doc.id, doc.seller_id);
            console.log('📊 Parsed Data:', JSON.stringify(parsedData, null, 2));
        } else {
            console.error('❌ Parsing timed out or returned null status.');
        }

    } catch (error: any) {
        console.error('❌ Error during verification:', error.message);
        if (error.response) {
            console.error('API Response:', error.response.data);
        }
    }
}

verifyAgent5().catch(console.error);
