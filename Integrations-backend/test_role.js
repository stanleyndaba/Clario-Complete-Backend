require('dotenv').config();
const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");

async function testRole() {
    console.log("🦁 Agent 9: Testing IAM Role Connection...");
    console.log("🎯 Target Role:", process.env.AWS_ROLE_ARN);

    // 1. Setup the client with your IAM User keys
    const client = new STSClient({
        region: "us-east-1",
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });

    try {
        // 2. Try to "Assume" (put on) the Role
        const command = new AssumeRoleCommand({
            RoleArn: process.env.AWS_ROLE_ARN,
            RoleSessionName: "MarginTestSession"
        });

        const response = await client.send(command);

        console.log("✅ SUCCESS! The Role works.");
        console.log("🛡️  Temporary Access Key:", response.Credentials.AccessKeyId);
        console.log("🚀 We are ready to build the auditor.");

    } catch (error) {
        console.log("❌ FAILURE. The Role rejected us.");
        console.log("Error:", error.message);
        console.log("\n💡 TIP: Check if AWS_ACCESS_KEY_ID is correct in your .env file.");
    }
}

testRole();
