import axios from 'axios';
import { integrationsApiController } from '../integrationsApiController';

jest.mock('axios');
jest.mock('../../models/oauthToken', () => ({
  storeOAuthToken: jest.fn().mockResolvedValue(undefined),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const { storeOAuthToken } = require('../../models/oauthToken');

function mockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation((payload: any) => {
    res.payload = payload;
    return res;
  });
  return res;
}

describe('integrationsApiController.processAmazonOAuth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...OLD_ENV };
    (process.env as any)['AMAZON_CLIENT_ID'] = 'client-id';
    (process.env as any)['AMAZON_CLIENT_SECRET'] = 'client-secret';
    (process.env as any)['AMAZON_REDIRECT_URI'] = 'http://localhost/callback';
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('returns 200 and seller data on happy path', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'access', refresh_token: 'refresh' },
    } as any);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        payload: {
          marketplaceParticipations: [
            {
              participation: { sellerId: 'SELLER123', sellerName: 'ACME LLC' },
              marketplace: { id: 'ATVPDKIKX0DER' },
            },
          ],
        },
      },
    } as any);

    const req: any = { body: { code: 'code123', state: 'state123' } };
    const res = mockRes();

    await integrationsApiController.processAmazonOAuth(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.payload?.success).toBe(true);
    expect(res.payload?.data?.amazon_seller_id).toBe('SELLER123');
    expect(res.payload?.data?.company_name).toBe('ACME LLC');
    expect(res.payload?.data?.marketplaces).toEqual(['ATVPDKIKX0DER']);
    expect(storeOAuthToken).toHaveBeenCalledWith('SELLER123', 'refresh');
  });

  it('returns 400 on LWA token exchange failure', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('invalid_grant'));

    const req: any = { body: { code: 'bad_code', state: 'state123' } };
    const res = mockRes();

    await integrationsApiController.processAmazonOAuth(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.payload?.success).toBe(false);
    expect(res.payload?.error).toBe('token_exchange_failed');
  });

  it('returns 502 on Sellers API failure', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'access', refresh_token: 'refresh' },
    } as any);
    mockedAxios.get.mockRejectedValueOnce(new Error('sellers down'));

    const req: any = { body: { code: 'code123', state: 'state123' } };
    const res = mockRes();

    await integrationsApiController.processAmazonOAuth(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.payload?.success).toBe(false);
    expect(res.payload?.error).toBe('sellers_api_failed');
  });

  it('returns 400 when missing parameters', async () => {
    const req: any = { body: {} };
    const res = mockRes();

    await integrationsApiController.processAmazonOAuth(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.payload?.success).toBe(false);
    expect(res.payload?.error).toBe('missing_parameters');
  });
});


