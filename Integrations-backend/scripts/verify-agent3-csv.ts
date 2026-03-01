import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Import after env is loaded to prevent mock fallback
const enhancedDetectionService = require('../src/services/enhancedDetectionService').default;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = '00000000-0000-0000-0000-000000000000';

async function run() {
    console.log("🔍 Checking for recent sync ID for the dummy user...");

    // Get the most recent sync_id from financial_events
    const { data: feData, error: feError } = await supabase
        .from('financial_events')
        .select('sync_id')
        .eq('seller_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);

    if (feError || !feData || feData.length === 0) {
        console.error("❌ No sync ID found for dummy user.", feError);
        process.exit(1);
    }

    const syncId = feData[0].sync_id;
    console.log(`✅ Found sync ID: ${syncId}`);

    console.log("🚀 Triggering Agent 3 Detection Pipeline...");

    const result = await enhancedDetectionService.triggerDetectionPipeline(
        userId,
        syncId,
        'csv_upload',
        { source: 'csv_upload', syncId }
    );

    console.log("📊 Detection Result:", JSON.stringify(result, null, 2));

    if (result.success) {
        console.log(`✅ SUCCESS! Found ${result.detectionsFound} claims.`);
        console.log(`💰 Estimated Recovery: $${result.estimatedRecovery?.toFixed(2)}`);
    } else {
        console.error("❌ Detection failed:", result.message);
    }
}

run();
