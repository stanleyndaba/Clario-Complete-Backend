import puppeteer from 'puppeteer';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const JWT_SECRET = '6d55b17615e87f15b252adc68a4b87ee69c2d910ef4b12d5b12fae94568b86cc';
const SUPABASE_URL = 'https://uuuqpujtnubusmigbkvw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dXFwdWp0bnVidXNtaWdia3Z3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzM5NjgzOSwiZXhwIjoyMDY4OTcyODM5fQ.Z_1TUlk3WgtCggP80UYPGj8gK-JKdgjPf3rNkHxIrBE';
const API_BASE = 'https://opside-node-api-woco.onrender.com';
const FRONTEND_BASE = 'https://margin-finance.com';
const TENANT_SLUG = 'demo-workspace';
const USER_ID = '07b4f03d-352e-473f-a316-af97d9017d69';
const USER_EMAIL = 'proof@margin-finance.com';
const CASE_NUMBER = 'DMO-CASE-1005';
const RECOVERY_WORK_ITEM_ID = 'f5a316ab-aa67-4244-bd01-5669a7909083';
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const token = jwt.sign({ id: USER_ID, email: USER_EMAIL }, JWT_SECRET, { expiresIn: '2h' });
const authHeaders = { Authorization: `Bearer ${token}` };
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function compactRow(row) {
  if (!row) return null;
  return {
    recovery_work_status: row.recovery_work_status,
    recovery_work_error: row.recovery_work_error,
    recovery_work_attempts: row.recovery_work_attempts,
    recovery_work_max_attempts: row.recovery_work_max_attempts,
    recovery_defer_count: row.recovery_defer_count,
    recovery_last_deferred_reason: row.recovery_last_deferred_reason,
    recovery_next_attempt_at: row.recovery_next_attempt_at,
    recovery_last_processed_at: row.recovery_last_processed_at,
    recovery_execution_lane: row.recovery_execution_lane,
    recovery_locked_by: row.recovery_locked_by,
    recovery_lifecycle_state: row.recovery_lifecycle_state,
    operator_state: row.operator_state,
    last_updated_at: row.last_updated_at,
  };
}

async function getTenant() {
  const res = await fetch(`${API_BASE}/api/tenant/current?slug=${encodeURIComponent(TENANT_SLUG)}`, { headers: authHeaders });
  const data = await res.json();
  if (!res.ok || !data?.tenant?.id) {
    throw new Error(`Tenant fetch failed: ${res.status}`);
  }
  return data.tenant;
}

async function getLedgerRow() {
  const url = `${API_BASE}/api/recoveries/ledger?tenantSlug=${encodeURIComponent(TENANT_SLUG)}&search=${encodeURIComponent(CASE_NUMBER)}&page=1&page_size=10`;
  const res = await fetch(url, { headers: authHeaders });
  const data = await res.json();
  if (!res.ok || !Array.isArray(data?.rows)) {
    throw new Error(`Ledger fetch failed: ${res.status}`);
  }
  return data.rows.find((item) => item.case_number === CASE_NUMBER) || null;
}

async function requeueRecovery() {
  const { error } = await supabase
    .from('recovery_work_items')
    .update({
      status: 'pending',
      next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', RECOVERY_WORK_ITEM_ID);

  if (error) throw error;
}

function isAllowedApi(url) {
  return (
    url.includes('/api/tenant/current') ||
    url.includes('/api/tenant/list') ||
    url.includes('/api/tenant/plan') ||
    url.includes('/api/recoveries/ledger') ||
    url.includes('/api/sse/status') ||
    url.includes('/api/sse/recent') ||
    url.includes('/api/auth/me')
  );
}

async function readVisibleRow(page) {
  return page.evaluate((caseNumber) => {
    const body = document.body.innerText || '';
    const nodes = Array.from(document.querySelectorAll('body *'));
    const candidates = nodes.filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const text = node.innerText || '';
      if (!text.includes(caseNumber)) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });

    if (!candidates.length) {
      return { rowFound: false, bodySnippet: body.slice(0, 7000) };
    }

    let card = candidates.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    for (let i = 0; i < 6 && card.parentElement; i += 1) {
      const text = card.innerText || '';
      if (
        text.includes('Last Finality Activity') ||
        text.includes('Recovery Lane') ||
        text.includes('Next Attempt') ||
        text.includes('Recovery Work Pending')
      ) {
        break;
      }
      card = card.parentElement;
    }

    card.scrollIntoView({ block: 'center' });
    return {
      rowFound: true,
      text: card.innerText,
      bodySnippet: body.slice(0, 7000),
    };
  }, CASE_NUMBER);
}

async function main() {
  const tenant = await getTenant();
  const preApi = compactRow(await getLedgerRow());

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: EDGE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1440, height: 1200 },
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(90_000);

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    const type = request.resourceType();
    const isDocument = type === 'document';
    const isScript = type === 'script';
    const isStylesheet = type === 'stylesheet';
    const isEssentialApi = url.startsWith(API_BASE) && isAllowedApi(url);
    const isFrontendAsset = url.startsWith(FRONTEND_BASE);

    if (isDocument || isScript || isStylesheet || isEssentialApi || isFrontendAsset) {
      request.continue();
      return;
    }

    request.abort();
  });

  await page.evaluateOnNewDocument((seed) => {
    localStorage.setItem('session_token', seed.token);
    localStorage.setItem('user_id', seed.userId);
    localStorage.setItem('active_tenant_slug', seed.tenantSlug);
    localStorage.setItem('active_tenant_id', seed.tenantId);
    localStorage.setItem('user_email', seed.userEmail);

    window.__sseObserved = [];
    window.__ledgerObserved = [];

    const pushLimited = (key, value) => {
      const arr = window[key];
      arr.push(value);
      if (arr.length > 50) arr.splice(0, arr.length - 50);
    };

    const parseSSEStream = async (stream) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = 'message';
      let dataLines = [];

      const flush = () => {
        if (!dataLines.length) {
          eventName = 'message';
          return;
        }
        const raw = dataLines.join('\n');
        let parsed = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {}
        pushLimited('__sseObserved', {
          event: eventName || 'message',
          data: parsed,
          seenAt: new Date().toISOString(),
        });
        eventName = 'message';
        dataLines = [];
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line === '') {
            flush();
            continue;
          }
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || 'message';
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
          }
        }
      }
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const request = args[0];
      const url = typeof request === 'string' ? request : request?.url || '';
      const response = await originalFetch(...args);

      if (url.includes('/api/sse/status') && response.body?.tee) {
        const [tap, passthrough] = response.body.tee();
        void parseSSEStream(tap);
        return new Response(passthrough, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      if (url.includes('/api/recoveries/ledger')) {
        response.clone().json().then((payload) => {
          const row = Array.isArray(payload?.rows)
            ? payload.rows.find((item) => item.case_number === seed.caseNumber) || null
            : null;
          pushLimited('__ledgerObserved', {
            seenAt: new Date().toISOString(),
            row: row
              ? {
                  recovery_defer_count: row.recovery_defer_count,
                  recovery_last_deferred_reason: row.recovery_last_deferred_reason,
                  recovery_next_attempt_at: row.recovery_next_attempt_at,
                  recovery_last_processed_at: row.recovery_last_processed_at,
                  recovery_execution_lane: row.recovery_execution_lane,
                  operator_state: row.operator_state,
                }
              : null,
          });
        }).catch(() => {});
      }

      return response;
    };
  }, {
    token,
    userId: USER_ID,
    userEmail: USER_EMAIL,
    tenantSlug: TENANT_SLUG,
    tenantId: tenant.id,
    caseNumber: CASE_NUMBER,
  });

  await page.goto(`${FRONTEND_BASE}/app/${TENANT_SLUG}/recoveries?q=${encodeURIComponent(CASE_NUMBER)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });

  await page.waitForFunction(() => document.body.innerText.includes('Recovery Pipeline'), { timeout: 60_000 }).catch(() => {});
  await page.waitForResponse((res) => res.url().includes('/api/recoveries/ledger') && res.status() === 200, { timeout: 90_000 }).catch(() => null);
  await sleep(12_000);

  let preVisible = await readVisibleRow(page);
  if (!preVisible?.rowFound) {
    const state = await page.evaluate(() => ({
      sseObserved: window.__sseObserved,
      ledgerObserved: window.__ledgerObserved,
      body: document.body.innerText.slice(0, 7000),
    }));
    console.log(JSON.stringify({ status: 'row_not_rendered', preApi, state }, null, 2));
    await browser.close();
    return;
  }

  await page.evaluate(() => {
    window.__sseObserved = [];
    window.__ledgerObserved = [];
  });

  await requeueRecovery();

  let sseSeen = false;
  await page.waitForFunction((workId) => {
    return Array.isArray(window.__sseObserved) && window.__sseObserved.some((entry) => {
      const evt = String(entry?.event || '').toLowerCase();
      const data = entry?.data || {};
      const itemId = String(data.recovery_work_item_id || data.payload?.recovery_work_item_id || '').trim();
      return itemId === workId && (evt === 'recovery.work_claimed' || evt === 'recovery.work_deferred');
    });
  }, { timeout: 120_000 }).then(() => {
    sseSeen = true;
  }).catch(() => {});

  let postVisible = null;
  for (let i = 0; i < 20; i += 1) {
    const snapshot = await readVisibleRow(page);
    if (snapshot?.rowFound && snapshot.text !== preVisible.text) {
      postVisible = snapshot;
      break;
    }
    await sleep(5_000);
  }
  if (!postVisible) {
    postVisible = await readVisibleRow(page);
  }

  const postApi = compactRow(await getLedgerRow());
  const state = await page.evaluate(() => ({
    sseObserved: window.__sseObserved,
    ledgerObserved: window.__ledgerObserved,
    body: document.body.innerText.slice(0, 7000),
  }));

  console.log(JSON.stringify({
    status: 'completed',
    preApi,
    postApi,
    preVisible,
    postVisible,
    sseSeen,
    state,
  }, null, 2));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
