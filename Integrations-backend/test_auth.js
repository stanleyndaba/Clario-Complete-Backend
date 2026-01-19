require('dotenv').config();
const axios = require('axios');

async function testAuth() {
    console.log("🦁 Agent 9: Testing Ignition...");

    // Use AMAZON_SPAPI_REFRESH_TOKEN as that's what we stored in .env
    const refreshToken = process.env.AMAZON_REFRESH_TOKEN || process.env.AMAZON_SPAPI_REFRESH_TOKEN;
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;

    console.log("📋 Checking credentials...");
    console.log("   Client ID:", clientId ? clientId.substring(0, 30) + "..." : "❌ MISSING");
    console.log("   Client Secret:", clientSecret ? "✅ Present" : "❌ MISSING");
    console.log("   Refresh Token:", refreshToken ? refreshToken.substring(0, 20) + "..." : "❌ MISSING");

    if (!refreshToken || !clientId || !clientSecret) {
        console.log("❌ FAILURE. Missing credentials in .env file.");
        return;
    }

    try {
        const response = await axios.post('https://api.amazon.com/auth/o2/token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        console.log("✅ SUCCESS! Amazon accepted our keys.");
        console.log("🔑 Access Token received:", response.data.access_token.substring(0, 20) + "...");
        console.log("⏱️  Expires in:", response.data.expires_in, "seconds");

    } catch (error) {
        console.log("❌ FAILURE. Something is wrong.");
        console.log("Error:", error.response ? error.response.data : error.message);
    }
}

testAuth();
