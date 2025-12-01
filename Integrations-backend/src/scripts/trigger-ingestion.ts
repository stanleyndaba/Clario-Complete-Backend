import dotenv from 'dotenv';
import path from 'path';

// Load environment variables BEFORE other imports
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { gmailIngestionService } from '../services/gmailIngestionService';
import logger from '../utils/logger';

const USER_ID = 'stress-test-user-78fecfc0-5bf7-4387-9084-38d4733b9649';

async function triggerIngestion() {
    console.log(`🚀 Triggering Gmail ingestion for user: ${USER_ID}`);

    try {
        const result = await gmailIngestionService.ingestEvidenceFromGmail(USER_ID, {
            maxResults: 5,
            autoParse: true
        });

        console.log('\n✅ Ingestion Result:', JSON.stringify(result, null, 2));
    } catch (error: any) {
        console.error('\n❌ Ingestion Failed:', error.message);
        console.error(error.stack);
    }
}

triggerIngestion();
