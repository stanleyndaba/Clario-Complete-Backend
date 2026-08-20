import dotenv from 'dotenv';
import { Client } from 'pg';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

async function count(client: Client, sql: string): Promise<number> {
  const result = await client.query<{ count: string }>(sql);
  return Number(result.rows[0]?.count || 0);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = {
      tenants: await count(client, `SELECT COUNT(*)::text AS count FROM tenants WHERE slug LIKE 'ssv1_%' OR name LIKE 'ssv1_%'`),
      users: await count(client, `SELECT COUNT(*)::text AS count FROM users WHERE email LIKE 'ssv1_%@%'`),
      notificationDeliveries: await count(client, `SELECT COUNT(*)::text AS count FROM notification_signal_deliveries WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'ssv1_%' OR name LIKE 'ssv1_%')`),
      emailEvents: await count(client, `SELECT COUNT(*)::text AS count FROM email_delivery_events WHERE recipient_email LIKE 'ssv1_resend_%@mailinator.com'`),
    };
    if (Object.values(result).some((value) => value !== 0)) {
      const tenants = await client.query<{ id: string; slug: string; name: string; created_at: string }>(`
        SELECT id, slug, name, created_at
        FROM tenants
        WHERE slug LIKE 'ssv1_%' OR name LIKE 'ssv1_%'
        ORDER BY created_at ASC
      `);
      console.error(`SYSTEM_SIGNALS_CERTIFICATION_FIXTURE_TENANTS=${JSON.stringify(tenants.rows)}`);
      throw new Error(`SYSTEM_SIGNALS_CERTIFICATION_FIXTURES_REMAIN=${JSON.stringify(result)}`);
    }
    console.log(`SYSTEM_SIGNALS_CERTIFICATION_CLEANUP_VERIFIED=${JSON.stringify(result)}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
