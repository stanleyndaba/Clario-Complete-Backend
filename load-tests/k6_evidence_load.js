import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '1m',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<800'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const TOKEN = __ENV.TOKEN || '';
const SOURCE_ID = __ENV.SOURCE_ID || '';

const headers = TOKEN
  ? { Authorization: `Bearer ${TOKEN}` }
  : {};

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  // 1) Evidence metrics
  const m = http.get(`${BASE_URL}/api/metrics/evidence`, { headers });
  check(m, { 'metrics 200': (r) => r.status === 200 });

  // 2) Evidence search
  const queries = ['Amazon', 'invoice', 'receipt', 'shipment', '123-1234567-1234567'];
  const q = randChoice(queries);
  const s = http.get(`${BASE_URL}/api/v1/integrations/evidence/search?q=${encodeURIComponent(q)}`, { headers });
  check(s, { 'search 200/401': (r) => r.status === 200 || r.status === 401 });

  // 3) Trigger sync (optional)
  if (SOURCE_ID) {
    const sync = http.post(`${BASE_URL}/api/v1/integrations/evidence/sources/${SOURCE_ID}/sync`, null, { headers });
    check(sync, { 'sync ok/accepted': (r) => r.status === 200 || r.status === 202 || r.status === 401 });
  }

  sleep(1);
}

