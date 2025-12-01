
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function convertUserIdToUuid(userId: string): string {
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const uuidMatch = userId.match(uuidRegex);
    if (uuidMatch) return uuidMatch[0];

    const hash = crypto.createHash('sha256').update(`clario-user-${userId}`).digest('hex');
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

async function checkSpecificUser() {
    const rawUserId = 'stress-test-user-a5055d7b-f453-4f53-92c7-d2e22330f47f';
    const dbUserId = convertUserIdToUuid(rawUserId);

    console.log(`Checking for user: ${rawUserId}`);
    console.log(`Converted UUID: ${dbUserId}`);
    console.log(`Supabase URL: ${supabaseUrl}`);
    console.log('='.repeat(60));

    const { data: sources, error: sourcesError } = await supabase
        .from('evidence_sources')
        .select('*')
        .or(`user_id.eq.${dbUserId},seller_id.eq.${dbUserId}`);

    if (sourcesError) {
        console.error('Error fetching sources:', sourcesError);
    } else {
        console.log(`\nFound ${sources?.length || 0} evidence sources for this user.`);
        if (sources?.length === 0) {
            console.log('❌ User NOT found in local DB.');
            console.log('   This suggests Render might be using a DIFFERENT database (or the user was deleted).');
        } else {
            console.log('✅ User FOUND in local DB. We are looking at the same database.');
            console.log('   Source ID:', sources[0].id);
            console.log('   Provider:', sources[0].provider);
        }
    }
}

checkSpecificUser().catch(console.error);
