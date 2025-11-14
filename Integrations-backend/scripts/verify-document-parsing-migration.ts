/**
 * Verify Document Parsing Migration
 * Checks that all tables and columns were created successfully
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import logger from '../src/utils/logger';

async function verifyMigration() {
  logger.info('🔍 Verifying document parsing migration...');

  try {
    const client = supabaseAdmin || require('../src/database/supabaseClient').supabase;

    // Check if parsed_metadata column exists
    logger.info('Checking parsed_metadata column...');
    const { data: metadataTest, error: metadataError } = await client
      .from('evidence_documents')
      .select('id, parsed_metadata')
      .limit(1);

    if (metadataError && metadataError.message?.includes('column') && metadataError.message?.includes('parsed_metadata')) {
      logger.error('❌ parsed_metadata column does not exist');
      return false;
    }
    logger.info('✅ parsed_metadata column exists');

    // Check if parser_status column exists
    logger.info('Checking parser_status column...');
    const { data: statusTest, error: statusError } = await client
      .from('evidence_documents')
      .select('id, parser_status')
      .limit(1);

    if (statusError && statusError.message?.includes('column') && statusError.message?.includes('parser_status')) {
      logger.error('❌ parser_status column does not exist');
      return false;
    }
    logger.info('✅ parser_status column exists');

    // Check if document_parsing_errors table exists
    logger.info('Checking document_parsing_errors table...');
    const { data: errorsTest, error: errorsError } = await client
      .from('document_parsing_errors')
      .select('id')
      .limit(1);

    if (errorsError && errorsError.message?.includes('relation') && errorsError.message?.includes('document_parsing_errors')) {
      logger.error('❌ document_parsing_errors table does not exist');
      return false;
    }
    logger.info('✅ document_parsing_errors table exists');

    // Check other columns
    const columnsToCheck = [
      'parser_confidence',
      'parser_error',
      'parser_started_at',
      'parser_completed_at'
    ];

    for (const column of columnsToCheck) {
      logger.info(`Checking ${column} column...`);
      const { error } = await client
        .from('evidence_documents')
        .select(`id, ${column}`)
        .limit(1);

      if (error && error.message?.includes('column') && error.message?.includes(column)) {
        logger.error(`❌ ${column} column does not exist`);
        return false;
      }
      logger.info(`✅ ${column} column exists`);
    }

    logger.info('\n✅ All migration checks passed!');
    logger.info('\n📋 Next steps:');
    logger.info('   1. Start the server: npm run dev');
    logger.info('   2. Check logs for: "Document parsing worker initialized"');
    logger.info('   3. Ingest a document via Agent 4');
    logger.info('   4. Wait 2 minutes for Agent 5 to parse it');
    logger.info('   5. Check evidence_documents.parsed_metadata for results');

    return true;
  } catch (error: any) {
    logger.error('❌ Migration verification failed', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

verifyMigration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });

