
import logger from '../utils/logger';

// Copy of the function from supabaseClient.ts to test it in isolation
function convertUserIdToUuid(userId: string): string {
    // UUID regex pattern (matches standard UUID format)
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    // First, try to extract a valid UUID from the userId string
    const uuidMatch = userId.match(uuidRegex);
    if (uuidMatch) {
        // Found a valid UUID in the string - use it directly
        const extractedUuid = uuidMatch[0];
        if (extractedUuid !== userId) {
            console.log(`[DEBUG] Extracted UUID from prefixed userId: ${userId} -> ${extractedUuid}`);
        }
        return extractedUuid;
    }

    // No valid UUID found - generate a deterministic UUID from the userId
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(`clario-user-${userId}`).digest('hex');
    const generatedUuid = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;

    console.log(`[DEBUG] Generated deterministic UUID for non-UUID userId: ${userId} -> ${generatedUuid}`);

    return generatedUuid;
}

async function runVerification() {
    console.log('🔍 Starting UUID Fix Verification...\n');

    const testCases = [
        {
            name: 'Prefixed UUID (Your Case)',
            input: 'stress-test-user-2cdd1838-efe0-4549-a9b0-a88752846dc6',
            expected: '2cdd1838-efe0-4549-a9b0-a88752846dc6'
        },
        {
            name: 'Pure UUID',
            input: '2cdd1838-efe0-4549-a9b0-a88752846dc6',
            expected: '2cdd1838-efe0-4549-a9b0-a88752846dc6'
        },
        {
            name: 'Legacy User ID',
            input: 'demo-user',
            expectedType: 'generated' // Expect a generated UUID, not equal to input
        },
        {
            name: 'Another Prefix',
            input: 'google-oauth2|1234567890',
            expectedType: 'generated'
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of testCases) {
        console.log(`Testing: ${test.name}`);
        console.log(`Input: "${test.input}"`);

        const result = convertUserIdToUuid(test.input);
        console.log(`Result: "${result}"`);

        let isSuccess = false;
        if (test.expected) {
            isSuccess = result === test.expected;
            if (!isSuccess) console.log(`❌ Expected "${test.expected}" but got "${result}"`);
        } else if (test.expectedType === 'generated') {
            // Check if it's a valid UUID and NOT the input
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result);
            isSuccess = isUuid && result !== test.input;
            if (!isSuccess) console.log(`❌ Expected generated UUID but got "${result}"`);
        }

        if (isSuccess) {
            console.log('✅ PASS\n');
            passed++;
        } else {
            console.log('❌ FAIL\n');
            failed++;
        }
    }

    console.log('----------------------------------------');
    console.log(`Results: ${passed} Passed, ${failed} Failed`);

    if (failed === 0) {
        console.log('\n✅ CONCLUSION: The fix logic is CORRECT. Once deployed, it handles your userId correctly.');
    } else {
        console.log('\n❌ CONCLUSION: The fix logic is FLAWED.');
    }
}

runVerification().catch(console.error);
