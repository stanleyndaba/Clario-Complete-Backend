import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { gmailIngestionService } from '../services/gmailIngestionService';

async function testFullIngestion() {
    const userId = 'demo-user';

    console.log('🔍 Testing Full Gmail Ingestion Flow');
    console.log(`User ID: ${userId}\n`);

    try {
        console.log('📧 Starting ingestion...');
        const result = await gmailIngestionService.ingestEvidenceFromGmail(userId, {
            maxResults: 5,
            autoParse: false
        });

        console.log('\n✅ Ingestion Complete!');
        console.log(`Documents Ingested: ${result.documentsIngested}`);
        console.log(`Emails Processed: ${result.emailsProcessed}`);
        console.log(`Errors: ${result.errors.length}`);

        if (result.errors.length > 0) {
            console.log('\n❌ Errors:');
            result.errors.forEach((err, i) => {
                console.log(`  ${i + 1}. ${err}`);
            });
        }

    } catch (error: any) {
        console.error('\n❌ Fatal Error:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
    }
}

testFullIngestion().catch(console.error);
