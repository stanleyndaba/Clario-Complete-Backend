import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockVerifyAccessToken = jest.fn();
const mockResolveClerkUserProfile = jest.fn();
const mockEnsureAuthenticatedUserWorkspace = jest.fn();
const mockSendWorkspaceCreatedWelcomeEmailOnce = jest.fn();
const mockAttachIntent = jest.fn();

jest.mock('../../src/utils/authTokenVerifier', () => ({
  extractRequestToken: jest.fn((req: any) => {
    const authHeader = req.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }
    return req.cookies?.session_token || null;
  }),
  verifyAccessToken: mockVerifyAccessToken,
  resolveClerkUserProfile: mockResolveClerkUserProfile
}));

jest.mock('../../src/services/userWorkspaceBootstrap', () => ({
  ensureAuthenticatedUserWorkspace: mockEnsureAuthenticatedUserWorkspace
}));

jest.mock('../../src/services/welcomeEmailService', () => ({
  welcomeEmailService: {
    sendWorkspaceCreatedWelcomeEmailOnce: mockSendWorkspaceCreatedWelcomeEmailOnce
  }
}));

jest.mock('../../src/services/auditIntentService', () => ({
  __esModule: true,
  default: {
    attachIntent: mockAttachIntent
  }
}));

jest.mock('../../src/security/rateLimiter', () => ({
  createRedisRateLimiter: jest.fn(() => (_req: any, _res: any, next: any) => next())
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: {},
  supabaseAdmin: {},
  convertUserIdToUuid: (userId: string) => userId
}));

jest.mock('../../src/utils/sellerIdentity', () => ({
  normalizeResolvedAmazonSellerId: jest.fn((amazonSellerId?: string, sellerId?: string) => amazonSellerId || sellerId || null)
}));

import authRoutes from '../../src/routes/authRoutes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

describe('authRoutes Clerk bootstrap bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PAYSTACK_REVIEW_LOGIN_ENABLED;
    delete process.env.ALLOW_DEMO_USER;
    delete process.env.PAYSTACK_REVIEW_EMAIL;
    delete process.env.PAYSTACK_REVIEW_PASSWORD;

    mockResolveClerkUserProfile.mockResolvedValue({
      email: 'primary@example.com',
      firstName: 'Amina'
    } as never);
    mockAttachIntent.mockResolvedValue(null as never);
    mockEnsureAuthenticatedUserWorkspace.mockResolvedValue({
      userId: 'margin-user-uuid',
      email: 'primary@example.com',
      tenant: {
        id: 'tenant-123',
        name: 'Primary Workspace',
        slug: 'primary-workspace',
        plan: 'free',
        status: 'active'
      },
      role: 'owner',
      createdUser: true,
      createdTenant: true,
      foundingReservation: false,
      foundingActivationReady: false
    } as never);
  });

  it('resolves the verified Clerk profile once, passes its first name to the welcome email, and preserves response shape', async () => {
    mockVerifyAccessToken.mockResolvedValue({
      id: 'margin-user-uuid',
      clerkUserId: 'user_clerk123',
      email: '',
      source: 'clerk'
    } as never);

    const response = await request(createApp())
      .post('/api/auth/bootstrap')
      .set('Authorization', 'Bearer clerk-session-token')
      .send({
        workspaceName: 'Primary Workspace',
        preferredTenantSlug: 'primary-workspace',
        foundingReservation: true,
        email: 'body-spoof@example.com'
      });

    expect(response.status).toBe(200);
    expect(mockResolveClerkUserProfile).toHaveBeenCalledTimes(1);
    expect(mockResolveClerkUserProfile).toHaveBeenCalledWith('user_clerk123');
    expect(mockEnsureAuthenticatedUserWorkspace).toHaveBeenCalledWith({
      userId: 'margin-user-uuid',
      clerkUserId: 'user_clerk123',
      email: 'primary@example.com',
      preferredWorkspaceName: 'Primary Workspace',
      preferredTenantSlug: 'primary-workspace',
      foundingReservation: true,
      authProvider: 'clerk'
    });
    expect(mockSendWorkspaceCreatedWelcomeEmailOnce).toHaveBeenCalledWith({
      userId: 'margin-user-uuid',
      email: 'primary@example.com',
      firstName: 'Amina',
      tenantId: 'tenant-123',
      tenantName: 'Primary Workspace',
      tenantSlug: 'primary-workspace',
      suppressForAuditProgress: false
    });
    expect(response.body).toEqual({
      success: true,
      user: {
        id: 'margin-user-uuid',
        email: 'primary@example.com'
      },
      tenant: {
        id: 'tenant-123',
        name: 'Primary Workspace',
        slug: 'primary-workspace',
        plan: 'free',
        status: 'active',
        role: 'owner',
        foundingReservation: false,
        foundingActivationReady: false
      },
      createdUser: true,
      createdTenant: true,
      foundingReservation: false,
      foundingActivationReady: false,
      auditIntent: null
    });
  });

  it('suppresses the welcome email after an Audit intent attaches during account bootstrap', async () => {
    mockVerifyAccessToken.mockResolvedValue({
      id: 'margin-user-uuid',
      clerkUserId: 'user_clerk123',
      email: '',
      source: 'clerk'
    } as never);
    mockAttachIntent.mockResolvedValue({
      id: 'intent-123',
      source_type: 'sp_api',
      status: 'attached',
      return_path: '/audit',
      audit_run_id: null,
      expires_at: '2027-01-01T00:00:00.000Z'
    } as never);

    const response = await request(createApp())
      .post('/api/auth/bootstrap')
      .set('Authorization', 'Bearer clerk-session-token')
      .send({ auditIntentId: 'intent-123' });

    expect(response.status).toBe(200);
    expect(mockAttachIntent).toHaveBeenCalledWith({
      intentId: 'intent-123',
      userId: 'margin-user-uuid',
      tenantId: 'tenant-123'
    });
    expect(mockSendWorkspaceCreatedWelcomeEmailOnce).toHaveBeenCalledWith(expect.objectContaining({
      suppressForAuditProgress: true
    }));
    expect(response.body.auditIntent).toEqual({
      id: 'intent-123',
      source_type: 'sp_api',
      status: 'attached',
      return_path: '/audit',
      audit_run_id: null,
      expires_at: '2027-01-01T00:00:00.000Z'
    });
  });

  it('keeps the Paystack reviewer demo login contract unchanged', async () => {
    process.env.PAYSTACK_REVIEW_LOGIN_ENABLED = 'true';
    process.env.ALLOW_DEMO_USER = 'true';
    process.env.PAYSTACK_REVIEW_EMAIL = 'paystack-review@margin-finance.com';
    process.env.PAYSTACK_REVIEW_PASSWORD = 'temporary-review-password';

    const response = await request(createApp())
      .post('/api/auth/demo-reviewer/login')
      .send({
        email: 'paystack-review@margin-finance.com',
        password: 'temporary-review-password'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      token: 'demo-session-local',
      user: {
        id: 'demo-user',
        email: 'paystack-review@margin-finance.com',
        role: 'viewer'
      },
      tenant: {
        id: '00000000-0000-0000-0000-0000000000d0',
        name: 'Acme Operations',
        slug: 'demo-workspace',
        plan: 'professional',
        status: 'read_only',
        role: 'viewer'
      },
      redirectPath: '/app/demo-workspace/dashboard'
    });
    expect(mockEnsureAuthenticatedUserWorkspace).not.toHaveBeenCalled();
  });
});
