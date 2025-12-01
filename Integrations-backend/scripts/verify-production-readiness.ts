import 'dotenv/config';
import { Client } from 'pg';
import axios from 'axios';

interface VerificationResult {
  name: string;
  status: '✅' | '❌' | '⚠️';
  message: string;
}

const results: VerificationResult[] = [];

function logResult(name: string, status: '✅' | '❌' | '⚠️', message: string) {
  results.push({ name, status, message });
  console.log(`${status} ${name}: ${message}`);
}

async function verifyDatabase() {
  try {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    
    // Check key tables
    const keyTables = [
      'tokens', 'users', 'sync_progress', 'detection_queue', 'detection_results',
      'evidence_sources', 'evidence_documents', 'dispute_cases', 'recoveries',
      'billing_transactions', 'notifications', 'agent_events', 'learning_metrics'
    ];
    
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = ANY($1)
    `, [keyTables]);
    
    const foundTables = tableCheck.rows.map(r => r.table_name);
    const missingTables = keyTables.filter(t => !foundTables.includes(t));
    
    if (missingTables.length === 0) {
      logResult('Database Tables', '✅', `All ${keyTables.length} key tables exist`);
    } else {
      logResult('Database Tables', '⚠️', `Missing: ${missingTables.join(', ')}`);
    }
    
    await client.end();
    logResult('Database Connection', '✅', 'Connected successfully');
  } catch (error: any) {
    logResult('Database Connection', '❌', error.message);
  }
}

async function verifyEnvironmentVariables() {
  const requiredVars = {
    'DATABASE_URL': process.env.DATABASE_URL,
    'SUPABASE_URL': process.env.SUPABASE_URL,
    'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'ENCRYPTION_KEY': process.env.ENCRYPTION_KEY,
    'JWT_SECRET': process.env.JWT_SECRET,
    'AMAZON_CLIENT_ID': process.env.AMAZON_CLIENT_ID,
    'AMAZON_CLIENT_SECRET': process.env.AMAZON_CLIENT_SECRET,
    'GMAIL_CLIENT_ID': process.env.GMAIL_CLIENT_ID,
    'GMAIL_CLIENT_SECRET': process.env.GMAIL_CLIENT_SECRET,
    'PYTHON_API_URL': process.env.PYTHON_API_URL,
    'INTEGRATIONS_URL': process.env.INTEGRATIONS_URL,
  };
  
  const optionalVars = {
    'STRIPE_SECRET_KEY': process.env.STRIPE_SECRET_KEY,
    'REDIS_URL': process.env.REDIS_URL,
  };
  
  let allRequired = true;
  for (const [key, value] of Object.entries(requiredVars)) {
    if (!value || value.includes('<your-') || value.includes('your-')) {
      logResult(`Env: ${key}`, '❌', 'Missing or placeholder');
      allRequired = false;
    } else {
      logResult(`Env: ${key}`, '✅', 'Set');
    }
  }
  
  for (const [key, value] of Object.entries(optionalVars)) {
    if (!value || value.includes('<your-') || value.includes('your-')) {
      logResult(`Env: ${key}`, '⚠️', 'Not set (optional)');
    } else {
      logResult(`Env: ${key}`, '✅', 'Set');
    }
  }
  
  if (allRequired) {
    logResult('Environment Variables', '✅', 'All required vars configured');
  }
}

async function verifyAPIs() {
  const nodeAPI = process.env.INTEGRATIONS_URL || 'https://opside-node-api-woco.onrender.com';
  const pythonAPI = process.env.PYTHON_API_URL || 'https://python-api-9.onrender.com';
  
  try {
    const nodeResponse = await axios.get(`${nodeAPI}/`, { timeout: 5000 });
    if (nodeResponse.status === 200) {
      logResult('Node API', '✅', `${nodeAPI} is responding`);
    } else {
      logResult('Node API', '⚠️', `Status: ${nodeResponse.status}`);
    }
  } catch (error: any) {
    logResult('Node API', '❌', error.message);
  }
  
  try {
    const pythonResponse = await axios.get(`${pythonAPI}/`, { timeout: 5000 });
    if (pythonResponse.status === 200) {
      logResult('Python API', '✅', `${pythonAPI} is responding`);
    } else {
      logResult('Python API', '⚠️', `Status: ${pythonResponse.status}`);
    }
  } catch (error: any) {
    logResult('Python API', '❌', error.message);
  }
}

async function verifyDatabaseConnectionString() {
  const dbUrl = process.env.DATABASE_URL || '';
  
  // Check if it's using pooler format
  if (dbUrl.includes('pooler.supabase.com')) {
    logResult('DB Connection Format', '✅', 'Using pooler connection');
  } else if (dbUrl.includes('db.') && dbUrl.includes('.supabase.co')) {
    logResult('DB Connection Format', '✅', 'Using direct connection');
  } else {
    logResult('DB Connection Format', '⚠️', 'Unknown format');
  }
  
  // Check if password is URL-encoded
  if (dbUrl.includes('%40')) {
    logResult('DB Password Encoding', '✅', 'Password is URL-encoded');
  } else if (dbUrl.includes('@') && dbUrl.split('@').length > 2) {
    logResult('DB Password Encoding', '❌', 'Password may need URL encoding');
  } else {
    logResult('DB Password Encoding', '✅', 'Password format OK');
  }
}

async function verifySupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  
  if (supabaseUrl && supabaseUrl.startsWith('https://') && supabaseUrl.includes('.supabase.co')) {
    logResult('Supabase URL', '✅', 'Format correct');
  } else {
    logResult('Supabase URL', '❌', 'Invalid format');
  }
  
  if (serviceKey && serviceKey.startsWith('eyJ')) {
    logResult('Supabase Service Key', '✅', 'JWT format detected');
  } else {
    logResult('Supabase Service Key', '❌', 'Invalid format');
  }
  
  if (anonKey && anonKey.startsWith('eyJ')) {
    logResult('Supabase Anon Key', '✅', 'JWT format detected');
  } else {
    logResult('Supabase Anon Key', '❌', 'Invalid format');
  }
}

async function verifyAmazonConfig() {
  const clientId = process.env.AMAZON_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET;
  const spapiUrl = process.env.AMAZON_SPAPI_BASE_URL;
  
  if (clientId && clientId.startsWith('amzn1.application-oa2-client.')) {
    logResult('Amazon Client ID', '✅', 'Format correct');
  } else {
    logResult('Amazon Client ID', '❌', 'Invalid format');
  }
  
  if (clientSecret && clientSecret.startsWith('amzn1.oa2-cs.')) {
    logResult('Amazon Client Secret', '✅', 'Format correct');
  } else {
    logResult('Amazon Client Secret', '❌', 'Invalid format');
  }
  
  if (spapiUrl) {
    if (spapiUrl.includes('sandbox')) {
      logResult('Amazon SP-API URL', '⚠️', 'Using sandbox (expected)');
    } else {
      logResult('Amazon SP-API URL', '✅', 'Using production');
    }
  } else {
    logResult('Amazon SP-API URL', '❌', 'Not set');
  }
}

async function verifyGmailConfig() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  
  if (clientId && clientId.includes('.apps.googleusercontent.com')) {
    logResult('Gmail Client ID', '✅', 'Format correct');
  } else {
    logResult('Gmail Client ID', '❌', 'Missing or invalid');
  }
  
  if (clientSecret && clientSecret.length > 20) {
    logResult('Gmail Client Secret', '✅', 'Set');
  } else {
    logResult('Gmail Client Secret', '❌', 'Missing or invalid');
  }
  
  if (redirectUri && redirectUri.includes('/callback')) {
    logResult('Gmail Redirect URI', '✅', 'Format correct');
  } else {
    logResult('Gmail Redirect URI', '⚠️', 'Not set or invalid');
  }
}

async function verifyRedisConfig() {
  const redisEnabled = process.env.REDIS_ENABLED;
  const redisUrl = process.env.REDIS_URL;
  
  if (redisEnabled === 'false' || !redisEnabled) {
    logResult('Redis', '✅', 'Disabled (OK for MVP)');
  } else if (redisUrl && !redisUrl.includes('127.0.0.1') && !redisUrl.includes('localhost')) {
    logResult('Redis', '✅', 'Configured with remote URL');
  } else {
    logResult('Redis', '⚠️', 'Enabled but using localhost (will fail on Render)');
  }
}

async function runAllVerifications() {
  console.log('🚀 Starting Production Readiness Verification...\n');
  
  await verifyDatabaseConnectionString();
  await verifyDatabase();
  await verifyEnvironmentVariables();
  await verifySupabaseConfig();
  await verifyAmazonConfig();
  await verifyGmailConfig();
  await verifyRedisConfig();
  await verifyAPIs();
  
  console.log('\n📊 Summary:');
  const success = results.filter(r => r.status === '✅').length;
  const warnings = results.filter(r => r.status === '⚠️').length;
  const errors = results.filter(r => r.status === '❌').length;
  
  console.log(`   ✅ Passed: ${success}`);
  console.log(`   ⚠️  Warnings: ${warnings}`);
  console.log(`   ❌ Failed: ${errors}`);
  
  if (errors === 0 && warnings <= 3) {
    console.log('\n🎉 System is ready for production!');
  } else if (errors === 0) {
    console.log('\n⚠️  System is mostly ready, but review warnings above.');
  } else {
    console.log('\n❌ System needs fixes before production.');
  }
}

runAllVerifications().catch(console.error);

