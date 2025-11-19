/**
 * Quick script to hit the Python Discovery Agent predict endpoint directly.
 * Helps validate whether claims are flagged as claimable.
 */
require('dotenv/config');
const axios = require('axios');

async function main() {
  const pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-5.onrender.com';
  const payload = {
    claims: [
      {
        claim_id: 'test-claim-1',
        seller_id: 'diagnostics',
        order_id: 'ORDER123',
        category: 'inventory_loss',
        subcategory: 'lost_shipment',
        reason_code: 'LOST_SHIPMENT',
        marketplace: 'US',
        fulfillment_center: 'FBA1',
        amount: 125.5,
        quantity: 3,
        order_value: 150,
        shipping_cost: 12.5,
        days_since_order: 25,
        days_since_delivery: 20,
        description: 'Diagnostic lost shipment claim',
        reason: 'LOST_SHIPMENT',
        notes: 'diagnostic',
        claim_date: new Date().toISOString()
      }
    ]
  };

  console.log('POST', `${pythonApiUrl}/api/v1/claim-detector/predict/batch`);
  try {
    const response = await axios.post(`${pythonApiUrl}/api/v1/claim-detector/predict/batch`, payload, {
      timeout: 60000,
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('Status:', response.status);
    console.log('Body:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Request failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

main();


