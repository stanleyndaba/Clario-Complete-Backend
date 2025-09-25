/*
  Minimal WebSocket + SSE smoke script
  Usage:
    BASE_URL=https://localhost:3001 TOKEN="Bearer <jwt>" SYNC_ID=<id> npm run smoke:ws
*/

/* eslint-disable no-console */
import 'dotenv/config';
import WebSocket from 'ws';
import fetch from 'node-fetch';

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
  const token = process.env.TOKEN || '';
  const syncId = process.env.SYNC_ID || '';

  console.log('Connecting WebSocket...');
  const ws = new WebSocket(baseUrl.replace('http', 'ws'));

  ws.on('open', () => {
    console.log('WS connected');
    ws.send(JSON.stringify({ event: 'authenticate', data: { userId: 'me', token } }));
    if (syncId) {
      ws.send(JSON.stringify({ event: 'subscribe_sync_progress', data: { userId: 'me', syncId } }));
    }
  });

  ws.on('message', (data) => {
    console.log('WS message:', data.toString());
  });

  ws.on('error', (e) => console.error('WS error:', e));

  console.log('Subscribing to SSE...');
  const sseResp = await fetch(`${baseUrl}/api/sse/sync-progress/${syncId || 'test'}`, {
    headers: token ? { Authorization: token } : {},
  });
  if (!sseResp.ok) {
    console.error('SSE subscribe failed:', sseResp.status, sseResp.statusText);
    return;
  }
  sseResp.body?.on('data', (chunk: any) => {
    process.stdout.write(chunk);
  });
}

main().catch((e) => console.error('Smoke WS/SSE failed:', e));

