import 'dotenv/config';
import { Client } from 'pg';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function checkDataSource() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Check environment variables
    console.log('🔍 Environment Configuration:');
    console.log(`   USE_MOCK_SPAPI: ${process.env.USE_MOCK_SPAPI || 'not set'}`);
    console.log(`   USE_MOCK_DATA_GENERATOR: ${process.env.USE_MOCK_DATA_GENERATOR || 'not set'}`);
    console.log(`   AMAZON_SPAPI_BASE_URL: ${process.env.AMAZON_SPAPI_BASE_URL || 'not set'}`);
    console.log(`   ENABLE_MOCK_SP_API: ${process.env.ENABLE_MOCK_SP_API || 'not set'}`);
    
    // Check if sandbox URL
    const spapiUrl = process.env.AMAZON_SPAPI_BASE_URL || '';
    if (spapiUrl.includes('sandbox')) {
      console.log(`   ⚠️  Using SANDBOX API (${spapiUrl})`);
    } else if (spapiUrl) {
      console.log(`   ✅ Using PRODUCTION API (${spapiUrl})`);
    }
    
    // Check tokens table for Amazon connections
    const tokens = await client.query(`
      SELECT 
        COUNT(*) as total_tokens,
        COUNT(*) FILTER (WHERE provider = 'amazon' AND is_active = true) as active_amazon_tokens,
        COUNT(*) FILTER (WHERE provider = 'amazon') as total_amazon_tokens
      FROM tokens
    `);
    
    console.log('\n🔐 Token Status:');
    console.log(`   Total Tokens: ${tokens.rows[0].total_tokens}`);
    console.log(`   Active Amazon Tokens: ${tokens.rows[0].active_amazon_tokens}`);
    console.log(`   Total Amazon Tokens: ${tokens.rows[0].total_amazon_tokens}`);
    
    if (tokens.rows[0].active_amazon_tokens > 0) {
      console.log('   ✅ Real Amazon OAuth tokens found - System can use real SP-API');
    } else {
      console.log('   ⚠️  No active Amazon tokens - System will use mock data');
    }
    
    // Check detection_queue for sandbox flag
    const detectionQueue = await client.query(`
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(*) FILTER (WHERE is_sandbox = true) as sandbox_jobs,
        COUNT(*) FILTER (WHERE is_sandbox = false OR is_sandbox IS NULL) as production_jobs
      FROM detection_queue
    `);
    
    console.log('\n📊 Detection Queue:');
    console.log(`   Total Jobs: ${detectionQueue.rows[0].total_jobs}`);
    console.log(`   Sandbox Jobs: ${detectionQueue.rows[0].sandbox_jobs}`);
    console.log(`   Production Jobs: ${detectionQueue.rows[0].production_jobs}`);
    
    // Check detection_results source
    const detections = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE metadata->>'is_mock' = 'true') as mock_detections,
        COUNT(*) FILTER (WHERE metadata->>'is_mock' = 'false' OR metadata->>'is_mock' IS NULL) as real_detections
      FROM detection_results
    `);
    
    console.log('\n🔍 Detection Results Source:');
    console.log(`   Total Detections: ${detections.rows[0].total}`);
    console.log(`   Mock Detections: ${detections.rows[0].mock_detections}`);
    console.log(`   Real Detections: ${detections.rows[0].real_detections}`);
    
    // Check sync_progress for mock flag
    const syncs = await client.query(`
      SELECT 
        COUNT(*) as total_syncs,
        COUNT(*) FILTER (WHERE metadata->>'isMock' = 'true' OR metadata->>'is_mock' = 'true') as mock_syncs,
        COUNT(*) FILTER (WHERE metadata->>'isMock' = 'false' OR metadata->>'is_mock' = 'false' OR (metadata->>'isMock' IS NULL AND metadata->>'is_mock' IS NULL)) as real_syncs
      FROM sync_progress
    `);
    
    console.log('\n🔄 Sync Progress:');
    console.log(`   Total Syncs: ${syncs.rows[0].total_syncs}`);
    console.log(`   Mock Syncs: ${syncs.rows[0].mock_syncs}`);
    console.log(`   Real Syncs: ${syncs.rows[0].real_syncs}`);
    
    // Determine actual mode
    console.log('\n📋 Current Mode:');
    const hasActiveTokens = tokens.rows[0].active_amazon_tokens > 0;
    const usingSandboxUrl = spapiUrl.includes('sandbox');
    const useMockEnv = process.env.USE_MOCK_SPAPI === 'true' || process.env.USE_MOCK_DATA_GENERATOR === 'true';
    
    if (hasActiveTokens && !useMockEnv && !usingSandboxUrl) {
      console.log('   ✅ PRODUCTION MODE - Using real Amazon SP-API');
    } else if (hasActiveTokens && usingSandboxUrl && !useMockEnv) {
      console.log('   ⚠️  SANDBOX MODE - Using Amazon SP-API Sandbox');
    } else if (useMockEnv || !hasActiveTokens) {
      console.log('   🧪 MOCK MODE - Using mock data generator');
      console.log('   💡 To use real API: Set USE_MOCK_SPAPI=false, add real OAuth tokens');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkDataSource();

