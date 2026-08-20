import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http, { type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';
import request from 'supertest';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for the safe SSE receipt boundary certification');

process.env.NODE_ENV = 'test';
// The receipt boundary does not certify email. Keep its fixtures entirely local to the safe database and SSE stream.
process.env.RESEND_API_KEY = '';

const tag = `ssv1_sse_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const ids = {
  tenantA: crypto.randomUUID(),
  tenantB: crypto.randomUUID(),
  userA: crypto.randomUUID(),
  userB: crypto.randomUUID(),
};
const slugA = `${tag}-a`;
const slugB = `${tag}-b`;

type SseConnection = {
  response: IncomingMessage;
  received: Promise<Record<string, any>>;
  close: () => Promise<void>;
};

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert.equal(actual, expected, message);
}

function waitForListening(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('SSE test server did not expose a TCP port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function openAuthenticatedSse(port: number, tenantSlug: string, token: string): Promise<SseConnection> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: `/api/sse/notifications?tenantSlug=${encodeURIComponent(tenantSlug)}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });

    req.once('error', reject);
    req.once('response', (response) => {
      if (response.statusCode !== 200) {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.once('end', () => reject(new Error(`SSE connection denied: ${response.statusCode} ${body}`)));
        return;
      }

      let buffer = '';
      let settled = false;
      let resolveReceived: (payload: Record<string, any>) => void = () => undefined;
      let rejectReceived: (error: Error) => void = () => undefined;
      const received = new Promise<Record<string, any>>((resolveEvent, rejectEvent) => {
        resolveReceived = resolveEvent;
        rejectReceived = rejectEvent;
      });
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          rejectReceived(new Error('Timed out waiting for canonical notification SSE event'));
        }
      }, 12_000);

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const eventType = /^event:\s*([^\n]+)/m.exec(frame)?.[1]?.trim();
          const dataLine = /^data:\s*(.+)$/m.exec(frame)?.[1];
          if (eventType !== 'notification' || !dataLine || settled) continue;
          try {
            settled = true;
            clearTimeout(timer);
            resolveReceived(JSON.parse(dataLine));
          } catch (error) {
            settled = true;
            clearTimeout(timer);
            rejectReceived(error instanceof Error ? error : new Error(String(error)));
          }
        }
      });
      response.once('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          rejectReceived(error);
        }
      });

      resolve({
        response,
        received,
        close: async () => {
          clearTimeout(timer);
          response.destroy();
        },
      });
    });

    req.end();
  });
}

async function main(): Promise<void> {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let server: Server | null = null;
  let firstStream: SseConnection | null = null;
  let secondStream: SseConnection | null = null;

  try {
    const { default: app } = await import('../src/index');
    const { systemSignalService } = await import('../src/notifications/services/system_signal_service');
    const { generateToken } = await import('../src/middleware/authMiddleware');
    const { sseHub } = await import('../src/utils/sseHub');

    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES
       ($1, $2, $3), ($4, $5, $6)`,
      [ids.tenantA, `${tag} Tenant A`, slugA, ids.tenantB, `${tag} Tenant B`, slugB],
    );
    await client.query(
      `INSERT INTO users (id, tenant_id, email, seller_id, amazon_seller_id) VALUES
       ($1, $2, $3, $4, $4), ($5, $6, $7, $8, $8)`,
      [
        ids.userA, ids.tenantA, `${tag}.a@example.test`, `${tag}-seller-a`,
        ids.userB, ids.tenantB, `${tag}.b@example.test`, `${tag}-seller-b`,
      ],
    );
    await client.query(
      `INSERT INTO tenant_memberships (tenant_id, user_id, is_active, role) VALUES
       ($1, $2, true, 'owner'), ($3, $4, true, 'owner')`,
      [ids.tenantA, ids.userA, ids.tenantB, ids.userB],
    );

    const accepted = await systemSignalService.accept({
      tenantId: ids.tenantA,
      recipientUserId: ids.userA,
      eventType: 'case.approval_required',
      objectType: 'dispute_case',
      objectId: `${tag}-case`,
      businessTransitionKey: 'sse_transport_receipt',
      privateTitle: 'Approval required',
      privateBody: 'Synthetic safe SSE receipt certification event.',
    });
    assertEqual(accepted.deduped, false, 'fixture must create one canonical notification');

    const initial = await client.query<{
      client_received_at: string | null;
      signal_state: string;
      seller_state: string;
      action_state: string;
    }>(
      `SELECT d.client_received_at, n.signal_state, n.seller_state, n.action_state
       FROM notifications n
       LEFT JOIN notification_signal_deliveries d
         ON d.notification_id = n.id AND d.channel = 'realtime'
       WHERE n.id = $1`,
      [accepted.notification.id],
    );
    assertEqual(initial.rows[0]?.client_received_at, null, 'server transport attempt must not fabricate client receipt');
    assertEqual(initial.rows[0]?.signal_state, 'open', 'fixture signal begins open');
    assertEqual(initial.rows[0]?.seller_state, 'unseen', 'fixture begins unseen');
    assertEqual(initial.rows[0]?.action_state, 'pending', 'fixture action begins pending');

    server = http.createServer(app);
    const port = await waitForListening(server);
    const userAToken = generateToken({ userId: ids.userA, email: `${tag}.a@example.test`, role: 'owner' });
    const userBToken = generateToken({ userId: ids.userB, email: `${tag}.b@example.test`, role: 'owner' });

    firstStream = await openAuthenticatedSse(port, slugA, userAToken);
    const delivered = sseHub.sendEvent(ids.userA, 'notification', accepted.notification as any, slugA);
    assertEqual(delivered, true, 'live authenticated SSE connection must receive the canonical notification');
    const firstEvent = await firstStream.received;
    const firstEventNotificationId = String(firstEvent.id || firstEvent.notification_id || firstEvent.data?.id || '').trim();
    assertEqual(firstEventNotificationId, accepted.notification.id, 'SSE event must preserve canonical notification identity');
    const firstEventSignalId = String(
      firstEvent.payload?.system_signal?.signal_id ||
      firstEvent.data?.payload?.system_signal?.signal_id ||
      firstEvent.system_signal_id ||
      '',
    ).trim();
    assertEqual(firstEventSignalId, accepted.signalId, 'SSE event must carry canonical signal identity');

    const agent = request(app);
    const receiptOne = await agent
      .post(`/api/notifications/${accepted.notification.id}/receipt?tenantSlug=${encodeURIComponent(slugA)}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({});
    assertEqual(receiptOne.status, 200, `authenticated receipt must succeed: ${JSON.stringify(receiptOne.body)}`);
    assertEqual(receiptOne.body?.data?.idempotent, false, 'first receipt must record transport truth');

    const afterFirstReceipt = await client.query<{
      client_received_at: string | null;
      status: string;
      signal_state: string;
      seller_state: string;
      action_state: string;
    }>(
      `SELECT d.client_received_at, d.status, n.signal_state, n.seller_state, n.action_state
       FROM notifications n
       JOIN notification_signal_deliveries d ON d.notification_id = n.id AND d.channel = 'realtime'
       WHERE n.id = $1`,
      [accepted.notification.id],
    );
    assert(Boolean(afterFirstReceipt.rows[0]?.client_received_at), 'receipt endpoint must persist client_received_at');
    assertEqual(afterFirstReceipt.rows[0]?.status, 'client_received', 'receipt ledger status must represent transport receipt');
    assertEqual(afterFirstReceipt.rows[0]?.signal_state, 'open', 'receipt must not resolve canonical signal');
    assertEqual(afterFirstReceipt.rows[0]?.seller_state, 'unseen', 'receipt must not mark seller interaction as read');
    assertEqual(afterFirstReceipt.rows[0]?.action_state, 'pending', 'receipt must not complete the underlying action');

    await firstStream.close();
    firstStream = null;
    secondStream = await openAuthenticatedSse(port, slugA, userAToken);
    const replayDelivered = sseHub.sendEvent(ids.userA, 'notification', accepted.notification as any, slugA);
    assertEqual(replayDelivered, true, 'reconnected authenticated SSE client must receive replayed canonical event');
    const secondEvent = await secondStream.received;
    const secondEventNotificationId = String(secondEvent.id || secondEvent.notification_id || secondEvent.data?.id || '').trim();
    assertEqual(secondEventNotificationId, accepted.notification.id, 'replayed SSE event must retain notification identity');

    const receiptReplay = await agent
      .post(`/api/notifications/${accepted.notification.id}/receipt?tenantSlug=${encodeURIComponent(slugA)}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({});
    assertEqual(receiptReplay.status, 200, 'replayed receipt endpoint call must succeed');
    assertEqual(receiptReplay.body?.data?.idempotent, true, 'replayed delivery receipt must be idempotent');

    const wrongUser = await agent
      .post(`/api/notifications/${accepted.notification.id}/receipt?tenantSlug=${encodeURIComponent(slugA)}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({});
    assert(wrongUser.status === 403 || wrongUser.status === 401, `cross-tenant receipt must be denied, received ${wrongUser.status}`);

    const final = await client.query<{
      client_received_at: string | null;
      status: string;
      signal_state: string;
      seller_state: string;
      action_state: string;
    }>(
      `SELECT d.client_received_at, d.status, n.signal_state, n.seller_state, n.action_state
       FROM notifications n
       JOIN notification_signal_deliveries d ON d.notification_id = n.id AND d.channel = 'realtime'
       WHERE n.id = $1`,
      [accepted.notification.id],
    );
    assert(Boolean(final.rows[0]?.client_received_at), 'cross-tenant denial must leave established receipt intact');
    assertEqual(final.rows[0]?.status, 'client_received', 'cross-tenant denial must not alter transport receipt state');
    assertEqual(final.rows[0]?.signal_state, 'open', 'cross-tenant denial must not alter signal state');
    assertEqual(final.rows[0]?.seller_state, 'unseen', 'cross-tenant denial must not alter seller state');
    assertEqual(final.rows[0]?.action_state, 'pending', 'cross-tenant denial must not alter action state');

    console.log(`SSE_RECEIPT_BOUNDARY_CERTIFICATION=${JSON.stringify({
      notificationId: accepted.notification.id.slice(0, 8),
      signalId: accepted.signalId.slice(0, 8),
      firstReceiptIdempotent: receiptOne.body?.data?.idempotent,
      replayReceiptIdempotent: receiptReplay.body?.data?.idempotent,
      wrongUserStatus: wrongUser.status,
      deliveryStatus: final.rows[0]?.status,
      signalState: final.rows[0]?.signal_state,
      sellerState: final.rows[0]?.seller_state,
      actionState: final.rows[0]?.action_state,
    })}`);
  } finally {
    await firstStream?.close().catch(() => undefined);
    await secondStream?.close().catch(() => undefined);
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await client.query(`DELETE FROM notification_signal_deliveries WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM notifications WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM tenant_memberships WHERE tenant_id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.userA, ids.userB]]).catch(() => undefined);
    await client.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[ids.tenantA, ids.tenantB]]).catch(() => undefined);
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
