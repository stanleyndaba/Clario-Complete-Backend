
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { gmailIngestionService } from '../services/gmailIngestionService';
import logger from '../utils/logger';

async function triggerDemoIngestion() {
    const userId = 'demo-user';
    console.log(`Triggering Gmail ingestion for ${userId}...`);

    try {
        const result = await gmailIngestionService.ingestEvidenceFromGmail(userId, {
            maxResults: 10,
            autoParse: true
        });

        console.log('Ingestion Result:', JSON.stringify(result, null, 2));

        if (result.success) {
            console.log('✅ Ingestion successful!');
        } else {
            console.error('❌ Ingestion failed:', result.errors);
        }
    } catch (error) {
        console.error('❌ Script error:', error);
    }
}

triggerDemoIngestion().catch(console.error);
