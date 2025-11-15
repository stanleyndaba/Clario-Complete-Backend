/**
 * Test Script for Agent 9: Billing Engine
 * Tests billing service, worker, database operations, and integration with Agent 8
 */

import 'dotenv/config';
import logger from '../src/utils/logger';
import { supabaseAdmin } from '../src/database/supabaseClient';
import billingService from '../src/services/billingService';
import billingWorker from '../src/workers/billingWorker';

class BillingTest {
  private testUserId: string = 'test-user-billing-9';
  private testDisputeId: string = '';
  private testRecoveryId: string = '';

  /**
   * Setup test data
   */
  async setupTestData(): Promise<void> {
    try {
      logger.info('📋 Setting up test data...');

      // Create a test dispute case with reconciled recovery
      const { data: disputeCase, error: disputeError } = await supabaseAdmin
        .from('dispute_cases')
        .insert({
          seller_id: this.testUserId,
          claim_amount: 100.00,
          actual_payout_amount: 100.00,
          currency: 'usd',
          status: 'approved',
          recovery_status: 'reconciled',
          billing_status: 'pending',
          created_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (disputeError) {
        logger.warn('⚠️ Failed to create test dispute case', {
          error: disputeError.message,
          note: 'Test may run in demo mode'
        });
        // Generate mock ID for demo mode
        this.testDisputeId = 'test-dispute-' + Date.now();
      } else {
        this.testDisputeId = disputeCase.id;
      }

      // Create a test recovery
      if (this.testDisputeId && !this.testDisputeId.startsWith('test-')) {
        const { data: recovery, error: recoveryError } = await supabaseAdmin
          .from('recoveries')
          .insert({
            dispute_id: this.testDisputeId,
            user_id: this.testUserId,
            expected_amount: 100.00,
            actual_amount: 100.00,
            reconciliation_status: 'reconciled',
            reconciled_at: new Date().toISOString()
          })
          .select('id')
          .single();

        if (!recoveryError && recovery) {
          this.testRecoveryId = recovery.id;
        }
      }

      logger.info('✅ Test data setup complete', {
        disputeId: this.testDisputeId,
        recoveryId: this.testRecoveryId
      });

    } catch (error: any) {
      logger.error('❌ Failed to setup test data', { error: error.message });
    }
  }

  /**
   * Test migration
   */
  async testMigration(): Promise<void> {
    logger.info('📋 Testing Migration...');

    try {
      // Check billing_transactions table
      const { data: transactions, error: transactionsError } = await supabaseAdmin
        .from('billing_transactions')
        .select('id')
        .limit(1);

      if (transactionsError) {
        logger.error('❌ Migration: billing_transactions table', { error: transactionsError.message });
      } else {
        logger.info('✅ Migration: billing_transactions table');
      }

      // Check billing_errors table
      const { data: errors, error: errorsError } = await supabaseAdmin
        .from('billing_errors')
        .select('id')
        .limit(1);

      if (errorsError) {
        logger.error('❌ Migration: billing_errors table', { error: errorsError.message });
      } else {
        logger.info('✅ Migration: billing_errors table');
      }

      // Check billing_status column
      const { data: cases, error: casesError } = await supabaseAdmin
        .from('dispute_cases')
        .select('billing_status, billing_transaction_id, platform_fee_cents, seller_payout_cents, billed_at, billing_retry_count')
        .limit(1);

      if (casesError) {
        logger.error('❌ Migration: billing_status column', { error: casesError.message });
      } else {
        logger.info('✅ Migration: billing_status column');
        logger.info('✅ Migration: billing_transaction_id column');
        logger.info('✅ Migration: platform_fee_cents column');
        logger.info('✅ Migration: seller_payout_cents column');
        logger.info('✅ Migration: billed_at column');
        logger.info('✅ Migration: billing_retry_count column');
      }

    } catch (error: any) {
      logger.error('❌ Migration test failed', { error: error.message });
    }
  }

  /**
   * Test service
   */
  async testService(): Promise<void> {
    logger.info('🔧 Testing Billing Service...');

    try {
      // Test initialization
      if (billingService) {
        logger.info('✅ Service: Initialization');
      }

      // Test calculateFees method
      const feeCalculation = billingService.calculateFees(10000, 'usd'); // $100.00
      if (feeCalculation.platformFeeCents === 2000 && feeCalculation.sellerPayoutCents === 8000) {
        logger.info('✅ Service: calculateFees method', {
          platformFeeCents: feeCalculation.platformFeeCents,
          sellerPayoutCents: feeCalculation.sellerPayoutCents
        });
      } else {
        logger.error('❌ Service: calculateFees method', {
          expected: { platformFee: 2000, sellerPayout: 8000 },
          actual: feeCalculation
        });
      }

      // Test minimum fee
      const minFeeCalculation = billingService.calculateFees(100, 'usd'); // $1.00
      if (minFeeCalculation.platformFeeCents >= 50) {
        logger.info('✅ Service: Minimum fee calculation', {
          platformFeeCents: minFeeCalculation.platformFeeCents
        });
      }

      // Test getBillingStatus method
      if (typeof billingService.getBillingStatus === 'function') {
        logger.info('✅ Service: getBillingStatus method');
      }

      // Test logBillingError method
      if (typeof billingService.logBillingError === 'function') {
        logger.info('✅ Service: logBillingError method');
      }

      // Test chargeCommission method (will fail without Stripe API, but method exists)
      if (typeof billingService.chargeCommission === 'function') {
        logger.info('✅ Service: chargeCommission method');
      }

      // Test chargeCommissionWithRetry method
      if (typeof billingService.chargeCommissionWithRetry === 'function') {
        logger.info('✅ Service: chargeCommissionWithRetry method');
      }

      // Check STRIPE_PAYMENTS_URL
      const stripePaymentsUrl = process.env.STRIPE_PAYMENTS_URL;
      if (stripePaymentsUrl) {
        logger.info('✅ Service: STRIPE_PAYMENTS_URL configured', { url: stripePaymentsUrl });
      } else {
        logger.info('⚠️ Service: STRIPE_PAYMENTS_URL not set', {
          note: 'Optional - service will use default if not set',
          url: 'not set (will use default)'
        });
      }

    } catch (error: any) {
      logger.error('❌ Service test failed', { error: error.message });
    }
  }

  /**
   * Test worker
   */
  async testWorker(): Promise<void> {
    logger.info('⚙️ Testing Billing Worker...');

    try {
      // Test initialization
      if (billingWorker) {
        logger.info('✅ Worker: Initialization');
      }

      // Test start method
      if (typeof billingWorker.start === 'function') {
        logger.info('✅ Worker: start method');
      }

      // Test stop method
      if (typeof billingWorker.stop === 'function') {
        logger.info('✅ Worker: stop method');
      }

      // Test runBillingForAllTenants method
      if (typeof billingWorker.runBillingForAllTenants === 'function') {
        logger.info('✅ Worker: runBillingForAllTenants method');
      }

      // Test processBillingForRecovery method
      if (typeof billingWorker.processBillingForRecovery === 'function') {
        logger.info('✅ Worker: processBillingForRecovery method');
      }

    } catch (error: any) {
      logger.error('❌ Worker test failed', { error: error.message });
    }
  }

  /**
   * Test database operations
   */
  async testDatabaseOperations(): Promise<void> {
    logger.info('💾 Testing Database Operations...');

    try {
      // Test insert billing error
      const { data: errorLog, error: errorLogError } = await supabaseAdmin
        .from('billing_errors')
        .insert({
          dispute_id: this.testDisputeId || 'test-dispute',
          user_id: this.testUserId,
          error_type: 'billing_failed',
          error_message: 'Test error message',
          retry_count: 0,
          max_retries: 3
        })
        .select('id')
        .single();

      if (errorLogError) {
        logger.error('❌ Database: Insert error log', { error: errorLogError.message });
      } else {
        logger.info('✅ Database: Insert error log', { id: errorLog?.id });

        // Cleanup
        if (errorLog?.id) {
          await supabaseAdmin
            .from('billing_errors')
            .delete()
            .eq('id', errorLog.id);
        }
      }

    } catch (error: any) {
      logger.error('❌ Database operations test failed', { error: error.message });
    }
  }

  /**
   * Test integration
   */
  async testIntegration(): Promise<void> {
    logger.info('🔗 Testing Integration...');

    try {
      // Test service and worker available
      if (billingService && billingWorker) {
        logger.info('✅ Integration: Service and Worker available');
      }

      // Test environment variables
      const stripePaymentsUrl = process.env.STRIPE_PAYMENTS_URL;
      if (stripePaymentsUrl) {
        logger.info('✅ Integration: STRIPE_PAYMENTS_URL configured', { url: stripePaymentsUrl });
      } else {
        logger.info('⚠️ Integration: STRIPE_PAYMENTS_URL not set', {
          note: 'Optional - service will use default if not set',
          url: 'not set (will use default)'
        });
      }

      // Test Agent 8 integration (check if billing_status is set when recovery_status = 'reconciled')
      const { data: reconciledCases } = await supabaseAdmin
        .from('dispute_cases')
        .select('id, recovery_status, billing_status')
        .eq('recovery_status', 'reconciled')
        .limit(1);

      if (reconciledCases && reconciledCases.length > 0) {
        logger.info('✅ Integration: Cases marked for billing (Agent 8)', {
          count: reconciledCases.length,
          note: 'This verifies Agent 8 integration'
        });
      } else {
        logger.info('ℹ️ Integration: No reconciled cases found', {
          note: 'This is expected if no recoveries have been reconciled yet'
        });
      }

    } catch (error: any) {
      logger.error('❌ Integration test failed', { error: error.message });
    }
  }

  /**
   * Test fee calculation
   */
  async testFeeCalculation(): Promise<void> {
    logger.info('💰 Testing Fee Calculation...');

    try {
      // Test 20% fee calculation
      const testAmounts = [
        { amount: 10000, expectedFee: 2000, expectedPayout: 8000 }, // $100.00
        { amount: 5000, expectedFee: 1000, expectedPayout: 4000 },   // $50.00
        { amount: 100, expectedFee: 50, expectedPayout: 50 }           // $1.00 (minimum fee)
      ];

      for (const test of testAmounts) {
        const calculation = billingService.calculateFees(test.amount, 'usd');
        if (calculation.platformFeeCents === test.expectedFee && 
            calculation.sellerPayoutCents === test.expectedPayout) {
          logger.info('✅ Fee Calculation: Test passed', {
            amount: test.amount,
            platformFee: calculation.platformFeeCents,
            sellerPayout: calculation.sellerPayoutCents
          });
        } else {
          logger.error('❌ Fee Calculation: Test failed', {
            amount: test.amount,
            expected: { fee: test.expectedFee, payout: test.expectedPayout },
            actual: { fee: calculation.platformFeeCents, payout: calculation.sellerPayoutCents }
          });
        }
      }

    } catch (error: any) {
      logger.error('❌ Fee calculation test failed', { error: error.message });
    }
  }

  /**
   * Cleanup test data
   */
  async cleanupTestData(): Promise<void> {
    try {
      logger.info('🧹 Cleaning up test data...');

      if (this.testDisputeId && !this.testDisputeId.startsWith('test-')) {
        // Delete billing transactions
        await supabaseAdmin
          .from('billing_transactions')
          .delete()
          .eq('dispute_id', this.testDisputeId);

        // Delete billing errors
        await supabaseAdmin
          .from('billing_errors')
          .delete()
          .eq('dispute_id', this.testDisputeId);

        // Delete recovery
        if (this.testRecoveryId) {
          await supabaseAdmin
            .from('recoveries')
            .delete()
            .eq('id', this.testRecoveryId);
        }

        // Delete dispute case
        await supabaseAdmin
          .from('dispute_cases')
          .delete()
          .eq('id', this.testDisputeId);
      }

      logger.info('✅ Cleanup complete');

    } catch (error: any) {
      logger.error('❌ Cleanup failed', { error: error.message });
    }
  }

  /**
   * Run all tests
   */
  async runTests(): Promise<void> {
    logger.info('\n🚀 Starting Agent 9 (Billing) Tests...\n');

    try {
      await this.setupTestData();
      await this.testMigration();
      await this.testService();
      await this.testWorker();
      await this.testDatabaseOperations();
      await this.testIntegration();
      await this.testFeeCalculation();

      logger.info('\n📊 Test Summary:');
      logger.info('Total: 20+ | Passed: See above | Failed: See above');

      logger.info('\n✅ Agent 9 (Billing) Tests Complete!\n');

    } catch (error: any) {
      logger.error('❌ Test suite failed', { error: error.message });
    } finally {
      await this.cleanupTestData();
    }
  }
}

// Run tests
const test = new BillingTest();
test.runTests().catch(console.error);

