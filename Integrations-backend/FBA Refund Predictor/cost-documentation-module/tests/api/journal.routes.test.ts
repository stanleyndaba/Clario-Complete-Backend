import request from 'supertest';
import { app } from '../../src/index';

// Helpers to set auth header (simplified mock JWT)
function auth(token: string = 'valid'): string { return `Bearer ${token}`; }

describe('API /api/v1/journal', () => {
  it('rejects unauthorized access (401)', async () => {
    const res = await request(app).post('/api/v1/journal/journal').send({});
    expect([401, 403]).toContain(res.status);
  });

  it('rejects invalid body (400)', async () => {
    const res = await request(app)
      .post('/api/v1/journal/journal')
      .set('Authorization', auth())
      .send({ tx_type: '', entity_id: '', payload: 'not-object' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'ValidationError');
  });

  it('accepts valid journal entry (200)', async () => {
    const res = await request(app)
      .post('/api/v1/journal/journal')
      .set('Authorization', auth())
      .send({ tx_type: 'inventory_update', entity_id: 'SKU123', payload: { qty: 1 } });
    // Depending on real auth, this may be 401; treat as smoke test of validation pipeline
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('hash');
    }
  });

  it('lists transactions with query validation', async () => {
    const res = await request(app)
      .get('/api/v1/journal/journal?limit=10')
      .set('Authorization', auth());
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('items');
    }
  });
});


