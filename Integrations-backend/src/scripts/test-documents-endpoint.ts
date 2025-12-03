import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import axios from 'axios';

async function testDocumentsEndpoint() {
    const userId = 'demo-user';
    const baseUrl = 'http://localhost:3001'; // Assuming local server

    console.log('🔍 Testing GET /api/documents endpoint');
    console.log(`User ID: ${userId}`);
    console.log(`URL: ${baseUrl}/api/documents\n`);

    try {
        // We need to mock the authentication or use a valid token if auth middleware is strict
        // For local testing with userIdMiddleware, sending x-user-id header should work if we bypass auth middleware
        // But wait, userIdMiddleware extracts from headers.

        const response = await axios.get(`${baseUrl}/api/documents`, {
            headers: {
                'x-user-id': userId,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Request successful!');
        console.log(`Status: ${response.status}`);
        console.log(`Documents found: ${response.data.length}`);

        if (response.data.length > 0) {
            console.log('\nFirst document:');
            console.log(JSON.stringify(response.data[0], null, 2));
        } else {
            console.log('\n⚠️ No documents returned. Check if ingestion actually saved documents.');
        }

    } catch (error: any) {
        console.error('❌ Request failed:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

testDocumentsEndpoint().catch(console.error);
