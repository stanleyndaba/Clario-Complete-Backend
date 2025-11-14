/**
 * Simple Supabase connection test
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Supabase connection...');
console.log('URL:', supabaseUrl ? 'Set' : 'Missing');
console.log('Anon Key:', supabaseAnonKey ? 'Set' : 'Missing');
console.log('Service Role Key:', supabaseServiceRoleKey ? 'Set' : 'Missing');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

async function testConnection() {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Test basic connection
    const { data, error } = await supabase
      .from('evidence_sources')
      .select('count')
      .limit(1);

    if (error) {
      console.error('❌ Connection failed:', error.message);
      process.exit(1);
    } else {
      console.log('✅ Connection successful!');
      
      // Test admin client if available
      if (supabaseServiceRoleKey) {
        const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false }
        });
        const { data: buckets, error: storageError } = await admin.storage.listBuckets();
        
        if (storageError) {
          console.warn('⚠️ Storage access failed:', storageError.message);
        } else {
          console.log('✅ Storage access successful!');
          console.log('Buckets:', buckets?.map(b => b.name).join(', ') || 'None');
        }
      }
      process.exit(0);
    }
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

testConnection();

