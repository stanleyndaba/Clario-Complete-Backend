/**
 * Seed Test Notifications
 * Inserts realistic notifications into the notifications table
 * Usage: npx ts-node scripts/seed-notifications.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

async function seed() {
  // Step 1: Drop the old CHECK constraint and add one that allows all types
  console.log('🔧 Updating type CHECK constraint to allow all notification types...');
  const { error: alterError } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
      ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'claim_detected', 'integration_completed', 'payment_processed',
        'sync_completed', 'sync_started', 'sync_failed',
        'discrepancy_found', 'system_alert', 'user_action_required',
        'evidence_found', 'case_filed', 'refund_approved',
        'funds_deposited', 'amazon_challenge', 'claim_denied',
        'claim_expiring', 'learning_insight', 'weekly_summary',
        'reimbursement_payout', 'scarcity_alert', 'anomaly_detected',
        'expiring_soon'
      ));
    `
  });

  if (alterError) {
    console.warn('⚠️  Could not alter CHECK constraint (may need manual SQL). Trying insert with original types...');
    console.warn('   Error:', alterError.message);
  }

  // Step 2: Seed notifications using only the original allowed types as fallback
  // The allowed types are: claim_detected, integration_completed, payment_processed,
  // sync_completed, discrepancy_found, system_alert, user_action_required
  const notifications = [
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'claim_detected',
      title: 'Detected 3 High-Probability Claims - $1,247.80',
      message: 'Margin identified discrepancies Amazon likely owes you for. Reviewing and validating evidence now.',
      status: 'pending',
      priority: 'high',
      channel: 'both',
      payload: { count: 3, amount: 1247.80, currency: 'USD', isBulk: true },
      created_at: hoursAgo(0.5),
      updated_at: hoursAgo(0.5),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'payment_processed',
      title: 'Deposit Confirmed: $813.52',
      message: 'Funds have been cleared and deposited to your account.',
      status: 'pending',
      priority: 'urgent',
      channel: 'both',
      payload: { amount: 813.52, currency: 'USD', type: 'funds_deposited' },
      created_at: hoursAgo(2),
      updated_at: hoursAgo(2),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'claim_detected',
      title: 'Submitted Claims to Amazon',
      message: 'Filed with structured evidence packages and audit references.',
      status: 'pending',
      priority: 'high',
      channel: 'both',
      payload: { claimAmount: 422.10, currency: 'USD', status: 'filed' },
      created_at: hoursAgo(5),
      updated_at: hoursAgo(5),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'payment_processed',
      title: 'Recovered $222.20',
      message: 'Amazon approved the reimbursement. Cleared and scheduled for payout.',
      status: 'pending',
      priority: 'urgent',
      channel: 'both',
      payload: { approvedAmount: 222.20, currency: 'USD', type: 'refund_approved' },
      created_at: hoursAgo(8),
      updated_at: hoursAgo(8),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'claim_detected',
      title: 'Detected High-Probability Claim',
      message: 'Margin identified a discrepancy Amazon likely owes you for. Reviewing and validating evidence now.',
      status: 'pending',
      priority: 'high',
      channel: 'both',
      payload: { amount: 89.99, currency: 'USD', confidence: 0.94 },
      created_at: hoursAgo(12),
      updated_at: hoursAgo(12),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'discrepancy_found',
      title: 'Attached Supporting Evidence',
      message: 'Purchase invoices, delivery confirmations, and inventory trails linked to claims.',
      status: 'read',
      priority: 'normal',
      channel: 'both',
      payload: { source: 'gmail', parsed: true, matchFound: true },
      created_at: hoursAgo(18),
      updated_at: hoursAgo(18),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'sync_completed',
      title: 'Store Data Sync Complete',
      message: 'Successfully synced 2,847 transactions from your Amazon Seller Central account.',
      status: 'read',
      priority: 'normal',
      channel: 'in_app',
      payload: { transactionCount: 2847, source: 'amazon' },
      created_at: hoursAgo(24),
      updated_at: hoursAgo(24),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'user_action_required',
      title: 'Amazon Challenged Claim — Escalating',
      message: "We're reviewing their response and preparing counter-evidence.",
      status: 'pending',
      priority: 'high',
      channel: 'both',
      payload: { count: 1, originalType: 'amazon_challenge' },
      created_at: hoursAgo(36),
      updated_at: hoursAgo(36),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'payment_processed',
      title: 'Deposit Confirmed: $1,560.00',
      message: 'Funds have been cleared and deposited to your account.',
      status: 'read',
      priority: 'urgent',
      channel: 'both',
      payload: { amount: 1560.00, currency: 'USD', type: 'funds_deposited' },
      created_at: hoursAgo(48),
      updated_at: hoursAgo(48),
    },
    {
      user_id: DEMO_USER_ID,
      tenant_id: DEFAULT_TENANT_ID,
      type: 'claim_detected',
      title: 'Detected 7 High-Probability Claims - $3,891.40',
      message: 'Margin identified discrepancies Amazon likely owes you for. Reviewing and validating evidence now.',
      status: 'read',
      priority: 'high',
      channel: 'both',
      payload: { count: 7, amount: 3891.40, currency: 'USD', isBulk: true },
      created_at: hoursAgo(72),
      updated_at: hoursAgo(72),
    },
  ];

  console.log(`🌱 Seeding ${notifications.length} test notifications for user ${DEMO_USER_ID}...`);

  const { data, error } = await supabase
    .from('notifications')
    .insert(notifications)
    .select('id, type, title');

  if (error) {
    console.error('❌ Failed to seed notifications:', error.message);
    process.exit(1);
  }

  console.log(`✅ Seeded ${data.length} notifications successfully:`);
  data.forEach((n: any) => console.log(`   • [${n.type}] ${n.title}`));
  process.exit(0);
}

seed();
