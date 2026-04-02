import { SupportedCurrency } from '@/utils/currencyUtils';

const LEGACY_RECOVERY_FEE_DISABLED = 'Recovery-based fee calculation is disabled. Margin now uses flat subscription billing only.';

export interface FeeCalculationRequest {
  amountRecoveredCents: number;
  currency: SupportedCurrency;
  userId: number;
  claimId?: number;
}

export interface FeeCalculationResponse {
  success: boolean;
  data?: {
    originalAmount: number;
    platformFee: number;
    sellerPayout: number;
    currency: SupportedCurrency;
    formattedAmount: string;
    formattedPlatformFee: string;
    formattedSellerPayout: string;
  };
  error?: string;
}

export interface FeeBreakdown {
  amountRecoveredCents: number;
  platformFeeCents: number;
  sellerPayoutCents: number;
  currency: SupportedCurrency;
  platformFeePercentage: number;
  sellerPayoutPercentage: number;
}

/**
 * Fee Calculator Service
 * Handles all fee calculations for the platform
 */
export class FeeCalculatorService {
  /**
   * Calculate platform fee and seller payout
   */
  static calculateFees(request: FeeCalculationRequest): FeeCalculationResponse {
    return {
      success: false,
      error: LEGACY_RECOVERY_FEE_DISABLED,
    };
  }

  /**
   * Get fee breakdown for a given amount
   */
  static getFeeBreakdown(amountCents: number, currency: SupportedCurrency = 'usd'): FeeBreakdown {
    return {
      amountRecoveredCents: amountCents,
      platformFeeCents: 0,
      sellerPayoutCents: amountCents,
      currency,
      platformFeePercentage: 0,
      sellerPayoutPercentage: 100,
    };
  }

  /**
   * Validate if the fee calculation is reasonable
   */
  static validateFeeCalculation(
    amountCents: number,
    platformFeeCents: number,
    sellerPayoutCents: number,
    currency: SupportedCurrency = 'usd'
  ): boolean {
    return false;
  }

  /**
   * Get minimum fee for a currency
   */
  static getMinimumFee(currency: SupportedCurrency = 'usd'): number {
    return 0;
  }

  /**
   * Calculate fee percentage for a given amount
   */
  static calculateEffectiveFeePercentage(amountCents: number, platformFeeCents: number): number {
    return 0;
  }

  /**
   * Check if fee calculation meets minimum requirements
   */
  static meetsMinimumFeeRequirements(platformFeeCents: number): boolean {
    return false;
  }

  /**
   * Get fee calculation summary for reporting
   */
  static getFeeSummary(transactions: Array<{ platformFeeCents: number; currency: SupportedCurrency }>) {
    return {
      totalPlatformFees: 0,
      totalTransactions: transactions.length,
      averageFeePercentage: 0,
      currencyBreakdown: {} as Record<SupportedCurrency, number>,
    };
  }
} 
