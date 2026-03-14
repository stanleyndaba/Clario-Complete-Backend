import { Queue, QueueEvents } from 'bullmq';
import logger from '../../src/utils/logger';

/**
 * chaos/tenant_flood_bench.ts
 * 
 * MISSION: Prove that a "Mega-Seller" with massive backlog/throttling does not 
 * block a "Mini-Seller" (Weighted Fair Queuing / HOL Blocking prevention).
 */
async function runTenantFloodBench() {
    logger.info('🏎️ [CHAOS] Starting Tenant Flood Benchmark...');

    const MEGA_SELLER = 'seller_mega_alpha';
    const MINI_SELLER = 'seller_mini_beta';
    
    // 1. Initialize BullMQ (Requires local Redis)
    const submissionQueue = new Queue('sp-api-submissions');
    const queueEvents = new QueueEvents('sp-api-submissions');

    // 2. Flood MegaSeller (5000 jobs)
    logger.info(`🌊 [CHAOS] Flooding queue with 5,000 jobs for ${MEGA_SELLER}...`);
    const megaJobs = [];
    for (let i = 0; i < 5000; i++) {
        megaJobs.push({
            name: `filing_${i}`,
            data: { sellerId: MEGA_SELLER },
            opts: { groupId: MEGA_SELLER }
        });
    }
    await submissionQueue.addBulk(megaJobs);

    // 3. Inject MiniSeller (The Control)
    logger.info(`⚡ [CHAOS] Injecting clean job for ${MINI_SELLER}...`);
    const startTime = Date.now();
    const miniJob = await submissionQueue.add('urgent_filing', 
        { sellerId: MINI_SELLER }, 
        { groupId: MINI_SELLER, priority: 1 }
    );

    // 4. Benchmarking
    try {
        await miniJob.waitUntilFinished(queueEvents);
        const latency = Date.now() - startTime;
        
        logger.info(`📊 [CHAOS] BENCHMARK RESULT: MiniSeller Latency = ${latency}ms`);
        
        if (latency < 10000) {
            logger.info('✅ [CHAOS] SUCCESS: Seller B bypassed the 5,000-job wall.');
        } else {
            logger.error('❌ [CHAOS] FAIL: Head-of-Line blocking detected!', { latency });
            process.exit(1);
        }
    } catch (err) {
        logger.error('❌ [CHAOS] Benchmark failed', err);
    } finally {
        await submissionQueue.close();
        await queueEvents.close();
    }

    logger.info('🏆 [CHAOS] Tenant Flood Benchmark Complete.');
}

runTenantFloodBench().catch(err => {
    logger.error('❌ [CHAOS] Flood benchmark crashed', err);
    process.exit(1);
});
