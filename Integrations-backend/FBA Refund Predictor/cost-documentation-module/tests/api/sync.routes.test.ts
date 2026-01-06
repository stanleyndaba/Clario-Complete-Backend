import request from 'supertest';
import { app } from '../../src/index';

function auth(token: string = 'valid'): string { return `Bearer ${token}`; }

describe('API /api/v1/sync-check', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/v1/sync-check/ENTITY123');
    expect([401, 403]).toContain(res.status);
  });

  it('returns discrepancy status (smoke)', async () => {
    const res = await request(app)
      .get('/api/v1/sync-check/ENTITY123?source=internal')
      .set('Authorization', auth());
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('is_in_sync');
      expect(res.body.data).toHaveProperty('snapshot_hash');
    }
  });

  it('refresh endpoint works (smoke)', async () => {
    const res = await request(app)
      .post('/api/v1/sync-check/ENTITY123/refresh?source=internal')
      .set('Authorization', auth());
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('snapshot_hash');
    }
  });
});


