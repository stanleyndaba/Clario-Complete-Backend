import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockVerifyClerkToken = jest.fn();
const mockGetUser = jest.fn();
const mockCreateClerkClient = jest.fn((_config?: unknown) => ({
  users: {
    getUser: mockGetUser
  }
}));
const mockFrom = jest.fn();

function createQuery(data: unknown, error: unknown = null) {
  const query: any = {
    select: () => query,
    eq: () => query,
    is: () => query,
    in: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve, reject),
  };
  return query;
}

jest.mock('@clerk/express', () => ({
  __esModule: true,
  verifyToken: mockVerifyClerkToken,
  createClerkClient: mockCreateClerkClient
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: null }, error: null }))
    },
    from: mockFrom,
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
    mockFrom.mockImplementation(() => createQuery([]));
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
      clerkUserId: 'user_clerk123',
      email: 'seller@example.com',
      role: 'member',
      source: 'clerk'
    });
  });

  it('selects the unique active-membership holder when legacy duplicate Clerk mappings exist', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('not an internal token');
    });
    mockVerifyClerkToken.mockResolvedValue({
      sub: 'user_clerk123',
      email: 'seller@example.com',
    } as never);
    mockFrom
      .mockReturnValueOnce(createQuery([
        { id: 'margin-user-without-membership' },
        { id: 'margin-user-with-membership' },
      ]))
      .mockReturnValueOnce(createQuery([
        { user_id: 'margin-user-with-membership' },
      ]));

    await expect(verifyAccessToken('clerk-session-token')).resolves.toEqual({
      id: 'margin-user-with-membership',
      clerkUserId: 'user_clerk123',
      email: 'seller@example.com',
      role: undefined,
      source: 'clerk',
    });
  });

  it('fails closed rather than selecting an arbitrary duplicate Clerk mapping with no active memberships', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('not an internal token');
    });
    mockVerifyClerkToken.mockResolvedValue({
      sub: 'user_clerk123',
      email: 'seller@example.com',
    } as never);
    mockFrom
      .mockReturnValueOnce(createQuery([
        { id: 'margin-user-a' },
        { id: 'margin-user-b' },
      ]))
      .mockReturnValueOnce(createQuery([]));

    await expect(verifyAccessToken('clerk-session-token')).resolves.toEqual({
      id: 'user_clerk123',
      clerkUserId: 'user_clerk123',
      email: 'seller@example.com',
      role: undefined,
      source: 'clerk',
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
