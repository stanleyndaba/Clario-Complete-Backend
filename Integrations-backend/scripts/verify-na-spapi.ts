import axios from 'axios';
import aws4 from 'aws4';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function verifySPAPIConnection() {
    console.log('🚀 [AGENT 7] STARTING LIVE-FIRE CONNECTION PROFILER (NA)');

    // 1. Map Environment Variables
    const clientId = process.env.SP_API_CLIENT_ID || process.env.AMAZON_CLIENT_ID;
    const clientSecret = process.env.SP_API_CLIENT_SECRET || process.env.AMAZON_CLIENT_SECRET;
    const refreshToken = process.env.SP_API_REFRESH_TOKEN || process.env.AMAZON_REFRESH_TOKEN;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.AMAZON_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AMAZON_SECRET_ACCESS_KEY;
    const roleArn = process.env.SP_API_ROLE_ARN || process.env.AWS_ROLE_ARN;
    const region = 'us-east-1';
    const endpoint = 'sellingpartnerapi-na.amazon.com';

    try {
        // 2. LWA Access Token Exchange
        console.log('[PROFILER] Exchanging Refresh Token for LWA Access Token...');
        const lwaResponse = await axios.post('https://api.amazon.com/auth/o2/token', {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        });
        const lwaAccessToken = lwaResponse.data.access_token;
        console.log('✅ [PROFILER] LWA Exchange Successful');

        // 3. Assume Role (STS)
        console.log(`[PROFILER] Assuming Role: ${roleArn}...`);
        const stsClient = new STSClient({
            region,
            credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! }
        });
        const assumeRoleCommand = new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: 'Agent7ProfilerSession'
        });
        const stsResponse = await stsClient.send(assumeRoleCommand);
        const credentials = {
            accessKeyId: stsResponse.Credentials!.AccessKeyId!,
            secretAccessKey: stsResponse.Credentials!.SecretAccessKey!,
            sessionToken: stsResponse.Credentials!.SessionToken!
        };
        console.log('✅ [PROFILER] Role Assumed Successfully');

        // 4. SigV4 Signing & SP-API Request
        console.log('[PROFILER] Handshaking with getMarketplaceParticipations...');
        const path = '/sellers/v1/marketplaceParticipations';
        const opts = {
            host: endpoint,
            path: path,
            method: 'GET',
            region: region,
            service: 'execute-api',
            headers: {
                'x-amz-access-token': lwaAccessToken,
                'user-agent': 'Margin/Agent7/1.0 (Language=TypeScript)'
            }
        };

        aws4.sign(opts, credentials);

        const response = await axios.get(`https://${endpoint}${path}`, { headers: opts.headers });
        
        console.log('🔥 [PROFILER] LIVE-FIRE STATUS: 100% SUCCESS');
        console.log('--------------------------------------------------');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('--------------------------------------------------');

    } catch (error: any) {
        console.error('❌ [PROFILER] CONNECTION FAILED');
        if (error.response) {
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
        process.exit(1);
    }
}

verifySPAPIConnection();
