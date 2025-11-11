import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import aws4 from 'aws4';
import logger from './logger';

type Primitive = string | number | boolean;

export interface AmazonSpApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, Primitive | Primitive[] | undefined>;
  body?: unknown;
  accessToken: string;
  headers?: Record<string, string>;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 30_000;

function getAwsCredentials() {
  const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AMAZON_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AMAZON_AWS_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Amazon AWS credentials not configured. Set AMAZON_AWS_ACCESS_KEY_ID and AMAZON_AWS_SECRET_ACCESS_KEY.');
  }

  return { accessKeyId, secretAccessKey, sessionToken };
}

function normalisePath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

function appendQueryParameters(url: URL, query?: Record<string, Primitive | Primitive[] | undefined>) {
  if (!query) {
    return;
  }

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
      return;
    }

    url.searchParams.append(key, String(value));
  });
}

export async function callAmazonSpApi(options: AmazonSpApiRequestOptions): Promise<AxiosResponse<any>> {
  const { method, path, query, body, accessToken, headers, timeout } = options;

  const baseUrl = process.env.AMAZON_SPAPI_BASE_URL || 'https://sandbox.sellingpartnerapi-na.amazon.com';
  const region = process.env.AMAZON_REGION || process.env.AWS_REGION || 'us-east-1';
  const userAgent = process.env.AMAZON_SPAPI_USER_AGENT || 'Opside-Integrations/1.0.0';

  const { accessKeyId, secretAccessKey, sessionToken } = getAwsCredentials();

  const url = new URL(normalisePath(path), baseUrl);
  appendQueryParameters(url, query);

  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const requestHeaders: Record<string, string> = {
    host: url.host,
    'x-amz-access-token': accessToken,
    'user-agent': userAgent,
    ...headers
  };

  if (payload) {
    requestHeaders['content-type'] = headers?.['content-type'] || 'application/json;charset=UTF-8';
  }

  if (sessionToken) {
    requestHeaders['x-amz-security-token'] = sessionToken;
  }

  const request = {
    host: url.host,
    path: url.pathname + (url.search || ''),
    service: 'execute-api',
    region,
    method,
    headers: requestHeaders,
    body: payload
  };

  aws4.sign(request, { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined });

  const axiosConfig: AxiosRequestConfig = {
    method,
    url: url.toString(),
    headers: request.headers,
    data: payload,
    timeout: timeout ?? DEFAULT_TIMEOUT
  };

  try {
    return await axios(axiosConfig);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      logger.error('Amazon SP-API request failed', {
        path,
        status: error.response.status,
        data: error.response.data
      });
    } else {
      logger.error('Amazon SP-API request failed', {
        path,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}

