require('dotenv').config();
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

async function checkIdentity() {
    console.log("🦁 Agent 9: Verifying Identity Card...");

    const client = new STSClient({
        region: "us-east-1",
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    try {
        const command = new GetCallerIdentityCommand({});
        const response = await client.send(command);

        console.log("✅ AWS Credentials Work!");
        console.log("-----------------------------------------");
        console.log("🆔 Your User ARN:   ", response.Arn);
        console.log("-----------------------------------------");
        console.log("👉 THIS is the ARN that MUST be in your App Registration.");

    } catch (error) {
        console.log("❌ Authentication Failed.");
        console.log("Error:", error.message);
    }
}

checkIdentity();
