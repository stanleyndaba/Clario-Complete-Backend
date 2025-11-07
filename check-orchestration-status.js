// Check Orchestration Status
// Shows queue status, job counts, and recent activity

const Queue = require('bull');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function checkStatus() {
  console.log('🔍 Checking Orchestration Queue Status');
  console.log('=====================================');
  console.log('Redis URL:', REDIS_URL);
  console.log('');

  try {
    const orchestrationQueue = new Queue('orchestration', REDIS_URL);
    const syncProgressQueue = new Queue('sync-progress', REDIS_URL);

    // Get job counts
    const [orchestrationCounts, syncProgressCounts] = await Promise.all([
      orchestrationQueue.getJobCounts(),
      syncProgressQueue.getJobCounts()
    ]);

    console.log('📊 Orchestration Queue:');
    console.log('  Waiting:', orchestrationCounts.waiting);
    console.log('  Active:', orchestrationCounts.active);
    console.log('  Completed:', orchestrationCounts.completed);
    console.log('  Failed:', orchestrationCounts.failed);
    console.log('  Delayed:', orchestrationCounts.delayed);
    console.log('');

    console.log('📊 Sync Progress Queue:');
    console.log('  Waiting:', syncProgressCounts.waiting);
    console.log('  Active:', syncProgressCounts.active);
    console.log('  Completed:', syncProgressCounts.completed);
    console.log('  Failed:', syncProgressCounts.failed);
    console.log('');

    // Get recent jobs
    const [waitingJobs, activeJobs, completedJobs] = await Promise.all([
      orchestrationQueue.getJobs(['waiting'], 0, 10),
      orchestrationQueue.getJobs(['active'], 0, 10),
      orchestrationQueue.getJobs(['completed'], 0, 5)
    ]);

    if (waitingJobs.length > 0) {
      console.log('⏳ Waiting Jobs:');
      waitingJobs.forEach((job, index) => {
        console.log(`  ${index + 1}. Job ${job.id}:`);
        console.log(`     User: ${job.data.userId}`);
        console.log(`     Sync ID: ${job.data.syncId}`);
        console.log(`     Step: ${job.data.step} (${job.data.currentStep})`);
      });
      console.log('');
    }

    if (activeJobs.length > 0) {
      console.log('🔄 Active Jobs:');
      activeJobs.forEach((job, index) => {
        console.log(`  ${index + 1}. Job ${job.id}:`);
        console.log(`     User: ${job.data.userId}`);
        console.log(`     Sync ID: ${job.data.syncId}`);
        console.log(`     Step: ${job.data.step} (${job.data.currentStep})`);
        console.log(`     Progress: ${job.progress || 0}%`);
      });
      console.log('');
    }

    if (completedJobs.length > 0) {
      console.log('✅ Recently Completed Jobs:');
      completedJobs.forEach((job, index) => {
        console.log(`  ${index + 1}. Job ${job.id}:`);
        console.log(`     User: ${job.data.userId}`);
        console.log(`     Sync ID: ${job.data.syncId}`);
        console.log(`     Step: ${job.data.step}`);
        console.log(`     Completed: ${new Date(job.finishedOn).toISOString()}`);
        if (job.returnvalue) {
          console.log(`     Result: ${job.returnvalue.success ? 'Success' : 'Failed'}`);
          console.log(`     Message: ${job.returnvalue.message}`);
        }
      });
      console.log('');
    }

    // Get failed jobs for debugging
    const failedJobs = await orchestrationQueue.getJobs(['failed'], 0, 10);
    if (failedJobs.length > 0) {
      console.log('❌ Failed Jobs (Recent):');
      failedJobs.forEach((job, index) => {
        console.log(`  ${index + 1}. Job ${job.id}:`);
        console.log(`     User: ${job.data.userId}`);
        console.log(`     Sync ID: ${job.data.syncId}`);
        console.log(`     Step: ${job.data.step}`);
        if (job.failedReason) {
          console.log(`     Error: ${job.failedReason}`);
        }
        if (job.stacktrace && job.stacktrace.length > 0) {
          console.log(`     Stack: ${job.stacktrace[0].substring(0, 200)}...`);
        }
      });
      console.log('');
    }

    // Check for duplicate jobs (concurrency check)
    const allJobs = [...waitingJobs, ...activeJobs];
    const jobGroups = new Map();
    
    allJobs.forEach(job => {
      const key = `${job.data.userId}_${job.data.step}_${job.data.syncId}`;
      if (!jobGroups.has(key)) {
        jobGroups.set(key, []);
      }
      jobGroups.get(key).push(job);
    });

    const duplicates = Array.from(jobGroups.entries()).filter(([_, jobs]) => jobs.length > 1);
    
    if (duplicates.length > 0) {
      console.log('⚠️  Potential Duplicate Jobs Found:');
      duplicates.forEach(([key, jobs]) => {
        console.log(`  Key: ${key}`);
        console.log(`  Count: ${jobs.length}`);
        jobs.forEach((job, index) => {
          console.log(`    ${index + 1}. Job ${job.id} - State: ${job.opts ? 'waiting' : 'active'}`);
        });
      });
      console.log('');
    } else {
      console.log('✅ No duplicate jobs found');
      console.log('');
    }

    await orchestrationQueue.close();
    await syncProgressQueue.close();

    console.log('=====================================');
    console.log('Status check complete');

  } catch (error) {
    console.error('❌ Error checking queue status:', error.message);
    if (error.message.includes('ECONNREFUSED') || error.message.includes('max retries')) {
      console.error('');
      console.error('Redis connection failed. Make sure Redis is running:');
      console.error('  .\\start-redis.ps1');
    }
    process.exit(1);
  }
}

checkStatus();

