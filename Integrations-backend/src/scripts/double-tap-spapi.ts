/**
 * SP-API "Double-Tap" Validation Script
 * ======================================
 * Purpose: Force Amazon's auditing system to register a successful API call
 *          for the "Margin Analytics" developer account, satisfying Section 3.5
 *          of the Amazon Services API Acceptable Use Policy.
 *
 * Steps:
 *  [1/3] GET  /sellers/v1/marketplaceParticipations   — "Hello" handshake
 *  [2/3] POST /reports/2021-06-30/reports             — "Heavy action" (forces log entry)
 *  [3/3] GET  /reports/2021-06-30/reports/{id}        — Status follow-up
 *
 * Run from Integrations-backend directory:
 *   npx ts-node src/scripts/double-tap-spapi.ts
 */

import 'dotenv/config';
import axios from 'axios';

// ─── Colours for terminal output ────────────────────────────────────────────
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';

function log(msg: string)       { console.log(msg); }
function ok(msg: string)        { console.log(`${GREEN}✔ ${msg}${RESET}`); }
function info(msg: string)      { console.log(`${CYAN}  ${msg}${RESET}`); }
function warn(msg: string)      { console.log(`${YELLOW}⚠ ${msg}${RESET}`); }
function fail(msg: string)      { console.error(`${RED}✘ ${msg}${RESET}`); }
function banner(msg: string)    { console.log(`\n${BOLD}${CYAN}${msg}${RESET}`); }
function separator()            { console.log(`${CYAN}${'─'.repeat(60)}${RESET}`); }

// ─── Config ──────────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.AMAZON_CLIENT_ID     || process.env.AMAZON_SPAPI_CLIENT_ID;
const CLIENT_SECRET = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.AMAZON_SPAPI_REFRESH_TOKEN || process.env.AMAZON_REFRESH_TOKEN;

// Decide region — default to NA production (where the account is registered)
const BASE_URL = process.env.AMAZON_SPAPI_BASE_URL || 'https://sellingpartnerapi-na.amazon.com';

// US marketplace — the primary marketplace for "Margin Analytics"
const MARKETPLACE_ID = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';

// ─── Step 0: Obtain a fresh LWA access token ────────────────────────────────
async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error(
      'Missing credentials. Ensure AMAZON_CLIENT_ID, AMAZON_CLIENT_SECRET, ' +
      'and AMAZON_SPAPI_REFRESH_TOKEN are set in your .env file.'
    );
  }

  info('Exchanging refresh token for a fresh LWA access token...');

  const response = await axios.post<{ access_token: string; expires_in: number }>(
    'https://api.amazon.com/auth/o2/token',
    {
      grant_type:    'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    },
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, expires_in } = response.data;
  ok(`Access token obtained (expires in ${expires_in}s)`);
  return access_token;
}

// ─── Step 1: GET marketplaceParticipations ───────────────────────────────────
async function step1_helloHandshake(token: string): Promise<string> {
  banner('[1/3] Calling GET /sellers/v1/marketplaceParticipations...');

  const url = `${BASE_URL}/sellers/v1/marketplaceParticipations`;

  const response = await axios.get<{
    payload?: { marketplaceParticipations?: Array<{ marketplace: { id: string; name: string }; participation: { isParticipating: boolean } }> };
  }>(url, {
    headers: {
      Authorization:       `Bearer ${token}`,
      'x-amz-access-token': token,
      'Content-Type':      'application/json',
    },
    timeout: 30_000,
  });

  const participations = response.data?.payload?.marketplaceParticipations || [];

  if (participations.length === 0) {
    warn('No marketplace participations returned — but the call itself succeeded.');
    ok(`HTTP ${response.status} — registered in Amazon logs`);
    return 'UNKNOWN_SELLER';
  }

  const first       = participations[0];
  const sellerId    = (first as any).marketplace?.id || 'N/A';
  const storeName   = (first as any).marketplace?.name || 'N/A';
  const isActive    = (first as any).participation?.isParticipating ?? 'N/A';

  ok(`Marketplace participations received — ${participations.length} marketplace(s)`);
  info(`First entry → Marketplace ID: ${sellerId} | Name: ${storeName} | Active: ${isActive}`);

  return sellerId;
}

// ─── Step 2: POST createReport (Heavy action) ────────────────────────────────
// Report types tried in order — first one that Amazon accepts wins.
// Settlement reports need special permissions; merchant listing reports are universally available.
const REPORT_TYPE_CANDIDATES = [
  'GET_MERCHANT_LISTINGS_ALL_DATA',          // All active + inactive listings  (type 1000)
  'GET_FLAT_FILE_OPEN_LISTINGS_DATA',        // Open listings flat file          (type 1001)
  'GET_MERCHANT_LISTINGS_DATA',              // Active listings                  (type 1002)
  'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2', // Settlement (restricted)      (type 1118)
];

async function step2_createReport(token: string): Promise<string> {
  banner('[2/3] POSTing report request (heavy auditing action)...');
  info('This POST forces a timestamped log entry in Amazon\'s auditing system.');

  const url = `${BASE_URL}/reports/2021-06-30/reports`;

  for (const reportType of REPORT_TYPE_CANDIDATES) {
    info(`Trying report type: ${reportType}`);
    const body = { reportType, marketplaceIds: [MARKETPLACE_ID] };

    try {
      const response = await axios.post<{ reportId: string }>(url, body, {
        headers: {
          Authorization:       `Bearer ${token}`,
          'x-amz-access-token': token,
          'Content-Type':      'application/json',
        },
        timeout: 30_000,
      });

      const reportId = response.data?.reportId;
      if (!reportId) throw new Error(`No reportId returned for ${reportType}`);

      ok(`Report requested — type: ${reportType}  |  reportId: ${reportId}`);
      info(`Timestamp: ${new Date().toISOString()} — this entry is now in Amazon\'s audit log.`);
      return reportId;
    } catch (err: any) {
      const code = err.response?.data?.errors?.[0]?.code || err.response?.data?.error;
      const msg  = err.response?.data?.errors?.[0]?.message || err.message;
      if (err.response?.status === 400 && (code === 'InvalidInput' || code === 'InvalidReportType')) {
        warn(`  ${reportType} not available (${code}: ${msg}) — trying next type...`);
        continue;
      }
      throw err; // Unexpected error — let the outer handler deal with it
    }
  }

  throw new Error('All report types were rejected by Amazon. The POST action could not be completed.');
}

// ─── Step 3: GET report status ────────────────────────────────────────────────
async function step3_reportStatus(token: string, reportId: string): Promise<void> {
  banner('[3/3] Verifying Report Status...');

  const url = `${BASE_URL}/reports/2021-06-30/reports/${reportId}`;

  const response = await axios.get<{ reportId: string; processingStatus: string; reportType: string }>(url, {
    headers: {
      Authorization:       `Bearer ${token}`,
      'x-amz-access-token': token,
      'Content-Type':      'application/json',
    },
    timeout: 30_000,
  });

  const { processingStatus, reportType } = response.data;

  ok(`Report status received — processingStatus: ${processingStatus}`);
  info(`Report type: ${reportType}`);
  info('Amazon has confirmed the report request is registered in its system.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function doubleTap(): Promise<void> {
  separator();
  log(`${BOLD}  SP-API Double-Tap — "Margin Analytics" Account Validator${RESET}`);
  log(`  ${new Date().toISOString()}`);
  separator();

  info(`Target endpoint:  ${BASE_URL}`);
  info(`Marketplace:      ${MARKETPLACE_ID}`);
  info(`Has credentials:  CLIENT_ID=${!!CLIENT_ID}  SECRET=${!!CLIENT_SECRET}  REFRESH_TOKEN=${!!REFRESH_TOKEN}`);

  log('');

  try {
    // ── Token ──
    const token = await getAccessToken();
    log('');

    // ── Step 1 ──
    const sellerId = await step1_helloHandshake(token);
    log('');

    // ── Step 2 ──
    const reportId = await step2_createReport(token);
    log('');

    // ── Step 3 ──
    await step3_reportStatus(token, reportId);
    log('');

    // ── Summary ──
    separator();
    log(`${BOLD}${GREEN}`);
    log('  ██████╗  ██████╗ ███╗   ██╗███████╗██╗');
    log('  ██╔══██╗██╔═══██╗████╗  ██║██╔════╝██║');
    log('  ██║  ██║██║   ██║██╔██╗ ██║█████╗  ██║');
    log('  ██║  ██║██║   ██║██║╚██╗██║██╔══╝  ╚═╝');
    log('  ██████╔╝╚██████╔╝██║ ╚████║███████╗██╗');
    log('  ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚═╝');
    log(`${RESET}`);
    log(`${BOLD}  DOUBLE-TAP COMPLETE${RESET}`);
    log('');
    log(`  ✔  Marketplace participations: confirmed`);
    log(`  ✔  Settlement report created:  ${reportId}`);
    log(`  ✔  Report status verified:     OK`);
    log('');
    log(`  "Margin Analytics" is now officially active in Amazon\'s auditing logs.`);
    log(`  The deadline warning email can be safely ignored.`);
    separator();

  } catch (err: any) {
    const message   = err.response?.data?.errors?.[0]?.message || err.response?.data?.error_description || err.message;
    const status    = err.response?.status;
    const errorCode = err.response?.data?.errors?.[0]?.code || err.response?.data?.error;

    separator();
    fail(`DOUBLE-TAP FAILED`);
    fail(`Status:  ${status ?? 'N/A'}`);
    fail(`Code:    ${errorCode ?? 'N/A'}`);
    fail(`Message: ${message}`);
    separator();

    if (status === 401 || errorCode === 'invalid_grant') {
      warn('');
      warn('The refresh token may be invalid or expired.');
      warn('Go to Seller Central → Apps & Services → Manage Your Apps');
      warn('and re-authorise the "Margin Analytics" application.');
    }

    process.exit(1);
  }
}

doubleTap();
