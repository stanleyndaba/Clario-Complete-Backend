require('dotenv').config();
const logger = require('../dist/utils/logger').default;
const { AmazonSubmissionAutomator } = require('../dist/services/AmazonSubmissionAutomator');

async function runAlphaTest() {
    console.log('🚀 [ALPHA TEST] INITIALIZING AGENT 7...');
    
    // Test parameters
    const CASE_ID = 'bbb8246a-1a9b-45cb-b6bc-4ae8dd2bd0d4';
    const SELLER_ID = '07b4f03d-352e-473f-a316-af97d9017d69';
    
    // Ensure flags are set
    process.env.SINGLE_CASE_MODE = CASE_ID;
    process.env.ENABLE_REFUND_FILING_WORKER = 'true';
    process.env.agent7_filing_enabled = 'true';

    try {
        const automator = new AmazonSubmissionAutomator();
        
        console.log(`📡 [ALPHA TEST] DIRECTLY EXECUTING SUBMISSION FOR CASE: ${CASE_ID}...`);
        await automator.executeFullSubmission(CASE_ID, SELLER_ID);
        
        console.log('📊 [ALPHA TEST] EXECUTION COMPLETED');
        process.exit(0);
    } catch (error) {
        console.error('❌ [ALPHA TEST] FATAL ERROR:', error);
        process.exit(1);
    }
}

runAlphaTest();
