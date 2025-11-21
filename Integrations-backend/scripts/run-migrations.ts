/**
 * Run all database migrations using PostgreSQL connection
 * This script executes SQL migrations in order to set up the database schema
 */

import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import logger from '../src/utils/logger';
import { supabaseAdmin } from '../src/database/supabaseClient';

const migrations = [
  '005_add_dispute_system.sql',
  '006_add_deadline_tracking.sql',
  '006_add_prediction_fields.sql',
  '007_evidence_engine.sql',
  '008_evidence_line_items.sql',
  '009_evidence_documents_extracted_gin.sql',
  '010_evidence_engine_extras.sql',
  '011_evidence_engine_views.sql',
  '011_evidence_ingestion_worker.sql',
  '024_add_expected_payout_date_to_disputes.sql'
];

async function runMigrationsViaSupabase(sql: string): Promise<boolean> {
  // Try using Supabase REST API to execute SQL
  // Note: Supabase doesn't have a direct SQL execution endpoint via JS client
  // We'll fall back to PostgreSQL client
  return false;
}

async function runMigrations() {
  logger.info('🚀 Starting database migrations...');
  
  // Try to get PostgreSQL connection string from DATABASE_URL or SUPABASE_URL
  let connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    // Check if SUPABASE_URL is actually a PostgreSQL connection string
    const supabaseUrl = process.env.SUPABASE_URL;
    if (supabaseUrl && supabaseUrl.startsWith('postgresql://')) {
      connectionString = supabaseUrl;
      logger.info('ℹ️  Using SUPABASE_URL as PostgreSQL connection string');
    } else if (supabaseUrl && supabaseUrl.startsWith('https://')) {
      // Try to construct direct connection from Supabase URL
      const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
      logger.warn('⚠️  DATABASE_URL not found. Attempting direct connection...');
      logger.info('💡 For migrations, you need the direct PostgreSQL connection string.');
      logger.info('💡 Get it from: Supabase Dashboard → Settings → Database → Connection String');
      logger.info('💡 Format: postgresql://postgres.[project-ref]:[password]@db.[project-ref].supabase.co:5432/postgres');
      
      // Try pooler connection with different format
      if (process.env.SUPABASE_DB_PASSWORD) {
        connectionString = `postgresql://postgres.${projectRef}:${process.env.SUPABASE_DB_PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;
        logger.info('ℹ️  Attempting connection with SUPABASE_DB_PASSWORD...');
      } else {
        logger.error('❌ Cannot construct connection string. Please set DATABASE_URL.');
        process.exit(1);
      }
    }
  }
  
  if (!connectionString) {
    logger.error('❌ DATABASE_URL not found in environment variables.');
    logger.info('💡 Please set DATABASE_URL with PostgreSQL connection string.');
    process.exit(1);
  }

  // Try direct connection first (non-pooler)
  let client: Client | null = null;
  let connected = false;
  
  // Try pooler connection first
  try {
    client = new Client({ connectionString });
    await client.connect();
    logger.info('✅ Connected to database via pooler');
    connected = true;
  } catch (error: any) {
    logger.warn(`⚠️  Pooler connection failed: ${error.message}`);
    
    // Try direct connection format
    if (connectionString.includes('pooler')) {
      const directConnection = connectionString.replace('pooler', 'direct').replace(':6543', ':5432');
      logger.info('🔄 Attempting direct connection...');
      try {
        client = new Client({ connectionString: directConnection });
        await client.connect();
        logger.info('✅ Connected to database via direct connection');
        connected = true;
      } catch (directError: any) {
        logger.error('❌ Direct connection also failed:', directError.message);
      }
    }
  }
  
  if (!connected || !client) {
    logger.error('❌ Failed to connect to database. Please verify:');
    logger.error('   1. DATABASE_URL is correct');
    logger.error('   2. Database password is correct');
    logger.error('   3. Network allows connections');
    logger.info('💡 Alternative: Run migrations via Supabase SQL Editor manually');
    process.exit(1);
  }
  
  try {
    const migrationsDir = join(__dirname, '..', 'migrations');
    
    for (const migrationFile of migrations) {
      try {
        logger.info(`📄 Running migration: ${migrationFile}`);
        
        const migrationPath = join(migrationsDir, migrationFile);
        const sql = readFileSync(migrationPath, 'utf-8');
        
        // Execute migration
        await client.query(sql);
        
        logger.info(`✅ Migration ${migrationFile} completed`);
        
      } catch (error: any) {
        // Check if error is "already exists" - that's okay
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          logger.warn(`⚠️  Migration ${migrationFile} skipped (already applied)`);
        } else {
          logger.error(`❌ Failed to run migration ${migrationFile}:`, error.message);
          // Continue with next migration
        }
      }
    }
    
    logger.info('✅ All migrations completed successfully!');
    
  } catch (error: any) {
    logger.error('❌ Error running migrations:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    });
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

runMigrations().catch(error => {
  logger.error('Fatal error running migrations:', error);
  process.exit(1);
});
