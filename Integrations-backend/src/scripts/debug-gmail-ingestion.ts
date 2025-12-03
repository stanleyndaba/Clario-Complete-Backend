import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { gmailService } from '../services/gmailService';
import { convertUserIdToUuid } from '../database/supabaseClient';

async function debugGmailIngestion() {
    const userId = 'demo-user';
    const dbUserId = convertUserIdToUuid(userId);

    console.log('🔍 Gmail Ingestion Debug Tool');
    console.log(`User ID: ${userId}`);
    console.log(`DB UUID: ${dbUserId}\n`);

    try {
        // Step 1: Fetch emails
        console.log('📧 Step 1: Fetching emails...');
        const query = 'has:attachment';
        const emails = await gmailService.fetchEmails(userId, query, 5);

        console.log(`✅ Found ${emails.length} emails\n`);

        if (emails.length === 0) {
            console.log('❌ No emails found. Try a different query or check your inbox.');
            return;
        }

        // Step 2: Inspect first email in detail
        const email = emails[0];
        console.log('📋 Email Details:');
        console.log(`  ID: ${email.id}`);
        console.log(`  Subject: ${email.subject}`);
        console.log(`  From: ${email.from}`);
        console.log(`  Has Attachments (flag): ${email.hasAttachments}`);
        console.log(`  Date: ${email.date}\n`);

        if (!email.hasAttachments) {
            console.log('⚠️ Email marked as NO ATTACHMENTS. Skipping...');
            return;
        }

        // Step 3: Fetch full message details
        console.log('📥 Step 2: Fetching full message structure...');
        const message = await gmailService.fetchMessage(userId, email.id, 'full');

        console.log(`  Payload Type: ${message.payload?.mimeType}`);
        console.log(`  Has Parts: ${!!message.payload?.parts}`);
        console.log(`  Parts Count: ${message.payload?.parts?.length || 0}\n`);

        // Step 4: Inspect parts recursively
        console.log('🔎 Step 3: Analyzing message parts...\n');

        function inspectParts(parts: any[], indent = '') {
            if (!parts) return;

            parts.forEach((part, index) => {
                console.log(`${indent}Part ${index}:`);
                console.log(`${indent}  MimeType: ${part.mimeType}`);
                console.log(`${indent}  Filename: ${part.filename || '(none)'}`);
                console.log(`${indent}  Has AttachmentId: ${!!part.body?.attachmentId}`);
                console.log(`${indent}  AttachmentId: ${part.body?.attachmentId || '(none)'}`);
                console.log(`${indent}  Body Size: ${part.body?.size || 0} bytes`);

                // Check if this is an actual attachment
                const isAttachment = part.filename && part.body?.attachmentId;
                console.log(`${indent}  ✅ IS ATTACHMENT: ${isAttachment ? 'YES' : 'NO'}\n`);

                if (part.parts) {
                    console.log(`${indent}  Sub-parts: ${part.parts.length}`);
                    inspectParts(part.parts, indent + '    ');
                }
            });
        }

        if (message.payload?.parts) {
            inspectParts(message.payload.parts);
        } else if (message.payload?.filename) {
            console.log('📎 Single attachment at root level:');
            console.log(`  Filename: ${message.payload.filename}`);
            console.log(`  Has AttachmentId: ${!!message.payload.body?.attachmentId}`);
        } else {
            console.log('❌ No parts found in message structure.');
            console.log('   This email might not have real attachments (could be inline images).');
        }

        // Step 5: Summary
        console.log('\n📊 Summary:');
        console.log(`  Emails fetched: ${emails.length}`);
        console.log(`  Email has attachment flag: ${email.hasAttachments}`);
        console.log(`  Message structure analyzed: ${!!message.payload?.parts ? 'YES' : 'NO'}`);

    } catch (error: any) {
        console.error('\n❌ Error during debug:', error.message);
        if (error.response) {
            console.error('API Response:', error.response.status, error.response.data);
        }
    }
}

debugGmailIngestion().catch(console.error);
