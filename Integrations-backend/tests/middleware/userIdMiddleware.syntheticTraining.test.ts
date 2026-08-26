import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const extractRequestToken: any = jest.fn();
const verifyAccessToken: any = jest.fn();

jest.mock('../../src/utils/authTokenVerifier', () => ({ extractRequestToken, verifyAccessToken }));
jest.mock('../../src/database/supabaseClient', () => ({
  convertUserIdToUuid: (value: string) => value === 'demo-user'
    ? '00000000-0000-4000-8000-000000000001'
    : value,
}));

import { userIdMiddleware } from '../../src/middleware/userIdMiddleware';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const originalInternalApiKey = process.env.INTERNAL_API_KEY;

function makeRequest(headers: Record<string, string> = {}) {
  return {
    originalUrl: '/api/csv-upload/synthetic-training/ingest',
    path: '/api/csv-upload/synthetic-training/ingest',
    method: 'POST',
    ip: '127.0.0.1',
    headers,
  } as any;
}

function makeResponse() {
  const response: any = {
    status: jest.fn(() => response),
    json: jest.fn(() => response),
  };
  return response;
}

describe('userIdMiddleware synthetic training endpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    extractRequestToken.mockReturnValue(null);
    verifyAccessToken.mockResolvedValue(null);
    delete process.env.INTERNAL_API_KEY;
  });

  afterEach(() => {
    if (originalInternalApiKey === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = originalInternalApiKey;
  });

  it('rejects a synthetic upload with no verified identity even in a development test process', async () => {
    const request = makeRequest();
    const response = makeResponse();
    const next = jest.fn();

    await userIdMiddleware(request, response, next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: 'User authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not trust a browser-supplied x-user-id without the configured internal API key', async () => {
    const request = makeRequest({ 'x-user-id': USER_ID });
    const response = makeResponse();
    const next = jest.fn();

    await userIdMiddleware(request, response, next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a verified token identity and records its authenticated source', async () => {
    extractRequestToken.mockReturnValue('verified-token');
    verifyAccessToken.mockResolvedValue({ id: USER_ID, source: 'backend' });
    const request = makeRequest({ authorization: 'Bearer verified-token' });
    const response = makeResponse();
    const next = jest.fn();

    await userIdMiddleware(request, response, next);

    expect(request.userId).toBe(USER_ID);
    expect(request.authIdentitySource).toBe('verified-backend-jwt');
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });
});
