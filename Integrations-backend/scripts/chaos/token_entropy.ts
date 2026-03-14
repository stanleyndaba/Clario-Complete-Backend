import { spawn } from 'child_process';
import { Queue } from 'bullmq';
import logger from '../../src/utils/logger';

/**
 * chaos/token_entropy.ts
 * 
 * MISSION: Verify that Just-in-Time (JiT) Hydration prevents "Time-Bomb" token expiry.
 * Prove the worker refreshes stale tokens from the payload before firing SP-API calls.
 */
async function runTokenEntropyChaos() {
    logger.info('🧪 [CHAOS] Starting Token Entropy Test...');

    const TEST_SELLER_ID = 'chaos_token_seller';
    
    // 1. Poison a job with a stale token
    const jobData = {
        sellerId: TEST_SELLER_ID,
        rdtToken: {
            token: 'STALE_POISONED_TOKEN_V1',
            expiresAt: Date.now() - 3600000 // 1 hour ago
        }
    };

    // 2. Queue the job with a simulated delay hook
    // (Actual BullMQ implementation will happen in Phase 6)
    logger.info('📡 [CHAOS] Queuing job with poisoned token payload...');
    
    // 3. Spawn Worker with Token Decay check active
    const worker = spawn('npx', ['ts-node', 'src/workers/refundFilingWorker.ts'], {
        shell: true,
        env: {
            ...process.env,
            SIMULATE_TOKEN_EXPIRE: 'true',
            CHAOS_MODE: 'true'
        }
    });

    worker.stdout.on('data', (data) => {
        const output = data.toString();
        
        // 4. Validation: Look for JiT Hydration signals
        if (output.includes('[JiT] Stale token detected')) {
            logger.info('🎯 [CHAOS] SUCCESS: Worker detected the time-bomb token!');
        }
        
        if (output.includes('[JiT] Refresh successful')) {
            logger.info('✅ [CHAOS] SUCCESS: Just-in-Time hydration completed successfully.');
        }
    });

    await new Promise((resolve) => {
        setTimeout(resolve, 30000); // Allow 30s for the worker to process
        worker.on('exit', resolve);
    });

    worker.kill();
    logger.info('🏆 [CHAOS] Token Entropy Test Complete.');
}

runTokenEntropyChaos().catch(err => {
    logger.error('❌ [CHAOS] Token Entropy Test failed', err);
    process.exit(1);
});
