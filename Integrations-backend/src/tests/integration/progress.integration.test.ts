import request from 'supertest';
import app from '../../index';

describe('Progress endpoints', () => {
  it('health endpoint returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
  });
  it('SSE endpoint responds (smoke)', async () => {
    const res = await request(app).get('/api/sse/sync-progress/test-sync').buffer(true);
    expect([200, 404]).toContain(res.status);
  });
});

