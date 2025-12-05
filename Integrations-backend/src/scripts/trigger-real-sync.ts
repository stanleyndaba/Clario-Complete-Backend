
import dotenv from 'dotenv';
import path from 'path';

// 1. Load environment variables FIRST
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Mock Amazon vars to bypass connection check if not present
if (!process.env.AMAZON_SPAPI_REFRESH_TOKEN) process.env.AMAZON_SPAPI_REFRESH_TOKEN = 'mock_token';
if (!process.env.AMAZON_CLIENT_ID) process.env.AMAZON_CLIENT_ID = 'mock_client_id';
if (!process.env.AMAZON_CLIENT_SECRET) process.env.AMAZON_CLIENT_SECRET = 'mock_secret';
if (!process.env.MOCK_DETECTION_API) process.env.MOCK_DETECTION_API = 'true';

const supabaseUrl = process.env.SUPABASE_URL;
if (!supabaseUrl) {
    console.error('❌ SUPABASE_URL not found in environment!');
    process.exit(1);
}

const userId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

async function triggerSync() {
    console.log('🚀 Triggering Real Sync via SyncJobManager...');

    // 2. Dynamic import of services AFTER env is loaded
    const { syncJobManager } = await import('../services/syncJobManager');
    const { supabase } = await import('../database/supabaseClient');

    try {
        const result = await syncJobManager.startSync(userId);
        console.log(`✅ Sync started with ID: ${result.syncId}`);

        // Poll for completion
        console.log('⏳ Waiting for sync to complete...');
        const startTime = Date.now();

        while (Date.now() - startTime < 60000) { // 1 minute timeout
            const { data: syncRecord } = await supabase
                .from('sync_progress')
                .select('*')
                .eq('sync_id', result.syncId)
                .single();

            if (syncRecord) {
                console.log(`   Status: ${syncRecord.status}, Progress: ${syncRecord.progress}%`);

                if (syncRecord.status === 'completed') {
                    console.log('\n✅ Sync Completed!');
                    console.log('------------------------------------------------');
                    console.log(`Claims Detected (DB Column): ${syncRecord.claims_detected}`);
                    console.log(`Metadata:`, JSON.stringify(syncRecord.metadata, null, 2));

                    if (syncRecord.claims_detected > 0) {
                        console.log('\n🎉 SUCCESS: Claims Detected count is correctly stored!');
                        process.exit(0);
                    } else {
                        console.error('\n❌ FAILURE: Claims Detected is 0!');
                        process.exit(1);
                    }
                } else if (syncRecord.status === 'failed') {
                    console.error('\n❌ Sync Failed:', syncRecord.error);
                    process.exit(1);
                }
            } else {
                console.log('   Waiting for sync record creation...');
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.error('❌ Timeout waiting for sync completion');
        process.exit(1);

    } catch (error: any) {
        console.error('❌ Error triggering sync:', error.message);
        process.exit(1);
    }
}

triggerSync();
