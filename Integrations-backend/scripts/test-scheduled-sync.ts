
import scheduledSyncJob from '../src/jobs/scheduledSyncJob';

async function testScheduledSync() {
    console.log('🧪 Testing Scheduled Sync Job...');

    // Set mock env vars
    process.env.AMAZON_SANDBOX_MODE = 'true';
    process.env.USE_MOCK_DATA = 'true';

    try {
        // Manually trigger the sync
        await scheduledSyncJob.runScheduledSync();
        console.log('✅ Scheduled sync test completed successfully');
    } catch (error) {
        console.error('❌ Scheduled sync test failed:', error);
    }
}

testScheduledSync().catch(console.error);
