import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import tokenManager from '../utils/tokenManager';
import logger from '../utils/logger';

async function testTokenSave() {
    const userId = 'demo-user';
    const provider = 'gmail';

    console.log(`Testing token save for userId: ${userId}`);
    console.log(`Provider: ${provider}`);
    console.log('='.repeat(60));

    try {
        await tokenManager.saveToken(userId, provider, {
            accessToken: 'test-access-token-' + Date.now(),
            refreshToken: 'test-refresh-token-' + Date.now(),
            expiresAt: new Date(Date.now() + 3600 * 1000)
        });

        console.log('\n✅ Token save SUCCEEDED!');
        console.log('Token should now be in database.');

    } catch (error: any) {
        console.log('\n❌ Token save FAILED!');
        console.log('Error:', error?.message || String(error));
        console.log('Full error:', error);
    }
}

testTokenSave().catch(console.error);
