import request from 'supertest';
import { app } from '../../src/index';

function auth(token: string = 'valid'): string { return `Bearer ${token}`; }

describe('API /api/v1.1/cost-docs', () => {
  it('lock doc: requires auth', async () => {
    const res = await request(app).post('/api/v1.1/cost-docs/docs/00000000-0000-0000-0000-000000000000/lock');
    expect([401, 403]).toContain(res.status);
  });

  it('export docs: validation errors return consistent error shape', async () => {
    const res = await request(app)
      .post('/api/v1.1/cost-docs/docs/export')
      .set('Authorization', auth())
      .send({ document_ids: [], bundle_name: '', format: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'ValidationError');
    expect(res.body).toHaveProperty('success', false);
  });

  it('export docs: accepts valid body (depending on auth/DB)', async () => {
    const res = await request(app)
      .post('/api/v1.1/cost-docs/docs/export')
      .set('Authorization', auth())
      .send({
        document_ids: ['00000000-0000-0000-0000-000000000001'],
        bundle_name: 'Test',
        format: 'zip'
      });
    expect([200, 401, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
    }
  });
});


