

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { tokenManager } from '../utils/tokenManager';
import { supabase, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';

async function syncDemoToken() {
    const sourceUserId = '78fecfc0-5bf7-4387-9084-38d4733b9649';
    const targetUserId = 'demo-user'; // Will be converted to 07b4f03d...

    console.log(`Syncing token from ${sourceUserId} to ${targetUserId}...`);

    try {
        // 1. Get the valid token from the source user
        const token = await tokenManager.getToken(sourceUserId, 'gmail');

        if (!token) {
            console.error(`No Gmail token found for source user ${sourceUserId}`);
            return;
        }

        console.log('Found valid source token:', {
            expiresAt: token.expiresAt,
            hasAccessToken: !!token.accessToken,
            hasRefreshToken: !!token.refreshToken
        });

        // 2. Save it for the target user (demo-user)
        // tokenManager.saveToken handles the encryption and UUID conversion for us
        await tokenManager.saveToken(targetUserId, 'gmail', token);

        console.log(`Successfully copied token to ${targetUserId}`);
        console.log(`Target UUID should be: ${convertUserIdToUuid(targetUserId)}`);

    } catch (error) {
        console.error('Failed to sync token:', error);
    }
}

syncDemoToken().catch(console.error);
