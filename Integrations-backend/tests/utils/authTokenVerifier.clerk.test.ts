import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockVerifyClerkToken = jest.fn();
const mockGetUser = jest.fn();
const mockCreateClerkClient = jest.fn(() => ({
  users: {
    getUser: mockGetUser
  }
}));

jest.mock('@clerk/express', () => ({
  __esModule: true,
  verifyToken: mockVerifyClerkToken,
  createClerkClient: mockCreateClerkClient
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: null }, error: null }))
    }
  },
  supabaseAdmin: null
}));

jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: {
    JWT_SECRET: 'test-internal-secret'
  }
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    verify: jest.fn()
  },
  verify: jest.fn()
}));

import jwt from 'jsonwebtoken';
import { resolveClerkPrimaryEmail, verifyAccessToken } from '../../src/utils/authTokenVerifier';

describe('authTokenVerifier Clerk bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLERK_SECRET_KEY = 'test_clerk_secret';
  });

  it('keeps existing internal JWT verification first', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({
      id: 'internal-user-id',
      email: 'internal@example.com',
      role: 'admin'
    });

    const verified = await verifyAccessToken('internal-token');

    expect(verified).toEqual({
      id: 'internal-user-id',
      email: 'internal@example.com',
      role: 'admin',
      source: 'backend_jwt'
    });
    expect(mockVerifyClerkToken).not.toHaveBeenCalled();
  });

  it('maps a valid Clerk session token subject to the existing identity shape', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('not an internal token');
    });
    mockVerifyClerkToken.mockResolvedValue({
      sub: 'user_clerk123',
      email: 'seller@example.com',
      role: 'member'
    } as never);

    const verified = await verifyAccessToken('clerk-session-token');

    expect(mockVerifyClerkToken).toHaveBeenCalledWith('clerk-session-token', {
      secretKey: 'test_clerk_secret'
    });
    expect(verified).toEqual({
      id: 'user_clerk123',
      email: 'seller@example.com',
      role: 'member',
      source: 'clerk'
    });
  });

  it('rejects invalid Clerk tokens when no legacy fallback authenticates them', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('not an internal token');
    });
    mockVerifyClerkToken.mockRejectedValue(new Error('invalid clerk token') as never);

    const verified = await verifyAccessToken('invalid-token');

    expect(verified).toBeNull();
  });

  it('resolves the primary Clerk email without trusting request body data', async () => {
    mockGetUser.mockResolvedValue({
      primaryEmailAddress: {
        emailAddress: 'Primary@Example.com',
        verification: {
          status: 'verified'
        }
      },
      primaryEmailAddressId: 'email_primary',
      emailAddresses: []
    } as never);

    const email = await resolveClerkPrimaryEmail('user_clerk123');

    expect(mockCreateClerkClient).toHaveBeenCalledWith({ secretKey: 'test_clerk_secret' });
    expect(mockGetUser).toHaveBeenCalledWith('user_clerk123');
    expect(email).toBe('primary@example.com');
  });
});
