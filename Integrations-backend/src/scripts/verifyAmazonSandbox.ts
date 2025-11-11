import 'dotenv/config';
import amazonService from '../services/amazonService';
import logger from '../utils/logger';

async function run(): Promise<void> {
  const userId = process.env.AMAZON_SANDBOX_VERIFICATION_USER_ID || 'sandbox-verification-user';
  const requireData = process.env.AMAZON_REQUIRE_SANDBOX_DATA === 'true';

  logger.info('Starting Amazon sandbox verification run', {
    userId,
    requireData,
    testCaseId: process.env.AMAZON_SPAPI_TEST_CASE_ID
  });

  const [inventoryResult, claimsResult, feesResult] = await Promise.all([
    amazonService.fetchInventory(userId),
    amazonService.fetchClaims(userId),
    amazonService.fetchFees(userId)
  ]);

  const inventoryCount = inventoryResult.data?.length ?? 0;
  const claimCount = claimsResult.data?.length ?? 0;
  const feeCount = feesResult.data?.length ?? 0;

  const summary = {
    inventoryItems: inventoryCount,
    claims: claimCount,
    fees: feeCount,
    inventoryMessage: inventoryResult.message,
    claimsMessage: claimsResult.message,
    feesMessage: feesResult.message
  };

  console.log('\nAmazon sandbox sync summary:');
  console.table({
    inventory: summary.inventoryItems,
    claims: summary.claims,
    fees: summary.fees
  });

  if (requireData && (inventoryCount === 0 || claimCount === 0 || feeCount === 0)) {
    throw new Error(
      `Sandbox verification failed. Require data flag set but received counts: inventory=${inventoryCount}, claims=${claimCount}, fees=${feeCount}`
    );
  }

  logger.info('Amazon sandbox verification completed successfully', summary);
}

run().catch((error) => {
  logger.error('Amazon sandbox verification failed', {
    error: error?.message || error,
    stack: error?.stack
  });
  console.error('\nAmazon sandbox verification failed:', error?.message || error);
  process.exit(1);
});

