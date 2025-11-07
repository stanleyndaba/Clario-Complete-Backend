// Test Redis Connection
// Run with: node test-redis-connection.js

const { Queue } = require('bull');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

console.log('🔍 Testing Redis Connection');
console.log('Redis URL:', REDIS_URL);
console.log('');

async function testRedis() {
  try {
    // Create a test queue
    const testQueue = new Queue('test-connection', REDIS_URL);
    
    console.log('Attempting to connect to Redis...');
    
    // Try to get queue info (this will test the connection)
    const jobCounts = await testQueue.getJobCounts();
    
    console.log('✅ Redis connection successful!');
    console.log('Job counts:', jobCounts);
    console.log('');
    
    // Clean up
    await testQueue.close();
    
    console.log('✅ Redis is ready for use');
    console.log('');
    console.log('You can now run Phase 1 tests!');
    
    process.exit(0);
  } catch (error) {
    console.log('❌ Redis connection failed');
    console.log('Error:', error.message);
    console.log('');
    console.log('Troubleshooting:');
    console.log('1. Make sure Redis is running');
    console.log('2. Check REDIS_URL environment variable');
    console.log('3. Verify Redis is accessible at:', REDIS_URL);
    console.log('');
    console.log('To set REDIS_URL:');
    console.log('  $env:REDIS_URL="redis://localhost:6379"');
    
    process.exit(1);
  }
}

testRedis();

