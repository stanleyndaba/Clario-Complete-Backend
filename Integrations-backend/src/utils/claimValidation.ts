/**
 * Claim Validation Utilities
 * Validates claim data structure and business rules
 */

import { ValidationError, BusinessError, ErrorCode } from './errors';
import logger from './logger';

export interface ClaimData {
  claim_id?: string;
  id?: string;
  user_id?: string;
  seller_id?: string;
  amount?: number;
  claim_date?: string | Date;
  category?: string;
  order_id?: string;
  sku?: string;
  asin?: string;
  marketplace?: string;
  [key: string]: any;
}

/**
 * Validate claim data structure and required fields
 */
export function validateClaimStructure(claim: ClaimData): void {
  const errors: Record<string, string> = {};

  // Required: claim_id or id
  if (!claim.claim_id && !claim.id) {
    errors.claim_id = 'Claim ID is required';
  }

  // Required: user_id or seller_id
  if (!claim.user_id && !claim.seller_id) {
    errors.user_id = 'User ID or Seller ID is required';
  }

  // Required: amount
  if (claim.amount === undefined || claim.amount === null) {
    errors.amount = 'Amount is required';
  } else if (typeof claim.amount !== 'number') {
    errors.amount = 'Amount must be a number';
  } else if (claim.amount <= 0) {
    errors.amount = 'Amount must be greater than 0';
  } else if (claim.amount > 100000) {
    errors.amount = 'Amount exceeds maximum allowed value ($100,000)';
  }

  if (Object.keys(errors).length > 0) {
    throw ValidationError.multiple(errors);
  }
}

/**
 * Validate claim date
 */
export function validateClaimDate(claimDate: string | Date | undefined): Date | null {
  if (!claimDate) {
    return null;
  }

  const date = typeof claimDate === 'string' ? new Date(claimDate) : claimDate;

  if (isNaN(date.getTime())) {
    throw ValidationError.invalidFormat('claim_date', 'ISO 8601 date string');
  }

  if (date > new Date()) {
    throw new ValidationError(
      'Claim date cannot be in the future',
      { claim_date: 'Date must be in the past or present' }
    );
  }

  // Check if claim is older than 18 months (Amazon's limit)
  const eighteenMonthsAgo = new Date();
  eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
  
  if (date < eighteenMonthsAgo) {
    throw BusinessError.claimExpired(
      typeof claimDate === 'string' ? claimDate : claimDate.toISOString(),
      date
    );
  }

  return date;
}

/**
 * Validate claim category
 */
export function validateClaimCategory(category: string | undefined): string | null {
  if (!category) {
    return null;
  }

  const validCategories = [
    'lost_inventory',
    'damaged_goods',
    'fee_overcharge',
    'missing_reimbursement',
    'return_discrepancy',
    'inventory_adjustment',
    'shipping_error',
    'other'
  ];

  if (typeof category !== 'string') {
    throw ValidationError.invalidFormat('category', 'string');
  }

  if (!validCategories.includes(category.toLowerCase())) {
    throw new ValidationError(
      `Invalid claim category: ${category}`,
      { category: `Must be one of: ${validCategories.join(', ')}` }
    );
  }

  return category.toLowerCase();
}

/**
 * Validate claim amount range
 */
export function validateClaimAmount(amount: number): number {
  if (typeof amount !== 'number') {
    throw ValidationError.invalidFormat('amount', 'number');
  }

  if (amount <= 0) {
    throw new ValidationError(
      'Amount must be greater than 0',
      { amount: 'Must be a positive number' }
    );
  }

  if (amount > 100000) {
    throw new ValidationError(
      'Amount exceeds maximum allowed value',
      { amount: 'Maximum allowed: $100,000' }
    );
  }

  return amount;
}

/**
 * Comprehensive claim validation
 */
export function validateClaim(claim: ClaimData): {
  isValid: boolean;
  errors: Record<string, string>;
  normalized: Partial<ClaimData>;
} {
  const errors: Record<string, string> = {};
  const normalized: Partial<ClaimData> = { ...claim };

  try {
    // Validate structure
    validateClaimStructure(claim);

    // Validate and normalize date
    if (claim.claim_date) {
      try {
        normalized.claim_date = validateClaimDate(claim.claim_date)?.toISOString() || undefined;
      } catch (error) {
        if (error instanceof ValidationError || error instanceof BusinessError) {
          errors.claim_date = error.message;
        } else {
          errors.claim_date = 'Invalid date format';
        }
      }
    }

    // Validate and normalize category
    if (claim.category) {
      try {
        normalized.category = validateClaimCategory(claim.category) || undefined;
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.category = error.message;
        } else {
          errors.category = 'Invalid category';
        }
      }
    }

    // Validate amount
    if (claim.amount !== undefined) {
      try {
        normalized.amount = validateClaimAmount(claim.amount);
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.amount = error.message;
        } else {
          errors.amount = 'Invalid amount';
        }
      }
    }

    // Validate marketplace
    if (claim.marketplace && typeof claim.marketplace !== 'string') {
      errors.marketplace = 'Marketplace must be a string';
    }

    // Validate SKU/ASIN
    if (claim.sku && typeof claim.sku !== 'string') {
      errors.sku = 'SKU must be a string';
    }

    if (claim.asin && typeof claim.asin !== 'string') {
      errors.asin = 'ASIN must be a string';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
      normalized
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        isValid: false,
        errors: { ...errors, ...error.fields },
        normalized
      };
    }
    throw error;
  }
}

