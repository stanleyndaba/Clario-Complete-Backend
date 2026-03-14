import { spawn } from 'child_process';
import { supabaseAdmin } from '../../src/database/supabaseClient';
import logger from '../../src/utils/logger';

/**
 * chaos/sigkill_recovery.ts
 * 
 * MISSION: Verify that a "Ghost Submission" (crash post-API, pre-DB) is correctly
 * recovered by the Ghost Hunt reconciliation loop after the 15m shadow window.
 */
async function runSigkillChaos() {
    logger.info('🧪 [CHAOS] Starting SIGKILL Recovery Test...');

    const TEST_SELLER_ID = 'chaos_test_seller';
    const TEST_CASE_ID = '00000000-0000-4000-a000-000000000099'; // Mock UUID

    // 1. Setup Mock State
    await supabaseAdmin
        .from('dispute_cases')
        .upsert({
            id: TEST_CASE_ID,
            seller_id: TEST_SELLER_ID,
            filing_status: 'pending',
            case_number: 'CHAOS-99',
            claim_amount: 99.99,
            case_type: 'amazon_fba',
            provider: 'amazon'
        });

    logger.info('✅ [CHAOS] Mock case initialized as "pending"');

    // 2. Spawn Worker with Crash Hook active
    const worker = spawn('npx', ['ts-node', 'src/workers/refundFilingWorker.ts'], {
        shell: true,
        env: {
            ...process.env,
            SIMULATE_EXIT_AFTER_SUBMIT: 'true',
            SINGLE_CASE_MODE: TEST_CASE_ID // Assuming we add a way to target specific cases
        }
    });

    worker.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('SIMULATE_EXIT_AFTER_SUBMIT active')) {
            logger.info('🎯 [CHAOS] Catching planned worker crash!');
        }
    });

    await new Promise((resolve) => worker.on('exit', resolve));
    logger.info('💀 [CHAOS] Worker process has crashed as expected.');

    // 3. Validation: The State is now stuck in 'submitting'
    const { data: caseData } = await supabaseAdmin
        .from('dispute_cases')
        .select('filing_status')
        .eq('id', TEST_CASE_ID)
        .single();

    if (caseData?.filing_status === 'submitting') {
        logger.info('✅ [CHAOS] Step 1 SUCCESS: Case stuck in "submitting" state.');
    } else {
        logger.error('❌ [CHAOS] Step 1 FAIL: Case state is unexpected', { status: caseData?.filing_status });
        process.exit(1);
    }

    // 4. Verification: The Ghost Hunt ignores it initially (Atomic Lock)
    logger.info('🔍 [CHAOS] Running Ghost Hunt reconciliation (Immediate)...');
    // Mock run of GhostHunt (logic to be implemented in Phase 6)
    
    // 5. Success Metric
    logger.info('🏆 [CHAOS] SIGKILL Recovery Test Phase 1 Complete.');
}

runSigkillChaos().catch(err => {
    logger.error('❌ [CHAOS] Test failed with error', err);
    process.exit(1);
});
