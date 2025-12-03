
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { convertUserIdToUuid } from '../database/supabaseClient';
import tokenManager from '../utils/tokenManager';
import axios from 'axios';

async function testGmailApi() {
    const userId = 'demo-user';
    const dbUserId = convertUserIdToUuid(userId);

    console.log(`Testing Gmail API for user: ${userId}`);
    console.log(`Converted UUID: ${dbUserId}`);

    try {
        // 1. Get Token
        console.log('\n1. Retrieving Token...');
        const token = await tokenManager.getToken(userId, 'gmail');

        if (!token) {
            console.error('❌ No token found!');
            return;
        }
        console.log('✅ Token retrieved and decrypted successfully.');
        console.log(`   Access Token length: ${token.accessToken.length}`);

        // 2. Call Gmail API
        console.log('\n2. Calling Gmail API (List Messages)...');
        const response = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
            headers: { Authorization: `Bearer ${token.accessToken}` },
            params: { maxResults: 5 }
        });

        console.log('✅ Gmail API Call Successful!');
        console.log(`   Status: ${response.status}`);
        console.log(`   Messages found: ${response.data.messages?.length || 0}`);

    } catch (error: any) {
        console.error('\n❌ FAILED!');
        if (error.response) {
            console.error(`   API Status: ${error.response.status}`);
            console.error(`   API Data:`, JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(`   Error: ${error.message}`);
        }
    }
}

testGmailApi().catch(console.error);
