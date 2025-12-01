
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Credentials from User's Render Env Vars
const supabaseUrl = 'https://uuuqpujtnubusmigbkvw.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dXFwdWp0bnVidXNtaWdia3Z3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzM5NjgzOSwiZXhwIjoyMDY4OTcyODM5fQ.Z_1TUlk3WgtCggP80UYPGj8gK-JKdgjPf3rNkHxIrBE';
// The HEX key the user should have set
const encryptionKeyHex = '73ac80da5b49d36e7f717b7de12b1953e2e02e23c44d88ee72d4e213e42a46d2';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function decrypt(ivBase64: string, data: string): string {
    try {
        const key = Buffer.from(encryptionKeyHex, 'hex');
        const iv = Buffer.from(ivBase64, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let dec = decipher.update(data, 'base64', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch (err: any) {
        return `DECRYPTION FAILED: ${err.message}`;
    }
}

async function checkRenderToken() {
    console.log('🔌 Connecting to RENDER Database...');

    const { data: tokens, error } = await supabase
        .from('tokens')
        .select('*')
        .eq('provider', 'gmail');

    if (error) {
        console.error('❌ Error fetching tokens:', error);
        return;
    }

    console.log(`\nFound ${tokens?.length || 0} Gmail tokens.`);

    if (tokens && tokens.length > 0) {
        tokens.forEach((t, i) => {
            console.log(`\nToken #${i + 1}:`);
            console.log(`User ID: ${t.user_id}`);
            console.log(`Created: ${t.created_at}`);

            // Try to decrypt
            if (t.access_token_iv && t.access_token_data) {
                const decrypted = decrypt(t.access_token_iv, t.access_token_data);
                const isSuccess = !decrypted.startsWith('DECRYPTION FAILED');
                console.log(`Decryption Test: ${isSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);
                if (!isSuccess) console.log(`Error: ${decrypted}`);
            } else {
                console.log('❌ Token format invalid (missing IV/Data)');
            }
        });
    } else {
        console.log('❌ No tokens found. Save failed or user did not reconnect.');
    }
}

checkRenderToken().catch(console.error);
