/**
 * Duplicate Claim Detection Utilities
 * Detects and prevents duplicate claims
 */

import { BusinessError, DatabaseError, ErrorCode } from './errors';
import logger from './logger';
import { supabaseAdmin } from '../database/supabaseClient';

export interface DuplicateCheckOptions {
  claimId: string;
  userId: string;
  orderId?: string;
  amount?: number;
  dateRange?: number; // days
}

/**
 * Check if a claim ID already exists
 */
export async function checkClaimIdExists(claimId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('detection_results')
      .select('id')
      .eq('claim_id', claimId)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      logger.error('Error checking for duplicate claim ID', {
        claimId,
        error: error.message
      });
      throw DatabaseError.queryFailed(error.message);
    }

    return !!data;
  } catch (error) {
    logger.error('Error checking claim ID existence', {
      claimId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Check if a claim with same order ID and amount exists within date range
 */
export async function checkDuplicateByOrderAndAmount(
  orderId: string,
  amount: number,
  userId: string,
  dateRangeDays: number = 30
): Promise<boolean> {
  try {
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - dateRangeDays);

    const { data, error } = await supabaseAdmin
      .from('detection_results')
      .select('id, claim_id')
      .eq('user_id', userId)
      .eq('order_id', orderId)
      .eq('amount', amount)
      .gte('created_at', dateThreshold.toISOString())
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Error checking for duplicate by order and amount', {
        orderId,
        amount,
        userId,
        error: error.message
      });
      throw DatabaseError.queryFailed(error.message);
    }

    return !!data;
  } catch (error) {
    logger.error('Error checking duplicate by order and amount', {
      orderId,
      amount,
      userId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Check if a dispute case already exists for this claim
 */
export async function checkDisputeCaseExists(claimId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('dispute_cases')
      .select('id')
      .eq('claim_id', claimId)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Error checking for existing dispute case', {
        claimId,
        error: error.message
      });
      throw DatabaseError.queryFailed(error.message);
    }

    return !!data;
  } catch (error) {
    logger.error('Error checking dispute case existence', {
      claimId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Comprehensive duplicate check
 */
export async function checkForDuplicates(options: DuplicateCheckOptions): Promise<{
  isDuplicate: boolean;
  reason?: string;
  existingClaimId?: string;
}> {
  const { claimId, userId, orderId, amount, dateRange = 30 } = options;

  try {
    // Check 1: Claim ID already exists
    const claimIdExists = await checkClaimIdExists(claimId);
    if (claimIdExists) {
      logger.warn('⚠️ [DUPLICATE DETECTION] Duplicate claim ID detected', {
        claimId,
        userId
      });
      return {
        isDuplicate: true,
        reason: 'claim_id_already_exists',
        existingClaimId: claimId
      };
    }

    // Check 2: Dispute case already exists
    const disputeExists = await checkDisputeCaseExists(claimId);
    if (disputeExists) {
      logger.warn('⚠️ [DUPLICATE DETECTION] Dispute case already exists for claim', {
        claimId,
        userId
      });
      return {
        isDuplicate: true,
        reason: 'dispute_case_already_exists',
        existingClaimId: claimId
      };
    }

    // Check 3: Same order ID and amount within date range
    if (orderId && amount) {
      const orderAmountDuplicate = await checkDuplicateByOrderAndAmount(
        orderId,
        amount,
        userId,
        dateRange
      );
      if (orderAmountDuplicate) {
        logger.warn('⚠️ [DUPLICATE DETECTION] Duplicate by order ID and amount', {
          claimId,
          orderId,
          amount,
          userId
        });
        return {
          isDuplicate: true,
          reason: 'duplicate_order_and_amount',
          existingClaimId: claimId
        };
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    logger.error('Error during duplicate check', {
      claimId,
      userId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Prevent duplicate claim creation
 */
export async function preventDuplicateClaim(options: DuplicateCheckOptions): Promise<void> {
  const duplicateCheck = await checkForDuplicates(options);

  if (duplicateCheck.isDuplicate) {
    const reason = duplicateCheck.reason || 'unknown';
    const existingClaimId = duplicateCheck.existingClaimId || options.claimId;

    logger.error('❌ [DUPLICATE DETECTION] Duplicate claim prevented', {
      claimId: options.claimId,
      userId: options.userId,
      reason,
      existingClaimId
    });

    throw BusinessError.claimAlreadyFiled(existingClaimId);
  }
}

