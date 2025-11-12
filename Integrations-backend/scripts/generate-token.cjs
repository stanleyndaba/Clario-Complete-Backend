const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
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

  try {
    if (!userId) {
      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'signup',
        email: email
      });

      if (error) {
        console.error('❌ Error:', error.message);
        console.log('\n💡 Alternative: Use SUPABASE_SERVICE_ROLE_KEY directly');
        console.log(`   -AuthToken '${serviceRoleKey}'`);
        process.exit(1);
      }

      const url = new URL(data.properties.action_link);
      const token = url.searchParams.get('token');
      if (token) {
        console.log('\n✅ Token generated:');
        console.log(token);
      }
    } else {
      console.log('\n💡 For E2E testing with user ID, use service role key:');
      console.log(`   -AuthToken '${serviceRoleKey}'`);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n💡 Use SUPABASE_SERVICE_ROLE_KEY directly:');
    console.log(`   -AuthToken '${serviceRoleKey}'`);
  }
}

main();
