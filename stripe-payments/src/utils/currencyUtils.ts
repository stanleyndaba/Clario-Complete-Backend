import { FEE_CONFIG, SUPPORTED_CURRENCIES, SupportedCurrency } from '@/config/stripeConfig';

/**
 * Currency utilities for safe money calculations
 * All calculations are done in cents to avoid floating point errors
 */

export interface MoneyAmount {
  amount: number; // in cents
  currency: SupportedCurrency;
}

export interface FeeCalculation {
  originalAmount: number; // in cents
  platformFee: number; // in cents
  sellerPayout: number; // in cents
  currency: SupportedCurrency;
}

/**
 * Convert dollars to cents safely
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Convert cents to dollars safely
 */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Calculate platform fee and seller payout
 * @param amountRecoveredCents - Amount recovered in cents
 * @param currency - Currency code
 * @returns Fee calculation object
 */
export function calculateFees(
  amountRecoveredCents: number,
  currency: SupportedCurrency = 'usd'
): FeeCalculation {
  if (amountRecoveredCents <= 0) {
    throw new Error('Amount must be positive');
  }

  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }

  // Calculate platform fee (20%)
  const platformFeeCents = Math.round(
    (amountRecoveredCents * FEE_CONFIG.PLATFORM_FEE_PERCENTAGE) / 100
  );

  // Ensure minimum fee
  const finalPlatformFee = Math.max(platformFeeCents, FEE_CONFIG.MINIMUM_FEE_CENTS);

  // Calculate seller payout (80%)
  const sellerPayoutCents = amountRecoveredCents - finalPlatformFee;

  // Validate that seller payout is not negative
  if (sellerPayoutCents < 0) {
    throw new Error('Seller payout cannot be negative');
  }

  return {
    originalAmount: amountRecoveredCents,
    platformFee: finalPlatformFee,
    sellerPayout: sellerPayoutCents,
    currency,
  };
}

/**
 * Format currency amount for display
 */
export function formatCurrency(amountCents: number, currency: SupportedCurrency = 'usd'): string {
  const amount = centsToDollars(amountCents);
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return formatter.format(amount);
}

/**
 * Validate currency amount
 */
export function validateAmount(amountCents: number, currency: SupportedCurrency): boolean {
  if (amountCents <= 0) return false;
  if (!SUPPORTED_CURRENCIES.includes(currency)) return false;
  
  // Check for reasonable limits (e.g., $1M max)
  const maxAmountCents = 100_000_000; // $1M
  if (amountCents > maxAmountCents) return false;
  
  return true;
}

/**
 * Round amount to nearest cent
 */
export function roundToCents(amount: number): number {
  return Math.round(amount);
}

/**
 * Get currency symbol
 */
export function getCurrencySymbol(currency: SupportedCurrency): string {
  const symbols: Record<SupportedCurrency, string> = {
    usd: '$',
    eur: '€',
    gbp: '£',
    cad: 'C$',
  };
  
  return symbols[currency];
}

/**
 * Convert amount between currencies (basic implementation)
 * In production, you'd use a real-time exchange rate service
 */
export function convertCurrency(
  amountCents: number,
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency
): number {
  if (fromCurrency === toCurrency) {
    return amountCents;
  }

  // This is a simplified conversion - in production, use real exchange rates
  const exchangeRates: Record<string, number> = {
    'usd_eur': 0.85,
    'usd_gbp': 0.73,
    'usd_cad': 1.25,
    'eur_usd': 1.18,
    'eur_gbp': 0.86,
    'eur_cad': 1.47,
    'gbp_usd': 1.37,
    'gbp_eur': 1.16,
    'gbp_cad': 1.71,
    'cad_usd': 0.80,
    'cad_eur': 0.68,
    'cad_gbp': 0.58,
  };

  const rateKey = `${fromCurrency}_${toCurrency}`;
  const rate = exchangeRates[rateKey] || 1;

  return roundToCents(amountCents * rate);
} 