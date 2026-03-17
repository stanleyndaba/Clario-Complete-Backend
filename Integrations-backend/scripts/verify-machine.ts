
import dotenv from 'dotenv';
dotenv.config();

import { supabase } from '../src/database/supabaseClient';
import billingService from '../src/services/billingService';
import paypalService from '../src/services/paypalService';
import logger from '../utils/logger';

async function verifyMachine() {
  console.log('🔍 [VM] Starting Verification Machine...');

  // 1. Check DB Connection
  console.log('   - Checking Supabase...');
  const { data: cases, error: dbError } = await supabase
    .from('dispute_cases')
    .select('id, recovery_status, billing_status')
    .eq('recovery_status', 'reconciled')
    .limit(5);

  if (dbError) {
    console.error('   ❌ Supabase Error:', dbError.message);
    return;
  }
  console.log(`   ✅ Supabase connected. Found ${cases?.length || 0} reconciled cases.`);

  // 2. Check PayPal Config
  console.log('   - Checking PayPal Credentials...');
  try {
    const token = await paypalService.getAccessToken();
    console.log('   ✅ PayPal Authenticated Successfully (Token retrieved).');
  } catch (err: any) {
    console.error('   ❌ PayPal Authentication Failed:', err.message);
  }

  // 3. Stats Check
  const { count: approvedCount } = await supabase
    .from('dispute_cases')
    .select('*', { count: 'exact', head: true })
    .eq('recovery_status', 'reconciled');
    
  const { count: billedCount } = await supabase
    .from('dispute_cases')
    .select('*', { count: 'exact', head: true })
    .eq('billing_status', 'sent');

  console.log('📊 [STATS]');
  console.log(`   - Approved/Reconciled: ${approvedCount}`);
  console.log(`   - Invoiced (sent): ${billedCount}`);

  if (cases && cases.length > 0) {
    const sample = cases[0];
    console.log('💡 [SAMPLE CASE]');
    console.log(`   ID: ${sample.id}`);
    console.log(`   Recovery Status: ${sample.recovery_status}`);
    console.log(`   Billing Status: ${sample.billing_status}`);
  }
}

verifyMachine().catch(err => {
  console.error('💥 FATAL:', err);
  process.exit(1);
});
