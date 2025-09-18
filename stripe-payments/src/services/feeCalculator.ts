import { calculateFees, validateAmount, formatCurrency, SupportedCurrency } from '@/utils/currencyUtils';
import { FEE_CONFIG } from '@/config/stripeConfig';

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
    try {
      const { amountRecoveredCents, currency, userId, claimId } = request;

      // Validate input
      if (!validateAmount(amountRecoveredCents, currency)) {
        return {
          success: false,
          error: 'Invalid amount or currency',
        };
      }

      // Calculate fees
      const feeCalculation = calculateFees(amountRecoveredCents, currency);

      // Format amounts for display
      const formattedAmount = formatCurrency(feeCalculation.originalAmount, currency);
      const formattedPlatformFee = formatCurrency(feeCalculation.platformFee, currency);
      const formattedSellerPayout = formatCurrency(feeCalculation.sellerPayout, currency);

      return {
        success: true,
        data: {
          originalAmount: feeCalculation.originalAmount,
          platformFee: feeCalculation.platformFee,
          sellerPayout: feeCalculation.sellerPayout,
          currency: feeCalculation.currency,
          formattedAmount,
          formattedPlatformFee,
          formattedSellerPayout,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Get fee breakdown for a given amount
   */
  static getFeeBreakdown(amountCents: number, currency: SupportedCurrency = 'usd'): FeeBreakdown {
    const feeCalculation = calculateFees(amountCents, currency);

    return {
      amountRecoveredCents: feeCalculation.originalAmount,
      platformFeeCents: feeCalculation.platformFee,
      sellerPayoutCents: feeCalculation.sellerPayout,
      currency: feeCalculation.currency,
      platformFeePercentage: FEE_CONFIG.PLATFORM_FEE_PERCENTAGE,
      sellerPayoutPercentage: FEE_CONFIG.SELLER_PAYOUT_PERCENTAGE,
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
    try {
      const expectedCalculation = calculateFees(amountCents, currency);

      // Allow for small rounding differences (1 cent tolerance)
      const tolerance = 1;
      const platformFeeDiff = Math.abs(expectedCalculation.platformFee - platformFeeCents);
      const sellerPayoutDiff = Math.abs(expectedCalculation.sellerPayout - sellerPayoutCents);

      return platformFeeDiff <= tolerance && sellerPayoutDiff <= tolerance;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get minimum fee for a currency
   */
  static getMinimumFee(currency: SupportedCurrency = 'usd'): number {
    // In a real implementation, you might have different minimum fees per currency
    return FEE_CONFIG.MINIMUM_FEE_CENTS;
  }

  /**
   * Calculate fee percentage for a given amount
   */
  static calculateEffectiveFeePercentage(amountCents: number, platformFeeCents: number): number {
    if (amountCents <= 0) return 0;
    return (platformFeeCents / amountCents) * 100;
  }

  /**
   * Check if fee calculation meets minimum requirements
   */
  static meetsMinimumFeeRequirements(platformFeeCents: number): boolean {
    return platformFeeCents >= FEE_CONFIG.MINIMUM_FEE_CENTS;
  }

  /**
   * Get fee calculation summary for reporting
   */
  static getFeeSummary(transactions: Array<{ platformFeeCents: number; currency: SupportedCurrency }>) {
    const summary = {
      totalPlatformFees: 0,
      totalTransactions: transactions.length,
      averageFeePercentage: 0,
      currencyBreakdown: {} as Record<SupportedCurrency, number>,
    };

    let totalAmount = 0;

    transactions.forEach(({ platformFeeCents, currency }) => {
      summary.totalPlatformFees += platformFeeCents;
      
      if (!summary.currencyBreakdown[currency]) {
        summary.currencyBreakdown[currency] = 0;
      }
      summary.currencyBreakdown[currency] += platformFeeCents;
    });

    if (summary.totalTransactions > 0) {
      summary.averageFeePercentage = (summary.totalPlatformFees / summary.totalTransactions) / 100;
    }

    return summary;
  }
} 