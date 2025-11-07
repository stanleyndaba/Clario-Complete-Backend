// Database Check Script for Phase 1 Status
// Run with: node check-database.js

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const userId = process.env.USER_ID || 'test-user-sandbox-001';
const syncId = process.env.SYNC_ID || 'sandbox-test-001';

if (!supabaseUrl || !supabaseAnonKey) {
  console.log('❌ Missing Supabase credentials');
  console.log('   Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables');
  console.log('');
  console.log('   Example:');
  console.log('   $env:SUPABASE_URL="https://your-project.supabase.co"');
  console.log('   $env:SUPABASE_ANON_KEY="your-anon-key"');
  console.log('   node check-database.js');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkDatabase() {
  console.log('🔍 Checking Database for Phase 1 Status');
  console.log('=====================================');
  console.log('');
  console.log('Parameters:');
  console.log('  User ID:', userId);
  console.log('  Sync ID:', syncId);
  console.log('');

  try {
    // Query sync_progress table
    const { data, error } = await supabase
      .from('sync_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('sync_id', syncId)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error) {
      console.log('❌ Database query error:', error.message);
      console.log('   Error code:', error.code);
      console.log('');
      return;
    }

    if (!data || data.length === 0) {
      console.log('⚠️  No entries found in sync_progress table');
      console.log('   This is expected if Phase 1 has not run yet');
      console.log('   Phase 1 will create an entry when it executes');
      console.log('');
      return;
    }

    console.log(`✅ Found ${data.length} entry/entries:`);
    console.log('');

    data.forEach((entry, index) => {
      console.log(`Entry ${index + 1}:`);
      console.log('  ID:', entry.id);
      console.log('  User ID:', entry.user_id);
      console.log('  Sync ID:', entry.sync_id);
      console.log('  Step:', entry.step);
      console.log('  Phase Number:', entry.phase_number || 'N/A');
      console.log('  Total Steps:', entry.total_steps);
      console.log('  Current Step:', entry.current_step);
      console.log('  Status:', entry.status);
      console.log('  Progress:', entry.progress + '%');
      console.log('  Duration (ms):', entry.duration_ms || 'N/A');
      console.log('  Previous Phase:', entry.previous_phase || 'N/A');
      console.log('  Error Message:', entry.error_message || 'None');
      console.log('  Rollback Triggered:', entry.rollback_triggered || false);
      console.log('  Created At:', entry.created_at);
      console.log('  Updated At:', entry.updated_at);
      
      if (entry.metadata) {
        console.log('  Metadata:', JSON.stringify(entry.metadata, null, 2));
      }
      
      console.log('');
    });

    // Check for Phase 1 specifically
    const phase1Entry = data.find(e => e.phase_number === 1 || e.step === 1);
    if (phase1Entry) {
      console.log('🎯 Phase 1 Entry Found:');
      console.log('  Status:', phase1Entry.status);
      console.log('  Completed:', phase1Entry.status === 'completed' ? '✅ Yes' : '❌ No');
      console.log('');
      
      if (phase1Entry.status === 'completed') {
        console.log('✅ Phase 1 has completed successfully');
        console.log('   Idempotency check should skip duplicate triggers');
      } else if (phase1Entry.status === 'running') {
        console.log('⏳ Phase 1 is currently running');
      } else if (phase1Entry.status === 'failed') {
        console.log('❌ Phase 1 failed');
        if (phase1Entry.error_message) {
          console.log('   Error:', phase1Entry.error_message);
        }
      }
    } else {
      console.log('⚠️  No Phase 1 entry found');
      console.log('   Phase 1 may not have executed yet');
    }

  } catch (error) {
    console.log('❌ Unexpected error:', error.message);
    console.log('   Stack:', error.stack);
  }
}

checkDatabase().then(() => {
  process.exit(0);
}).catch((error) => {
  console.log('❌ Fatal error:', error.message);
  process.exit(1);
});

