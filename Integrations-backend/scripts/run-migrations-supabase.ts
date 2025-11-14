/**
 * Run migrations via Supabase SQL Editor (manual approach)
 * Since direct PostgreSQL connection is having issues, this script
 * provides the SQL to run in Supabase SQL Editor
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import logger from '../src/utils/logger';

const migrations = [
  '004_add_financial_events_and_detection.sql', // Must come first - creates detection_results
  '005_add_dispute_system.sql',
  '006_add_deadline_tracking.sql',
  '006_add_prediction_fields.sql',
  '007_evidence_engine.sql',
  '008_evidence_line_items.sql',
  '009_evidence_documents_extracted_gin.sql',
  '010_evidence_engine_extras.sql',
  '011_evidence_engine_views.sql',
  '011_evidence_ingestion_worker.sql',
  '012_document_parsing_worker.sql'
];

async function generateMigrationSQL() {
  logger.info('📝 Generating combined migration SQL...');
  
  const migrationsDir = join(__dirname, '..', 'migrations');
  let combinedSQL = '-- Combined Migration Script\n';
  combinedSQL += '-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/uuuqpujtnubusmigbkvw/sql/new\n\n';
  
  for (const migrationFile of migrations) {
    try {
      const migrationPath = join(migrationsDir, migrationFile);
      let sql = readFileSync(migrationPath, 'utf-8');
      
      // Fix nested $$ delimiter conflicts in function definitions
      // Replace function body $$ with $function$ when inside DO $$ blocks
      sql = sql.replace(
        /CREATE OR REPLACE FUNCTION[^$]*RETURNS TRIGGER AS \$\$/g,
        'CREATE OR REPLACE FUNCTION public.update_updated_at_column()\n    RETURNS TRIGGER AS $function$'
      );
      sql = sql.replace(/\$\$ LANGUAGE plpgsql;/g, '$function$ LANGUAGE plpgsql;');
      
      combinedSQL += `\n-- ========================================\n`;
      combinedSQL += `-- Migration: ${migrationFile}\n`;
      combinedSQL += `-- ========================================\n\n`;
      combinedSQL += sql;
      combinedSQL += `\n\n`;
      
      logger.info(`✅ Added ${migrationFile}`);
    } catch (error: any) {
      logger.error(`❌ Failed to read ${migrationFile}:`, error.message);
    }
  }
  
  // Write to file
  const outputPath = join(__dirname, '..', 'migrations', 'combined_migration.sql');
  require('fs').writeFileSync(outputPath, combinedSQL, 'utf-8');
  
  logger.info(`\n✅ Combined migration SQL written to: ${outputPath}`);
  logger.info('\n📋 Next steps:');
  logger.info('   1. Go to: https://supabase.com/dashboard/project/uuuqpujtnubusmigbkvw/sql/new');
  logger.info('   2. Copy the contents of: migrations/combined_migration.sql');
  logger.info('   3. Paste into SQL Editor and click "Run"');
  logger.info('   4. Verify tables are created in Table Editor');
}

generateMigrationSQL().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});

