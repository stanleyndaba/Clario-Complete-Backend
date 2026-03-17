
import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';

async function testPaypalAuth() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ Missing PayPal credentials in .env');
    return;
  }

  console.log('Testing PayPal Auth...');
  console.log(`Client ID: ${clientId.substring(0, 10)}...`);

  // Try Sandbox first
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const tryAuth = async (url: string, name: string) => {
    try {
      console.log(`Trying ${name} (${url})...`);
      const response = await axios.post(
        `${url}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      console.log(`✅ Success on ${name}! Token retrieved.`);
      return true;
    } catch (error: any) {
      console.error(`❌ ${name} failed:`, error.response?.data?.error_description || error.message);
      return false;
    }
  };

  const sandboxSuccess = await tryAuth('https://api-m.sandbox.paypal.com', 'Sandbox');
  const liveSuccess = await tryAuth('https://api-m.paypal.com', 'Live');

  if (!sandboxSuccess && !liveSuccess) {
    console.error('💥 Both Sandbox and Live authentication failed.');
  }
}

testPaypalAuth().catch(console.error);
