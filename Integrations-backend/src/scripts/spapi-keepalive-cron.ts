/**
 * SP-API Keep-Alive Cron
 * ========================
 * Runs a lightweight SP-API call to prevent the 90-day account deactivation.
 * Amazon deactivates developer accounts that go 90 days without a successful call.
 *
 * Schedule this to run every 30 days:
 *
 *   Windows Task Scheduler (recommended):
 *     Action: npx ts-node src/scripts/spapi-keepalive-cron.ts
 *     Trigger: Monthly (every 30 days)
 *     Start in: C:\Users\Student\Contacts\Clario-Complete-Backend\Integrations-backend
 *
 *   Linux/Mac cron (if deployed on Render/Railway):
 *     0 9 1,15 * * cd /app && npx ts-node src/scripts/spapi-keepalive-cron.ts
 *
 *   Manual run:
 *     npx ts-node --project tsconfig.json src/scripts/spapi-keepalive-cron.ts
 */

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.AMAZON_CLIENT_ID     || process.env.AMAZON_SPAPI_CLIENT_ID;
const CLIENT_SECRET = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.AMAZON_SPAPI_REFRESH_TOKEN || process.env.AMAZON_REFRESH_TOKEN;
const BASE_URL      = process.env.AMAZON_SPAPI_BASE_URL || 'https://sellingpartnerapi-na.amazon.com';
const LOG_FILE      = path.join(__dirname, '../../../spapi-keepalive.log');

function stamp() {
  return new Date().toISOString();
}

function writeLog(line: string) {
  const entry = `[${stamp()}] ${line}\n`;
  process.stdout.write(entry);
  try {
    fs.appendFileSync(LOG_FILE, entry);
  } catch { /* non-fatal */ }
}

async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Missing Amazon credentials in .env file.');
  }
  const response = await axios.post<{ access_token: string }>(
    'https://api.amazon.com/auth/o2/token',
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 }
  );
  return response.data.access_token;
}

async function keepAlive() {
  writeLog('─────────────────────────────────────────');
  writeLog('SP-API Keep-Alive starting...');
  writeLog(`Endpoint: ${BASE_URL}`);

  try {
    // Step 1: Fresh access token
    writeLog('Exchanging refresh token...');
    const token = await getAccessToken();
    writeLog('✔ Access token obtained');

    // Step 2: Lightest possible call — marketplace participations
    writeLog('Calling GET /sellers/v1/marketplaceParticipations...');
    const r1 = await axios.get(`${BASE_URL}/sellers/v1/marketplaceParticipations`, {
      headers: {
        'Authorization':       `Bearer ${token}`,
        'x-amz-access-token':  token,
        'Content-Type':        'application/json',
      },
      timeout: 20_000,
    });
    writeLog(`✔ Participations: HTTP ${r1.status}`);

    // Step 3: One POST call for stronger audit trail
    writeLog('Calling POST /reports (GET_MERCHANT_LISTINGS_ALL_DATA)...');
    const r2 = await axios.post(
      `${BASE_URL}/reports/2021-06-30/reports`,
      { reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA', marketplaceIds: ['ATVPDKIKX0DER'] },
      {
        headers: {
          'Authorization':       `Bearer ${token}`,
          'x-amz-access-token':  token,
          'Content-Type':        'application/json',
        },
        timeout: 20_000,
      }
    );
    const reportId = r2.data?.reportId || 'unknown';
    writeLog(`✔ Report created: ${reportId}`);

    writeLog('✔ KEEP-ALIVE COMPLETE — 90-day clock reset');
    writeLog(`✔ Next run due by: ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toDateString()}`);
    writeLog('─────────────────────────────────────────');
    process.exit(0);

  } catch (err: any) {
    const status  = err.response?.status;
    const code    = err.response?.data?.errors?.[0]?.code || err.response?.data?.error;
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    writeLog(`✘ KEEP-ALIVE FAILED — Status: ${status} | Code: ${code} | ${message}`);
    writeLog('─────────────────────────────────────────');
    process.exit(1);
  }
}

keepAlive();
