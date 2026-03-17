import paypalService from '../services/paypalService';
import * as dotenv from 'dotenv';
dotenv.config();

async function testPaypalService() {
  console.log('--- Testing PayPal Service Direct Call ---');
  try {
    const setupToken = await paypalService.createVaultSetupToken();
    console.log('SUCCESS:', JSON.stringify(setupToken, null, 2));
  } catch (err: any) {
    console.error('ERROR OCCURRED');
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Message:', err.message);
    }
  }
}

testPaypalService();
