import { BillingInterval, PlanTier } from './subscriptionBillingTruthService';

export type YocoPaymentLinkKey =
  | 'starter_monthly'
  | 'starter_annual'
  | 'pro_monthly'
  | 'pro_annual'
  | 'enterprise_monthly'
  | 'enterprise_annual';

export type YocoCheckoutResolution = {
  invoiceType: 'subscription_invoice';
  paymentProvider: 'yoco';
  paymentLinkKey: YocoPaymentLinkKey | null;
  paymentLinkUrl: string | null;
  expectedAmountCents: number | null;
  mappingStatus: 'resolved' | 'amount_mismatch' | 'url_missing' | 'key_unavailable';
};

type YocoLinkDefinition = {
  key: YocoPaymentLinkKey;
  planTier: PlanTier;
  billingInterval: BillingInterval;
  amountCents: number;
  envVar: string;
};

const YOCO_LINK_DEFINITIONS: Record<YocoPaymentLinkKey, YocoLinkDefinition> = {
  starter_monthly: {
    key: 'starter_monthly',
    planTier: 'starter',
    billingInterval: 'monthly',
    amountCents: 4900,
    envVar: 'YOCO_STARTER_MONTHLY_URL',
  },
  starter_annual: {
    key: 'starter_annual',
    planTier: 'starter',
    billingInterval: 'annual',
    amountCents: 46800,
    envVar: 'YOCO_STARTER_ANNUAL_URL',
  },
  pro_monthly: {
    key: 'pro_monthly',
    planTier: 'pro',
    billingInterval: 'monthly',
    amountCents: 9900,
    envVar: 'YOCO_PRO_MONTHLY_URL',
  },
  pro_annual: {
    key: 'pro_annual',
    planTier: 'pro',
    billingInterval: 'annual',
    amountCents: 94800,
    envVar: 'YOCO_PRO_ANNUAL_URL',
  },
  enterprise_monthly: {
    key: 'enterprise_monthly',
    planTier: 'enterprise',
    billingInterval: 'monthly',
    amountCents: 19900,
    envVar: 'YOCO_ENTERPRISE_MONTHLY_URL',
  },
  enterprise_annual: {
    key: 'enterprise_annual',
    planTier: 'enterprise',
    billingInterval: 'annual',
    amountCents: 190800,
    envVar: 'YOCO_ENTERPRISE_ANNUAL_URL',
  },
};

export function buildYocoPaymentLinkKey(planTier: PlanTier | null | undefined, billingInterval: BillingInterval | null | undefined): YocoPaymentLinkKey | null {
  if (planTier === 'starter' && billingInterval === 'monthly') return 'starter_monthly';
  if (planTier === 'starter' && billingInterval === 'annual') return 'starter_annual';
  if (planTier === 'pro' && billingInterval === 'monthly') return 'pro_monthly';
  if (planTier === 'pro' && billingInterval === 'annual') return 'pro_annual';
  if (planTier === 'enterprise' && billingInterval === 'monthly') return 'enterprise_monthly';
  if (planTier === 'enterprise' && billingInterval === 'annual') return 'enterprise_annual';
  return null;
}

export function resolveYocoCheckoutLink(input: {
  planTier: PlanTier | null | undefined;
  billingInterval: BillingInterval | null | undefined;
  billingAmountCents: number | null | undefined;
}): YocoCheckoutResolution {
  const paymentLinkKey = buildYocoPaymentLinkKey(input.planTier, input.billingInterval);
  if (!paymentLinkKey) {
    return {
      invoiceType: 'subscription_invoice',
      paymentProvider: 'yoco',
      paymentLinkKey: null,
      paymentLinkUrl: null,
      expectedAmountCents: null,
      mappingStatus: 'key_unavailable',
    };
  }

  const definition = YOCO_LINK_DEFINITIONS[paymentLinkKey];
  const paymentLinkUrl = String(process.env[definition.envVar] || '').trim() || null;

  if (Number(input.billingAmountCents) !== definition.amountCents) {
    return {
      invoiceType: 'subscription_invoice',
      paymentProvider: 'yoco',
      paymentLinkKey,
      paymentLinkUrl: null,
      expectedAmountCents: definition.amountCents,
      mappingStatus: 'amount_mismatch',
    };
  }

  if (!paymentLinkUrl) {
    return {
      invoiceType: 'subscription_invoice',
      paymentProvider: 'yoco',
      paymentLinkKey,
      paymentLinkUrl: null,
      expectedAmountCents: definition.amountCents,
      mappingStatus: 'url_missing',
    };
  }

  return {
    invoiceType: 'subscription_invoice',
    paymentProvider: 'yoco',
    paymentLinkKey,
    paymentLinkUrl,
    expectedAmountCents: definition.amountCents,
    mappingStatus: 'resolved',
  };
}

export function getYocoCheckoutDefinitions(): YocoLinkDefinition[] {
  return Object.values(YOCO_LINK_DEFINITIONS);
}

export default {
  buildYocoPaymentLinkKey,
  resolveYocoCheckoutLink,
  getYocoCheckoutDefinitions,
};
