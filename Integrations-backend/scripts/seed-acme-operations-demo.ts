import 'dotenv/config';
import { supabaseAdmin, isRealDatabaseConfigured, convertUserIdToUuid } from '../src/database/supabaseClient';

type DbError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type WriteOptions = {
  onConflict?: string;
  optional?: boolean;
  optionalColumns?: string[];
};

const DEMO_TENANT_ID = '00000000-0000-0000-0000-0000000000d0';
const DEFAULT_DEMO_USER_INPUT = 'demo-user';
const DEFAULT_DEMO_USER_ID = convertUserIdToUuid(DEFAULT_DEMO_USER_INPUT);

const tenantSlug = process.env.ACME_DEMO_TENANT_SLUG || 'demo-workspace';
const userInput = process.env.ACME_DEMO_USER_ID || DEFAULT_DEMO_USER_INPUT;
const demoUserId = convertUserIdToUuid(userInput);
const demoUserEmail = process.env.ACME_DEMO_USER_EMAIL || 'demo@acme-operations.test';
const shouldUpsertUserProfile =
  demoUserId === DEFAULT_DEMO_USER_ID ||
  process.env.ALLOW_DEMO_PROFILE_UPSERT === 'true';
const shouldOverwriteUserTokens =
  demoUserId === DEFAULT_DEMO_USER_ID ||
  process.env.ALLOW_DEMO_TOKEN_OVERWRITE === 'true';

const sellerId = process.env.ACME_DEMO_SELLER_ID || 'ACME-SELLER-001';
const sellerEmail = process.env.ACME_DEMO_SELLER_EMAIL || 'ops@acme-operations.test';
const storeUsId = '00000000-0000-0000-0000-00000000a001';
const storeEuId = '00000000-0000-0000-0000-00000000a002';
const syncId = 'acme-sync-20260420';

let resolvedTenantId = DEMO_TENANT_ID;

const db = supabaseAdmin;

function iso(daysOffset = 0, hoursOffset = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysOffset);
  date.setUTCHours(date.getUTCHours() + hoursOffset);
  return date.toISOString();
}

function dateOnly(daysOffset = 0): string {
  return iso(daysOffset).slice(0, 10);
}

function requireGuards(): void {
  if (process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Refusing to seed. Set ALLOW_DEMO_SEED=true to confirm this is intentional.');
  }

  if (!isRealDatabaseConfigured || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('A real Supabase service-role database connection is required for this seed.');
  }

  if (!db || typeof db.from !== 'function') {
    throw new Error('Supabase admin client is unavailable.');
  }

  if (tenantSlug !== 'demo-workspace' && process.env.ALLOW_NON_STANDARD_ACME_DEMO_SLUG !== 'true') {
    throw new Error(
      `Refusing to seed non-standard slug "${tenantSlug}". Set ALLOW_NON_STANDARD_ACME_DEMO_SLUG=true if this is intentional.`
    );
  }
}

function isSchemaError(error?: DbError | null): boolean {
  if (!error) return false;
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  return ['PGRST200', 'PGRST204', 'PGRST205', '42P01', '42703'].includes(String(error.code || '')) ||
    message.includes('does not exist') ||
    message.includes('could not find') ||
    message.includes('schema cache');
}

function parseMissingColumn(error?: DbError | null): string | null {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  const quoted = message.match(/'([^']+)' column/i);
  if (quoted?.[1]) return quoted[1];
  const doubleQuoted = message.match(/column "([^"]+)"/i);
  if (doubleQuoted?.[1]) return doubleQuoted[1];
  return null;
}

function isIntegerIdTypeError(error?: DbError | null): boolean {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return message.includes('invalid input syntax for type integer') && message.includes('00000000-');
}

function omitColumns<T extends Record<string, any>>(rows: T[], omitted: Set<string>): T[] {
  if (!omitted.size) return rows;
  return rows.map((row) => {
    const next: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!omitted.has(key)) next[key] = value;
    }
    return next as T;
  });
}

async function maybeDeleteByTenant(table: string): Promise<void> {
  const { error } = await db
    .from(table)
    .delete()
    .eq('tenant_id', resolvedTenantId);

  if (error && !isSchemaError(error)) {
    throw new Error(`Failed deleting ${table}: ${error.message}`);
  }

  if (error && isSchemaError(error)) {
    console.log(`skip delete ${table}: ${error.message}`);
  }
}

async function deleteUserScopedRows(table: string, field: string, value: string): Promise<void> {
  const { error } = await db
    .from(table)
    .delete()
    .eq(field, value);

  if (error && !isSchemaError(error)) {
    throw new Error(`Failed deleting ${table}: ${error.message}`);
  }
}

async function deleteDemoTokenRows(): Promise<void> {
  const { error } = await db
    .from('tokens')
    .delete()
    .eq('user_id', demoUserId)
    .in('provider', ['amazon', 'gmail', 'gdrive', 'dropbox']);

  if (error && !isSchemaError(error)) {
    throw new Error(`Failed deleting demo tokens: ${error.message}`);
  }
}

async function writeRows<T extends Record<string, any>>(
  table: string,
  rows: T[],
  options: WriteOptions = {}
): Promise<void> {
  if (!rows.length) return;

  const removed = new Set<string>();
  const optionalColumns = new Set(options.optionalColumns || Object.keys(rows[0]));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const payload = omitColumns(rows, removed);
    const query = options.onConflict
      ? db.from(table).upsert(payload, { onConflict: options.onConflict })
      : db.from(table).insert(payload);

    const { error } = await query;
    if (!error) {
      console.log(`seeded ${table}: ${rows.length}`);
      return;
    }

    if (isIntegerIdTypeError(error) && optionalColumns.has('id')) {
      removed.add('id');
      console.log(`retry ${table} without optional column: id`);
      continue;
    }

    const missingColumn = parseMissingColumn(error);
    if (missingColumn && optionalColumns.has(missingColumn)) {
      removed.add(missingColumn);
      console.log(`retry ${table} without optional column: ${missingColumn}`);
      continue;
    }

    if (options.optional && isSchemaError(error)) {
      console.log(`skip optional table ${table}: ${error.message}`);
      return;
    }

    throw new Error(`Failed writing ${table}: ${error.message}`);
  }

  throw new Error(`Failed writing ${table}: too many schema fallback attempts.`);
}

async function ensureTenant(): Promise<void> {
  const { data: existing, error } = await db
    .from('tenants')
    .select('id, slug, name, metadata')
    .eq('slug', tenantSlug)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve demo tenant: ${error.message}`);
  }

  if (existing) {
    const isDemoTenant = existing.slug === 'demo-workspace' || existing.metadata?.is_demo_workspace === true;
    if (!isDemoTenant) {
      throw new Error(`Refusing to modify tenant "${tenantSlug}" because it is not marked as a demo workspace.`);
    }
    resolvedTenantId = existing.id;
  }

  await writeRows('tenants', [{
    id: resolvedTenantId,
    name: 'Acme Operations',
    slug: tenantSlug,
    status: 'active',
    plan: 'professional',
    settings: {
      demo_workspace: true,
      billing_interval: 'monthly',
      read_only_reason: 'Isolated Acme Operations launch demo workspace',
      evidenceIngestion: {
        autoCollect: true,
        schedule: 'daily_0200',
        filters: {
          senderPatterns: ['*@amazon.com', '*@sellercentral.amazon.*', '*@fedex.com', '*@ups.com', '*invoice*'],
          excludeSenders: ['*newsletter*', '*marketing*'],
          subjectKeywords: ['invoice', 'FBA', 'reimbursement', 'shipment', 'proof of delivery', 'return authorization'],
          excludeSubjects: ['promotional', 'survey'],
          fileTypes: { pdf: true, images: true, spreadsheets: true, docs: false, shipping: true },
          fileNamePatterns: ['invoice', 'bol', 'tracking', 'shipment', 'FBA', 'reimburse'],
          dateRange: 'last_18_months'
        }
      }
    },
    metadata: {
      is_demo_workspace: true,
      seed_version: 'acme_operations_launch_demo_v1',
      seeded_at: iso(),
      live_data_mixed: false,
      demo_company: 'Acme Operations'
    },
    updated_at: iso()
  }], { onConflict: 'id' });
}

async function finalizeTenantReadOnly(): Promise<void> {
  const { error } = await db
    .from('tenants')
    .update({
      name: 'Acme Operations',
      status: 'read_only',
      settings: {
        demo_workspace: true,
        billing_interval: 'monthly',
        read_only_reason: 'Isolated Acme Operations launch demo workspace',
        evidenceIngestion: {
          autoCollect: true,
          schedule: 'daily_0200',
          filters: {
            senderPatterns: ['*@amazon.com', '*@sellercentral.amazon.*', '*@fedex.com', '*@ups.com', '*invoice*'],
            excludeSenders: ['*newsletter*', '*marketing*'],
            subjectKeywords: ['invoice', 'FBA', 'reimbursement', 'shipment', 'proof of delivery', 'return authorization'],
            excludeSubjects: ['promotional', 'survey'],
            fileTypes: { pdf: true, images: true, spreadsheets: true, docs: false, shipping: true },
            fileNamePatterns: ['invoice', 'bol', 'tracking', 'shipment', 'FBA', 'reimburse'],
            dateRange: 'last_18_months'
          }
        }
      },
      metadata: {
        is_demo_workspace: true,
        seed_version: 'acme_operations_launch_demo_v1',
        seeded_at: iso(),
        live_data_mixed: false,
        demo_company: 'Acme Operations'
      },
      updated_at: iso()
    })
    .eq('id', resolvedTenantId);

  if (error) {
    throw new Error(`Failed to return demo tenant to read_only: ${error.message}`);
  }
}

async function resetTenantData(): Promise<void> {
  const tenantScopedDeleteOrder = [
    'billing_work_items',
    'recovery_work_items',
    'billing_transactions',
    'billing_errors',
    'refund_filing_errors',
    'recovery_lifecycle_logs',
    'recoveries',
    'dispute_submissions',
    'case_messages',
    'unmatched_case_messages',
    'dispute_evidence_links',
    'evidence_match_results',
    'proof_packets',
    'smart_prompts',
    'evidence_documents',
    'evidence_sources',
    'billing_invoices',
    'tenant_billing_subscriptions',
    'billing_credit_ledger',
    'recovery_cycles',
    'recent_platform_events',
    'notifications',
    'user_notification_preferences',
    'sync_snapshots',
    'sync_progress',
    'orders',
    'shipments',
    'returns',
    'settlements',
    'inventory_items',
    'inventory_ledger',
    'product_catalog',
    'financial_events',
    'tokens',
    'stores',
    'dispute_cases',
    'detection_results'
  ];

  for (const table of tenantScopedDeleteOrder) {
    await maybeDeleteByTenant(table);
  }

  if (shouldOverwriteUserTokens) {
    await deleteDemoTokenRows();
  }

  await deleteUserScopedRows('tenant_memberships', 'tenant_id', resolvedTenantId);
}

function proofSnapshot(requirements: string[], recommendation = 'filing_ready') {
  return {
    requiredRequirements: requirements,
    missingRequirements: [],
    riskFlags: [],
    filingRecommendation: recommendation,
    explanationPayload: {
      basis: 'Demo proof packet assembled from linked Acme Operations source documents.',
      reviewer_note: 'All identifiers match the case record.'
    }
  };
}

function decisionIntelligence(params: {
  eligibility: string;
  requirements: string[];
  recommendation?: string;
  operationalState?: string;
  missing?: string[];
  blockReasons?: string[];
}) {
  return {
    decision_intelligence: {
      eligibility_status: params.eligibility,
      proof_snapshot: {
        ...proofSnapshot(params.requirements, params.recommendation || 'filing_ready'),
        missingRequirements: params.missing || []
      },
      filing_strategy: params.recommendation === 'smart_filing'
        ? 'review_then_file'
        : 'submit_with_invoice_and_shipment_proof',
      operational_state: params.operationalState || 'ready',
      operational_explanation: params.blockReasons?.[0] || 'Ready for the next workflow step.'
    },
    match_confidence: 0.94
  };
}

const detections = [
  {
    id: '00000000-0000-0000-0000-000000002001',
    anomaly_type: 'missing_unit',
    severity: 'high',
    estimated_value: 486.2,
    confidence_score: 0.93,
    status: 'pending',
    claim_number: 'ACM-LI-2604-0001',
    source_type: 'sp_api',
    order_id: '113-8043372-9097841',
    sku: 'ACME-TRAVEL-MUG-BLK',
    asin: 'B0ACME0001',
    evidence: { shipment_id: 'FBA17ACME001', order_id: '113-8043372-9097841', sku: 'ACME-TRAVEL-MUG-BLK', asin: 'B0ACME0001', issue: 'Inbound received short by 14 units' },
    days_remaining: 37,
    deadline_date: iso(37),
    discovery_date: iso(-23)
  },
  {
    id: '00000000-0000-0000-0000-000000002002',
    anomaly_type: 'incorrect_fee',
    severity: 'medium',
    estimated_value: 218.75,
    confidence_score: 0.89,
    status: 'pending',
    claim_number: 'ACM-FD-2604-0002',
    source_type: 'sp_api',
    order_id: '113-5621175-4496210',
    sku: 'ACME-CABLE-USB3-6FT',
    asin: 'B0ACME0002',
    evidence: { order_id: '113-5621175-4496210', sku: 'ACME-CABLE-USB3-6FT', asin: 'B0ACME0002', issue: 'Oversize fee applied to standard-size SKU' },
    days_remaining: 41,
    deadline_date: iso(41),
    discovery_date: iso(-19)
  },
  {
    id: '00000000-0000-0000-0000-000000002003',
    anomaly_type: 'overcharge',
    severity: 'high',
    estimated_value: 742.4,
    confidence_score: 0.91,
    status: 'disputed',
    claim_number: 'ACM-OC-2604-0003',
    source_type: 'sp_api',
    amazon_case_id: 'AMZ-ACME-42003',
    order_id: '113-9204451-1885026',
    sku: 'ACME-DESK-LAMP-OAK',
    asin: 'B0ACME0003',
    evidence: { order_id: '113-9204451-1885026', sku: 'ACME-DESK-LAMP-OAK', asin: 'B0ACME0003', issue: 'Duplicate long-term storage adjustment' },
    days_remaining: 45,
    deadline_date: iso(45),
    discovery_date: iso(-15)
  },
  {
    id: '00000000-0000-0000-0000-000000002004',
    anomaly_type: 'duplicate_charge',
    severity: 'critical',
    estimated_value: 1184.5,
    confidence_score: 0.96,
    status: 'resolved',
    claim_number: 'ACM-OC-2604-0004',
    source_type: 'sp_api',
    amazon_case_id: 'AMZ-ACME-42004',
    order_id: '113-3389120-7712430',
    sku: 'ACME-AIR-FILTER-3PK',
    asin: 'B0ACME0004',
    evidence: { order_id: '113-3389120-7712430', sku: 'ACME-AIR-FILTER-3PK', asin: 'B0ACME0004', issue: 'Duplicate reimbursement reversal' },
    days_remaining: 49,
    deadline_date: iso(49),
    discovery_date: iso(-11)
  },
  {
    id: '00000000-0000-0000-0000-000000002005',
    anomaly_type: 'damaged_stock',
    severity: 'high',
    estimated_value: 963.1,
    confidence_score: 0.92,
    status: 'resolved',
    claim_number: 'ACM-DM-2604-0005',
    source_type: 'sp_api',
    amazon_case_id: 'AMZ-ACME-42005',
    order_id: '113-7045128-6028173',
    sku: 'ACME-YOGA-MAT-SAGE',
    asin: 'B0ACME0005',
    evidence: { shipment_id: 'FBA17ACME005', sku: 'ACME-YOGA-MAT-SAGE', asin: 'B0ACME0005', issue: 'Warehouse damaged units not reimbursed' },
    days_remaining: 51,
    deadline_date: iso(51),
    discovery_date: iso(-9)
  },
  {
    id: '00000000-0000-0000-0000-000000002006',
    anomaly_type: 'incorrect_fee',
    severity: 'medium',
    estimated_value: 634.88,
    confidence_score: 0.87,
    status: 'resolved',
    claim_number: 'ACM-FD-2604-0006',
    source_type: 'sp_api',
    amazon_case_id: 'AMZ-ACME-42006',
    order_id: '113-6678124-1140062',
    sku: 'ACME-STORAGE-BIN-L',
    asin: 'B0ACME0006',
    evidence: { order_id: '113-6678124-1140062', sku: 'ACME-STORAGE-BIN-L', asin: 'B0ACME0006', issue: 'Weight tier fee corrected after case' },
    days_remaining: 52,
    deadline_date: iso(52),
    discovery_date: iso(-8)
  },
  {
    id: '00000000-0000-0000-0000-000000002007',
    anomaly_type: 'missing_unit',
    severity: 'medium',
    estimated_value: 376.45,
    confidence_score: 0.73,
    status: 'reviewed',
    claim_number: 'ACM-LI-2604-0007',
    source_type: 'sp_api',
    amazon_case_id: 'AMZ-ACME-42007',
    order_id: '113-1092831-5547868',
    sku: 'ACME-LED-STRIP-16FT',
    asin: 'B0ACME0007',
    evidence: { shipment_id: 'FBA17ACME007', sku: 'ACME-LED-STRIP-16FT', asin: 'B0ACME0007', issue: 'Carrier document outside reimbursement window' },
    days_remaining: 28,
    deadline_date: iso(28),
    discovery_date: iso(-32)
  },
  {
    id: '00000000-0000-0000-0000-000000002008',
    anomaly_type: 'duplicate_charge',
    severity: 'low',
    estimated_value: 142.35,
    confidence_score: 0.82,
    status: 'reviewed',
    claim_number: 'ACM-OC-2604-0008',
    source_type: 'sp_api',
    order_id: '113-4410290-0140095',
    sku: 'ACME-PHONE-STAND-WHT',
    asin: 'B0ACME0008',
    evidence: { order_id: '113-4410290-0140095', sku: 'ACME-PHONE-STAND-WHT', asin: 'B0ACME0008', issue: 'Duplicate already reimbursed in settlement batch' },
    days_remaining: 35,
    deadline_date: iso(35),
    discovery_date: iso(-25)
  },
  {
    id: '00000000-0000-0000-0000-000000002009',
    anomaly_type: 'incorrect_fee',
    severity: 'medium',
    estimated_value: 311.28,
    confidence_score: 0.84,
    status: 'detected',
    claim_number: 'ACM-FD-2604-0009',
    source_type: 'sp_api',
    order_id: '113-5155722-8199427',
    sku: 'ACME-BENTO-BOX-GRN',
    asin: 'B0ACME0009',
    evidence: { order_id: '113-5155722-8199427', sku: 'ACME-BENTO-BOX-GRN', asin: 'B0ACME0009', issue: 'Potential referral fee mismatch' },
    days_remaining: 54,
    deadline_date: iso(54),
    discovery_date: iso(-6)
  },
  {
    id: '00000000-0000-0000-0000-000000002010',
    anomaly_type: 'missing_unit',
    severity: 'low',
    estimated_value: 96.7,
    confidence_score: 0.69,
    status: 'detected',
    claim_number: 'ACM-LI-2604-0010',
    source_type: 'sp_api',
    order_id: '113-2147859-0031088',
    sku: 'ACME-CLEANING-CLOTH-12',
    asin: 'B0ACME0010',
    evidence: { shipment_id: 'FBA17ACME010', sku: 'ACME-CLEANING-CLOTH-12', asin: 'B0ACME0010', issue: 'Needs supplier proof before case creation' },
    days_remaining: 55,
    deadline_date: iso(55),
    discovery_date: iso(-5)
  }
];

const disputes = [
  {
    id: '00000000-0000-0000-0000-000000003001',
    detection_result_id: detections[0].id,
    case_number: 'ACME-CASE-2001',
    status: 'pending',
    case_state: 'pending',
    claim_amount: 486.2,
    approved_amount: null,
    actual_payout_amount: null,
    recovered_amount: null,
    filing_status: 'pending',
    recovery_status: 'pending',
    billing_status: 'pending',
    eligibility_status: 'READY',
    eligible_to_file: true,
    amazon_case_id: null,
    provider_case_id: null,
    order_id: detections[0].order_id,
    sku: detections[0].sku,
    asin: detections[0].asin,
    expected_payout_date: iso(13),
    evidence_attachments: decisionIntelligence({ eligibility: 'READY', requirements: ['document_type:invoice', 'document_family:shipping|po', 'unit_cost_proof'] }),
    block_reasons: [],
    created_at: iso(-8),
    updated_at: iso(-1, -5)
  },
  {
    id: '00000000-0000-0000-0000-000000003002',
    detection_result_id: detections[1].id,
    case_number: 'ACME-CASE-2002',
    status: 'pending',
    case_state: 'pending',
    claim_amount: 218.75,
    approved_amount: null,
    actual_payout_amount: null,
    recovered_amount: null,
    filing_status: 'pending_approval',
    recovery_status: 'pending',
    billing_status: 'pending',
    eligibility_status: 'READY',
    eligible_to_file: true,
    amazon_case_id: null,
    provider_case_id: null,
    order_id: detections[1].order_id,
    sku: detections[1].sku,
    asin: detections[1].asin,
    expected_payout_date: iso(15),
    evidence_attachments: decisionIntelligence({ eligibility: 'READY', requirements: ['document_type:invoice', 'unit_cost_proof'], recommendation: 'smart_filing' }),
    block_reasons: [],
    created_at: iso(-7),
    updated_at: iso(-1, -2)
  },
  {
    id: '00000000-0000-0000-0000-000000003003',
    detection_result_id: detections[2].id,
    case_number: 'ACME-CASE-2003',
    status: 'submitted',
    case_state: 'pending',
    claim_amount: 742.4,
    approved_amount: null,
    actual_payout_amount: null,
    recovered_amount: null,
    filing_status: 'filed',
    recovery_status: 'detecting',
    billing_status: 'pending',
    eligibility_status: 'SAFETY_HOLD',
    eligible_to_file: false,
    amazon_case_id: 'AMZ-ACME-42003',
    provider_case_id: 'AMZ-ACME-42003',
    order_id: detections[2].order_id,
    sku: detections[2].sku,
    asin: detections[2].asin,
    expected_payout_date: iso(10),
    submission_date: iso(-5),
    evidence_attachments: decisionIntelligence({ eligibility: 'SAFETY_HOLD', requirements: ['document_type:shipping', 'unit_cost_proof'], operationalState: 'filed_waiting_on_amazon' }),
    block_reasons: [],
    created_at: iso(-6),
    updated_at: iso(-2)
  },
  {
    id: '00000000-0000-0000-0000-000000003004',
    detection_result_id: detections[3].id,
    case_number: 'ACME-CASE-2004',
    status: 'approved',
    case_state: 'approved',
    claim_amount: 1184.5,
    approved_amount: 1184.5,
    actual_payout_amount: null,
    recovered_amount: null,
    filing_status: 'filed',
    recovery_status: 'matched',
    billing_status: 'pending',
    eligibility_status: 'SAFETY_HOLD',
    eligible_to_file: false,
    amazon_case_id: 'AMZ-ACME-42004',
    provider_case_id: 'AMZ-ACME-42004',
    order_id: detections[3].order_id,
    sku: detections[3].sku,
    asin: detections[3].asin,
    expected_payout_date: iso(4),
    submission_date: iso(-10),
    resolution_date: iso(-2),
    evidence_attachments: decisionIntelligence({ eligibility: 'SAFETY_HOLD', requirements: ['document_type:invoice', 'unit_cost_proof'], operationalState: 'approved_waiting_for_payout' }),
    block_reasons: [],
    created_at: iso(-12),
    updated_at: iso(-2)
  },
  {
    id: '00000000-0000-0000-0000-000000003005',
    detection_result_id: detections[4].id,
    case_number: 'ACME-CASE-2005',
    status: 'approved',
    case_state: 'paid',
    claim_amount: 963.1,
    approved_amount: 963.1,
    actual_payout_amount: 963.1,
    recovered_amount: 963.1,
    filing_status: 'filed',
    recovery_status: 'reconciled',
    billing_status: 'credited',
    eligibility_status: 'SAFETY_HOLD',
    eligible_to_file: false,
    amazon_case_id: 'AMZ-ACME-42005',
    provider_case_id: 'AMZ-ACME-42005',
    order_id: detections[4].order_id,
    sku: detections[4].sku,
    asin: detections[4].asin,
    expected_payout_date: iso(-1),
    reconciled_at: iso(-1),
    submission_date: iso(-13),
    resolution_date: iso(-2),
    evidence_attachments: decisionIntelligence({ eligibility: 'SAFETY_HOLD', requirements: ['document_type:invoice', 'document_type:shipping', 'unit_cost_proof'], operationalState: 'reconciled' }),
    block_reasons: [],
    created_at: iso(-15),
    updated_at: iso(-1)
  },
  {
    id: '00000000-0000-0000-0000-000000003006',
    detection_result_id: detections[5].id,
    case_number: 'ACME-CASE-2006',
    status: 'approved',
    case_state: 'paid',
    claim_amount: 634.88,
    approved_amount: 634.88,
    actual_payout_amount: 634.88,
    recovered_amount: 634.88,
    filing_status: 'filed',
    recovery_status: 'reconciled',
    billing_status: 'charged',
    eligibility_status: 'SAFETY_HOLD',
    eligible_to_file: false,
    amazon_case_id: 'AMZ-ACME-42006',
    provider_case_id: 'AMZ-ACME-42006',
    order_id: detections[5].order_id,
    sku: detections[5].sku,
    asin: detections[5].asin,
    expected_payout_date: iso(-3),
    reconciled_at: iso(-3),
    billed_at: iso(-2),
    submission_date: iso(-18),
    resolution_date: iso(-4),
    evidence_attachments: decisionIntelligence({ eligibility: 'SAFETY_HOLD', requirements: ['document_type:invoice', 'unit_cost_proof'], operationalState: 'billing_complete' }),
    block_reasons: [],
    created_at: iso(-20),
    updated_at: iso(-2)
  },
  {
    id: '00000000-0000-0000-0000-000000003007',
    detection_result_id: detections[6].id,
    case_number: 'ACME-CASE-2007',
    status: 'rejected',
    case_state: 'rejected',
    claim_amount: 376.45,
    approved_amount: null,
    actual_payout_amount: null,
    recovered_amount: null,
    filing_status: 'failed',
    recovery_status: 'failed',
    billing_status: 'pending',
    eligibility_status: 'SAFETY_HOLD',
    eligible_to_file: false,
    amazon_case_id: 'AMZ-ACME-42007',
    provider_case_id: 'AMZ-ACME-42007',
    order_id: detections[6].order_id,
    sku: detections[6].sku,
    asin: detections[6].asin,
    rejection_reason: 'Amazon requested supplier proof inside the receiving window; current carrier document is outside the case period.',
    rejected_at: iso(-3),
    evidence_attachments: {
      ...decisionIntelligence({
        eligibility: 'SAFETY_HOLD',
        requirements: ['document_type:invoice', 'document_type:shipping'],
        operationalState: 'manual_review',
        missing: ['document_type:shipping'],
        blockReasons: ['evidence_window_mismatch']
      }),
      rejection_category: 'insufficient_evidence',
      raw_reason_text: 'Invoice and carrier proof did not match the reimbursement window.'
    },
    block_reasons: ['evidence_window_mismatch'],
    created_at: iso(-11),
    updated_at: iso(-3)
  },
  {
    id: '00000000-0000-0000-0000-000000003008',
    detection_result_id: detections[7].id,
    case_number: 'ACME-CASE-2008',
    status: 'review_needed',
    case_state: 'unlinked',
    claim_amount: 142.35,
    approved_amount: null,
    actual_payout_amount: null,
    recovered_amount: null,
    filing_status: 'duplicate_blocked',
    recovery_status: 'pending',
    billing_status: 'pending',
    eligibility_status: 'DUPLICATE_BLOCKED',
    eligible_to_file: false,
    amazon_case_id: null,
    provider_case_id: null,
    order_id: detections[7].order_id,
    sku: detections[7].sku,
    asin: detections[7].asin,
    evidence_attachments: decisionIntelligence({
      eligibility: 'DUPLICATE_BLOCKED',
      requirements: ['document_type:invoice'],
      operationalState: 'blocked',
      blockReasons: ['already_reimbursed_in_settlement']
    }),
    block_reasons: ['already_reimbursed_in_settlement'],
    created_at: iso(-10),
    updated_at: iso(-4)
  },
  {
    id: '00000000-0000-0000-0000-000000003011',
    detection_result_id: null,
    case_number: 'ACME-THREAD-2011',
    status: 'submitted',
    case_state: 'needs_evidence',
    claim_amount: 529.42,
    approved_amount: null,
    actual_payout_amount: null,
    recovered_amount: null,
    filing_status: 'filed',
    recovery_status: 'pending',
    billing_status: 'pending',
    eligibility_status: 'THREAD_ONLY',
    eligible_to_file: false,
    case_origin: 'amazon_thread_backfill',
    amazon_case_id: 'AMZ-ACME-42011',
    provider_case_id: 'AMZ-ACME-42011',
    order_id: '113-8841022-9946216',
    sku: 'ACME-THERMAL-BAG-BLU',
    asin: 'B0ACME0011',
    origin_metadata: { source: 'gmail_case_thread', matched_subject: 'Action required on reimbursement case AMZ-ACME-42011' },
    thread_backfilled_at: iso(-2),
    evidence_attachments: decisionIntelligence({
      eligibility: 'THREAD_ONLY',
      requirements: ['document_type:invoice', 'document_type:shipping'],
      operationalState: 'needs_evidence',
      missing: ['document_type:shipping'],
      blockReasons: ['amazon_thread_requested_more_evidence']
    }),
    block_reasons: ['amazon_thread_requested_more_evidence'],
    created_at: iso(-9),
    updated_at: iso(-2)
  }
];

function detectionRows() {
  return detections.map((row, index) => ({
    ...row,
    tenant_id: resolvedTenantId,
    seller_id: demoUserId,
    sync_id: syncId,
    currency: 'USD',
    store_id: index > 1 ? storeEuId : storeUsId,
    related_event_ids: [],
    timeline: [
      { id: `${row.claim_number}-detected`, date: row.discovery_date, action: 'detected', description: row.evidence.issue }
    ],
    created_at: iso(-20 + index),
    updated_at: iso(-5 + Math.min(index, 4))
  }));
}

function disputeRows() {
  return disputes.map((row) => ({
    ...row,
    tenant_id: resolvedTenantId,
    seller_id: demoUserId,
    currency: 'USD',
    case_type: 'amazon_fba',
    provider: 'amazon',
    store_id: row.sku === 'ACME-DESK-LAMP-OAK' || row.sku === 'ACME-AIR-FILTER-3PK' ? storeEuId : storeUsId,
    retry_count: 0,
    billing_retry_count: 0,
    platform_fee_cents: 0,
    seller_payout_cents: row.actual_payout_amount ? Math.round(Number(row.actual_payout_amount) * 100) : null,
    resolution_amount: row.approved_amount,
    case_origin: row.case_origin || 'detection_pipeline',
    origin_metadata: row.origin_metadata || {},
    deleted_at: null
  }));
}

function evidenceSources() {
  const managedTokenFields = {
    encrypted_access_token: 'managed-by-token-manager',
    encrypted_refresh_token: 'managed-by-token-manager'
  };

  return [
    {
      id: '00000000-0000-0000-0000-000000004001',
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      seller_id: sellerId,
      store_id: storeUsId,
      provider: 'amazon',
      status: 'connected',
      display_name: 'Acme Operations US FBA',
      account_email: sellerEmail,
      ...managedTokenFields,
      last_ingested_at: iso(-1),
      last_synced_at: iso(-1),
      last_sync_at: iso(-1),
      permissions: ['sellingpartnerapi::reports', 'sellingpartnerapi::notifications'],
      metadata: {
        demo_seed: true,
        marketplaces: ['US'],
        seller_id: sellerId,
        expires_at: iso(45)
      },
      created_at: iso(-28),
      updated_at: iso(-1)
    },
    {
      id: '00000000-0000-0000-0000-000000004002',
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      seller_id: demoUserId,
      provider: 'gmail',
      status: 'connected',
      display_name: 'Operations Gmail',
      account_email: 'claims@acme-operations.test',
      ...managedTokenFields,
      last_ingested_at: iso(-1),
      last_synced_at: iso(-1),
      last_sync_at: iso(-1),
      permissions: ['gmail.readonly'],
      metadata: { demo_seed: true, filters_loaded: true, expires_at: iso(30) },
      created_at: iso(-21),
      updated_at: iso(-1)
    },
    {
      id: '00000000-0000-0000-0000-000000004003',
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      seller_id: demoUserId,
      provider: 'gdrive',
      status: 'connected',
      display_name: 'Acme Evidence Drive',
      account_email: 'evidence@acme-operations.test',
      ...managedTokenFields,
      last_ingested_at: iso(-2),
      last_synced_at: iso(-2),
      last_sync_at: iso(-2),
      permissions: ['drive.readonly'],
      metadata: { demo_seed: true, folder: 'FBA Reimbursement Evidence', expires_at: iso(30) },
      created_at: iso(-20),
      updated_at: iso(-2)
    },
    {
      id: '00000000-0000-0000-0000-000000004004',
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      seller_id: demoUserId,
      provider: 'dropbox',
      status: 'connected',
      display_name: 'Acme Supplier Dropbox',
      account_email: 'warehouse@acme-operations.test',
      ...managedTokenFields,
      last_ingested_at: iso(-4),
      last_synced_at: iso(-4),
      last_sync_at: iso(-4),
      permissions: ['files.metadata.read', 'files.content.read'],
      metadata: { demo_seed: true, expires_at: iso(30) },
      created_at: iso(-18),
      updated_at: iso(-4)
    }
  ];
}

const evidenceDocSpecs = [
  ['00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004003', 'gdrive', 'invoice', 'Northstar Supply Co', 'INV-ACME-2001', 'ACME-TRAVEL-MUG-BLK', 'B0ACME0001', 486.2, -12],
  ['00000000-0000-0000-0000-000000004102', '00000000-0000-0000-0000-000000004002', 'gmail', 'shipping', 'BlueLine Freight', 'BOL-ACME-2001', 'ACME-TRAVEL-MUG-BLK', 'B0ACME0001', 486.2, -11],
  ['00000000-0000-0000-0000-000000004103', '00000000-0000-0000-0000-000000004003', 'gdrive', 'invoice', 'CableWorks Ltd', 'INV-ACME-2002', 'ACME-CABLE-USB3-6FT', 'B0ACME0002', 218.75, -10],
  ['00000000-0000-0000-0000-000000004104', '00000000-0000-0000-0000-000000004003', 'gdrive', 'invoice', 'Luma Home Goods', 'INV-ACME-2003', 'ACME-DESK-LAMP-OAK', 'B0ACME0003', 742.4, -9],
  ['00000000-0000-0000-0000-000000004105', '00000000-0000-0000-0000-000000004004', 'dropbox', 'invoice', 'PureAir Components', 'INV-ACME-2004', 'ACME-AIR-FILTER-3PK', 'B0ACME0004', 1184.5, -8],
  ['00000000-0000-0000-0000-000000004106', '00000000-0000-0000-0000-000000004002', 'gmail', 'shipping', 'Southdock Fulfillment', 'SHIP-ACME-2005', 'ACME-YOGA-MAT-SAGE', 'B0ACME0005', 963.1, -7],
  ['00000000-0000-0000-0000-000000004107', '00000000-0000-0000-0000-000000004003', 'gdrive', 'invoice', 'HomeCube Supply', 'INV-ACME-2006', 'ACME-STORAGE-BIN-L', 'B0ACME0006', 634.88, -6],
  ['00000000-0000-0000-0000-000000004108', '00000000-0000-0000-0000-000000004002', 'gmail', 'invoice', 'Brightline Electronics', 'INV-ACME-2007', 'ACME-LED-STRIP-16FT', 'B0ACME0007', 376.45, -5],
  ['00000000-0000-0000-0000-000000004109', '00000000-0000-0000-0000-000000004004', 'dropbox', 'invoice', 'DeskDirect Supply', 'INV-ACME-2009', 'ACME-BENTO-BOX-GRN', 'B0ACME0009', 311.28, -4],
  ['00000000-0000-0000-0000-000000004110', '00000000-0000-0000-0000-000000004003', 'gdrive', 'po', 'Acme Operations', 'PO-ACME-2011', 'ACME-THERMAL-BAG-BLU', 'B0ACME0011', 529.42, -3]
] as const;

function evidenceDocuments() {
  return evidenceDocSpecs.map(([id, sourceId, provider, docType, supplier, invoiceNumber, sku, asin, amount, days]) => ({
    id,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    seller_id: demoUserId,
    source_id: sourceId,
    external_id: `acme-doc-${invoiceNumber.toLowerCase()}`,
    provider,
    doc_type: docType,
    supplier_name: supplier,
    invoice_number: invoiceNumber,
    purchase_order_number: invoiceNumber.startsWith('PO') ? invoiceNumber : null,
    document_date: iso(days),
    currency: 'USD',
    total_amount: amount,
    file_url: `demo://acme/${invoiceNumber}.pdf`,
    filename: `${invoiceNumber}.pdf`,
    original_filename: `${invoiceNumber}.pdf`,
    file_size: 220000 + Math.round(amount * 10),
    size_bytes: 220000 + Math.round(amount * 10),
    mime_type: 'application/pdf',
    content_type: 'application/pdf',
    storage_path: `demo/acme-operations/${invoiceNumber}.pdf`,
    raw_text: `${supplier} ${invoiceNumber} for SKU ${sku} ASIN ${asin}. Unit cost proof and shipment identifiers captured for reimbursement support.`,
    extracted: {
      items: [{ sku, asin, quantity: Math.max(1, Math.round(Number(amount) / 80)), unit_cost: Number((Number(amount) / Math.max(1, Math.round(Number(amount) / 80))).toFixed(2)) }]
    },
    parsed_metadata: {
      parser_status: 'completed',
      confidence: 0.97,
      items: [{ sku, asin, quantity: Math.max(1, Math.round(Number(amount) / 80)), unit_cost: Number((Number(amount) / Math.max(1, Math.round(Number(amount) / 80))).toFixed(2)) }],
      identifiers: { sku, asin, invoiceNumber }
    },
    parser_status: 'completed',
    parser_confidence: 0.97,
    parser_started_at: iso(days, 1),
    parser_completed_at: iso(days, 2),
    parsed_at: iso(days, 2),
    ingested_at: iso(days, 1),
    unit_manufacturing_cost: Number((Number(amount) / Math.max(1, Math.round(Number(amount) / 80))).toFixed(4)),
    metadata: {
      demo_seed: true,
      ingestion_method: 'acme_operations_demo_seed',
      original_filename: `${invoiceNumber}.pdf`
    },
    created_at: iso(days),
    updated_at: iso(days, 2)
  }));
}

function evidenceLinks() {
  const pairs = [
    ['00000000-0000-0000-0000-000000006001', disputes[0].id, '00000000-0000-0000-0000-000000004101', 0.98],
    ['00000000-0000-0000-0000-000000006002', disputes[0].id, '00000000-0000-0000-0000-000000004102', 0.95],
    ['00000000-0000-0000-0000-000000006003', disputes[1].id, '00000000-0000-0000-0000-000000004103', 0.92],
    ['00000000-0000-0000-0000-000000006004', disputes[2].id, '00000000-0000-0000-0000-000000004104', 0.91],
    ['00000000-0000-0000-0000-000000006005', disputes[3].id, '00000000-0000-0000-0000-000000004105', 0.96],
    ['00000000-0000-0000-0000-000000006006', disputes[4].id, '00000000-0000-0000-0000-000000004106', 0.97],
    ['00000000-0000-0000-0000-000000006007', disputes[5].id, '00000000-0000-0000-0000-000000004107', 0.94],
    ['00000000-0000-0000-0000-000000006008', disputes[6].id, '00000000-0000-0000-0000-000000004108', 0.57],
    ['00000000-0000-0000-0000-000000006009', disputes[8].id, '00000000-0000-0000-0000-000000004110', 0.72]
  ] as const;

  return pairs.map(([id, dispute_case_id, evidence_document_id, relevance_score]) => ({
    id,
    tenant_id: resolvedTenantId,
    dispute_case_id,
    evidence_document_id,
    relevance_score,
    link_type: relevance_score > 0.9 ? 'automatic' : 'suggested',
    matched_context: {
      demo_seed: true,
      matched_identifiers: ['sku', 'asin', 'invoice_number'],
      confidence_label: relevance_score > 0.9 ? 'high' : 'needs_review'
    },
    created_at: iso(-2)
  }));
}

function disputeSubmissions() {
  return disputes
    .filter((row) => row.amazon_case_id)
    .map((row, index) => ({
      id: `00000000-0000-0000-0000-0000000070${String(index + 1).padStart(2, '0')}`,
      tenant_id: resolvedTenantId,
      dispute_id: row.id,
      user_id: demoUserId,
      seller_id: demoUserId,
      submission_id: `SUB-ACME-${2003 + index}`,
      amazon_case_id: row.amazon_case_id,
      external_reference: row.amazon_case_id,
      idempotency_key: `acme-submission-${row.case_number}`,
      status: row.status === 'rejected' ? 'rejected' : row.status === 'approved' ? 'approved' : 'submitted',
      outcome: row.case_state === 'paid' ? 'approved' : row.case_state || 'submitted',
      request_started_at: iso(-8 + index),
      response_received_at: row.status === 'approved' || row.status === 'rejected' ? iso(-4 + index) : iso(-7 + index),
      submission_channel: 'seller_central_manual',
      request_summary: { case_number: row.case_number, amount_claimed: row.claim_amount },
      response_summary: { amazon_case_id: row.amazon_case_id, status: row.case_state || row.status },
      attachment_manifest: [{ filename: `${row.case_number}-proof.pdf`, document_count: 2 }],
      order_id: row.order_id,
      asin: row.asin,
      sku: row.sku,
      claim_type: 'amazon_fba',
      amount_claimed: row.claim_amount,
      amount_approved: row.approved_amount,
      currency: 'USD',
      confidence_score: 0.9,
      submission_timestamp: iso(-8 + index),
      resolution_timestamp: row.status === 'approved' || row.status === 'rejected' ? iso(-4 + index) : null,
      metadata: { demo_seed: true },
      created_at: iso(-8 + index),
      updated_at: iso(-4 + index)
    }));
}

function financialEvents() {
  const baseEvents = detections.slice(0, 8).map((detection, index) => ({
    id: `00000000-0000-0000-0000-0000000080${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    seller_id: demoUserId,
    event_type: index % 2 === 0 ? 'fee' : 'shipment',
    event_subtype: detection.anomaly_type,
    amount: Number((-Math.max(24.5, Number(detection.estimated_value) * 0.18)).toFixed(2)),
    currency: 'USD',
    raw_payload: {
      demo_seed: true,
      sku: detection.sku,
      asin: detection.asin,
      anomaly_type: detection.anomaly_type
    },
    amazon_event_id: `ACME-FEE-${2001 + index}`,
    amazon_order_id: detection.order_id,
    amazon_sku: detection.sku,
    sku: detection.sku,
    asin: detection.asin,
    store_id: index > 1 ? storeEuId : storeUsId,
    sync_id: syncId,
    source: 'sp_api',
    description: `Amazon financial event supporting ${detection.claim_number}`,
    reference_id: detection.claim_number,
    reference_type: 'detection_result',
    settlement_id: `SETTLE-ACME-${index + 1}`,
    is_payout_event: false,
    event_date: iso(-18 + index),
    created_at: iso(-18 + index),
    updated_at: iso(-18 + index)
  }));

  const payoutEvents = [
    { id: '00000000-0000-0000-0000-000000008101', dispute: disputes[4], amount: 963.1, date: -1, settlement: 'SETTLE-ACME-PAYOUT-01' },
    { id: '00000000-0000-0000-0000-000000008102', dispute: disputes[5], amount: 634.88, date: -3, settlement: 'SETTLE-ACME-PAYOUT-02' }
  ].map(({ id, dispute, amount, date, settlement }) => ({
    id,
    tenant_id: resolvedTenantId,
    seller_id: demoUserId,
    event_type: 'reimbursement',
    event_subtype: 'amazon_case_reimbursement',
    amount,
    currency: 'USD',
    raw_payload: {
      demo_seed: true,
      amazon_case_id: dispute.amazon_case_id,
      case_number: dispute.case_number,
      proof: 'settlement_report'
    },
    amazon_event_id: `REIMB-${dispute.amazon_case_id}`,
    amazon_order_id: dispute.order_id,
    amazon_sku: dispute.sku,
    sku: dispute.sku,
    asin: dispute.asin,
    store_id: dispute.sku === 'ACME-STORAGE-BIN-L' ? storeUsId : storeUsId,
    sync_id: syncId,
    source: 'sp_api',
    description: `Verified reimbursement for ${dispute.case_number}`,
    reference_id: dispute.amazon_case_id,
    reference_type: 'amazon_case_id',
    settlement_id: settlement,
    payout_batch_id: `PAYOUT-${settlement}`,
    is_payout_event: true,
    event_date: iso(date),
    created_at: iso(date),
    updated_at: iso(date)
  }));

  return [...baseEvents, ...payoutEvents];
}

function stores() {
  return [
    {
      id: storeUsId,
      tenant_id: resolvedTenantId,
      name: 'Acme Operations US FBA',
      marketplace: 'ATVPDKIKX0DER',
      seller_id: sellerId,
      is_active: true,
      automation_enabled: true,
      metadata: {
        demo_seed: true,
        marketplace_country: 'US',
        health: 'connected',
        last_sync_id: syncId
      },
      created_at: iso(-30),
      updated_at: iso(-1)
    },
    {
      id: storeEuId,
      tenant_id: resolvedTenantId,
      name: 'Acme Operations EU FBA',
      marketplace: 'A1F83G8C2ARO7P',
      seller_id: `${sellerId}-EU`,
      is_active: true,
      automation_enabled: true,
      metadata: {
        demo_seed: true,
        marketplace_country: 'UK',
        health: 'connected',
        last_sync_id: syncId
      },
      created_at: iso(-29),
      updated_at: iso(-2)
    }
  ];
}

function tokens() {
  const amazonToken = {
    id: '00000000-0000-0000-0000-000000009001',
    tenant_id: resolvedTenantId,
    store_id: storeUsId,
    user_id: demoUserId,
    provider: 'amazon',
    access_token_iv: 'acme-demo-iv',
    access_token_data: 'acme-demo-access-token-not-for-api-use',
    refresh_token_iv: 'acme-demo-iv',
    refresh_token_data: 'acme-demo-refresh-token-not-for-api-use',
    token_type: 'Bearer',
    scope: 'sellingpartnerapi::reports sellingpartnerapi::notifications',
    expires_at: iso(45),
    is_active: true,
    created_at: iso(-28),
    updated_at: iso(-1)
  };

  if (!shouldOverwriteUserTokens) {
    return [amazonToken];
  }

  return [
    amazonToken,
    {
      id: '00000000-0000-0000-0000-000000009002',
      tenant_id: resolvedTenantId,
      store_id: null,
      user_id: demoUserId,
      provider: 'gmail',
      access_token_iv: 'acme-demo-iv',
      access_token_data: 'acme-demo-gmail-token-not-for-api-use',
      refresh_token_iv: 'acme-demo-iv',
      refresh_token_data: 'acme-demo-gmail-refresh-token-not-for-api-use',
      token_type: 'Bearer',
      scope: 'gmail.readonly',
      expires_at: iso(30),
      is_active: true,
      created_at: iso(-21),
      updated_at: iso(-1)
    },
    {
      id: '00000000-0000-0000-0000-000000009003',
      tenant_id: resolvedTenantId,
      store_id: null,
      user_id: demoUserId,
      provider: 'gdrive',
      access_token_iv: 'acme-demo-iv',
      access_token_data: 'acme-demo-gdrive-token-not-for-api-use',
      refresh_token_iv: 'acme-demo-iv',
      refresh_token_data: 'acme-demo-gdrive-refresh-token-not-for-api-use',
      token_type: 'Bearer',
      scope: 'drive.readonly',
      expires_at: iso(30),
      is_active: true,
      created_at: iso(-20),
      updated_at: iso(-2)
    },
    {
      id: '00000000-0000-0000-0000-000000009004',
      tenant_id: resolvedTenantId,
      store_id: null,
      user_id: demoUserId,
      provider: 'dropbox',
      access_token_iv: 'acme-demo-iv',
      access_token_data: 'acme-demo-dropbox-token-not-for-api-use',
      refresh_token_iv: 'acme-demo-iv',
      refresh_token_data: 'acme-demo-dropbox-refresh-token-not-for-api-use',
      token_type: 'Bearer',
      scope: 'files.metadata.read files.content.read',
      expires_at: iso(30),
      is_active: true,
      created_at: iso(-18),
      updated_at: iso(-4)
    }
  ];
}

function recoveries() {
  return [
    {
      id: '00000000-0000-0000-0000-000000010001',
      tenant_id: resolvedTenantId,
      dispute_id: disputes[4].id,
      user_id: demoUserId,
      amazon_case_id: 'AMZ-ACME-42005',
      expected_amount: 963.1,
      actual_amount: 963.1,
      discrepancy: 0,
      reconciliation_status: 'reconciled',
      payout_date: iso(-1),
      amazon_reimbursement_id: 'REIMB-ACME-42005',
      matched_at: iso(-1, -4),
      reconciled_at: iso(-1, -3),
      created_at: iso(-1, -4),
      updated_at: iso(-1, -3)
    },
    {
      id: '00000000-0000-0000-0000-000000010002',
      tenant_id: resolvedTenantId,
      dispute_id: disputes[5].id,
      user_id: demoUserId,
      amazon_case_id: 'AMZ-ACME-42006',
      expected_amount: 634.88,
      actual_amount: 634.88,
      discrepancy: 0,
      reconciliation_status: 'reconciled',
      payout_date: iso(-3),
      amazon_reimbursement_id: 'REIMB-ACME-42006',
      matched_at: iso(-3, -2),
      reconciled_at: iso(-3, -1),
      created_at: iso(-3, -2),
      updated_at: iso(-3, -1)
    }
  ];
}

function billingTransactions() {
  return [
    {
      id: '00000000-0000-0000-0000-000000010101',
      tenant_id: resolvedTenantId,
      dispute_id: disputes[4].id,
      recovery_id: '00000000-0000-0000-0000-000000010001',
      user_id: demoUserId,
      amount_recovered_cents: 96310,
      platform_fee_cents: 0,
      seller_payout_cents: 96310,
      credit_applied_cents: 0,
      amount_due_cents: 0,
      credit_balance_after_cents: 0,
      currency: 'usd',
      billing_status: 'credited',
      billing_type: 'success_fee',
      provider: 'paypal',
      idempotency_key: 'acme-billing-42005',
      metadata: { demo_seed: true, flat_subscription_truth: true, note: 'No recovery commission charged.' },
      created_at: iso(-1),
      updated_at: iso(-1)
    },
    {
      id: '00000000-0000-0000-0000-000000010102',
      tenant_id: resolvedTenantId,
      dispute_id: disputes[5].id,
      recovery_id: '00000000-0000-0000-0000-000000010002',
      user_id: demoUserId,
      amount_recovered_cents: 63488,
      platform_fee_cents: 0,
      seller_payout_cents: 63488,
      credit_applied_cents: 0,
      amount_due_cents: 0,
      credit_balance_after_cents: 0,
      currency: 'usd',
      billing_status: 'charged',
      billing_type: 'success_fee',
      provider: 'paypal',
      idempotency_key: 'acme-billing-42006',
      metadata: { demo_seed: true, flat_subscription_truth: true, note: 'Legacy recovery fee row retained with zero fee.' },
      created_at: iso(-2),
      updated_at: iso(-2)
    }
  ];
}

function workItems() {
  const recoveryRows = [
    [disputes[3].id, 'pending', 'approval_webhook', null, { lifecycle_state: 'approved_waiting_for_payout', operational_state: 'pending', operational_explanation: 'Waiting for reimbursement event in settlement feed.' }],
    [disputes[4].id, 'completed', 'financial_event', iso(-1), { lifecycle_state: 'reconciled', operational_state: 'completed', match_explanation: 'Amazon reimbursement matched by case id and SKU.' }],
    [disputes[5].id, 'completed', 'financial_event', iso(-3), { lifecycle_state: 'reconciled', operational_state: 'completed', match_explanation: 'Amazon reimbursement matched by case id and order id.' }]
  ] as const;

  const recoveryWork = recoveryRows.map(([disputeId, status, source, completedAt, payload], index) => ({
    id: `00000000-0000-0000-0000-0000000102${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    tenant_slug: tenantSlug,
    user_id: demoUserId,
    dispute_case_id: disputeId,
    source_event_type: source,
    source_event_id: `acme-recovery-event-${index + 1}`,
    idempotency_key: `acme-recovery-work-${disputeId}`,
    status,
    attempts: status === 'completed' ? 1 : 0,
    max_attempts: 5,
    next_attempt_at: status === 'pending' ? iso(1) : iso(-1),
    locked_by: status === 'completed' ? 'recoveries-lane' : null,
    payload,
    completed_at: completedAt,
    created_at: iso(-5 + index),
    updated_at: completedAt || iso(-1)
  }));

  const billingWork = [
    {
      id: '00000000-0000-0000-0000-000000010301',
      tenant_id: resolvedTenantId,
      tenant_slug: tenantSlug,
      user_id: demoUserId,
      dispute_case_id: disputes[5].id,
      recovery_id: '00000000-0000-0000-0000-000000010002',
      source_event_type: 'recovery_reconciled',
      source_event_id: 'acme-billing-event-1',
      idempotency_key: `acme-billing-work-${disputes[5].id}`,
      status: 'completed',
      attempts: 1,
      max_attempts: 5,
      next_attempt_at: iso(-2),
      locked_by: 'billing-lane',
      payload: {
        lifecycle_state: 'flat_subscription_checked',
        operational_state: 'completed',
        operational_explanation: 'Recovered cash confirmed. Flat subscription model means no success fee invoice.'
      },
      completed_at: iso(-2),
      created_at: iso(-2),
      updated_at: iso(-2)
    }
  ];

  return { recoveryWork, billingWork };
}

function billingSubscriptionAndInvoices() {
  const subscriptionId = '00000000-0000-0000-0000-000000011001';
  const subscription = {
    id: subscriptionId,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    billing_model: 'flat_subscription',
    plan_tier: 'pro',
    billing_interval: 'monthly',
    monthly_price_cents: 19900,
    annual_monthly_equivalent_price_cents: 19900,
    billing_amount_cents: 19900,
    billing_currency: 'USD',
    promo_start_at: iso(-18),
    promo_end_at: iso(42),
    promo_type: 'keep_100_percent_recoveries_60_days',
    subscription_status: 'active',
    current_period_start_at: iso(-10),
    current_period_end_at: iso(20),
    next_billing_date: iso(20),
    billing_provider: 'yoco',
    billing_customer_id: 'yoco_cus_acme_demo',
    billing_subscription_id: 'yoco_sub_acme_demo',
    legacy_recovery_billing_disabled_at: iso(-18),
    metadata: { demo_seed: true, plan_label: 'Pro', keep_100_percent_recoveries: true },
    created_at: iso(-18),
    updated_at: iso(-1)
  };

  const invoices = [
    {
      id: '00000000-0000-0000-0000-000000011101',
      invoice_id: 'SUB-PRO-20260401-ACMEDEMO',
      payment_reference: 'SUB-PRO-20260401-ACMEDEMO',
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      subscription_id: subscriptionId,
      invoice_type: 'subscription_invoice',
      invoice_model: 'subscription',
      billing_model: 'flat_subscription',
      plan_tier: 'pro',
      billing_interval: 'monthly',
      billing_amount_cents: 19900,
      amount_charged_cents: 19900,
      currency: 'USD',
      billing_period_start: iso(-40),
      billing_period_end: iso(-10),
      invoice_date: iso(-40),
      due_date: iso(-35),
      paid_at: iso(-39),
      subscription_status_snapshot: 'active',
      promo_type: 'keep_100_percent_recoveries_60_days',
      promo_note: 'First 60 days: you keep 100% of recoveries. Subscription pricing remains flat with no commissions.',
      provider: 'yoco',
      provider_invoice_id: 'yoco_inv_acme_001',
      provider_charge_id: 'yoco_charge_acme_001',
      payment_provider: 'yoco',
      payment_link_key: 'pro_monthly',
      payment_link_url: 'https://pay.yoco.com/acme-demo-pro-monthly',
      payment_confirmation_source: 'manual_dashboard',
      payment_confirmed_by_user_id: demoUserId,
      payment_confirmation_note: 'Demo invoice marked paid for Acme Operations.',
      status: 'paid',
      metadata: { demo_seed: true },
      created_at: iso(-40),
      updated_at: iso(-39)
    },
    {
      id: '00000000-0000-0000-0000-000000011102',
      invoice_id: 'SUB-PRO-20260501-ACMEDEMO',
      payment_reference: 'SUB-PRO-20260501-ACMEDEMO',
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      subscription_id: subscriptionId,
      invoice_type: 'subscription_invoice',
      invoice_model: 'subscription',
      billing_model: 'flat_subscription',
      plan_tier: 'pro',
      billing_interval: 'monthly',
      billing_amount_cents: 19900,
      amount_charged_cents: null,
      currency: 'USD',
      billing_period_start: iso(-10),
      billing_period_end: iso(20),
      invoice_date: iso(-10),
      due_date: iso(20),
      paid_at: null,
      subscription_status_snapshot: 'active',
      promo_type: 'keep_100_percent_recoveries_60_days',
      promo_note: 'First 60 days: you keep 100% of recoveries. Subscription pricing remains flat with no commissions.',
      provider: 'yoco',
      provider_invoice_id: 'yoco_inv_acme_002',
      provider_charge_id: null,
      payment_provider: 'yoco',
      payment_link_key: 'pro_monthly',
      payment_link_url: 'https://pay.yoco.com/acme-demo-pro-monthly',
      payment_confirmation_source: null,
      payment_confirmed_by_user_id: null,
      payment_confirmation_note: null,
      status: 'sent',
      metadata: { demo_seed: true },
      created_at: iso(-10),
      updated_at: iso(-1)
    }
  ];

  return { subscription, invoices };
}

function sourceDataRows() {
  const skus = [
    ['ACME-TRAVEL-MUG-BLK', 'B0ACME0001', 'Insulated Travel Mug - Black', 24.99, 184],
    ['ACME-CABLE-USB3-6FT', 'B0ACME0002', 'USB-C Cable 6ft', 14.99, 611],
    ['ACME-DESK-LAMP-OAK', 'B0ACME0003', 'Oak Desk Lamp', 49.99, 77],
    ['ACME-AIR-FILTER-3PK', 'B0ACME0004', 'HEPA Air Filter 3 Pack', 39.99, 142],
    ['ACME-YOGA-MAT-SAGE', 'B0ACME0005', 'Yoga Mat - Sage', 32.99, 203],
    ['ACME-STORAGE-BIN-L', 'B0ACME0006', 'Large Storage Bin', 27.5, 96],
    ['ACME-LED-STRIP-16FT', 'B0ACME0007', 'LED Strip 16ft', 21.99, 258],
    ['ACME-PHONE-STAND-WHT', 'B0ACME0008', 'Phone Stand - White', 16.49, 332]
  ] as const;

  const productCatalog = skus.map(([sku, asin, item_name, price, quantity], index) => ({
    id: `00000000-0000-0000-0000-0000000120${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    seller_id: sellerId,
    sku,
    asin,
    item_name,
    price,
    quantity,
    fulfillment_channel: 'FBA',
    item_condition: 'New',
    length_cm: 18 + index,
    width_cm: 10 + index,
    height_cm: 6 + index,
    weight_kg: Number((0.25 + index * 0.08).toFixed(4)),
    category: index % 2 === 0 ? 'Home & Kitchen' : 'Electronics',
    size_tier: index > 2 ? 'STANDARD' : 'SMALL_STANDARD',
    last_synced: iso(-1),
    created_at: iso(-20 + index),
    updated_at: iso(-1)
  }));

  const inventoryItems = skus.map(([sku, asin, product_name, price, quantity], index) => ({
    id: `00000000-0000-0000-0000-0000000121${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    store_id: index > 2 ? storeEuId : storeUsId,
    sku,
    asin,
    fnsku: `X00ACME${String(index + 1).padStart(3, '0')}`,
    product_name,
    condition_type: 'New',
    quantity_available: quantity,
    quantity_reserved: 11 + index,
    quantity_inbound: index % 2 === 0 ? 48 : 22,
    price,
    dimensions: { length_cm: 18 + index, width_cm: 10 + index, height_cm: 6 + index },
    sync_id: syncId,
    source: 'sp_api',
    created_at: iso(-18 + index),
    updated_at: iso(-1)
  }));

  const orders = skus.slice(0, 6).map(([sku, asin, product_name, price], index) => ({
    id: `00000000-0000-0000-0000-0000000122${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    store_id: index > 2 ? storeEuId : storeUsId,
    order_id: detections[index].order_id,
    seller_id: sellerId,
    marketplace_id: index > 2 ? 'A1F83G8C2ARO7P' : 'ATVPDKIKX0DER',
    order_date: iso(-22 + index),
    order_status: 'Shipped',
    fulfillment_channel: 'FBA',
    total_amount: Number((Number(price) * (3 + index)).toFixed(2)),
    currency: 'USD',
    items: [{ sku, asin, title: product_name, quantity: 3 + index, item_price: price }],
    quantities: { [sku]: 3 + index },
    sync_id: syncId,
    source: 'sp_api',
    is_sandbox: false,
    metadata: { demo_seed: true },
    created_at: iso(-22 + index),
    updated_at: iso(-1)
  }));

  const shipments = skus.slice(0, 6).map(([sku, asin, product_name], index) => ({
    id: `00000000-0000-0000-0000-0000000123${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    store_id: index > 2 ? storeEuId : storeUsId,
    shipment_id: `FBA17ACME00${index + 1}`,
    order_id: detections[index].order_id,
    shipped_date: iso(-24 + index),
    received_date: iso(-20 + index),
    status: index === 0 ? 'RECEIVED_WITH_DISCREPANCY' : 'RECEIVED',
    carrier: index % 2 === 0 ? 'UPS' : 'FedEx',
    tracking_number: `1ZACME${index + 1}DEMO`,
    warehouse_location: index > 2 ? 'LHR3' : 'ONT8',
    items: [{ sku, asin, title: product_name, shipped_quantity: 60 + index * 6 }],
    shipped_quantity: 60 + index * 6,
    received_quantity: index === 0 ? 46 : 60 + index * 6,
    missing_quantity: index === 0 ? 14 : 0,
    metadata: { demo_seed: true },
    sync_id: syncId,
    source: 'sp_api',
    is_sandbox: false,
    created_at: iso(-24 + index),
    updated_at: iso(-1)
  }));

  const returns = skus.slice(2, 7).map(([sku, asin, product_name, price], index) => ({
    id: `00000000-0000-0000-0000-0000000124${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    store_id: index > 1 ? storeEuId : storeUsId,
    return_id: `RET-ACME-${3000 + index}`,
    order_id: detections[index + 2]?.order_id || `113-ACME-RETURN-${index}`,
    reason: index % 2 === 0 ? 'CUSTOMER_DAMAGED' : 'CUSTOMER_REQUEST',
    returned_date: iso(-14 + index),
    status: 'RECEIVED',
    refund_amount: Number((Number(price) * (1 + index)).toFixed(2)),
    currency: 'USD',
    items: [{ sku, asin, title: product_name, quantity: 1 + index }],
    is_partial: index % 2 === 1,
    metadata: { demo_seed: true },
    sync_id: syncId,
    source: 'sp_api',
    is_sandbox: false,
    created_at: iso(-14 + index),
    updated_at: iso(-1)
  }));

  const settlements = skus.slice(0, 7).map(([sku, asin, product_name, price], index) => ({
    id: `00000000-0000-0000-0000-0000000125${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    store_id: index > 2 ? storeEuId : storeUsId,
    settlement_id: `SETTLE-ACME-${100 + index}`,
    order_id: detections[index]?.order_id || `113-ACME-SETTLE-${index}`,
    transaction_type: index > 4 ? 'Reimbursement' : 'Order',
    amount: index > 4 ? Number(disputes[index]?.actual_payout_amount || price) : Number((Number(price) * (4 + index)).toFixed(2)),
    fees: Number((Number(price) * 0.16).toFixed(2)),
    currency: 'USD',
    settlement_date: iso(-12 + index),
    fee_breakdown: { fba_fee: Number((Number(price) * 0.11).toFixed(2)), referral_fee: Number((Number(price) * 0.05).toFixed(2)) },
    metadata: { demo_seed: true, product_name },
    sync_id: syncId,
    source: 'sp_api',
    is_sandbox: false,
    created_at: iso(-12 + index),
    updated_at: iso(-1)
  }));

  const inventoryLedger = skus.map(([sku, asin, title], index) => ({
    id: `00000000-0000-0000-0000-0000000126${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    seller_id: sellerId,
    event_date: iso(-16 + index),
    fnsku: `X00ACME${String(index + 1).padStart(3, '0')}`,
    asin,
    sku,
    title,
    event_type: index === 0 ? 'Adjustments' : 'Receipts',
    reference_id: index === 0 ? 'FBA17ACME001' : `FBA17ACME00${index + 1}`,
    quantity: index === 0 ? -14 : 60 + index,
    fulfillment_center: index > 2 ? 'LHR3' : 'ONT8',
    disposition: index === 0 ? 'MISSING' : 'SELLABLE',
    reason_code: index === 0 ? 'MISSING_FROM_INBOUND' : 'RECEIVED',
    country: index > 2 ? 'GB' : 'US',
    created_at: iso(-16 + index),
    updated_at: iso(-1)
  }));

  return { productCatalog, inventoryItems, orders, shipments, returns, settlements, inventoryLedger };
}

function syncProgressRows() {
  return [
    {
      id: '00000000-0000-0000-0000-000000013001',
      tenant_id: resolvedTenantId,
      store_id: storeUsId,
      user_id: demoUserId,
      sync_id: syncId,
      step: 5,
      total_steps: 5,
      current_step: 'Acme Operations data synced and analyzed',
      status: 'completed',
      progress: 100,
      metadata: {
        ordersProcessed: 1842,
        totalOrders: 1842,
        inventoryCount: 8,
        shipmentsCount: 128,
        returnsCount: 43,
        settlementsCount: 31,
        feesCount: 612,
        claimsDetected: 10,
        partialSuccess: false,
        reportIdentifiers: ['GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL', 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA'],
        requestIdentifiers: ['RPT-ACME-001', 'RPT-ACME-002']
      },
      sync_fingerprint: 'acme-demo-sync-fingerprint',
      last_successful_sync_at: iso(-1),
      coverage: [{ entity: 'orders', complete: true }, { entity: 'settlements', complete: true }, { entity: 'inventory', complete: true }],
      coverage_complete: true,
      created_at: iso(-1, -3),
      updated_at: iso(-1)
    }
  ];
}

function notifications() {
  const rows = [
    ['claim_detected', 'New reimbursement opportunity', 'Acme Operations has 10 new reimbursement findings ready for review.', 'high', false, disputes[0].id],
    ['evidence_found', 'Evidence matched', 'Invoice and carrier proof matched ACME-CASE-2001 with high confidence.', 'normal', false, disputes[0].id],
    ['case_filed', 'Case filed with Amazon', 'ACME-CASE-2003 was filed and is awaiting Amazon review.', 'normal', true, disputes[2].id],
    ['refund_approved', 'Reimbursement approved', 'Amazon approved ACME-CASE-2004 for $1,184.50.', 'high', false, disputes[3].id],
    ['funds_deposited', 'Funds deposited', 'A verified reimbursement of $963.10 landed for ACME-CASE-2005.', 'high', false, disputes[4].id],
    ['claim_denied', 'Evidence window mismatch', 'ACME-CASE-2007 needs review after Amazon rejected the first packet.', 'normal', true, disputes[6].id],
    ['sync_completed', 'Amazon sync complete', 'Latest Acme Operations sync processed 1,842 orders and 612 fee events.', 'normal', true, syncId],
    ['payment_processed', 'Subscription invoice paid', 'The April Pro subscription invoice was marked paid.', 'low', true, 'SUB-PRO-20260401-ACMEDEMO']
  ] as const;

  return rows.map(([type, title, message, priority, read, entityId], index) => ({
    id: `00000000-0000-0000-0000-0000000140${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    type,
    title,
    message,
    status: read ? 'read' : 'delivered',
    priority,
    channel: 'in_app',
    payload: {
      tenant_slug: tenantSlug,
      entity_id: entityId,
      demo_seed: true
    },
    dedupe_key: `acme-demo:${type}:${entityId}`,
    delivery_state: {
      in_app_requested: true,
      in_app_success: true,
      realtime_requested: true,
      realtime_success: true,
      email_requested: false,
      derived_state: read ? 'read' : 'delivered',
      attempted_at: iso(-index)
    },
    read_at: read ? iso(-index) : null,
    delivered_at: iso(-index),
    expires_at: iso(30),
    created_at: iso(-index - 1),
    updated_at: iso(-index)
  }));
}

function recentPlatformEvents() {
  const events = [
    ['sync_completed', 'sync', syncId, { claimsDetected: 10, ordersProcessed: 1842 }],
    ['claim_detected', 'detection_result', detections[0].id, { claim_number: detections[0].claim_number, amount: 486.2 }],
    ['evidence_found', 'evidence_document', '00000000-0000-0000-0000-000000004101', { case_number: 'ACME-CASE-2001', confidence: 0.98 }],
    ['case_filed', 'dispute_case', disputes[2].id, { amazon_case_id: 'AMZ-ACME-42003' }],
    ['approved', 'dispute_case', disputes[3].id, { amount: 1184.5 }],
    ['paid', 'dispute_case', disputes[4].id, { amount: 963.1 }]
  ] as const;

  return events.map(([event_type, entity_type, entity_id, payload], index) => ({
    user_id: demoUserId,
    tenant_id: resolvedTenantId,
    tenant_slug: tenantSlug,
    event_type,
    entity_type,
    entity_id,
    payload: { ...payload, tenant_slug: tenantSlug, demo_seed: true },
    created_at: iso(-index)
  }));
}

function proofPacketsAndPrompts() {
  const proofPackets = [
    {
      id: '00000000-0000-0000-0000-000000015001',
      tenant_id: resolvedTenantId,
      seller_id: demoUserId,
      dispute_case_id: disputes[0].id,
      packet_url: 'demo://proof-packets/acme-case-2001.pdf',
      summary: {
        demo_seed: true,
        case_number: 'ACME-CASE-2001',
        documents: ['INV-ACME-2001.pdf', 'BOL-ACME-2001.pdf'],
        readiness: 'filing_ready'
      },
      created_at: iso(-1)
    },
    {
      id: '00000000-0000-0000-0000-000000015002',
      tenant_id: resolvedTenantId,
      seller_id: demoUserId,
      dispute_case_id: disputes[3].id,
      packet_url: 'demo://proof-packets/acme-case-2004.pdf',
      summary: {
        demo_seed: true,
        case_number: 'ACME-CASE-2004',
        documents: ['INV-ACME-2004.pdf'],
        readiness: 'approved'
      },
      created_at: iso(-5)
    }
  ];

  const smartPrompts = [
    {
      id: '00000000-0000-0000-0000-000000015101',
      tenant_id: resolvedTenantId,
      seller_id: demoUserId,
      status: 'open',
      prompt_type: 'evidence_selection',
      question: 'Select the carrier proof that matches AMZ-ACME-42011.',
      options: [
        { id: 'doc-po', label: 'PO-ACME-2011.pdf', evidence_document_id: '00000000-0000-0000-0000-000000004110' },
        { id: 'upload-new', label: 'Upload matching carrier proof' }
      ],
      related_dispute_id: disputes[8].id,
      metadata: { demo_seed: true, case_number: 'ACME-THREAD-2011' },
      created_at: iso(-2)
    }
  ];

  return { proofPackets, smartPrompts };
}

function matchResults() {
  return evidenceLinks().map((link, index) => ({
    id: `00000000-0000-0000-0000-0000000152${String(index + 1).padStart(2, '0')}`,
    tenant_id: resolvedTenantId,
    user_id: demoUserId,
    seller_id: demoUserId,
    claim_id: disputes.find((dispute) => dispute.id === link.dispute_case_id)?.detection_result_id || detections[0].id,
    document_id: link.evidence_document_id,
    match_type: 'sku_asin_invoice',
    matched_fields: ['sku', 'asin', 'invoice_number'],
    confidence_score: link.relevance_score,
    rule_score: link.relevance_score,
    action_taken: link.relevance_score >= 0.85 ? 'auto_submit' : 'smart_prompt',
    reasoning: 'Demo match created from Acme Operations invoice and shipment identifiers.',
    status: link.relevance_score >= 0.85 ? 'approved' : 'pending',
    metadata: { demo_seed: true },
    created_at: iso(-2),
    updated_at: iso(-1)
  }));
}

function caseMessages() {
  return [
    {
      id: '00000000-0000-0000-0000-000000015301',
      tenant_id: resolvedTenantId,
      dispute_case_id: disputes[3].id,
      amazon_case_id: 'AMZ-ACME-42004',
      provider: 'gmail',
      provider_message_id: 'gmail-acme-42004-approved',
      provider_thread_id: 'thread-acme-42004',
      direction: 'inbound',
      subject: 'Your reimbursement request AMZ-ACME-42004 has been approved',
      body_text: 'We approved your reimbursement request for $1,184.50. Payment will appear in an upcoming settlement.',
      attachments: [],
      sender: 'seller-performance@amazon.com',
      recipients: ['claims@acme-operations.test'],
      received_at: iso(-2),
      state_signal: 'approved',
      metadata: { demo_seed: true },
      created_at: iso(-2),
      updated_at: iso(-2)
    },
    {
      id: '00000000-0000-0000-0000-000000015302',
      tenant_id: resolvedTenantId,
      dispute_case_id: disputes[8].id,
      amazon_case_id: 'AMZ-ACME-42011',
      provider: 'gmail',
      provider_message_id: 'gmail-acme-42011-needs-evidence',
      provider_thread_id: 'thread-acme-42011',
      direction: 'inbound',
      subject: 'Action required on reimbursement case AMZ-ACME-42011',
      body_text: 'Please provide carrier proof that matches the affected FBA shipment.',
      attachments: [],
      sender: 'seller-performance@amazon.com',
      recipients: ['claims@acme-operations.test'],
      received_at: iso(-2),
      state_signal: 'needs_evidence',
      metadata: { demo_seed: true },
      created_at: iso(-2),
      updated_at: iso(-2)
    }
  ];
}

function unmatchedCaseMessages() {
  return [
    {
      id: '00000000-0000-0000-0000-000000015401',
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      amazon_case_id: 'AMZ-ACME-99999',
      provider: 'gmail',
      provider_message_id: 'gmail-acme-unmatched-99999',
      provider_thread_id: 'thread-acme-99999',
      subject: 'Reimbursement case update AMZ-ACME-99999',
      body_text: 'We need additional detail, but Margin could not safely link this message to a known case.',
      attachments: [],
      sender: 'seller-performance@amazon.com',
      recipients: ['claims@acme-operations.test'],
      received_at: iso(-1),
      failure_reason: 'No matching dispute case or detection identifiers.',
      link_status: 'unmatched',
      metadata: { demo_seed: true },
      created_at: iso(-1)
    }
  ];
}

function membershipRows() {
  return [
    {
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      role: 'owner',
      accepted_at: iso(-30),
      is_active: true,
      created_at: iso(-30),
      updated_at: iso(-1)
    }
  ];
}

function userProfileRow() {
  return {
    id: demoUserId,
    email: demoUserEmail,
    amazon_seller_id: sellerId,
    seller_id: sellerId,
    company_name: 'Acme Operations',
    tenant_id: resolvedTenantId,
    last_active_tenant_id: resolvedTenantId,
    last_active_at: iso(),
    billing_status: 'unlocked',
    billing_unlocked_at: iso(-18),
    billing_source: 'acme_demo_seed',
    welcome_email_attempted_at: iso(-30),
    welcome_email_sent_at: iso(-30),
    welcome_email_delivery_status: 'delivered',
    welcome_email_delivered_at: iso(-30),
    welcome_email_last_event_at: iso(-30),
    created_at: iso(-30),
    updated_at: iso()
  };
}

async function seedAcmeOperations(): Promise<void> {
  requireGuards();
  console.log(`Seeding Acme Operations demo into tenant slug "${tenantSlug}" for user ${demoUserId}.`);

  try {
    await ensureTenant();
    await resetTenantData();

    if (shouldUpsertUserProfile) {
      await writeRows('users', [userProfileRow()], { onConflict: 'id' });
    } else {
      console.log('skip users profile update: set ALLOW_DEMO_PROFILE_UPSERT=true to update a non-default demo user profile.');
    }

    await writeRows('tenant_memberships', membershipRows(), { onConflict: 'tenant_id,user_id' });
    await writeRows('stores', stores(), { onConflict: 'id' });
    await writeRows('tokens', tokens(), { onConflict: 'id' });
    await writeRows('evidence_sources', evidenceSources(), { onConflict: 'id' });
    await writeRows('detection_results', detectionRows(), { onConflict: 'id' });
    await writeRows('dispute_cases', disputeRows(), { onConflict: 'id' });
    await writeRows('evidence_documents', evidenceDocuments(), { onConflict: 'id' });
    await writeRows('dispute_evidence_links', evidenceLinks(), { onConflict: 'id' });
    await writeRows('dispute_submissions', disputeSubmissions(), { onConflict: 'id' });
    await writeRows('financial_events', financialEvents(), { onConflict: 'id' });

    const recoveryRows = recoveries();
    await writeRows('recoveries', recoveryRows, { onConflict: 'id' });
    await writeRows('billing_transactions', billingTransactions(), { onConflict: 'id' });

    const { recoveryWork, billingWork } = workItems();
    await writeRows('recovery_work_items', recoveryWork, { onConflict: 'id', optional: true });
    await writeRows('billing_work_items', billingWork, { onConflict: 'id', optional: true });

    const billing = billingSubscriptionAndInvoices();
    await writeRows('tenant_billing_subscriptions', [billing.subscription], { onConflict: 'tenant_id' });
    await writeRows('billing_invoices', billing.invoices, { onConflict: 'id' });

    const sourceData = sourceDataRows();
    await writeRows('product_catalog', sourceData.productCatalog, { onConflict: 'id', optional: true });
    await writeRows('inventory_items', sourceData.inventoryItems, { onConflict: 'id', optional: true });
    await writeRows('orders', sourceData.orders, { onConflict: 'id', optional: true });
    await writeRows('shipments', sourceData.shipments, { onConflict: 'id', optional: true });
    await writeRows('returns', sourceData.returns, { onConflict: 'id', optional: true });
    await writeRows('settlements', sourceData.settlements, { onConflict: 'id', optional: true });
    await writeRows('inventory_ledger', sourceData.inventoryLedger, { onConflict: 'id', optional: true });

    await writeRows('sync_progress', syncProgressRows(), { onConflict: 'id', optional: true });
    await writeRows('notifications', notifications(), { onConflict: 'id', optional: true });
    await writeRows('recent_platform_events', recentPlatformEvents(), { optional: true });

    const evidenceExtras = proofPacketsAndPrompts();
    await writeRows('proof_packets', evidenceExtras.proofPackets, { onConflict: 'id', optional: true });
    await writeRows('smart_prompts', evidenceExtras.smartPrompts, { onConflict: 'id', optional: true });
    await writeRows('evidence_match_results', matchResults(), { onConflict: 'id', optional: true });
    await writeRows('case_messages', caseMessages(), { onConflict: 'id', optional: true });
    await writeRows('unmatched_case_messages', unmatchedCaseMessages(), { onConflict: 'id', optional: true });

    await writeRows('user_notification_preferences', [{
      id: '00000000-0000-0000-0000-000000016001',
      tenant_id: resolvedTenantId,
      user_id: demoUserId,
      preferences: {
        in_app: true,
        email: false,
        claim_detected: true,
        evidence_found: true,
        refund_approved: true,
        funds_deposited: true
      },
      created_at: iso(-15),
      updated_at: iso(-1)
    }], { onConflict: 'id', optional: true });

    console.log('Acme Operations demo seed complete.');
  } finally {
    await finalizeTenantReadOnly();
    console.log(`Tenant "${tenantSlug}" returned to read_only mode.`);
  }
}

seedAcmeOperations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
