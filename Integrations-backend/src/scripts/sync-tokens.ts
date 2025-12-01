import dotenv from 'dotenv';
import path from 'path';

// Load environment variables BEFORE other imports
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';
import tokenManager from '../utils/tokenManager';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function syncTokens() {
    console.log('🔄 SYNCING TOKENS FROM EVIDENCE_SOURCES TO TOKEN_MANAGER\n');

    // Get all connected Gmail sources
    const { data: sources, error } = await supabase
        .from('evidence_sources')
        .select('user_id, seller_id, provider, metadata')
        .eq('provider', 'gmail')
        .eq('status', 'connected');

    if (error) {
        console.error('❌ Error fetching sources:', error);
        return;
    }

    console.log(`Found ${sources.length} Gmail sources. Syncing tokens...`);

    let syncedCount = 0;
    let errorCount = 0;

    for (const source of sources) {
        const userId = source.user_id || source.seller_id;
        const metadata = source.metadata;

        if (metadata && metadata.access_token && metadata.refresh_token) {
            try {
                await tokenManager.saveToken(userId, 'gmail', {
                    accessToken: metadata.access_token,
                    refreshToken: metadata.refresh_token,
                    expiresAt: new Date(metadata.expires_at || Date.now())
                });
                syncedCount++;
                if (syncedCount % 10 === 0) process.stdout.write('.');
            } catch (err: any) {
                console.error(`\n❌ Failed to sync token for user ${userId}:`, err.message);
                errorCount++;
            }
        }
    }

    console.log(`\n\n✅ Sync complete!`);
    console.log(`   Synced: ${syncedCount}`);
    console.log(`   Errors: ${errorCount}`);
}

syncTokens();
