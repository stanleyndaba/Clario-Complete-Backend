require('dotenv').config();
const axios = require('axios');
const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");
const aws4 = require('aws4');

// CONFIGURATION - Using NA region for Amazon.com sellers
const REGION = 'us-east-1';
const HOST = 'sellingpartnerapi-na.amazon.com'; // NA endpoint
// const HOST = 'sandbox.sellingpartnerapi-na.amazon.com'; // Sandbox endpoint

async function getAccessToken() {
    // Use AMAZON_SPAPI_REFRESH_TOKEN as fallback (matches our .env)
    const refreshToken = process.env.AMAZON_REFRESH_TOKEN || process.env.AMAZON_SPAPI_REFRESH_TOKEN;
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;

    const response = await axios.post('https://api.amazon.com/auth/o2/token',
        new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        }).toString(),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
    );
    return response.data.access_token;
}

async function getTempCredentials() {
    const client = new STSClient({
        region: "us-east-1",
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });
    const command = new AssumeRoleCommand({
        RoleArn: process.env.AWS_ROLE_ARN,
        RoleSessionName: "MarginAppSession"
    });
    const response = await client.send(command);
    return response.Credentials;
}

async function fetchMarketplaces() {
    console.log("🦁 Agent 9: Starting Role-Based Audit Scan...");
    console.log("🌍 Region:", REGION);
    console.log("🌐 Host:", HOST);

    try {
        // 1. Get Tokens & Creds
        const accessToken = await getAccessToken();
        const tempCreds = await getTempCredentials();
        console.log("✅ Auth & Role Secure.");

        // 2. Prepare the Request
        let opts = {
            service: 'execute-api',
            region: REGION,
            host: HOST,
            path: '/sellers/v1/marketplaceParticipations',
            method: 'GET',
            headers: {
                'x-amz-access-token': accessToken
            }
        };

        // 3. Sign the Request (SigV4)
        aws4.sign(opts, {
            accessKeyId: tempCreds.AccessKeyId,
            secretAccessKey: tempCreds.SecretAccessKey,
            sessionToken: tempCreds.SessionToken
        });

        // 4. Send it!
        console.log("📡 Contacting Amazon SP-API...");
        const res = await axios({
            method: opts.method,
            url: `https://${opts.host}${opts.path}`,
            headers: opts.headers
        });

        console.log("🎉 SUCCESS! Marketplaces Found:");
        console.log(JSON.stringify(res.data, null, 2));

    } catch (error) {
        console.log("❌ ERROR fetching data.");
        if (error.response) {
            console.log("Status:", error.response.status);
            console.log("Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.log(error.message);
        }
    }
}

fetchMarketplaces();
