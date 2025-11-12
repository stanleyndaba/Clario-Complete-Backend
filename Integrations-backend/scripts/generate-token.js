import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env file from the Integrations-backend directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  console.error('   Make sure Integrations-backend/.env has these variables set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  const email = process.argv[2] || 'sbiyarmvelorh@gmail.com';
  const userId = process.argv[3] || null;

  console.log('🔑 Generating Supabase Auth Token');
  console.log('==================================');
  console.log(`\n📧 Email: ${email}`);
  if (userId) {
    console.log(`👤 User ID: ${userId}`);
  }
  console.log(`\n🔗 Supabase URL: ${supabaseUrl}`);

  try {
    // Option 1: Generate link for signup/magic link
    if (!userId) {
      console.log('\n📝 Generating signup link...');
      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'signup',
        email: email
      });

      if (error) {
        console.error('❌ Error generating link:', error.message);
        process.exit(1);
      }

      console.log('\n✅ Generated Link:');
      console.log(data.properties.action_link);
      
      // Extract token from the link
      const url = new URL(data.properties.action_link);
      const token = url.searchParams.get('token');
      if (token) {
        console.log('\n🔑 Extracted Token:');
        console.log(token);
        console.log('\n💡 Use this token in your E2E test:');
        console.log(`   -AuthToken '${token}'`);
      }
    } else {
      // Option 2: Create a session for existing user
      console.log(`\n📝 Creating session for user: ${userId}...`);
      
      // First, get user by ID
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
      
      if (userError) {
        console.error('❌ Error getting user:', userError.message);
        console.log('\n💡 Trying to create session directly...');
        
        // Try to create a session token directly
        const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
          type: 'magiclink',
          email: email
        });
        
        if (sessionError) {
          console.error('❌ Error creating session:', sessionError.message);
          console.log('\n💡 Alternative: Use SUPABASE_SERVICE_ROLE_KEY directly as AuthToken');
          process.exit(1);
        }
        
        console.log('\n✅ Session created');
        const url = new URL(sessionData.properties.action_link);
        const token = url.searchParams.get('token');
        if (token) {
          console.log('\n🔑 Token:');
          console.log(token);
        }
      } else {
        console.log(`\n✅ User found: ${userData.user.email}`);
        console.log('\n💡 For E2E testing, you can use:');
        console.log(`   -AuthToken '${serviceRoleKey}'`);
        console.log('   (Service role key works for sandbox testing)');
      }
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    console.log('\n💡 Alternative: Use SUPABASE_SERVICE_ROLE_KEY directly');
    console.log(`   -AuthToken '${serviceRoleKey}'`);
    process.exit(1);
  }
}

main();

