import 'dotenv/config';
import { Client } from 'pg';

const DEMO_TENANT_ID = '00000000-0000-0000-0000-0000000000d0';
const DEMO_SELLER_ID = process.env.ACME_DEMO_SELLER_ID || 'ACME-SELLER-001';

const tables = [
  'tenant_memberships',
  'stores',
  'tokens',
  'evidence_sources',
  'detection_results',
  'dispute_cases',
  'evidence_documents',
  'dispute_evidence_links',
  'dispute_submissions',
  'financial_events',
  'recoveries',
  'billing_transactions',
  'tenant_billing_subscriptions',
  'billing_invoices',
  'product_catalog',
  'inventory_items',
  'orders',
  'shipments',
  'returns',
  'settlements',
  'inventory_ledger',
  'sync_progress',
  'notifications',
  'agent_events',
  'recent_platform_events',
  'proof_packets',
  'smart_prompts',
  'evidence_match_results',
  'case_messages',
  'unmatched_case_messages',
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const tenant = await client.query(
      `SELECT id, name, slug, status, plan
       FROM tenants
       WHERE slug = 'demo-workspace'
       LIMIT 1`
    );

    console.log(`tenant=${JSON.stringify(tenant.rows[0] || null)}`);

    for (const table of tables) {
      try {
        const result = table === 'product_catalog'
          ? await client.query(
              `SELECT COUNT(*)::int AS count FROM ${table} WHERE seller_id = $1`,
              [DEMO_SELLER_ID]
            )
          : await client.query(
              `SELECT COUNT(*)::int AS count FROM ${table} WHERE tenant_id = $1`,
              [DEMO_TENANT_ID]
            );
        console.log(`${table}=${result.rows[0]?.count ?? 0}`);
      } catch (error: any) {
        console.log(`${table}=ERROR:${error?.message || error}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
