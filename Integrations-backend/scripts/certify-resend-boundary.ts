import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http, { type Server } from 'node:http';
import path from 'node:path';
import { Webhook } from 'svix';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
const resendApiKey = process.env.RESEND_API_KEY;
const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
if (!connectionString) throw new Error('DATABASE_URL is required for the safe Resend boundary certification');
if (!resendApiKey) throw new Error('RESEND_API_KEY is required for the real Resend boundary certification');
if (!resendWebhookSecret) throw new Error('RESEND_WEBHOOK_SECRET is required for signed webhook certification');

process.env.NODE_ENV = 'test';
process.env.EMAIL_FROM_EMAIL = process.env.RESEND_TEST_FROM || 'notifications@margin-finance.com';
process.env.EMAIL_FROM_NAME = 'Margin Certification';
process.env.EMAIL_REPLY_TO = process.env.RESEND_TEST_REPLY_TO || 'support@margin-finance.com';

const callbackPort = Number(process.env.RESEND_CERT_CALLBACK_PORT || '3105');
const tag = `ssv1_resend_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const recipient = `${tag}@mailinator.com`;
const ids = {
  tenant: crypto.randomUUID(),
  user: crypto.randomUUID(),
};

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });
}

function close(server: Server | null): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

function postRaw(port: number, rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const requestHeaders: Record<string, string> = {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(rawBody)),
    };
    for (const name of ['svix-id', 'svix-timestamp', 'svix-signature']) {
      const value = headers[name];
      if (Array.isArray(value)) requestHeaders[name] = value[0] || '';
      else if (typeof value === 'string') requestHeaders[name] = value;
    }

    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/webhooks/resend',
      method: 'POST',
      headers: requestHeaders,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.once('error', reject);
    req.end(rawBody);
  });
}

async function waitForProviderConfirmation(
  client: Client,
  notificationId: string,
  timeoutMs = 90_000,
): Promise<{
  provider_message_id: string | null;
  provider_event_id: string | null;
  status: string;
  accepted_at: string | null;
  provider_confirmed_at: string | null;
  updated_at: string | null;
}> {
  const deadline = Date.now() + timeoutMs;
  let latest: any = null;
  while (Date.now() < deadline) {
    const result = await client.query<{
      provider_message_id: string | null;
      provider_event_id: string | null;
      status: string;
      accepted_at: string | null;
      provider_confirmed_at: string | null;
      updated_at: string | null;
    }>(
      `SELECT provider_message_id, provider_event_id, status, accepted_at, provider_confirmed_at, updated_at
       FROM notification_signal_deliveries
       WHERE notification_id = $1 AND channel = 'email'`,
      [notificationId],
    );
    latest = result.rows[0] || null;
    if (latest?.provider_message_id && latest?.provider_event_id && latest?.provider_confirmed_at) return latest;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for signed Resend provider confirmation: ${JSON.stringify(latest)}`);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let server: Server | null = null;
  let notificationId: string | null = null;
  let providerMessageId: string | null = null;

  try {
    const { default: app } = await import('../src/index');
    const { systemSignalService } = await import('../src/notifications/services/system_signal_service');

    server = http.createServer(app);
    await listen(server, callbackPort);

    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)`,
      [ids.tenant, `${tag} Tenant`, `${tag}-tenant`],
    );
    await client.query(
      `INSERT INTO users (id, tenant_id, email, seller_id, amazon_seller_id) VALUES ($1, $2, $3, $4, $4)`,
      [ids.user, ids.tenant, recipient, `${tag}-seller`],
    );
    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, is_active, role) VALUES ($1, $2, true, 'owner')`,
      [ids.tenant, ids.user],
    );

    const accepted = await systemSignalService.accept({
      tenantId: ids.tenant,
      recipientUserId: ids.user,
      eventType: 'case.approval_required',
      objectType: 'dispute_case',
      objectId: `${tag}-case`,
      businessTransitionKey: 'real_resend_provider_boundary',
      privateTitle: 'Certification action required',
      privateBody: 'This is an isolated Margin System Signals V1 delivery certification message.',
      externalTitle: 'Margin delivery certification',
      externalBody: 'This temporary message validates provider delivery for Margin System Signals V1.',
    });
    notificationId = accepted.notification.id;

    const acceptedLedger = await client.query<{
      provider_message_id: string | null;
      status: string;
      accepted_at: string | null;
      client_received_at: string | null;
    }>(
      `SELECT provider_message_id, status, accepted_at, client_received_at
       FROM notification_signal_deliveries
       WHERE notification_id = $1 AND channel = 'email'`,
      [notificationId],
    );
    providerMessageId = acceptedLedger.rows[0]?.provider_message_id || null;
    assert(Boolean(providerMessageId), 'real Resend send must return a provider message ID');
    assertEqual(acceptedLedger.rows[0]?.status, 'accepted', 'provider acceptance must be recorded before provider confirmation');
    assert(Boolean(acceptedLedger.rows[0]?.accepted_at), 'provider acceptance timestamp must be recorded');
    assertEqual(acceptedLedger.rows[0]?.client_received_at, null, 'email provider acceptance must not fabricate client receipt');

    const confirmed = await waitForProviderConfirmation(client, notificationId);
    assertEqual(confirmed.status, 'provider_confirmed', 'signed delivered webhook must update only email transport status');
    assert(Boolean(confirmed.provider_confirmed_at), 'signed delivered webhook must persist provider confirmation timestamp');
    assert(Boolean(confirmed.provider_event_id), 'signed delivered webhook must persist provider event identity');

    // The first provider callback above is a real Resend delivery event, verified by the live route.
    // To test the exact replay safely, construct a single additional delivered event using the configured
    // Svix signing secret, submit it once, then submit the *identical* signed payload again.
    const replayPayload = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: providerMessageId,
        to: recipient,
      },
    });
    const replayId = `msg_${crypto.randomUUID()}`;
    const replayTimestamp = new Date();
    const replayHeaders = {
      'svix-id': replayId,
      'svix-timestamp': String(Math.floor(replayTimestamp.getTime() / 1000)),
      'svix-signature': new Webhook(resendWebhookSecret).sign(replayId, replayTimestamp, replayPayload),
    };

    const signedFirstDelivery = await postRaw(callbackPort, replayPayload, replayHeaders);
    assertEqual(signedFirstDelivery.status, 200, `signed delivery event must be accepted: ${signedFirstDelivery.body}`);
    const signedFirstBody = JSON.parse(signedFirstDelivery.body || '{}');
    assertEqual(signedFirstBody.success, true, 'signed delivery event response must succeed');

    const beforeReplay = await client.query<{
      provider_event_id: string | null;
      provider_confirmed_at: string | null;
      updated_at: string | null;
    }>(
      `SELECT provider_event_id, provider_confirmed_at, updated_at
       FROM notification_signal_deliveries
       WHERE notification_id = $1 AND channel = 'email'`,
      [notificationId],
    );

    const replay = await postRaw(callbackPort, replayPayload, replayHeaders);
    assertEqual(replay.status, 200, `signed webhook replay must be accepted idempotently: ${replay.body}`);
    const replayBody = JSON.parse(replay.body || '{}');
    assertEqual(replayBody.success, true, 'signed webhook replay response must remain successful');

    const afterReplay = await client.query<{
      provider_event_id: string | null;
      provider_confirmed_at: string | null;
      updated_at: string | null;
    }>(
      `SELECT provider_event_id, provider_confirmed_at, updated_at
       FROM notification_signal_deliveries
       WHERE notification_id = $1 AND channel = 'email'`,
      [notificationId],
    );
    const normalizeTimestamp = (value: unknown): string | null => value == null ? null : new Date(String(value)).toISOString();
    assertEqual(afterReplay.rows[0]?.provider_event_id, beforeReplay.rows[0]?.provider_event_id, 'signed replay must retain the original provider event identity');
    assertEqual(normalizeTimestamp(afterReplay.rows[0]?.provider_confirmed_at), normalizeTimestamp(beforeReplay.rows[0]?.provider_confirmed_at), 'signed replay must not fabricate a second provider confirmation');
    assertEqual(normalizeTimestamp(afterReplay.rows[0]?.updated_at), normalizeTimestamp(beforeReplay.rows[0]?.updated_at), 'signed replay must leave canonical delivery ledger unchanged');

    const storedEvent = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM email_delivery_events
       WHERE provider = 'resend' AND provider_event_id = $1`,
      [beforeReplay.rows[0]?.provider_event_id],
    );
    assertEqual(storedEvent.rows[0]?.count, '1', 'provider event persistence must dedupe the signed replay by provider event identity');

    const lifecycle = await client.query<{
      signal_state: string;
      seller_state: string;
      action_state: string;
    }>(
      `SELECT signal_state, seller_state, action_state FROM notifications WHERE id = $1`,
      [notificationId],
    );
    assertEqual(lifecycle.rows[0]?.signal_state, 'open', 'provider confirmation must not resolve the signal');
    assertEqual(lifecycle.rows[0]?.seller_state, 'unseen', 'provider confirmation must not mark seller interaction');
    assertEqual(lifecycle.rows[0]?.action_state, 'pending', 'provider confirmation must not complete the action');

    console.log(`RESEND_PROVIDER_BOUNDARY_CERTIFICATION=${JSON.stringify({
      notificationId: notificationId.slice(0, 8),
      providerMessageId: String(providerMessageId).slice(0, 8),
      providerEventId: String(confirmed.provider_event_id).slice(0, 8),
      acceptedStatus: acceptedLedger.rows[0]?.status,
      confirmedStatus: confirmed.status,
      replayStatus: replay.status,
      eventRows: Number(storedEvent.rows[0]?.count || 0),
      signalState: lifecycle.rows[0]?.signal_state,
      sellerState: lifecycle.rows[0]?.seller_state,
      actionState: lifecycle.rows[0]?.action_state,
    })}`);
  } finally {
    await close(server);
    if (providerMessageId) {
      await client.query(`DELETE FROM email_delivery_events WHERE provider = 'resend' AND provider_message_id = $1`, [providerMessageId]).catch(() => undefined);
    }
    await client.query(`DELETE FROM notification_signal_deliveries WHERE tenant_id = $1`, [ids.tenant]).catch(() => undefined);
    await client.query(`DELETE FROM notifications WHERE tenant_id = $1`, [ids.tenant]).catch(() => undefined);
    await client.query(`DELETE FROM tenant_memberships WHERE tenant_id = $1`, [ids.tenant]).catch(() => undefined);
    await client.query(`DELETE FROM users WHERE id = $1`, [ids.user]).catch(() => undefined);
    await client.query(`DELETE FROM tenants WHERE id = $1`, [ids.tenant]).catch(() => undefined);
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
