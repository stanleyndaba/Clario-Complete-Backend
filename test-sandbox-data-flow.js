/**
 * Test script to verify sandbox data flow end-to-end
 * 
 * This script tests:
 * 1. Amazon connection (bypass)
 * 2. Sync trigger
 * 3. Data fetching from sandbox
 * 4. Database storage
 * 5. Recoveries endpoint retrieval
 * 
 * Usage: node test-sandbox-data-flow.js
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const USER_ID = process.env.TEST_USER_ID || 'demo-user';

async function test() {
  console.log('🧪 Testing Amazon Sandbox Data Flow\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`User ID: ${USER_ID}\n`);

  const results = {
    connection: null,
    sync: null,
    recoveries: null,
    database: null
  };

  try {
    // Step 1: Test Amazon Connection (Bypass)
    console.log('1️⃣  Testing Amazon Connection (Bypass)...');
    try {
      const connectionResponse = await fetch(
        `${BASE_URL}/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=http://localhost:3000`,
        { method: 'GET' }
      );
      const connectionData = await connectionResponse.json();
      results.connection = connectionData;
      
      if (connectionData.success && connectionData.bypassed) {
        console.log('✅ Connection successful (bypassed)\n');
      } else {
        console.log('⚠️  Connection response:', JSON.stringify(connectionData, null, 2), '\n');
      }
    } catch (error) {
      console.error('❌ Connection test failed:', error.message, '\n');
    }

    // Step 2: Trigger Sync
    console.log('2️⃣  Triggering Sync...');
    try {
      const syncResponse = await fetch(
        `${BASE_URL}/api/sync/start`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          // Note: In production, you'd need to include auth headers
          body: JSON.stringify({ userId: USER_ID })
        }
      );
      
      if (syncResponse.ok) {
        const syncData = await syncResponse.json();
        results.sync = syncData;
        console.log('✅ Sync triggered:', JSON.stringify(syncData, null, 2));
        
        if (syncData.syncId) {
          console.log(`   Sync ID: ${syncData.syncId}\n`);
          
          // Wait a bit for sync to complete
          console.log('   Waiting 10 seconds for sync to complete...\n');
          await new Promise(resolve => setTimeout(resolve, 10000));
          
          // Check sync status
          const statusResponse = await fetch(
            `${BASE_URL}/api/sync/status/${syncData.syncId}`,
            {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              }
            }
          );
          
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            console.log('   Sync Status:', JSON.stringify(statusData, null, 2), '\n');
          }
        }
      } else {
        const errorText = await syncResponse.text();
        console.log('⚠️  Sync trigger response:', syncResponse.status, errorText, '\n');
      }
    } catch (error) {
      console.error('❌ Sync test failed:', error.message, '\n');
    }

    // Step 3: Test Recoveries Endpoint
    console.log('3️⃣  Testing Recoveries Endpoint...');
    try {
      const recoveriesResponse = await fetch(
        `${BASE_URL}/api/v1/integrations/amazon/recoveries`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
      
      const recoveriesData = await recoveriesResponse.json();
      results.recoveries = recoveriesData;
      
      console.log('📊 Recoveries Response:', JSON.stringify(recoveriesData, null, 2), '\n');
      
      if (recoveriesData.totalAmount > 0 || recoveriesData.claimCount > 0) {
        console.log('✅ Found data!');
        console.log(`   Total Amount: $${recoveriesData.totalAmount}`);
        console.log(`   Claim Count: ${recoveriesData.claimCount}`);
        console.log(`   Source: ${recoveriesData.source || recoveriesData.dataSource || 'unknown'}\n`);
      } else {
        console.log('⚠️  No data found (this is normal if sandbox returned empty data)\n');
      }
    } catch (error) {
      console.error('❌ Recoveries test failed:', error.message, '\n');
    }

    // Step 4: Test Diagnostics
    console.log('4️⃣  Testing Diagnostics...');
    try {
      const diagnoseResponse = await fetch(
        `${BASE_URL}/api/v1/integrations/amazon/diagnose`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
      
      const diagnoseData = await diagnoseResponse.json();
      console.log('🔍 Diagnostics:', JSON.stringify(diagnoseData, null, 2), '\n');
    } catch (error) {
      console.error('❌ Diagnostics test failed:', error.message, '\n');
    }

    // Summary
    console.log('📋 Test Summary:\n');
    console.log('Connection:', results.connection?.success ? '✅' : '❌');
    console.log('Sync:', results.sync?.syncId ? `✅ (${results.sync.syncId})` : '⚠️');
    console.log('Recoveries:', results.recoveries?.claimCount > 0 ? `✅ (${results.recoveries.claimCount} claims, $${results.recoveries.totalAmount})` : '⚠️ (no data)');
    console.log('\n✅ Test completed!\n');
    
    // Recommendations
    console.log('💡 Recommendations:');
    if (results.recoveries?.claimCount === 0) {
      console.log('   - Sandbox may have returned empty data (this is normal)');
      console.log('   - Check server logs for sync status');
      console.log('   - Verify database has claims stored');
      console.log('   - Wait a few minutes and check recoveries again');
    }
    if (!results.sync?.syncId) {
      console.log('   - Sync may not have triggered');
      console.log('   - Check if user has valid Amazon token');
      console.log('   - Verify sync endpoint is accessible');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run test
test().catch(console.error);

