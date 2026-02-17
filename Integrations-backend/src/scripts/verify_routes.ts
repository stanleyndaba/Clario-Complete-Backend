import axios from 'axios';

const BACKEND_URL = process.env.INTEGRATIONS_URL || 'http://127.0.0.1:3001';
const TEST_USER_ID = 'de000000-0000-0000-0000-000000000000'; // Valid UUID for testing

async function testRoute(path: string, provider: string) {
    try {
        console.log(`Testing ${path}...`);
        const response = await axios.get(`${BACKEND_URL}${path}`, {
            params: {
                tenant_slug: 'test-tenant',
                store_id: 'test-store',
                redirect_uri: 'http://localhost:3000/callback'
            },
            headers: {
                'x-user-id': TEST_USER_ID
            }
        });

        if (response.status === 200 && (response.data.authUrl || response.data.auth_url)) {
            console.log(`✅ ${provider} route ${path} works!`);
            return true;
        } else {
            console.log(`❌ ${provider} route ${path} returned unexpected response:`, response.data);
            return false;
        }
    } catch (error: any) {
        if (error.response) {
            console.log(`❌ ${provider} route ${path} failed with status ${error.response.status}:`, error.response.data);
        } else {
            console.log(`❌ ${provider} route ${path} failed:`, error.message);
            if (error.code) console.log('Error code:', error.code);
        }
        return false;
    }
}

async function runTests() {
    const providers = ['gmail', 'outlook', 'gdrive', 'dropbox'];
    let allPassed = true;

    for (const provider of providers) {
        const p1 = await testRoute(`/api/v1/integrations/${provider}/auth`, provider);
        const p2 = await testRoute(`/api/v1/integrations/${provider}/auth/start`, provider);
        if (!p1 || !p2) allPassed = false;
    }

    if (allPassed) {
        console.log('\n🚀 ALL INTEGRATION ROUTES VERIFIED SUCCESSFULLY!');
    } else {
        console.log('\n⚠️ SOME TESTS FAILED. CHECK LOGS.');
        process.exit(1);
    }
}

runTests();
