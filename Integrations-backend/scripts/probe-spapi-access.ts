import axios, { AxiosError, Method } from 'axios';
import aws4 from 'aws4';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

type Probe = {
  name: string;
  method: Method;
  path: string;
  body?: unknown;
};

const endpoint = process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';
const endpointUrl = new URL(endpoint.startsWith('http') ? endpoint : `https://${endpoint}`);
const host = endpointUrl.host;
const region = process.env.SP_API_REGION || process.env.AWS_REGION || 'us-east-1';
const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  throw new Error(`Missing required env var. Tried: ${names.join(', ')}`);
}

function appendQuery(pathname: string, params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) qs.set(key, String(value));
  });
  return `${pathname}?${qs.toString()}`;
}

function summarize(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (depth >= 3) return Array.isArray(value) ? `[array:${value.length}]` : typeof value;

  if (Array.isArray(value)) {
    const first = value[0];
    return {
      type: 'array',
      count: value.length,
      firstItemShape: first && typeof first === 'object' ? summarize(first, depth + 1) : typeof first,
    };
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 12);
    const result: Record<string, any> = {};
    for (const [key, child] of entries) {
      if (Array.isArray(child)) {
        result[key] = summarize(child, depth + 1);
      } else if (child && typeof child === 'object') {
        result[key] = { type: 'object', keys: Object.keys(child).slice(0, 12) };
      } else {
        result[key] = typeof child;
      }
    }
    return { type: 'object', keys: Object.keys(value).slice(0, 20), shape: result };
  }

  return typeof value;
}

function extractMetrics(name: string, data: any): Record<string, any> {
  const payload = data?.payload ?? data;

  if (name.includes('marketplace participations')) {
    const rows = Array.isArray(payload) ? payload : payload?.marketplaceParticipations;
    return {
      marketplaces: Array.isArray(rows) ? rows.length : 0,
      marketplaceCodes: Array.isArray(rows)
        ? rows.map((row: any) => row?.marketplace?.countryCode).filter(Boolean)
        : [],
    };
  }

  if (name.includes('Orders')) {
    return {
      ordersReturned: Array.isArray(payload?.Orders) ? payload.Orders.length : 0,
      hasNextToken: !!payload?.NextToken,
      hasCreatedBefore: !!payload?.CreatedBefore,
      orderFields: payload?.Orders?.[0] ? Object.keys(payload.Orders[0]).slice(0, 20) : [],
    };
  }

  if (name.includes('Financial')) {
    const events = payload?.FinancialEvents || {};
    return {
      financialEventGroupsReturned: Array.isArray(payload?.FinancialEventGroupList) ? payload.FinancialEventGroupList.length : 0,
      financialEventCategories: Object.entries(events)
        .filter(([, value]) => Array.isArray(value) && value.length > 0)
        .map(([key, value]) => ({ key, count: (value as any[]).length })),
      hasNextToken: !!payload?.NextToken,
    };
  }

  if (name.includes('reports')) {
    return {
      reportsReturned: Array.isArray(data?.reports) ? data.reports.length : 0,
      hasNextToken: !!data?.nextToken,
      reportFields: data?.reports?.[0] ? Object.keys(data.reports[0]).slice(0, 20) : [],
    };
  }

  if (name.includes('inventory')) {
    return {
      inventorySummariesReturned: Array.isArray(payload?.inventorySummaries) ? payload.inventorySummaries.length : 0,
      hasNextToken: !!payload?.pagination?.nextToken,
      inventoryFields: payload?.inventorySummaries?.[0]
        ? Object.keys(payload.inventorySummaries[0]).slice(0, 20)
        : [],
    };
  }

  if (name.includes('Catalog')) {
    return {
      numberOfResults: data?.numberOfResults,
      itemsReturned: Array.isArray(data?.items) ? data.items.length : 0,
      itemFields: data?.items?.[0] ? Object.keys(data.items[0]).slice(0, 20) : [],
    };
  }

  return {};
}

function summarizeError(data: any): any {
  const first = data?.errors?.[0];
  if (first) {
    return {
      code: first.code,
      message: first.message,
      details: first.details,
    };
  }
  return data;
}

async function getLwaAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: requireEnv('SP_API_REFRESH_TOKEN', 'AMAZON_SPAPI_REFRESH_TOKEN', 'AMAZON_REFRESH_TOKEN'),
    client_id: requireEnv('SP_API_CLIENT_ID', 'AMAZON_SPAPI_CLIENT_ID', 'AMAZON_CLIENT_ID'),
    client_secret: requireEnv('SP_API_CLIENT_SECRET', 'AMAZON_SPAPI_CLIENT_SECRET', 'AMAZON_CLIENT_SECRET'),
  });

  const response = await axios.post('https://api.amazon.com/auth/o2/token', params, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });

  return response.data.access_token;
}

async function getAwsCredentials() {
  const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID', 'AMAZON_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY', 'AMAZON_SECRET_ACCESS_KEY');
  const roleArn = requireEnv('SP_API_ROLE_ARN', 'AWS_ROLE_ARN');

  const sts = new STSClient({ region, credentials: { accessKeyId, secretAccessKey } });
  const assumed = await sts.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: 'SpApiAccessProbe',
  }));

  return {
    accessKeyId: assumed.Credentials!.AccessKeyId!,
    secretAccessKey: assumed.Credentials!.SecretAccessKey!,
    sessionToken: assumed.Credentials!.SessionToken!,
  };
}

async function callProbe(probe: Probe, accessToken: string, credentials: any) {
  const opts: any = {
    host,
    path: probe.path,
    method: probe.method.toUpperCase(),
    region,
    service: 'execute-api',
    headers: {
      'x-amz-access-token': accessToken,
      'user-agent': 'Margin/SPAPIAccessProbe/1.0 (Language=TypeScript)',
      'content-type': 'application/json',
    },
    body: probe.body ? JSON.stringify(probe.body) : undefined,
  };

  aws4.sign(opts, credentials);

  try {
    const response = await axios.request({
      method: probe.method,
      url: `${endpointUrl.origin}${probe.path}`,
      headers: opts.headers,
      data: probe.body,
      timeout: 20_000,
      validateStatus: () => true,
    });

    return {
      name: probe.name,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      metrics: extractMetrics(probe.name, response.data),
      error: response.status >= 400 ? summarizeError(response.data) : undefined,
      dataShape: summarize(response.data),
    };
  } catch (error) {
    const err = error as AxiosError<any>;
    return {
      name: probe.name,
      status: err.response?.status || 'network_error',
      ok: false,
      error: err.response?.data ? summarizeError(err.response.data) : err.message,
    };
  }
}

async function main() {
  const accessToken = await getLwaAccessToken();
  const credentials = await getAwsCredentials();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

  const probes: Probe[] = [
    {
      name: 'Seller marketplace participations',
      method: 'GET',
      path: '/sellers/v1/marketplaceParticipations',
    },
    {
      name: 'Orders, last 7 days',
      method: 'GET',
      path: appendQuery('/orders/v0/orders', {
        MarketplaceIds: marketplaceId,
        CreatedAfter: sevenDaysAgo,
        MaxResultsPerPage: 1,
      }),
    },
    {
      name: 'Orders, last 365 days',
      method: 'GET',
      path: appendQuery('/orders/v0/orders', {
        MarketplaceIds: marketplaceId,
        CreatedAfter: oneYearAgo,
        MaxResultsPerPage: 1,
      }),
    },
    {
      name: 'Financial events, last 30 days',
      method: 'GET',
      path: appendQuery('/finances/v0/financialEvents', {
        PostedAfter: thirtyDaysAgo,
        MaxResultsPerPage: 1,
      }),
    },
    {
      name: 'Financial events, last 365 days',
      method: 'GET',
      path: appendQuery('/finances/v0/financialEvents', {
        PostedAfter: oneYearAgo,
        MaxResultsPerPage: 1,
      }),
    },
    {
      name: 'FBA inventory summaries',
      method: 'GET',
      path: appendQuery('/fba/inventory/v1/summaries', {
        details: false,
        granularityType: 'Marketplace',
        granularityId: marketplaceId,
        marketplaceIds: marketplaceId,
      }),
    },
    {
      name: 'Existing reports list, settlements',
      method: 'GET',
      path: appendQuery('/reports/2021-06-30/reports', {
        reportTypes: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE',
        marketplaceIds: marketplaceId,
        pageSize: 10,
        createdSince: thirtyDaysAgo,
      }),
    },
    {
      name: 'Existing reports list, FBA inventory',
      method: 'GET',
      path: appendQuery('/reports/2021-06-30/reports', {
        reportTypes: 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA',
        marketplaceIds: marketplaceId,
        pageSize: 10,
        createdSince: thirtyDaysAgo,
      }),
    },
    {
      name: 'Existing reports list, FBA returns',
      method: 'GET',
      path: appendQuery('/reports/2021-06-30/reports', {
        reportTypes: 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA',
        marketplaceIds: marketplaceId,
        pageSize: 10,
        createdSince: thirtyDaysAgo,
      }),
    },
    {
      name: 'Catalog search',
      method: 'GET',
      path: appendQuery('/catalog/2022-04-01/items', {
        marketplaceIds: marketplaceId,
        keywords: 'test',
        pageSize: 1,
        includedData: 'summaries',
      }),
    },
  ];

  console.log(JSON.stringify({
    endpoint: endpointUrl.origin,
    region,
    marketplaceId,
    probes: await Promise.all(probes.map((probe) => callProbe(probe, accessToken, credentials))),
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
