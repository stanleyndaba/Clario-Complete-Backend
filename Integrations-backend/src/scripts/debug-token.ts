import dotenv from 'dotenv';
import path from 'path';

// Load environment variables BEFORE other imports
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import tokenManager from '../utils/tokenManager';

const USER_ID = 'stress-test-user-78fecfc0-5bf7-4387-9084-38d4733b9649';

async function debugToken() {
    console.log('🔍 Debugging token decryption for:', USER_ID);

    try {
        const tokenStatus = await tokenManager.getTokenWithStatus(USER_ID, 'gmail');

        if (!tokenStatus) {
            console.error('❌ No token found');
            return;
        }

        const tokenData = tokenStatus.token;

        console.log('\n✅ Token found:');
        console.log('  Access Token:', tokenData.accessToken?.substring(0, 20) + '...');
        console.log('  Refresh Token:', tokenData.refreshToken || 'NULL/UNDEFINED');
        console.log('  Refresh Token Length:', tokenData.refreshToken?.length || 0);
        console.log('  Expires At:', tokenData.expiresAt);
        console.log('  Is Expired:', tokenStatus.isExpired);

    } catch (error: any) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
}

debugToken();
