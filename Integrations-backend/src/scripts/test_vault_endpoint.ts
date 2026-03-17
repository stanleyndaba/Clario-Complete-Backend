import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

async function testVaultSetup() {
  const url = 'http://localhost:3001/api/revenue/vault/setup';
  console.log(`Testing vault setup at ${url}...`);
  try {
    const res = await axios.post(url, {}, {
      headers: {
        'x-user-id': 'demo-user',
        'x-tenant-id': '00000000-0000-0000-0000-000000000001'
      }
    });
    console.log('Response:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error('Error Status:', err.response?.status);
    console.error('Error Data:', JSON.stringify(err.response?.data, null, 2));
    console.error('Error Message:', err.message);
  }
}

testVaultSetup();
