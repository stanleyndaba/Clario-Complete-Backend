/**
 * Simple test to verify Supabase connection
 */

import { supabaseAdmin, supabase } from '../src/database/supabaseClient';

async function testConnection() {
  console.log('🔍 Testing Supabase Connection...\n');

  try {
    // Test 1: Check if clients are initialized
    console.log('Test 1: Client Initialization');
    if (!supabase || typeof supabase.from !== 'function') {
      console.log('❌ Supabase client not initialized');
      return;
    }
    console.log('✅ Supabase client initialized');

    if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
      console.log('❌ Supabase admin client not initialized');
      return;
    }
    console.log('✅ Supabase admin client initialized\n');

    // Test 2: Try a simple query
    console.log('Test 2: Simple Query Test');
    try {
      const { data, error } = await supabaseAdmin
        .from('tokens')
        .select('id')
        .limit(1);

      if (error) {
        console.log('❌ Query error:', error.message);
        console.log('   Code:', error.code);
        console.log('   Details:', error.details);
        console.log('   Hint:', error.hint);
      } else {
        console.log('✅ Query successful!');
        console.log('   Data:', data);
      }
    } catch (err: any) {
      console.log('❌ Query exception:', err.message);
      console.log('   Type:', err.constructor.name);
      if (err.cause) {
        console.log('   Cause:', err.cause);
      }
    }

    // Test 3: Check if users table exists
    console.log('\nTest 3: Users Table Check');
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('id')
        .limit(1);

      if (error) {
        if (error.code === '42P01') {
          console.log('❌ Users table does not exist');
        } else {
          console.log('⚠️  Users table query error:', error.message);
        }
      } else {
        console.log('✅ Users table exists and is accessible');
      }
    } catch (err: any) {
      console.log('❌ Users table check failed:', err.message);
    }

  } catch (error: any) {
    console.error('❌ Connection test failed:', error.message);
    console.error('   Stack:', error.stack);
  }
}

testConnection();

