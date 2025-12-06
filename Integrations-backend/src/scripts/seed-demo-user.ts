import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Convert userId to UUID (same logic as in supabaseClient.ts)
 */
function convertUserIdToUuid(userId: string): string {
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const uuidMatch = userId.match(uuidRegex);
    if (uuidMatch) {
        return uuidMatch[0];
    }
    // Generate deterministic UUID from userId
    const hash = crypto.createHash('sha256').update(`clario-user-${userId}`).digest('hex');
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

async function seedDemoUser() {
    console.log('🔧 Seeding demo-user for frontend testing...\n');

    const originalUserId = 'demo-user';
    const userId = convertUserIdToUuid(originalUserId);

    console.log(`Original userId: ${originalUserId}`);
    console.log(`Converted UUID: ${userId}\n`);

    // Step 1: Create user in users table
    console.log('📝 Step 1: Creating user in users table...');
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

    if (existingUser) {
        console.log('✅ User already exists\n');
    } else {
        const { data: newUser, error: userError } = await supabase
            .from('users')
            .insert({
                id: userId,
                email: 'demo@example.com',
                amazon_seller_id: 'DEMO_SELLER_ID',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select();

        if (userError) {
            console.error('❌ Error creating user:', userError);
            process.exit(1);
        }
        console.log('✅ User created successfully\n');
    }

    // Step 2: Create/Update evidence_sources with mock Gmail token
    console.log('📝 Step 2: Creating evidence_sources entry with mock Gmail token...');

    // Check if source exists
    const { data: existingSource } = await supabase
        .from('evidence_sources')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'gmail')
        .maybeSingle();

    if (existingSource) {
        console.log('✅ Evidence source already exists, updating...');
        const { error: updateError } = await supabase
            .from('evidence_sources')
            .update({
                status: 'connected',
                encrypted_access_token: 'mock-encrypted-access-token',
                encrypted_refresh_token: 'mock-encrypted-refresh-token',
                updated_at: new Date().toISOString(),
                metadata: {
                    access_token: `mock-token-${crypto.randomUUID()}`,
                    refresh_token: `mock-refresh-${crypto.randomUUID()}`,
                    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
                    connected_at: new Date().toISOString()
                }
            })
            .eq('id', existingSource.id);

        if (updateError) {
            console.error('❌ Error updating evidence source:', updateError);
        } else {
            console.log('✅ Evidence source updated\n');
        }
    } else {
        const { data: newSource, error: sourceError } = await supabase
            .from('evidence_sources')
            .insert({
                user_id: userId,
                seller_id: userId,
                provider: 'gmail',
                account_email: 'demo@example.com',
                status: 'connected',
                encrypted_access_token: 'mock-encrypted-access-token',
                encrypted_refresh_token: 'mock-encrypted-refresh-token',
                metadata: {
                    access_token: `mock-token-${crypto.randomUUID()}`,
                    refresh_token: `mock-refresh-${crypto.randomUUID()}`,
                    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    connected_at: new Date().toISOString()
                }
            })
            .select();

        if (sourceError) {
            console.error('❌ Error creating evidence source:', sourceError);
            process.exit(1);
        }
        console.log('✅ Evidence source created\n');
    }

    // Step 3: Create entry in tokens table if it exists
    console.log('📝 Step 3: Creating tokens table entry...');
    try {
        const { data: existingToken } = await supabase
            .from('tokens')
            .select('id')
            .eq('user_id', userId)
            .eq('provider', 'gmail')
            .maybeSingle();

        if (existingToken) {
            console.log('✅ Token already exists\n');
        } else {
            const { error: tokenError } = await supabase
                .from('tokens')
                .insert({
                    user_id: userId,
                    provider: 'gmail',
                    access_token_iv: 'mock-iv',
                    access_token_data: `mock-token-${crypto.randomUUID()}`,
                    refresh_token_iv: 'mock-refresh-iv',
                    refresh_token_data: `mock-refresh-${crypto.randomUUID()}`,
                    token_type: 'Bearer',
                    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    is_active: true
                });

            if (tokenError) {
                console.warn('⚠️ Could not create token (table may not exist):', tokenError.message);
            } else {
                console.log('✅ Token created\n');
            }
        }
    } catch (e) {
        console.warn('⚠️ Tokens table operation skipped');
    }

    console.log('='.repeat(50));
    console.log('✅ DEMO USER SEEDING COMPLETE!');
    console.log('='.repeat(50));
    console.log(`\nThe frontend can now ingest Gmail for user: demo-user (UUID: ${userId})`);
    console.log('\nTo test: Click "Ingest Gmail Only" on the Integrations Hub page.');
}

seedDemoUser().catch(console.error);
