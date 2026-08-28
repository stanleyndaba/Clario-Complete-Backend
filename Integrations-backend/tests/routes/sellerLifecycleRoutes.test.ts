import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockResolve: any = jest.fn();

jest.mock('../../src/services/sellerLifecycleService', () => ({
  __esModule: true,
  default: { resolve: mockResolve },
}));

jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    if (req.headers.authorization !== 'Bearer lifecycle-token') {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }
    req.user = { id: 'user-a', email: 'seller@example.com' };
    return next();
  },
}));

import sellerLifecycleRoutes from '../../src/routes/sellerLifecycleRoutes';

function createApp(withTenant = true) {
  const app = express();
  if (withTenant) {
    app.use((req: any, _res, next) => {
      req.tenant = { tenantId: 'tenant-a', tenantSlug: 'tenant-a' };
      next();
    });
  }
  app.use('/api/seller-lifecycle', sellerLifecycleRoutes);
  return app;
}

describe('sellerLifecycleRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the authenticated identity and existing tenant context rather than browser-provided IDs', async () => {
    mockResolve.mockResolvedValue({
      tenant: { id: 'tenant-a', slug: 'tenant-a' },
      continuation: { kind: 'audit_default', destination: '/audit', audit_id: null, audit_status: null, intent_id: null },
      amazon: { connected: false, needs_reconnect: false, status: 'connection_required', error_code: null, error_message: null },
      entitlement: { entitled: false, state: 'none', access_until: null },
    });

    const response = await request(createApp())
      .get('/api/seller-lifecycle?tenantId=tenant-attacker&userId=user-attacker&auditIntentId=intent-a')
      .set('Authorization', 'Bearer lifecycle-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, continuation: { destination: '/audit' } });
    expect(mockResolve).toHaveBeenCalledWith({
      userId: 'user-a',
      tenantId: 'tenant-a',
      tenantSlug: 'tenant-a',
      auditIntentId: 'intent-a',
    });
  });

  it('fails closed when authentication is missing', async () => {
    const response = await request(createApp()).get('/api/seller-lifecycle');

    expect(response.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('requires tenant context provided by existing middleware', async () => {
    const response = await request(createApp(false))
      .get('/api/seller-lifecycle')
      .set('Authorization', 'Bearer lifecycle-token');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, message: 'Active workspace context is required' });
  });
});
