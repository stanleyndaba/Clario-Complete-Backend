import { describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockInitializeSubscription = jest.fn<(input: any) => Promise<any>>();

class MockWorkspaceCommercialEligibilityError extends Error {
  readonly code = 'workspace_not_eligible' as const;
  readonly status = 409;
  readonly commercial: { route: string | null; eligibility: string | null };

  constructor(commercial: { route: string | null; eligibility: string | null }) {
    super('This audit does not qualify for Recovery Workspace checkout.');
    this.commercial = commercial;
  }
}

jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: '11111111-1111-1111-1111-111111111111', email: 'seller@example.test' };
    next();
  },
}));

jest.mock('../../src/services/paymentRepository', () => ({
  getPaymentByReference: jest.fn(),
}));

jest.mock('../../src/services/recoverOnceService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../src/services/paystackSubscriptionService', () => ({
  __esModule: true,
  default: { initializeSubscription: mockInitializeSubscription },
  WorkspaceCommercialEligibilityError: MockWorkspaceCommercialEligibilityError,
}));

jest.mock('../../src/services/paystackService', () => ({
  verifyPaystackWebhookSignature: jest.fn(),
}));

import paystackRoutes from '../../src/routes/paystackRoutes';

describe('POST /api/paystack/subscription/initialize commercial eligibility response', () => {
  test('returns 409 workspace_not_eligible with persisted commercial truth and no checkout URL', async () => {
    mockInitializeSubscription.mockRejectedValue(
      new MockWorkspaceCommercialEligibilityError({ route: 'NO_SALE', eligibility: 'ineligible' })
    );

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.tenant = { tenantId: '22222222-2222-2222-2222-222222222222' };
      next();
    });
    app.use('/api/paystack', paystackRoutes);

    const response = await request(app)
      .post('/api/paystack/subscription/initialize')
      .send({ audit_run_id: 'audit-1' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      code: 'workspace_not_eligible',
      message: 'This audit does not qualify for Recovery Workspace checkout.',
      commercial: { route: 'NO_SALE', eligibility: 'ineligible' },
    });
    expect(mockInitializeSubscription).toHaveBeenCalledWith({
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'seller@example.test',
      auditRunId: 'audit-1',
      tenantId: '22222222-2222-2222-2222-222222222222',
    });
  });
});
