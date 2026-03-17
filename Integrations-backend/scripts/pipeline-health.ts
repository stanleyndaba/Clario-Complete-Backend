import dotenv from 'dotenv';
dotenv.config();
import { supabase } from '../src/database/supabaseClient';
import logger from '../src/utils/logger';

async function trackPipelineHealth() {
  console.log('📊 RECOVERY MACHINE: PIPELINE HEALTH REPORT');
  console.log('-----------------------------------------');

  try {
    // 1. Detections Created
    const { count: detectionsCount, error: detectionsError } = await supabase
      .from('detection_results')
      .select('*', { count: 'exact', head: true });

    // 2. Cases Created
    const { count: casesCount, error: casesError } = await supabase
      .from('dispute_cases')
      .select('*', { count: 'exact', head: true });

    // 3. Cases Filed
    const { count: filedCount, error: filedError } = await supabase
      .from('dispute_cases')
      .select('*', { count: 'exact', head: true })
      .in('filing_status', ['filed', 'filing']);

    // 4. Cases Approved
    const { count: approvedCount, error: approvedError } = await supabase
      .from('dispute_cases')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved');

    // 5. Money Recovered
    const { data: recoveredData, error: recoveredError } = await supabase
      .from('recoveries')
      .select('actual_amount')
      .eq('reconciliation_status', 'reconciled');
    
    const totalRecovered = recoveredData?.reduce((sum: number, r: any) => sum + (Number(r.actual_amount) || 0), 0) || 0;

    // 6. Billing Triggered
    const { count: billingCount, error: billingError } = await supabase
      .from('margin_invoices')
      .select('*', { count: 'exact', head: true });

    if (detectionsError || casesError || filedError || approvedError || recoveredError || billingError) {
      console.error('❌ Error fetching some metrics:', {
        detectionsError, casesError, filedError, approvedError, recoveredError, billingError
      });
    }

    console.log(`1. Detections Created: ${detectionsCount || 0}`);
    console.log(`2. Cases Created:      ${casesCount || 0}`);
    console.log(`3. Cases Filed:        ${filedCount || 0}`);
    console.log(`4. Cases Approved:     ${approvedCount || 0}`);
    console.log(`5. Money Recovered:    $${totalRecovered.toLocaleString()}`);
    console.log(`6. Billing Triggered:  ${billingCount || 0}`);
    console.log('-----------------------------------------');

    // Analysis
    if ((detectionsCount || 0) > 0 && (casesCount || 0) === 0) {
      console.warn('⚠️ ALERT: Detections exist but no Cases created. Agent 3 -> Agent 7 handoff is BROKEN.');
    } else if ((casesCount || 0) > 0 && (filedCount || 0) === 0) {
      console.warn('⚠️ ALERT: Cases exist but none Filed. Agent 7 (The Closer) is STUCK.');
    } else if ((approvedCount || 0) > 0 && (totalRecovered || 0) === 0) {
      console.warn('⚠️ ALERT: Cases approved but no Money Recovered matches. Agent 8 (The Collector) is MISSING matches.');
    } else {
      console.log('✅ Pipeline status: Logic appears connected. Check volumes for throughput.');
    }

  } catch (error: any) {
    console.error('💥 Fatal error in health check:', error.message);
  }
}

trackPipelineHealth();
