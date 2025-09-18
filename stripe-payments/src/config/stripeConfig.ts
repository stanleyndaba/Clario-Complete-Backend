import Stripe from 'stripe';
import config from './env';

// Initialize Stripe client
export const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
  apiVersion: config.STRIPE_API_VERSION as Stripe.LatestApiVersion,
  typescript: true,
});

// Stripe configuration constants
export const STRIPE_CONFIG = {
  PLATFORM_ACCOUNT_ID: config.STRIPE_PLATFORM_ACCOUNT_ID,
  CLIENT_ID: config.STRIPE_CLIENT_ID,
  WEBHOOK_SECRET: config.STRIPE_WEBHOOK_SECRET,
  API_VERSION: config.STRIPE_API_VERSION,
  PLATFORM_FEE_PERCENTAGE: config.PLATFORM_FEE_PERCENTAGE,
  PRICE_ID: config.STRIPE_PRICE_ID,
  LIVE_MODE: config.STRIPE_LIVE_MODE === 'true',
} as const;

// Stripe Connect configuration
export const CONNECT_CONFIG = {
  // Standard Connect onboarding
  ONBOARDING_URL: 'https://connect.stripe.com/oauth/authorize',
  REFRESH_URL: 'https://connect.stripe.com/oauth/token',
  
  // Required capabilities for sellers
  REQUIRED_CAPABILITIES: ['card_payments', 'transfers'] as const,
  
  // Optional capabilities
  OPTIONAL_CAPABILITIES: ['card_issuing', 'treasury'] as const,
} as const;

// Webhook event types we handle
export const WEBHOOK_EVENTS = {
  PAYMENT_INTENT_SUCCEEDED: 'payment_intent.succeeded',
  PAYMENT_INTENT_FAILED: 'payment_intent.payment_failed',
  CHARGE_SUCCEEDED: 'charge.succeeded',
  CHARGE_FAILED: 'charge.failed',
  CHARGE_REFUNDED: 'charge.refunded',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  INVOICE_FINALIZED: 'invoice.finalized',
  INVOICE_VOIDED: 'invoice.voided',
  INVOICE_MARKED_UNCOLLECTIBLE: 'invoice.marked_uncollectible',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  TRANSFER_CREATED: 'transfer.created',
  TRANSFER_PAID: 'transfer.paid',
  TRANSFER_FAILED: 'transfer.failed',
  PAYOUT_PAID: 'payout.paid',
  PAYOUT_FAILED: 'payout.failed',
  ACCOUNT_UPDATED: 'account.updated',
} as const;

export type WebhookEventType = typeof WEBHOOK_EVENTS[keyof typeof WEBHOOK_EVENTS];

// Transaction status constants
export const TRANSACTION_STATUS = {
  PENDING: 'pending',
  CHARGED: 'charged',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  TRANSFERRED: 'transferred',
  CANCELLED: 'cancelled',
  REVERSAL_NEEDED: 'reversal_needed',
} as const;

export type TransactionStatus = typeof TRANSACTION_STATUS[keyof typeof TRANSACTION_STATUS];

// Stripe account status constants
export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  RESTRICTED: 'restricted',
} as const;

export type AccountStatus = typeof ACCOUNT_STATUS[keyof typeof ACCOUNT_STATUS];

// Currency configuration
export const SUPPORTED_CURRENCIES = ['usd', 'eur', 'gbp', 'cad'] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

// Fee calculation configuration
export const FEE_CONFIG = {
  PLATFORM_FEE_PERCENTAGE: config.PLATFORM_FEE_PERCENTAGE,
  SELLER_PAYOUT_PERCENTAGE: 100 - config.PLATFORM_FEE_PERCENTAGE,
  MINIMUM_FEE_CENTS: 50, // $0.50 minimum fee
  ROUNDING_MODE: 'round' as const, // 'round', 'floor', 'ceil'
} as const;

export default stripe; 