// Clean Queue Script
// Removes old failed and completed jobs

const Queue = require('bull');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function cleanQueue() {
  console.log('🧹 Cleaning Orchestration Queue');
  console.log('================================');
  console.log('Redis URL:', REDIS_URL);
  console.log('');

  try {
    const orchestrationQueue = new Queue('orchestration', REDIS_URL);
    const syncProgressQueue = new Queue('sync-progress', REDIS_URL);

    // Get counts before cleanup
    const [beforeOrchestration, beforeSyncProgress] = await Promise.all([
      orchestrationQueue.getJobCounts(),
      syncProgressQueue.getJobCounts()
    ]);

    console.log('📊 Before Cleanup:');
    console.log('  Orchestration - Failed:', beforeOrchestration.failed, 'Completed:', beforeOrchestration.completed);
    console.log('  Sync Progress - Failed:', beforeSyncProgress.failed, 'Completed:', beforeSyncProgress.completed);
    console.log('');

    // Clean failed jobs (older than 0ms = all failed jobs)
    console.log('Cleaning failed jobs...');
    const [cleanedFailedOrch, cleanedFailedSync] = await Promise.all([
      orchestrationQueue.clean(0, 'failed'),
      syncProgressQueue.clean(0, 'failed')
    ]);

    console.log(`  ✅ Removed ${cleanedFailedOrch.length} failed orchestration jobs`);
    console.log(`  ✅ Removed ${cleanedFailedSync.length} failed sync progress jobs`);
    console.log('');

    // Clean completed jobs older than 1 hour (optional)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    console.log('Cleaning old completed jobs (older than 1 hour)...');
    const [cleanedCompletedOrch, cleanedCompletedSync] = await Promise.all([
      orchestrationQueue.clean(oneHourAgo, 'completed'),
      syncProgressQueue.clean(oneHourAgo, 'completed')
    ]);

    console.log(`  ✅ Removed ${cleanedCompletedOrch.length} old completed orchestration jobs`);
    console.log(`  ✅ Removed ${cleanedCompletedSync.length} old completed sync progress jobs`);
    console.log('');

    // Get counts after cleanup
    const [afterOrchestration, afterSyncProgress] = await Promise.all([
      orchestrationQueue.getJobCounts(),
      syncProgressQueue.getJobCounts()
    ]);

    console.log('📊 After Cleanup:');
    console.log('  Orchestration - Failed:', afterOrchestration.failed, 'Completed:', afterOrchestration.completed);
    console.log('  Sync Progress - Failed:', afterSyncProgress.failed, 'Completed:', afterSyncProgress.completed);
    console.log('');

    await orchestrationQueue.close();
    await syncProgressQueue.close();

    console.log('================================');
    console.log('✅ Queue cleanup complete');

  } catch (error) {
    console.error('❌ Error cleaning queue:', error.message);
    if (error.message.includes('ECONNREFUSED') || error.message.includes('max retries')) {
      console.error('');
      console.error('Redis connection failed. Make sure Redis is running:');
      console.error('  .\\start-redis.ps1');
    }
    process.exit(1);
  }
}

cleanQueue();

