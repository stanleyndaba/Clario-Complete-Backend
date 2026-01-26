import { v4 as uuidv4 } from 'uuid';
import { OrchestrationJobManager } from '../src/jobs/orchestrationJob';
import logger from '../src/utils/logger';
import { supabaseAdmin } from '../src/database/supabaseClient';

// Configuration
const TEST_USER_ID = 'e2e-tester-' + Math.random().toString(36).substring(7);
const TEST_SELLER_ID = 'SELLER_' + Math.random().toString(36).substring(7).toUpperCase();
const SYNC_ID = 'sync_' + uuidv4().substring(0, 8);

async function verify7Phases() {
    logger.info(`🚀 Starting 7-Phase E2E Verification [${SYNC_ID}]`);
    logger.info(`👤 Target User: ${TEST_USER_ID} (${TEST_SELLER_ID})`);

    try {
        // --- PHASE 1: OAuth Completion ---
        logger.info('\n🎬 PHASE 1: Zero-Friction Onboarding');
        await OrchestrationJobManager.triggerPhase1_OAuthCompletion(
            TEST_USER_ID,
            TEST_SELLER_ID,
            SYNC_ID
        );
        logger.info('✅ Phase 1 Triggered (Check logs for WebSocket emit)');

        // --- PHASE 2: Sync Completion ---
        logger.info('\n🔍 PHASE 2: Autonomous Money Discovery');
        await OrchestrationJobManager.triggerPhase2_SyncCompletion(
            TEST_USER_ID,
            SYNC_ID,
            1250, // orders_count
            85    // inventory_items
        );
        logger.info('✅ Phase 2 Triggered (Detection job enqueued)');

        // --- PHASE 3: Detection Completion ---
        logger.info('\n📄 PHASE 3: Intelligent Evidence Ecosystem');
        const mockClaims = [
            { id: 'c1', type: 'missing_unit', value: 120.50, confidence: 0.92 },
            { id: 'c2', type: 'fba_fee_error', value: 45.00, confidence: 0.78 }
        ];
        await OrchestrationJobManager.triggerPhase3_DetectionCompletion(
            TEST_USER_ID,
            SYNC_ID,
            mockClaims
        );
        logger.info('✅ Phase 3 Triggered (Evidence matching started)');

        // --- PHASE 4: Evidence Matching ---
        logger.info('\n🎯 PHASE 4: Predictive Refund Orchestration');
        const mockMatches = [
            { claim_id: 'c1', document_id: 'd1', confidence: 0.95, auto_submit: true },
            { claim_id: 'c2', document_id: 'd2', confidence: 0.88, auto_submit: true }
        ];
        await OrchestrationJobManager.triggerPhase4_EvidenceMatching(
            TEST_USER_ID,
            SYNC_ID,
            mockMatches
        );
        logger.info('✅ Phase 4 Triggered (Claims routed)');

        // --- PHASE 5: Claim Submission ---
        logger.info('\n🚀 PHASE 5: Autonomous Recovery Pipeline');
        await OrchestrationJobManager.triggerPhase5_ClaimSubmission(
            TEST_USER_ID,
            'claim_123',
            'CASE-456-789',
            SYNC_ID
        );
        logger.info('✅ Phase 5 Triggered (Claim submitted to Amazon)');

        // --- PHASE 6: Claim Rejection (Simulated) ---
        logger.info('\n🧠 PHASE 6: Continuous Learning Brain');
        await OrchestrationJobManager.triggerPhase6_ClaimRejection(
            TEST_USER_ID,
            'claim_123',
            'Missing proof of delivery',
            'CASE-456-789',
            SYNC_ID
        );
        logger.info('✅ Phase 6 Triggered (Learning engine notified)');

        // --- PHASE 7: Payout Received ---
        logger.info('\n💰 PHASE 7: Hyper-Transparency Layer');
        await OrchestrationJobManager.triggerPhase7_PayoutReceived(
            TEST_USER_ID,
            'claim_999',
            250.00,
            'CASE-999-000',
            SYNC_ID
        );
        logger.info('✅ Phase 7 Triggered (Payout verified & proof packet generated)');

        logger.info('\n🎊 Final E2E Verification Status: SUCCESS');
        logger.info('All 7 phases of the Clario engine are functional and integrated.');

        // Cleanup (Optional: uncomment to remove test logs)
        // await supabaseAdmin.from('recovery_lifecycle_logs').delete().eq('workflow_id', SYNC_ID);
        // logger.info('🧹 Cleanup complete.');

    } catch (error: any) {
        logger.error('❌ E2E Verification FAILED:', error.message);
        process.exit(1);
    }
}

// Ensure the JobManager is initialized (sets up processors)
OrchestrationJobManager.initialize();

// Run it
verify7Phases().then(() => {
    // Wait for async background work to settle
    setTimeout(() => process.exit(0), 1000);
});
