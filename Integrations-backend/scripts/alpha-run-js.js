
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API_URL = 'https://api-m.paypal.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getPaypalToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await axios.post(
    `${PAYPAL_API_URL}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  return response.data.access_token;
}

async function runAlpha() {
  console.log('🚀 [JS-ALPHA] Starting Pure JS Billing Run...');

  try {
    // 1. Get Candidate Case
    const { data: caseData, error: caseError } = await supabase
      .from('dispute_cases')
      .select('id, seller_id, actual_payout_amount, currency, recovery_status')
      .eq('recovery_status', 'reconciled')
      .is('billing_status', null)
      .limit(1)
      .single();

    if (caseError || !caseData) {
      console.log('❌ [JS-ALPHA] No case found:', caseError?.message || 'Empty');
      return;
    }

    console.log(`💡 [JS-ALPHA] Found Case: ${caseData.id}`);

    // 2. Resolve User Email
    let userEmail = 'billing-fallback@margin-finance.com';
    const { data: userRecord } = await supabase
      .from('users')
      .select('email')
      .eq('seller_id', caseData.seller_id)
      .single();

    if (userRecord?.email) userEmail = userRecord.email;
    console.log(`📧 [JS-ALPHA] Using Email: ${userEmail}`);

    // 3. Calculate Fees
    const amount = caseData.actual_payout_amount || 10000;
    const fee = Math.max(Math.round(amount * 0.2), 50);
    const currency = (caseData.currency || 'USD').toUpperCase();
    console.log(`💰 [JS-ALPHA] Amount: ${amount / 100}, Fee: ${fee / 100} ${currency}`);

    // 4. Create PayPal Invoice
    const token = await getPaypalToken();
    const invoiceData = {
      detail: {
        invoice_number: `JS-INV-${caseData.id.substring(0, 8)}-${Date.now()}`,
        reference: caseData.id,
        currency_code: currency,
        note: "Platform Service Fee (20%) for successful Amazon FBA recovery.",
        term: "Payable on receipt"
      },
      invoicer: { email_address: "billing@margin-finance.com" },
      primary_recipients: [{ billing_info: { email_address: userEmail } }],
      items: [{
        name: "Recovery Commission (20%)",
        quantity: "1",
        unit_amount: { currency_code: currency, value: (fee / 100).toFixed(2) }
      }]
    };

    const invResponse = await axios.post(
      `${PAYPAL_API_URL}/v2/invoicing/invoices`,
      invoiceData,
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' } }
    );

    const invoiceId = invResponse.data.id;
    console.log(`✅ [JS-ALPHA] Invoice Created: ${invoiceId}`);

    // 5. Send Invoice
    await axios.post(
      `${PAYPAL_API_URL}/v2/invoicing/invoices/${invoiceId}/send`,
      {},
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('✅ [JS-ALPHA] Invoice Sent.');

    // 6. Update Database
    await supabase.from('dispute_cases').update({
      billing_status: 'sent',
      billed_at: new Date().toISOString(),
      platform_fee_cents: fee
    }).eq('id', caseData.id);

    console.log('🎉 [JS-ALPHA] Pipeline Operational for this case.');

  } catch (err) {
    console.error('💥 [JS-ALPHA] Error:', err.response?.data || err.message);
  }
}

runAlpha();
