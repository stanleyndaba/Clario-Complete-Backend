
import dotenv from 'dotenv';
dotenv.config();

import billingService from '../src/services/billingService';
import { supabaseAdmin } from '../src/database/supabaseClient';
import logger from '../utils/logger';

async function testSingleCase() {
  console.log('🚀 [ALPHA] Starting Single-Case Billing Test...');

  // 1. Get a candidate case
  const { data: caseData, error: caseError } = await supabaseAdmin
    .from('dispute_cases')
    .select('id, seller_id, actual_payout_amount, currency')
    .eq('recovery_status', 'reconciled')
    .is('billing_status', null)
    .limit(1)
    .single();

  if (caseError || !caseData) {
    console.error('❌ [ALPHA] No candidate reconciled case found:', caseError?.message);
    return;
  }

  console.log('💡 [ALPHA] Candidate Case:', caseData.id);
  console.log('   - Amount (Cents):', caseData.actual_payout_amount);
  console.log('   - Seller ID:', caseData.seller_id);

  // 2. Mock recovery amount if missing
  const amountToCharge = (caseData.actual_payout_amount && caseData.actual_payout_amount > 0) 
    ? caseData.actual_payout_amount 
    : 10000; // Default $100 for testing

  // 3. Trigger Billing
  const request = {
    disputeId: caseData.id,
    userId: caseData.seller_id,
    amountRecoveredCents: amountToCharge,
    currency: caseData.currency || 'USD'
  };

  console.log('💳 [ALPHA] Calling chargeCommission...');
  try {
    const result = await billingService.chargeCommission(request);
    console.log('📊 [ALPHA] Result received.');
    const fs = require('fs');
    fs.writeFileSync('alpha-result.json', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('✅ [ALPHA] Success! Invoice created and sent.');
    } else {
      console.error('❌ [ALPHA] Billing Failed:', result.error);
    }
  } catch (err: any) {
    console.error('💥 [ALPHA] Fatal Error:', err.stack);
    const fs = require('fs');
    fs.writeFileSync('alpha-error.txt', err.stack || err.message);
  }
}

testSingleCase().catch(console.error);
