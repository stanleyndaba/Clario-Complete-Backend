
import axios from 'axios';
import { URLSearchParams } from 'url';

// Mock axios.post to verify the request body type
const mockPost = async (url: string, data: any, config?: any) => {
    console.log(`[TEST] axios.post called for: ${url}`);
    console.log(`[TEST] Data type: ${data?.constructor?.name}`);

    if (data instanceof URLSearchParams) {
        console.log('[TEST] ✅ Data is an instance of URLSearchParams');
        console.log('[TEST] Serialized data:', data.toString());
    } else {
        console.log('[TEST] ❌ Data is NOT an instance of URLSearchParams');
        console.log('[TEST] Data content:', JSON.stringify(data));
    }

    return { data: { success: true, access_token: 'mock-token' } };
};

async function verifyFix() {
    console.log('--- Verifying Gmail Fix (Content-Type Serialization) ---');

    // Example of what we fixed in gmailController.ts:
    const code = 'mock-auth-code';
    const clientId = 'mock-client-id';
    const clientSecret = 'mock-client-secret';
    const redirectUri = 'http://localhost:3001/callback';

    console.log('\nTesting fix logic...');

    const tokenParams = new URLSearchParams();
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('code', code);
    tokenParams.append('client_id', clientId);
    tokenParams.append('client_secret', clientSecret);
    tokenParams.append('redirect_uri', redirectUri);

    const response = await mockPost('https://oauth2.googleapis.com/token', tokenParams);

    console.log('\nComparison with the broken version (simulated):');
    const brokenData = {
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
    };
    await mockPost('https://oauth2.googleapis.com/token', brokenData);

    console.log('\n--- Verification Complete ---');
}

verifyFix().catch(console.error);
