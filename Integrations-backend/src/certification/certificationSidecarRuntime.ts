import axios, { AxiosError } from 'axios';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { Pool } from 'pg';
import crypto from 'crypto';
import logger from '../utils/logger';
import {
  CertificationSidecarConfig,
  redisOptionsFromUrl,
  requireQuickBooksCertificationConfig,
} from './certificationSidecarConfig';

const FIXTURE_TENANT_ID = 'a7ee0000-0000-4000-8000-000000000001';
const FIXTURE_USER_ID = 'a7ee0000-0000-4000-8000-000000000002';
const FIXTURE_SLUG = 'quickbooks-sandbox-certification';
const FIXTURE_SELLER_ID = 'margin-quickbooks-sandbox-certification';
const OAUTH_STATE_TTL_SECONDS = 600;
const QUICKBOOKS_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QUICKBOOKS_SANDBOX_URL = 'https://sandbox-quickbooks.api.intuit.com';
const PAGE_SIZE = 1000;
const MAX_PAGES_PER_ENTITY = 100;

export const certificationFixture = Object.freeze({
  tenantId: FIXTURE_TENANT_ID,
  userId: FIXTURE_USER_ID,
  tenantSlug: FIXTURE_SLUG,
});

export interface CertificationRecord {
  providerRecordId: string;
  recordType: 'bill' | 'purchase';
  supplierName: string | null;
  transactionDate: string | null;
  dueDate: string | null;
  currency: string | null;
  totalAmount: number | null;
  lineItems: Array<Record<string, unknown>>;
  referenceNumber: string | null;
  memo: string | null;
  status: string | null;
  rawData: Record<string, unknown>;
  providerUpdatedAt: string | null;
}

interface CertificationSource {
  id: string;
  realmId: string;
}

interface CertificationToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface CertificationJobData {
  kind: 'probe' | 'quickbooks-sync';
  tenantId: string;
  userId: string;
  trigger: 'fixture_probe' | 'oauth_initial' | 'manual';
}

interface EncryptedCredential {
  iv: string;
  data: string;
}

/**
 * This intentionally does not import the process-global token crypto module.
 * The sidecar receives its own explicit 32-byte key and stores only v2 AES-GCM
 * envelopes in the isolated test database.
 */
class CertificationCredentialCrypto {
  constructor(private readonly key: Buffer) {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new Error('Invalid certification credential encryption key length');
    }
  }

  encrypt(plaintext: string): EncryptedCredential {
    if (!plaintext) throw new Error('Certification credential value is missing');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: 'v2',
      data: JSON.stringify({ version: 2, algorithm: 'aes-256-gcm', encoding: 'base64', iv: iv.toString('base64'), authTag: authTag.toString('base64'), ciphertext: ciphertext.toString('base64') }),
    };
  }

  decrypt(credential: EncryptedCredential): string {
    if (credential.iv !== 'v2' || !credential.data) throw new Error('Unsupported certification credential envelope');
    let envelope: any;
    try {
      envelope = JSON.parse(credential.data);
    } catch {
      throw new Error('Malformed certification credential envelope');
    }
    if (envelope?.version !== 2 || envelope?.algorithm !== 'aes-256-gcm' || envelope?.encoding !== 'base64') {
      throw new Error('Unsupported certification credential envelope');
    }
    const iv = Buffer.from(String(envelope.iv || ''), 'base64');
    const authTag = Buffer.from(String(envelope.authTag || ''), 'base64');
    const ciphertext = Buffer.from(String(envelope.ciphertext || ''), 'base64');
    if (iv.length !== 12 || authTag.length !== 16 || !ciphertext.length) throw new Error('Malformed certification credential envelope');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

class CertificationFailure extends Error {
  constructor(
    message: string,
    public readonly kind: 'not_connected' | 'auth' | 'provider' | 'configuration' | 'probe'
  ) {
    super(message);
    this.name = 'CertificationFailure';
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Unknown certification failure');
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/refresh_token=[^&\s]+/gi, 'refresh_token=[redacted]')
    .slice(0, 500);
}

function secureEqual(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hasCertificationInternalKey(config: CertificationSidecarConfig, provided: unknown): boolean {
  return typeof provided === 'string' && Boolean(config.internalApiKey) && secureEqual(config.internalApiKey, provided);
}

function normalizeAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeLineItems(lines: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(lines)) return [];
  return lines.map((line: any) => ({
    id: line?.Id === undefined || line?.Id === null ? null : String(line.Id),
    description: typeof line?.Description === 'string' ? line.Description : null,
    amount: normalizeAmount(line?.Amount),
    detail_type: typeof line?.DetailType === 'string' ? line.DetailType : null,
    item_ref: typeof line?.ItemBasedExpenseLineDetail?.ItemRef?.value === 'string'
      ? line.ItemBasedExpenseLineDetail.ItemRef.value
      : null,
    quantity: normalizeAmount(line?.ItemBasedExpenseLineDetail?.Qty),
    unit_price: normalizeAmount(line?.ItemBasedExpenseLineDetail?.UnitPrice),
    account_ref: typeof line?.AccountBasedExpenseLineDetail?.AccountRef?.value === 'string'
      ? line.AccountBasedExpenseLineDetail.AccountRef.value
      : null,
  }));
}

function normalizeQuickBooksRecord(entity: any, recordType: 'bill' | 'purchase'): CertificationRecord {
  if (entity?.Id === undefined || entity?.Id === null) {
    throw new CertificationFailure('QuickBooks returned an accounting object without an identifier.', 'provider');
  }
  const balance = normalizeAmount(entity?.Balance);
  return {
    providerRecordId: String(entity.Id),
    recordType,
    supplierName: entity?.VendorRef?.name || entity?.VendorRef?.value || null,
    transactionDate: typeof entity?.TxnDate === 'string' ? entity.TxnDate : null,
    dueDate: typeof entity?.DueDate === 'string' ? entity.DueDate : null,
    currency: typeof entity?.CurrencyRef?.value === 'string' ? entity.CurrencyRef.value : null,
    totalAmount: normalizeAmount(entity?.TotalAmt),
    lineItems: normalizeLineItems(entity?.Line),
    referenceNumber: typeof entity?.DocNumber === 'string' ? entity.DocNumber : null,
    memo: typeof entity?.PrivateNote === 'string' ? entity.PrivateNote : null,
    status: typeof entity?.TxnStatus === 'string' ? entity.TxnStatus : balance === 0 ? 'paid' : 'open',
    rawData: entity as Record<string, unknown>,
    providerUpdatedAt: typeof entity?.MetaData?.LastUpdatedTime === 'string' ? entity.MetaData.LastUpdatedTime : null,
  };
}

function providerFailure(error: unknown): CertificationFailure {
  if (error instanceof CertificationFailure) return error;
  const axiosError = error as AxiosError;
  const status = axiosError?.response?.status;
  if (status === 401 || status === 403) {
    return new CertificationFailure('QuickBooks Sandbox authorization is no longer valid. Reconnect before another provider read.', 'auth');
  }
  if (status === 429) {
    return new CertificationFailure('QuickBooks Sandbox rate-limited the certification read.', 'provider');
  }
  return new CertificationFailure('QuickBooks Sandbox could not complete the certification accounting read.', 'provider');
}

class CertificationRepository {
  private readonly pool: Pool;
  private readonly credentialCrypto: CertificationCredentialCrypto;

  constructor(private readonly config: CertificationSidecarConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 3, ssl: { rejectUnauthorized: true } });
    this.credentialCrypto = new CertificationCredentialCrypto(config.encryptionKey);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async health(): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  }

  async bootstrapFixture(): Promise<typeof certificationFixture> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tenants (id, name, slug, status, plan, settings)
         VALUES ($1, $2, $3, 'active', 'free', $4::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           slug = EXCLUDED.slug,
           settings = EXCLUDED.settings,
           updated_at = NOW()`,
        [FIXTURE_TENANT_ID, 'Margin QuickBooks Sandbox Certification', FIXTURE_SLUG, JSON.stringify({ certification_fixture: true, provider: 'quickbooks', environment: 'sandbox' })]
      );
      await client.query(
        `INSERT INTO users (id, email, amazon_seller_id, seller_id, company_name, tenant_id, last_active_tenant_id, last_active_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, NOW())
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           last_active_tenant_id = EXCLUDED.last_active_tenant_id,
           last_active_at = EXCLUDED.last_active_at,
           updated_at = NOW()`,
        [FIXTURE_USER_ID, 'quickbooks-sandbox-certification@invalid.test', FIXTURE_SELLER_ID, FIXTURE_SELLER_ID, 'Margin QuickBooks Sandbox Certification', FIXTURE_TENANT_ID]
      );
      await client.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, role, accepted_at, is_active)
         VALUES ($1, $2, 'owner', NOW(), TRUE)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner', accepted_at = NOW(), is_active = TRUE, deleted_at = NULL, updated_at = NOW()`,
        [FIXTURE_TENANT_ID, FIXTURE_USER_ID]
      );
      await client.query('COMMIT');
      return certificationFixture;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getQuickBooksSource(): Promise<CertificationSource | null> {
    const result = await this.pool.query(
      `SELECT id, metadata
       FROM evidence_sources
       WHERE tenant_id = $1 AND user_id = $2 AND provider = 'quickbooks' AND status = 'connected' AND deleted_at IS NULL
       LIMIT 1`,
      [FIXTURE_TENANT_ID, FIXTURE_USER_ID]
    );
    const row = result.rows[0];
    const realmId = typeof row?.metadata?.realm_id === 'string' ? row.metadata.realm_id : null;
    return row?.id && realmId ? { id: String(row.id), realmId } : null;
  }

  async persistQuickBooksConnection(input: { realmId: string; accessToken: string; refreshToken: string; expiresIn: number }): Promise<CertificationSource> {
    const source = await this.ensureQuickBooksSource(input.realmId);
    const access = this.credentialCrypto.encrypt(input.accessToken);
    const refresh = this.credentialCrypto.encrypt(input.refreshToken);
    const expiresAt = new Date(Date.now() + Math.max(1, input.expiresIn) * 1000).toISOString();
    await this.pool.query(
      `INSERT INTO tokens (
          user_id, provider, tenant_id, store_id,
          access_token_iv, access_token_data, refresh_token_iv, refresh_token_data,
          credential_status, credential_error_code, credential_checked_at, credential_reconnect_required_at,
          expires_at, is_active, updated_at
       ) VALUES ($1, 'quickbooks', $2, NULL, $3, $4, $5, $6, 'active', NULL, NOW(), NULL, $7, TRUE, NOW())
       ON CONFLICT (user_id, provider, tenant_id) WHERE provider IN ('quickbooks', 'xero') AND tenant_id IS NOT NULL
       DO UPDATE SET
          access_token_iv = EXCLUDED.access_token_iv,
          access_token_data = EXCLUDED.access_token_data,
          refresh_token_iv = EXCLUDED.refresh_token_iv,
          refresh_token_data = EXCLUDED.refresh_token_data,
          credential_status = 'active',
          credential_error_code = NULL,
          credential_checked_at = NOW(),
          credential_reconnect_required_at = NULL,
          expires_at = EXCLUDED.expires_at,
          is_active = TRUE,
          updated_at = NOW()`,
      [FIXTURE_USER_ID, FIXTURE_TENANT_ID, access.iv, access.data, refresh.iv, refresh.data, expiresAt]
    );
    return source;
  }

  private async ensureQuickBooksSource(realmId: string): Promise<CertificationSource> {
    const sourceResult = await this.pool.query(
      `SELECT id FROM evidence_sources
       WHERE tenant_id = $1 AND user_id = $2 AND provider = 'quickbooks' AND deleted_at IS NULL
       LIMIT 1`,
      [FIXTURE_TENANT_ID, FIXTURE_USER_ID]
    );
    const existingId = sourceResult.rows[0]?.id;
    const metadata = JSON.stringify({ realm_id: realmId, source: 'quickbooks_sandbox_certification', token_source: 'certification_callback' });
    if (existingId) {
      await this.pool.query(
        `UPDATE evidence_sources
         SET status = 'connected', account_email = 'QuickBooks Sandbox', metadata = $2::jsonb,
             accounting_read_status = 'pending', accounting_last_read_at = NULL, accounting_last_error = NULL,
             accounting_record_count = 0, updated_at = NOW()
         WHERE id = $1`,
        [existingId, metadata]
      );
      return { id: String(existingId), realmId };
    }
    const inserted = await this.pool.query(
      `INSERT INTO evidence_sources (
          seller_id, user_id, tenant_id, provider, status, account_email, metadata,
          accounting_read_status, accounting_record_count
       ) VALUES ($1, $2, $3, 'quickbooks', 'connected', 'QuickBooks Sandbox', $4::jsonb, 'pending', 0)
       RETURNING id`,
      [FIXTURE_SELLER_ID, FIXTURE_USER_ID, FIXTURE_TENANT_ID, metadata]
    );
    return { id: String(inserted.rows[0].id), realmId };
  }

  async getQuickBooksToken(): Promise<CertificationToken | null> {
    const result = await this.pool.query(
      `SELECT access_token_iv, access_token_data, refresh_token_iv, refresh_token_data, expires_at, credential_status
       FROM tokens
       WHERE user_id = $1 AND tenant_id = $2 AND provider = 'quickbooks' AND is_active = TRUE AND deleted_at IS NULL
       LIMIT 1`,
      [FIXTURE_USER_ID, FIXTURE_TENANT_ID]
    );
    const row = result.rows[0];
    if (!row || row.credential_status === 'reconnect_required') return null;
    try {
      const accessToken = this.credentialCrypto.decrypt({ iv: row.access_token_iv, data: row.access_token_data });
      const refreshToken = row.refresh_token_iv && row.refresh_token_data
        ? this.credentialCrypto.decrypt({ iv: row.refresh_token_iv, data: row.refresh_token_data })
        : '';
      return { accessToken, refreshToken, expiresAt: new Date(row.expires_at) };
    } catch {
      await this.pool.query(
        `UPDATE tokens SET credential_status = 'reconnect_required', credential_error_code = 'decrypt_failed', credential_reconnect_required_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND tenant_id = $2 AND provider = 'quickbooks'`,
        [FIXTURE_USER_ID, FIXTURE_TENANT_ID]
      );
      return null;
    }
  }

  async updateQuickBooksToken(token: CertificationToken): Promise<void> {
    const access = this.credentialCrypto.encrypt(token.accessToken);
    const refresh = this.credentialCrypto.encrypt(token.refreshToken);
    await this.pool.query(
      `UPDATE tokens SET
         access_token_iv = $3, access_token_data = $4, refresh_token_iv = $5, refresh_token_data = $6,
         expires_at = $7, credential_status = 'active', credential_error_code = NULL,
         credential_checked_at = NOW(), credential_reconnect_required_at = NULL, updated_at = NOW()
       WHERE user_id = $1 AND tenant_id = $2 AND provider = 'quickbooks'`,
      [FIXTURE_USER_ID, FIXTURE_TENANT_ID, access.iv, access.data, refresh.iv, refresh.data, token.expiresAt.toISOString()]
    );
  }

  async createRun(sourceId: string, queueJobId: string | undefined, trigger: 'oauth_initial' | 'manual'): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO accounting_sync_runs (tenant_id, user_id, source_id, provider, trigger, status, queue_job_id, attempt_count, started_at)
       VALUES ($1, $2, $3, 'quickbooks', $4, 'running', $5, 1, NOW())
       ON CONFLICT (tenant_id, provider) WHERE status IN ('queued', 'running')
       DO UPDATE SET attempt_count = accounting_sync_runs.attempt_count + 1, updated_at = NOW()
       RETURNING id`,
      [FIXTURE_TENANT_ID, FIXTURE_USER_ID, sourceId, trigger, queueJobId || null]
    );
    return String(result.rows[0].id);
  }

  async markRunFailed(runId: string, sourceId: string | undefined, error: CertificationFailure): Promise<void> {
    const status = error.kind === 'auth' ? 'reconnect_required' : 'failed';
    await this.pool.query(
      `UPDATE accounting_sync_runs
       SET status = $2, error_code = $3, error_message = $4, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [runId, status, error.kind === 'auth' ? 'ACCOUNTING_RECONNECT_REQUIRED' : 'ACCOUNTING_SYNC_FAILED', sanitizeError(error)]
    );
    if (sourceId) {
      await this.pool.query(
        `UPDATE evidence_sources SET accounting_read_status = $2, accounting_last_error = $3, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $4 AND user_id = $5`,
        [sourceId, status === 'reconnect_required' ? 'reconnect_required' : 'failed', sanitizeError(error), FIXTURE_TENANT_ID, FIXTURE_USER_ID]
      );
    }
  }

  async persistRead(sourceId: string, records: CertificationRecord[]): Promise<{ status: 'verified' | 'no_data'; recordsInserted: number; recordsUpdated: number; evidenceCount: number; checkpoint: string | null }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ids = records.map((record) => record.providerRecordId);
      const existing = ids.length
        ? await client.query(
          `SELECT provider_record_id FROM accounting_records
           WHERE tenant_id = $1 AND provider = 'quickbooks' AND provider_record_id = ANY($2::text[])`,
          [FIXTURE_TENANT_ID, ids]
        )
        : { rows: [] as Array<{ provider_record_id: string }> };
      const existingIds = new Set(existing.rows.map((row) => String(row.provider_record_id)));
      const now = new Date().toISOString();

      for (const record of records) {
        await client.query(
          `INSERT INTO accounting_records (
             tenant_id, user_id, provider, provider_record_id, record_type, supplier_name,
             transaction_date, due_date, currency, total_amount, line_items, reference_number,
             memo, status, raw_data, provider_updated_at, synced_at, source_id, updated_at
           ) VALUES (
             $1, $2, 'quickbooks', $3, $4, $5, $6::date, $7::date, $8, $9, $10::jsonb, $11,
             $12, $13, $14::jsonb, $15::timestamptz, $16::timestamptz, $17, $16::timestamptz
           ) ON CONFLICT (tenant_id, provider, provider_record_id) DO UPDATE SET
             record_type = EXCLUDED.record_type, supplier_name = EXCLUDED.supplier_name,
             transaction_date = EXCLUDED.transaction_date, due_date = EXCLUDED.due_date,
             currency = EXCLUDED.currency, total_amount = EXCLUDED.total_amount, line_items = EXCLUDED.line_items,
             reference_number = EXCLUDED.reference_number, memo = EXCLUDED.memo, status = EXCLUDED.status,
             raw_data = EXCLUDED.raw_data, provider_updated_at = EXCLUDED.provider_updated_at,
             synced_at = EXCLUDED.synced_at, source_id = EXCLUDED.source_id, updated_at = EXCLUDED.updated_at`,
          [
            FIXTURE_TENANT_ID, FIXTURE_USER_ID, record.providerRecordId, record.recordType, record.supplierName,
            record.transactionDate, record.dueDate, record.currency, record.totalAmount, JSON.stringify(record.lineItems),
            record.referenceNumber, record.memo, record.status, JSON.stringify(record.rawData), record.providerUpdatedAt,
            now, sourceId,
          ]
        );
      }

      let evidenceCount = 0;
      for (const record of records) {
        const saved = await client.query(
          `SELECT id FROM accounting_records WHERE tenant_id = $1 AND provider = 'quickbooks' AND provider_record_id = $2`,
          [FIXTURE_TENANT_ID, record.providerRecordId]
        );
        const accountingRecordId = String(saved.rows[0].id);
        const materializedLines = record.lineItems.length ? record.lineItems : [{}];
        for (let index = 0; index < materializedLines.length; index += 1) {
          const line = materializedLines[index];
          await client.query(
            `INSERT INTO accounting_evidence (
               tenant_id, accounting_record_id, source_id, provider, provider_record_id, provider_record_type,
               supplier_name, reference_number, transaction_date, currency, total_amount, line_item_index,
               line_item_reference, line_item, document_available, provenance, status, updated_at
             ) VALUES (
               $1, $2, $3, 'quickbooks', $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13::jsonb,
               FALSE, $14::jsonb, 'available', NOW()
             ) ON CONFLICT (accounting_record_id, line_item_index) DO UPDATE SET
               source_id = EXCLUDED.source_id, supplier_name = EXCLUDED.supplier_name,
               reference_number = EXCLUDED.reference_number, transaction_date = EXCLUDED.transaction_date,
               currency = EXCLUDED.currency, total_amount = EXCLUDED.total_amount,
               line_item_reference = EXCLUDED.line_item_reference, line_item = EXCLUDED.line_item,
               provenance = EXCLUDED.provenance, status = 'available', updated_at = NOW()`,
            [
              FIXTURE_TENANT_ID, accountingRecordId, sourceId, record.providerRecordId, record.recordType,
              record.supplierName, record.referenceNumber, record.transactionDate, record.currency, record.totalAmount,
              index, typeof line.item_ref === 'string' ? line.item_ref : typeof line.id === 'string' ? line.id : null,
              JSON.stringify(line), JSON.stringify({ source: 'quickbooks_sandbox', materialized_by: 'certification_sidecar', fixture_tenant: FIXTURE_SLUG }),
            ]
          );
          evidenceCount += 1;
        }
      }

      const status = records.length ? 'verified' : 'no_data';
      const checkpoint = records
        .map((record) => record.providerUpdatedAt)
        .filter((value): value is string => Boolean(value && !Number.isNaN(new Date(value).getTime())))
        .sort()
        .at(-1) || null;
      await client.query(
        `UPDATE evidence_sources SET
           accounting_read_status = $2, accounting_last_read_at = NOW(), accounting_last_error = NULL,
           accounting_record_count = $3, accounting_sync_checkpoint = $4::timestamptz, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $5 AND user_id = $6`,
        [sourceId, status, records.length, checkpoint, FIXTURE_TENANT_ID, FIXTURE_USER_ID]
      );
      await client.query('COMMIT');
      return {
        status,
        recordsInserted: records.filter((record) => !existingIds.has(record.providerRecordId)).length,
        recordsUpdated: records.filter((record) => existingIds.has(record.providerRecordId)).length,
        evidenceCount,
        checkpoint,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markRunCompleted(runId: string, result: { status: 'verified' | 'no_data'; recordsDiscovered: number; recordsInserted: number; recordsUpdated: number; checkpoint: string | null }): Promise<void> {
    await this.pool.query(
      `UPDATE accounting_sync_runs SET
         status = $2, records_discovered = $3, records_inserted = $4, records_updated = $5,
         provider_checkpoint_after = $6::timestamptz, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [runId, result.status === 'verified' ? 'completed' : 'completed_no_data', result.recordsDiscovered, result.recordsInserted, result.recordsUpdated, result.checkpoint]
    );
  }
}

export class CertificationSidecarRuntime {
  private readonly repository: CertificationRepository;
  private readonly redis: Redis;
  private queue: Queue<CertificationJobData> | null = null;
  private worker: Worker<CertificationJobData> | null = null;

  constructor(private readonly config: CertificationSidecarConfig) {
    this.repository = new CertificationRepository(config);
    this.redis = new Redis(redisOptionsFromUrl(config.redisUrl));
    this.redis.on('error', () => undefined);
  }

  async start(): Promise<void> {
    await this.repository.health();
    const pong = await this.redis.ping();
    if (pong !== 'PONG') throw new Error('Certification Redis did not respond with PONG');
    this.queue = new Queue<CertificationJobData>(this.config.queueName, {
      connection: redisOptionsFromUrl(this.config.redisUrl),
      defaultJobOptions: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
    });
    this.worker = new Worker<CertificationJobData>(this.config.queueName, async (job) => this.processJob(job), {
      connection: redisOptionsFromUrl(this.config.redisUrl),
      concurrency: 1,
    });
    this.worker.on('completed', (job) => logger.info('Certification sidecar job completed', { jobId: job.id, kind: job.data.kind }));
    this.worker.on('failed', (job, error) => logger.warn('Certification sidecar job failed', { jobId: job?.id, kind: job?.data.kind, error: sanitizeError(error) }));
    logger.info('Certification sidecar worker started', { queue: this.config.queueName, fixtureTenant: FIXTURE_SLUG });
  }

  async health(): Promise<{ redis: boolean; database: boolean; worker: boolean; queueName: string; metrics: Record<string, number> | null }> {
    const [database, redisResult, metrics] = await Promise.all([
      this.repository.health().catch(() => false),
      this.redis.ping().then((value) => value === 'PONG').catch(() => false),
      this.getQueueMetrics().catch(() => null),
    ]);
    return { redis: redisResult, database, worker: Boolean(this.worker), queueName: this.config.queueName, metrics };
  }

  async getQueueMetrics(): Promise<Record<string, number>> {
    if (!this.queue) throw new Error('Certification sidecar queue is not started');
    return this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
  }

  async bootstrapFixture(): Promise<typeof certificationFixture> {
    return this.repository.bootstrapFixture();
  }

  async createOAuthState(): Promise<string> {
    requireQuickBooksCertificationConfig(this.config);
    await this.repository.bootstrapFixture();
    const state = crypto.randomBytes(32).toString('hex');
    const payload = JSON.stringify({ tenantId: FIXTURE_TENANT_ID, userId: FIXTURE_USER_ID, provider: 'quickbooks', createdAt: Date.now() });
    await this.redis.set(`${this.config.oauthStatePrefix}${state}`, payload, 'EX', OAUTH_STATE_TTL_SECONDS);
    return state;
  }

  async consumeOAuthState(state: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/i.test(state)) return false;
    const key = `${this.config.oauthStatePrefix}${state}`;
    const raw = await this.redis.eval("local v=redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]); end; return v", 1, key);
    if (typeof raw !== 'string') return false;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.tenantId === FIXTURE_TENANT_ID && parsed?.userId === FIXTURE_USER_ID && parsed?.provider === 'quickbooks';
    } catch {
      return false;
    }
  }

  async persistOAuthExchange(input: { realmId: string; accessToken: string; refreshToken: string; expiresIn: number }): Promise<string> {
    const source = await this.repository.persistQuickBooksConnection(input);
    return this.enqueue({ kind: 'quickbooks-sync', tenantId: FIXTURE_TENANT_ID, userId: FIXTURE_USER_ID, trigger: 'oauth_initial' });
  }

  async enqueueProbe(): Promise<string> {
    await this.repository.bootstrapFixture();
    return this.enqueue({ kind: 'probe', tenantId: FIXTURE_TENANT_ID, userId: FIXTURE_USER_ID, trigger: 'fixture_probe' });
  }

  async enqueueManualSync(): Promise<string> {
    return this.enqueue({ kind: 'quickbooks-sync', tenantId: FIXTURE_TENANT_ID, userId: FIXTURE_USER_ID, trigger: 'manual' });
  }

  private async enqueue(data: CertificationJobData): Promise<string> {
    if (!this.queue) throw new Error('Certification sidecar queue is not started');
    const job = await this.queue.add(data.kind, data, { jobId: `${data.kind}-${Date.now()}-${crypto.randomUUID()}` });
    return String(job.id);
  }

  private async processJob(job: Job<CertificationJobData>): Promise<void> {
    if (job.data.tenantId !== FIXTURE_TENANT_ID || job.data.userId !== FIXTURE_USER_ID) {
      throw new CertificationFailure('Certification job tenant/user boundary mismatch.', 'configuration');
    }
    const source = await this.repository.getQuickBooksSource();
    if (job.data.kind === 'probe') {
      if (source) throw new CertificationFailure('Fixture probe refused because an accounting source exists; it must run only before OAuth.', 'probe');
      throw new CertificationFailure('No accounting connection exists for the isolated fixture. Provider access was not attempted.', 'probe');
    }
    if (!source) throw new CertificationFailure('No accounting connection exists for the isolated fixture.', 'not_connected');
    const runId = await this.repository.createRun(source.id, job.id, job.data.trigger === 'oauth_initial' ? 'oauth_initial' : 'manual');
    try {
      const records = await this.readQuickBooksRecords(source.realmId);
      const persisted = await this.repository.persistRead(source.id, records);
      await this.repository.markRunCompleted(runId, {
        status: persisted.status,
        recordsDiscovered: records.length,
        recordsInserted: persisted.recordsInserted,
        recordsUpdated: persisted.recordsUpdated,
        checkpoint: persisted.checkpoint,
      });
    } catch (error) {
      const failure = providerFailure(error);
      await this.repository.markRunFailed(runId, source.id, failure);
      throw failure;
    }
  }

  private async readQuickBooksRecords(realmId: string): Promise<CertificationRecord[]> {
    const token = await this.repository.getQuickBooksToken();
    if (!token) throw new CertificationFailure('QuickBooks Sandbox authorization is unavailable. Reconnect before another provider read.', 'auth');
    const usableToken = await this.refreshTokenIfNeeded(token);
    const [bills, purchases] = await Promise.all([
      this.readEntityPages(usableToken.accessToken, realmId, 'Bill'),
      this.readEntityPages(usableToken.accessToken, realmId, 'Purchase'),
    ]);
    return [
      ...bills.map((record) => normalizeQuickBooksRecord(record, 'bill')),
      ...purchases.map((record) => normalizeQuickBooksRecord(record, 'purchase')),
    ];
  }

  private async refreshTokenIfNeeded(token: CertificationToken): Promise<CertificationToken> {
    if (token.expiresAt.getTime() > Date.now() + 60_000) return token;
    if (!token.refreshToken) throw new CertificationFailure('QuickBooks Sandbox authorization expired without a refresh token.', 'auth');
    const quickBooks = requireQuickBooksCertificationConfig(this.config);
    try {
      const response = await axios.post(QUICKBOOKS_TOKEN_URL, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refreshToken }), {
        headers: {
          Authorization: `Basic ${Buffer.from(`${quickBooks.clientId}:${quickBooks.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      });
      const refreshed = {
        accessToken: String(response.data.access_token || ''),
        refreshToken: String(response.data.refresh_token || token.refreshToken),
        expiresAt: new Date(Date.now() + (Number(response.data.expires_in) || 3600) * 1000),
      };
      if (!refreshed.accessToken) throw new CertificationFailure('QuickBooks Sandbox token refresh returned no access token.', 'auth');
      await this.repository.updateQuickBooksToken(refreshed);
      return refreshed;
    } catch (error) {
      throw providerFailure(error);
    }
  }

  private async readEntityPages(accessToken: string, realmId: string, entityName: 'Bill' | 'Purchase'): Promise<any[]> {
    const records: any[] = [];
    let startPosition = 1;
    for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_ENTITY; pageIndex += 1) {
      try {
        const query = `SELECT * FROM ${entityName} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;
        const response = await axios.get(`${QUICKBOOKS_SANDBOX_URL}/v3/company/${encodeURIComponent(realmId)}/query`, {
          params: { query },
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        const page = Array.isArray(response.data?.QueryResponse?.[entityName]) ? response.data.QueryResponse[entityName] : [];
        records.push(...page);
        if (page.length < PAGE_SIZE) return records;
        startPosition += PAGE_SIZE;
      } catch (error) {
        throw providerFailure(error);
      }
    }
    throw new CertificationFailure(`QuickBooks Sandbox ${entityName} pagination exceeded the configured safety limit.`, 'provider');
  }

  async getOAuthAuthorizationUrl(): Promise<string> {
    const quickBooks = requireQuickBooksCertificationConfig(this.config);
    const state = await this.createOAuthState();
    return `https://appcenter.intuit.com/connect/oauth2?client_id=${encodeURIComponent(quickBooks.clientId)}&response_type=code&scope=${encodeURIComponent('com.intuit.quickbooks.accounting')}&redirect_uri=${encodeURIComponent(quickBooks.redirectUri)}&state=${encodeURIComponent(state)}`;
  }

  async exchangeAuthorizationCode(code: string, realmId: string): Promise<string> {
    const quickBooks = requireQuickBooksCertificationConfig(this.config);
    const response = await axios.post(QUICKBOOKS_TOKEN_URL, new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: quickBooks.redirectUri }), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${quickBooks.clientId}:${quickBooks.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    });
    const accessToken = String(response.data.access_token || '');
    const refreshToken = String(response.data.refresh_token || '');
    if (!accessToken || !refreshToken || !realmId) {
      throw new CertificationFailure('QuickBooks Sandbox callback did not contain the required authorization result.', 'auth');
    }
    return this.persistOAuthExchange({ realmId, accessToken, refreshToken, expiresIn: Number(response.data.expires_in) || 3600 });
  }
}

let singleton: CertificationSidecarRuntime | null = null;

export function getCertificationSidecarRuntime(config: CertificationSidecarConfig): CertificationSidecarRuntime {
  if (!config.enabled) throw new Error('Certification sidecar is disabled');
  if (!singleton) singleton = new CertificationSidecarRuntime(config);
  return singleton;
}
