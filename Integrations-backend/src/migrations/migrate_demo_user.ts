import 'dotenv/config';
import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';

async function migrate() {
  const nullUuid = '00000000-0000-0000-0000-000000000000';
  const hashedUuid = convertUserIdToUuid('demo-user');
  
  if (nullUuid === hashedUuid) {
    logger.info('Null UUID and Hashed UUID are identical. No migration needed.');
    return;
  }

  logger.info(`Starting migration: ${nullUuid} -> ${hashedUuid}`);

  try {
    // 1. Migrate Tokens
    const { count: tokenCount, error: tokenError } = await (supabaseAdmin || (await import('../database/supabaseClient')).supabaseAdmin)
      .from('tokens')
      .update({ user_id: hashedUuid })
      .eq('user_id', nullUuid);

    if (tokenError) {
      logger.error('Failed to migrate tokens:', tokenError);
    } else {
      logger.info(`Migrated ${tokenCount} tokens.`);
    }

    // 2. Migrate Evidence Sources
    const { count: evidenceCount, error: evidenceError } = await (supabaseAdmin || (await import('../database/supabaseClient')).supabaseAdmin)
      .from('evidence_sources')
      .update({ user_id: hashedUuid })
      .eq('user_id', nullUuid);

    if (evidenceError) {
      logger.error('Failed to migrate evidence sources:', evidenceError);
    } else {
      logger.info(`Migrated ${evidenceCount} evidence sources.`);
    }

    logger.info('Migration completed successfully.');
  } catch (err) {
    logger.error('Migration failed with exception:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  migrate().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export { migrate };
