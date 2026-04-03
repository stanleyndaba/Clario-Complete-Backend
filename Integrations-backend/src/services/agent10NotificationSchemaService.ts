import { Client } from 'pg';
import path from 'path';
import fs from 'fs';
import config from '../config/env';
import logger from '../utils/logger';

type NotificationSchemaSnapshot = {
  columns: string[];
  statusConstraint: string | null;
  typeConstraint: string | null;
  dedupeIndexPresent: boolean;
};

const REQUIRED_COLUMNS = ['dedupe_key', 'delivery_state', 'last_delivery_error', 'created_at', 'updated_at'];
const REQUIRED_STATUS_VALUES = ['partial'];
const REQUIRED_TYPE_VALUES = ['needs_evidence', 'approved', 'rejected', 'paid', 'sync_started', 'sync_failed'];
const NOTIFICATIONS_SCHEMA_MIGRATION = '100_agent10_notifications_live_schema_unblock.sql';

function getNotificationsSchemaPatchSql(): string {
  const candidatePaths = [
    path.resolve(process.cwd(), 'migrations', NOTIFICATIONS_SCHEMA_MIGRATION),
    path.resolve(__dirname, '../../migrations', NOTIFICATIONS_SCHEMA_MIGRATION)
  ];

  const migrationPath = candidatePaths.find(candidate => fs.existsSync(candidate));
  if (!migrationPath) {
    throw new Error(`AGENT10_SCHEMA_SQL_NOT_FOUND:${candidatePaths.join('|')}`);
  }

  return fs.readFileSync(migrationPath, 'utf8');
}

function buildConnectionCandidates(): string[] {
  const candidates: string[] = [];

  if (config.DATABASE_URL) {
    candidates.push(config.DATABASE_URL);
  }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  if (supabaseUrl.startsWith('postgresql://') || supabaseUrl.startsWith('postgres://')) {
    candidates.push(supabaseUrl);
  } else if (supabaseUrl.startsWith('https://') && process.env.SUPABASE_DB_PASSWORD) {
    const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
    candidates.push(`postgresql://postgres.${projectRef}:${process.env.SUPABASE_DB_PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`);
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function connectClient(): Promise<Client> {
  const candidates = buildConnectionCandidates();
  const errors: string[] = [];

  for (const connectionString of candidates) {
    const attempted = [connectionString];
    if (connectionString.includes('pooler')) {
      attempted.push(connectionString.replace('pooler', 'direct').replace(':6543', ':5432'));
    }

    for (const candidate of attempted) {
      const client = new Client({ connectionString: candidate });
      try {
        await client.connect();
        return client;
      } catch (error: any) {
        errors.push(error?.message || String(error));
        try {
          await client.end();
        } catch {
          // no-op
        }
      }
    }
  }

  throw new Error(`AGENT10_SCHEMA_DB_CONNECT_FAILED:${errors.join(' | ') || 'no_connection_candidates'}`);
}

async function getSchemaSnapshot(client: Client): Promise<NotificationSchemaSnapshot> {
  const columnsResult = await client.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
    ORDER BY ordinal_position
  `);

  const constraintsResult = await client.query<{ conname: string; definition: string }>(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
  `);

  const indexesResult = await client.query<{ indexname: string }>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND indexname = 'uq_notifications_tenant_user_dedupe_truth'
  `);

  const statusConstraint = constraintsResult.rows.find(row => row.conname === 'notifications_status_check')?.definition || null;
  const typeConstraint = constraintsResult.rows.find(row => row.conname === 'notifications_type_check')?.definition || null;

  return {
    columns: columnsResult.rows.map(row => row.column_name),
    statusConstraint,
    typeConstraint,
    dedupeIndexPresent: indexesResult.rows.length > 0
  };
}

function getPatchReasons(snapshot: NotificationSchemaSnapshot): string[] {
  const reasons: string[] = [];

  for (const column of REQUIRED_COLUMNS) {
    if (!snapshot.columns.includes(column)) {
      reasons.push(`missing_column:${column}`);
    }
  }

  for (const value of REQUIRED_STATUS_VALUES) {
    if (!snapshot.statusConstraint?.includes(`'${value}'`)) {
      reasons.push(`status_constraint_missing:${value}`);
    }
  }

  for (const value of REQUIRED_TYPE_VALUES) {
    if (!snapshot.typeConstraint?.includes(`'${value}'`)) {
      reasons.push(`type_constraint_missing:${value}`);
    }
  }

  if (!snapshot.dedupeIndexPresent) {
    reasons.push('missing_index:uq_notifications_tenant_user_dedupe_truth');
  }

  return reasons;
}

export async function ensureAgent10NotificationSchema(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const connectionCandidates = buildConnectionCandidates();
  if (!connectionCandidates.length) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AGENT10_SCHEMA_DB_CONNECT_FAILED:no_database_connection_string');
    }

    logger.info('Skipping Agent 10 notification schema check - no direct database connection configured');
    return;
  }

  const client = await connectClient();

  try {
    await client.query(`SET lock_timeout = '5s'`);
    await client.query(`SET statement_timeout = '120s'`);

    const before = await getSchemaSnapshot(client);
    const reasons = getPatchReasons(before);

    logger.info('Agent 10 notification schema snapshot', {
      columns: before.columns,
      statusConstraint: before.statusConstraint,
      typeConstraint: before.typeConstraint,
      dedupeIndexPresent: before.dedupeIndexPresent,
      patchRequired: reasons.length > 0,
      reasons
    });

    if (!reasons.length) {
      return;
    }

    const sql = getNotificationsSchemaPatchSql();
    await client.query(sql);

    const after = await getSchemaSnapshot(client);
    const remainingReasons = getPatchReasons(after);

    logger.info('Agent 10 notification schema patched', {
      columns: after.columns,
      statusConstraint: after.statusConstraint,
      typeConstraint: after.typeConstraint,
      dedupeIndexPresent: after.dedupeIndexPresent,
      remainingReasons
    });

    if (remainingReasons.length > 0) {
      throw new Error(`AGENT10_SCHEMA_STILL_MISALIGNED:${remainingReasons.join(',')}`);
    }
  } finally {
    await client.end();
  }
}
