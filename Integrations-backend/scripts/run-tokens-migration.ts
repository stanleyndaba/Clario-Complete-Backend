/**
 * Run the tokens table migration
 * This script connects to Supabase and runs the 020_create_tokens_table.sql migration
 */

import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://postgres.fmzfjhrwbkebqaxjlvzt:Lungilemzila_75@aws-1-eu-central-1.pooler.supabase.com:5432/postgres';

async function runMigration() {
  console.log('🚀 Running tokens table migration...\n');

  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const migrationPath = join(__dirname, '..', 'migrations', '020_create_tokens_table.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    console.log('📄 Executing migration: 020_create_tokens_table.sql\n');
    await client.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify table was created
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'tokens';
    `);

    if (result.rows.length > 0) {
      console.log('✅ Verified: tokens table exists\n');
    } else {
      console.log('⚠️  Warning: tokens table not found after migration\n');
    }

  } catch (error: any) {
    if (error.message.includes('already exists') || error.message.includes('duplicate')) {
      console.log('⚠️  Migration already applied (some objects already exist)');
      console.log('✅ This is okay - migration is idempotent\n');
    } else {
      console.error('❌ Migration failed:', error.message);
      console.error('\nFull error:', error);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

