import { FeeCalculatorService } from '@/services/feeCalculator';
import { calculateFees, validateAmount, formatCurrency } from '@/utils/currencyUtils';

describe('FeeCalculatorService', () => {
  describe('calculateFees', () => {
    it('should calculate fees correctly for USD', () => {
      const result = FeeCalculatorService.calculateFees({
        amountRecoveredCents: 10000, // $100.00
        currency: 'usd',
        userId: 1,
        claimId: 123,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.platformFee).toBe(2000); // $20.00 (20%)
      expect(result.data!.sellerPayout).toBe(8000); // $80.00 (80%)
      expect(result.data!.currency).toBe('usd');
    });

    it('should calculate fees correctly for EUR', () => {
      const result = FeeCalculatorService.calculateFees({
        amountRecoveredCents: 5000, // €50.00
        currency: 'eur',
        userId: 1,
        claimId: 123,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.platformFee).toBe(1000); // €10.00 (20%)
      expect(result.data!.sellerPayout).toBe(4000); // €40.00 (80%)
      expect(result.data!.currency).toBe('eur');
    });

    it('should handle minimum fee requirement', () => {
      const result = FeeCalculatorService.calculateFees({
        amountRecoveredCents: 100, // $1.00
        currency: 'usd',
        userId: 1,
        claimId: 123,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.platformFee).toBe(50); // Minimum fee of $0.50
      expect(result.data!.sellerPayout).toBe(50); // $0.50 remaining
    });

    it('should reject invalid amounts', () => {
      const result = FeeCalculatorService.calculateFees({
        amountRecoveredCents: -100,
        currency: 'usd',
        userId: 1,
        claimId: 123,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject invalid currencies', () => {
      const result = FeeCalculatorService.calculateFees({
        amountRecoveredCents: 1000,
        currency: 'invalid' as any,
        userId: 1,
        claimId: 123,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getFeeBreakdown', () => {
    it('should return correct fee breakdown', () => {
      const breakdown = FeeCalculatorService.getFeeBreakdown(10000, 'usd');

      expect(breakdown.amountRecoveredCents).toBe(10000);
      expect(breakdown.platformFeeCents).toBe(2000);
      expect(breakdown.sellerPayoutCents).toBe(8000);
      expect(breakdown.currency).toBe('usd');
      expect(breakdown.platformFeePercentage).toBe(20);
      expect(breakdown.sellerPayoutPercentage).toBe(80);
    });
  });

  describe('validateFeeCalculation', () => {
    it('should validate correct fee calculation', () => {
      const isValid = FeeCalculatorService.validateFeeCalculation(
        10000, // $100.00
        2000,  // $20.00 fee
        8000,  // $80.00 payout
        'usd'
      );

      expect(isValid).toBe(true);
    });

    it('should reject incorrect fee calculation', () => {
      const isValid = FeeCalculatorService.validateFeeCalculation(
        10000, // $100.00
        3000,  // $30.00 fee (incorrect)
        7000,  // $70.00 payout (incorrect)
        'usd'
      );

      expect(isValid).toBe(false);
    });

    it('should allow small rounding differences', () => {
      const isValid = FeeCalculatorService.validateFeeCalculation(
        10000, // $100.00
        2001,  // $20.01 fee (1 cent difference)
        7999,  // $79.99 payout (1 cent difference)
        'usd'
      );

      expect(isValid).toBe(true);
    });
  });

  describe('getMinimumFee', () => {
    it('should return minimum fee for USD', () => {
      const minFee = FeeCalculatorService.getMinimumFee('usd');
      expect(minFee).toBe(50); // $0.50
    });

    it('should return minimum fee for EUR', () => {
      const minFee = FeeCalculatorService.getMinimumFee('eur');
      expect(minFee).toBe(50); // €0.50
    });
  });

  describe('calculateEffectiveFeePercentage', () => {
    it('should calculate correct percentage', () => {
      const percentage = FeeCalculatorService.calculateEffectiveFeePercentage(10000, 2000);
      expect(percentage).toBe(20);
    });

    it('should handle zero amount', () => {
      const percentage = FeeCalculatorService.calculateEffectiveFeePercentage(0, 0);
      expect(percentage).toBe(0);
    });
  });

  describe('meetsMinimumFeeRequirements', () => {
    it('should return true for sufficient fee', () => {
      const meets = FeeCalculatorService.meetsMinimumFeeRequirements(100);
      expect(meets).toBe(true);
    });

    it('should return false for insufficient fee', () => {
      const meets = FeeCalculatorService.meetsMinimumFeeRequirements(25);
      expect(meets).toBe(false);
    });
  });

  describe('getFeeSummary', () => {
    it('should calculate summary correctly', () => {
      const transactions = [
        { platformFeeCents: 2000, currency: 'usd' as const },
        { platformFeeCents: 1000, currency: 'usd' as const },
        { platformFeeCents: 1500, currency: 'eur' as const },
      ];

      const summary = FeeCalculatorService.getFeeSummary(transactions);

      expect(summary.totalPlatformFees).toBe(4500);
      expect(summary.totalTransactions).toBe(3);
      expect(summary.currencyBreakdown.usd).toBe(3000);
      expect(summary.currencyBreakdown.eur).toBe(1500);
    });
  });
});

describe('Currency Utils', () => {
  describe('calculateFees', () => {
    it('should calculate fees correctly', () => {
      const result = calculateFees(10000, 'usd');
      
      expect(result.originalAmount).toBe(10000);
      expect(result.platformFee).toBe(2000);
      expect(result.sellerPayout).toBe(8000);
      expect(result.currency).toBe('usd');
    });

    it('should throw error for negative amount', () => {
      expect(() => calculateFees(-100, 'usd')).toThrow('Amount must be positive');
    });

    it('should throw error for unsupported currency', () => {
      expect(() => calculateFees(1000, 'invalid' as any)).toThrow('Unsupported currency');
    });
  });

  describe('validateAmount', () => {
    it('should validate correct amounts', () => {
      expect(validateAmount(1000, 'usd')).toBe(true);
      expect(validateAmount(1000000, 'usd')).toBe(true);
    });

    it('should reject invalid amounts', () => {
      expect(validateAmount(-100, 'usd')).toBe(false);
      expect(validateAmount(0, 'usd')).toBe(false);
      expect(validateAmount(1000000000, 'usd')).toBe(false); // Too large
    });

    it('should reject invalid currencies', () => {
      expect(validateAmount(1000, 'invalid' as any)).toBe(false);
    });
  });

  describe('formatCurrency', () => {
    it('should format USD correctly', () => {
      expect(formatCurrency(1000, 'usd')).toBe('$10.00');
      expect(formatCurrency(1234, 'usd')).toBe('$12.34');
    });

    it('should format EUR correctly', () => {
      expect(formatCurrency(1000, 'eur')).toBe('€10.00');
      expect(formatCurrency(1234, 'eur')).toBe('€12.34');
    });

    it('should format GBP correctly', () => {
      expect(formatCurrency(1000, 'gbp')).toBe('£10.00');
      expect(formatCurrency(1234, 'gbp')).toBe('£12.34');
    });
  });
}); 