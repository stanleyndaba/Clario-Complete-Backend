import 'dotenv/config';
import { tokenManager as dbTokenManager, supabaseAdmin, convertUserIdToUuid } from '../src/database/supabaseClient';
import { tokenManager } from '../src/utils/tokenManager';

async function diagnose() {
    const userId = 'demo-user';
    const dbUserId = convertUserIdToUuid(userId);
    const provider = 'amazon';
    const refreshToken = 'Atzr|IwEBIACx3473EvrAnsixHkRlsd5FEe5xx0xIkgRmwi_IhHdJuA2241EahW6wzMleZ-Q5IcLXNplL7j9hT0VetAcjGDNjfMU2qDyx1rMrpYGp2nfNb1al-jQZ_Mz7Me25bqFI2JmcL3B5hL9IpFYVRVbruziCJIaz5TPTuQZMsRQ1CE13F_V8oxvLalD5Z88Spi5Z0l8p-zfER4ndll-4nejOol1sUpA8tPO2eSaZmnx2b8b_LuWBzebQvRZy_XKNFqKoHdGjY9jz9dSJg2ps3j1N1AjCJ4siqvABAidv3dVAGitSGPYnUQTpAoWywHBDQr1fNgu4m2M-YlFJgxlyx3CzFetR';

    console.log('🔍 Diagnosing Token Save Failure...');

    try {
        // Attempt manual upsert to see full error
        console.log('Trying manual upsert into tokens table...');
        const { data: cols } = await supabaseAdmin.from('tokens').select('*').limit(1);
        if (cols && cols.length > 0) {
            console.log('Existing token columns:', Object.keys(cols[0]));
        }

        const { error } = await supabaseAdmin
            .from('tokens')
            .upsert({
                user_id: dbUserId,
                provider,
                access_token_data: 'dummy',
                access_token_iv: 'dummy',
                refresh_token_data: 'dummy',
                refresh_token_iv: 'dummy',
                expires_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,provider' });

        if (error) {
            console.error('❌ MANUAL UPSERT FAILED:');
            console.error(JSON.stringify(error, null, 2));
        } else {
            console.log('✅ Manual upsert succeeded with dummy data. Attempting real injection...');

            await tokenManager.saveToken(userId, provider, {
                accessToken: 'dummy_access_token',
                refreshToken: refreshToken,
                expiresAt: new Date(Date.now() - 3600000)
            });
            console.log('🔥 REAL INJECTION SUCCEEDED!');
        }

    } catch (err: any) {
        console.error('💥 UNEXPECTED ERROR:', err.message);
    }
}

diagnose();
