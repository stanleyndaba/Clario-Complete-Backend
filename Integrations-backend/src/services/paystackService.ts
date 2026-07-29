import crypto from 'crypto';
import config from '../config/env';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const DEFAULT_TIMEOUT_MS = 12000;

type PaystackApiResponse<T> = {
  status: boolean;
  message: string;
  data?: T;
};

export type PaystackInitializeData = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackVerifyData = {
  id?: number | string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  gateway_response?: string | null;
  channel?: string | null;
  fees?: number | null;
  customer?: {
    customer_code?: string;
    email?: string;
  } | null;
  plan?: string | { plan_code?: string; amount?: number; currency?: string; interval?: string } | null;
  authorization?: {
    authorization_code?: string;
    reusable?: boolean;
    signature?: string;
  } | null;
};

export type InitializePaystackTransactionInput = {
  email: string;
  amountSubunits: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
  planCode?: string;
};

export type PaystackPlanData = {
  id?: number | string;
  name?: string;
  plan_code: string;
  amount: number;
  currency: string;
  interval: string;
  is_deleted?: boolean;
  is_archived?: boolean;
};

export type PaystackSubscriptionData = {
  id?: number | string;
  subscription_code?: string;
  email_token?: string;
  status?: string;
  next_payment_date?: string | null;
  amount?: number;
  cron_expression?: string;
  plan?: string | PaystackPlanData | null;
  customer?: {
    customer_code?: string;
    email?: string;
  } | null;
};

function getSecretKey(): string {
  const secret = config.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }
  return secret;
}

function withTimeout(): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS).unref?.();
  return controller.signal;
}

function safeProviderData<T extends Record<string, any>>(data: T | undefined): Partial<T> {
  if (!data) return {};
  const allowedKeys = [
    'id',
    'reference',
    'status',
    'amount',
    'currency',
    'paid_at',
    'gateway_response',
    'channel',
    'fees',
    'authorization_url',
    'access_code',
    'plan_code',
    'subscription_code',
    'email_token',
    'next_payment_date',
    'customer',
    'plan',
  ];

  return allowedKeys.reduce((safe, key) => {
    if (typeof data[key] !== 'undefined') {
      safe[key as keyof T] = data[key];
    }
    return safe;
  }, {} as Partial<T>);
}

async function paystackRequest<T>(path: string, init: RequestInit): Promise<PaystackApiResponse<T>> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    signal: withTimeout(),
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null) as PaystackApiResponse<T> | null;
  if (!response.ok || !payload?.status) {
    throw new Error(payload?.message || `Paystack request failed with status ${response.status}`);
  }

  return payload;
}

export async function initializePaystackTransaction(
  input: InitializePaystackTransactionInput
): Promise<{ data: PaystackInitializeData; safeResponse: Record<string, unknown> }> {
  const body: Record<string, unknown> = {
    email: input.email,
    amount: input.amountSubunits,
    currency: input.currency,
    reference: input.reference,
    callback_url: input.callbackUrl,
    metadata: input.metadata,
  };

  if (input.planCode) {
    body.plan = input.planCode;
  }

  const response = await paystackRequest<PaystackInitializeData>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.data?.authorization_url || !response.data?.access_code) {
    throw new Error('Paystack initialization response was incomplete');
  }

  return {
    data: response.data,
    safeResponse: {
      message: response.message,
      data: safeProviderData(response.data),
    },
  };
}

export async function fetchPaystackPlan(
  planCode: string
): Promise<{ data: PaystackPlanData; safeResponse: Record<string, unknown> }> {
  const response = await paystackRequest<PaystackPlanData>(
    `/plan/${encodeURIComponent(planCode)}`,
    { method: 'GET' }
  );

  if (!response.data?.plan_code) {
    throw new Error('Paystack plan response was incomplete');
  }

  return {
    data: response.data,
    safeResponse: {
      message: response.message,
      data: safeProviderData(response.data),
    },
  };
}

export async function disablePaystackSubscription(input: {
  subscriptionCode: string;
  emailToken: string;
}): Promise<{ safeResponse: Record<string, unknown> }> {
  const response = await paystackRequest<Record<string, unknown>>('/subscription/disable', {
    method: 'POST',
    body: JSON.stringify({
      code: input.subscriptionCode,
      token: input.emailToken,
    }),
  });

  return { safeResponse: { message: response.message, data: safeProviderData(response.data) } };
}

export async function enablePaystackSubscription(input: {
  subscriptionCode: string;
  emailToken: string;
}): Promise<{ safeResponse: Record<string, unknown> }> {
  const response = await paystackRequest<Record<string, unknown>>('/subscription/enable', {
    method: 'POST',
    body: JSON.stringify({
      code: input.subscriptionCode,
      token: input.emailToken,
    }),
  });

  return { safeResponse: { message: response.message, data: safeProviderData(response.data) } };
}

export async function generatePaystackSubscriptionManageLink(input: {
  subscriptionCode: string;
}): Promise<{ url: string | null; safeResponse: Record<string, unknown> }> {
  const response = await paystackRequest<{ link?: string; url?: string }>(
    `/subscription/${encodeURIComponent(input.subscriptionCode)}/manage/link`,
    { method: 'GET' }
  );

  return {
    url: response.data?.link || response.data?.url || null,
    safeResponse: { message: response.message, data: safeProviderData(response.data) },
  };
}

export async function verifyPaystackTransaction(
  reference: string
): Promise<{ data: PaystackVerifyData; safeResponse: Record<string, unknown> }> {
  const response = await paystackRequest<PaystackVerifyData>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: 'GET' }
  );

  if (!response.data?.reference) {
    throw new Error('Paystack verification response was incomplete');
  }

  return {
    data: response.data,
    safeResponse: {
      message: response.message,
      data: safeProviderData(response.data),
    },
  };
}

export function computePaystackSignature(rawBody: Buffer | string): string {
  return crypto
    .createHmac('sha512', getSecretKey())
    .update(rawBody)
    .digest('hex');
}

export function verifyPaystackWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
  if (!signature) return false;

  const expected = computePaystackSignature(rawBody);
  const provided = signature.trim();

  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}

export function getSafePaystackProviderData(data: PaystackVerifyData | PaystackInitializeData | undefined) {
  return safeProviderData(data);
}
