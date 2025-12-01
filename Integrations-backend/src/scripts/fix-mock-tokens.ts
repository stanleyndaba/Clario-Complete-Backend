import dotenv from 'dotenv';
import path from 'path';

// Load environment variables BEFORE other imports
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixMockTokens() {
    console.log('🔧 Fixing expired mock token expiry dates\n');

    // Update all evidence_sources with mock tokens to have future expiry
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    const { data: sources, error: fetchError } = await supabase
        .from('evidence_sources')
        .select('id, user_id, seller_id, provider, metadata')
        .eq('provider', 'gmail')
        .eq('status', 'connected');

    if (fetchError) {
        console.error('❌ Error fetching sources:', fetchError);
        return;
    }

    let updated = 0;
    for (const source of sources) {
        const metadata = source.metadata;
        if (metadata && metadata.access_token && metadata.access_token.startsWith('mock-token-')) {
            // Update this source's metadata with a future expiry
            const newMetadata = {
                ...metadata,
                expires_at: futureDate.toISOString()
            };

            const { error: updateError } = await supabase
                .from('evidence_sources')
                .update({ metadata: newMetadata })
                .eq('id', source.id);

            if (updateError) {
                console.error(`❌ Failed to update source ${source.id}:`, updateError);
            } else {
                updated++;
                if (updated % 10 === 0) process.stdout.write('.');
            }
        }
    }

    console.log(`\n\n✅ Updated ${updated} mock token expiry dates to ${futureDate.toISOString()}`);
}

fixMockTokens();
