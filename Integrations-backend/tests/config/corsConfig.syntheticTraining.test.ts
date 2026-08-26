import express from 'express';
import { describe, expect, it } from '@jest/globals';
import cors from 'cors';
import request from 'supertest';
import { buildCorsOptions, SYNTHETIC_EXECUTION_PROVENANCE_HEADER } from '../../src/config/corsConfig';

describe('synthetic training browser CORS contract', () => {
  function createApp() {
    const app = express();
    app.use(cors(buildCorsOptions({ NODE_ENV: 'production' })));
    app.post('/api/csv-upload/synthetic-training/ingest', (_req, res) => res.status(204).end());
    return app;
  }

  it('allows the exact required provenance header from the production Margin origin', async () => {
    const response = await request(createApp())
      .options('/api/csv-upload/synthetic-training/ingest')
      .set('Origin', 'https://margin-finance.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', [
        'authorization',
        'content-type',
        'x-tenant-id',
        SYNTHETIC_EXECUTION_PROVENANCE_HEADER.toLowerCase(),
      ].join(','));

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://margin-finance.com');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(String(response.headers['access-control-allow-headers']).toLowerCase())
      .toContain(SYNTHETIC_EXECUTION_PROVENANCE_HEADER.toLowerCase());
  });

  it('does not permit unconfigured browser origins to complete the synthetic preflight', async () => {
    const response = await request(createApp())
      .options('/api/csv-upload/synthetic-training/ingest')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', SYNTHETIC_EXECUTION_PROVENANCE_HEADER.toLowerCase());

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not silently allow the synthetic provenance header through a wildcard origin policy', () => {
    const options = buildCorsOptions({ NODE_ENV: 'production' });
    expect(options.origin).not.toBe('*');
    expect(options.allowedHeaders).toContain(SYNTHETIC_EXECUTION_PROVENANCE_HEADER);
  });
});
