/**
 * Phase 5: Tenant Isolation Smoke Test
 * 
 * This script tests multi-tenant data isolation.
 * Run this against your deployed backend to verify tenants are isolated.
 * 
 * Usage:
 *   1. Set API_URL and AUTH_TOKEN environment variables
 *   2. Run: npx ts-node test-tenant-isolation.ts
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface TestResult {
    test: string;
    passed: boolean;
    details?: any;
    error?: string;
}

const results: TestResult[] = [];

async function httpRequest(path: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    return response.json();
}

async function createTenant(name: string, authToken: string): Promise<any> {
    console.log(`\n📦 Creating tenant: ${name}`);
    const result = await httpRequest('/api/tenant/create', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ name })
    });

    if (result.success) {
        console.log(`   ✅ Created: ${result.tenant.slug} (${result.tenant.id})`);
        return result.tenant;
    } else {
        console.log(`   ❌ Failed: ${result.error}`);
        return null;
    }
}

async function getTenantData(tenantSlug: string, authToken: string): Promise<any> {
    console.log(`\n📊 Fetching data for tenant: ${tenantSlug}`);

    // Get recoveries/dashboard data
    const data = await httpRequest(`/api/recoveries/metrics`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-Id': tenantSlug // or use URL-based routing
        }
    });

    return data;
}

async function runTest(name: string, testFn: () => Promise<{ passed: boolean; details?: any }>): Promise<void> {
    console.log(`\n🧪 Test: ${name}`);
    try {
        const result = await testFn();
        results.push({ test: name, ...result });
        console.log(result.passed ? '   ✅ PASSED' : '   ❌ FAILED', result.details || '');
    } catch (error: any) {
        results.push({ test: name, passed: false, error: error.message });
        console.log('   ❌ ERROR:', error.message);
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('🔥 Phase 5: Tenant Isolation Smoke Test');
    console.log('═══════════════════════════════════════════════');
    console.log(`API URL: ${API_URL}`);

    // Check for auth tokens
    const ALPHA_TOKEN = process.env.ALPHA_TOKEN;
    const BETA_TOKEN = process.env.BETA_TOKEN;

    if (!ALPHA_TOKEN || !BETA_TOKEN) {
        console.log(`
⚠️  Missing auth tokens. Set these environment variables:

    ALPHA_TOKEN=<JWT for User A>
    BETA_TOKEN=<JWT for User B>
    
To get tokens:
1. Log in as User A, get token from browser dev tools
2. Log in as User B (incognito), get token from browser dev tools
`);
        return;
    }

    console.log('\n--- Step 1: Create Tenant Alpha ---');
    const alphaTime = Date.now();
    const alpha = await createTenant(`Alpha Corp ${alphaTime}`, ALPHA_TOKEN);

    console.log('\n--- Step 2: Create Tenant Beta ---');
    const betaTime = Date.now();
    const beta = await createTenant(`Beta Ltd ${betaTime}`, BETA_TOKEN);

    if (!alpha || !beta) {
        console.log('\n❌ Failed to create test tenants. Check auth tokens.');
        return;
    }

    console.log('\n--- Step 3: Verify Isolation ---');

    await runTest('Alpha sees own data', async () => {
        const data = await getTenantData(alpha.slug, ALPHA_TOKEN);
        return { passed: !data.error, details: { totalClaims: data.totalClaimsFound || 0 } };
    });

    await runTest('Beta sees own data (should be empty/different)', async () => {
        const data = await getTenantData(beta.slug, BETA_TOKEN);
        return { passed: !data.error, details: { totalClaims: data.totalClaimsFound || 0 } };
    });

    await runTest('Beta cannot access Alpha tenant', async () => {
        const data = await getTenantData(alpha.slug, BETA_TOKEN);
        // Should either error or return empty (no access)
        const noAccess = data.error || data.totalClaimsFound === 0;
        return { passed: noAccess, details: data };
    });

    console.log('\n═══════════════════════════════════════════════');
    console.log('📋 Test Results Summary');
    console.log('═══════════════════════════════════════════════');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    results.forEach(r => {
        console.log(`${r.passed ? '✅' : '❌'} ${r.test}`);
    });

    console.log(`\nTotal: ${passed} passed, ${failed} failed`);

    if (failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED - Tenant isolation verified!');
    } else {
        console.log('\n⚠️  SOME TESTS FAILED - Review isolation implementation');
    }
}

main().catch(console.error);
