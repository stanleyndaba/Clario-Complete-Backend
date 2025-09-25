/*
  Minimal SP-API smoke script (transpile-only)
  Usage:
    AMAZON_MARKETPLACE_IDS=ATVPDKIKX0DER TOKEN_ENCRYPTION_KEY=... AMAZON_CLIENT_ID=... AMAZON_CLIENT_SECRET=... AMAZON_REDIRECT_URI=... \
    USER_ID=<uuid-of-user-with-token> npm run smoke:spapi

  Notes:
  - Expects a valid encrypted refresh token stored for the given USER_ID via tokenManager.
  - Runs TypeScript in transpile-only mode (ignores type errors) to exercise runtime paths.
*/

/* eslint-disable no-console */
import 'dotenv/config';

// Register ts-node transpile-only if executed via plain node
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('ts-node/register/transpile-only');
} catch {}

import amazonService from '../src/services/amazonService';

async function main() {
  const userId = process.env.USER_ID || process.argv[2];
  if (!userId) {
    console.error('USER_ID env or argv[2] required (user with stored Amazon token)');
    process.exit(1);
  }

  const marketplaceIdsEnv = process.env.AMAZON_MARKETPLACE_IDS || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
  console.log('Smoke config:', { userId, marketplaceIds: marketplaceIdsEnv });

  const t0 = Date.now();
  try {
    console.log('\n== Fetch FBA Reimbursements ==');
    const reimb = await amazonService.getRealFbaReimbursements(userId);
    console.log('Reimbursements:', { count: reimb.length, sample: reimb[0] });

    console.log('\n== Fetch Fee Preview (Estimated FBA Fees) ==');
    const fees = await amazonService.getRealFeeDiscrepancies(userId);
    console.log('Fees:', { count: fees.length, sample: fees[0] });

    console.log('\n== Fetch Shipment Data ==');
    const shipments = await amazonService.getRealShipmentData(userId);
    console.log('Shipments:', { count: shipments.length, sample: shipments[0] });

    console.log('\n== Fetch Returns Data ==');
    const returns = await amazonService.getRealReturnsData(userId);
    console.log('Returns:', { count: returns.length, sample: returns[0] });

    console.log('\n== Fetch Removal Data ==');
    const removals = await amazonService.getRealRemovalData(userId);
    console.log('Removals:', { count: removals.length, sample: removals[0] });

    console.log('\n== Fetch Inventory Summaries ==');
    const inventory = await amazonService.getRealInventoryData(userId);
    console.log('Inventory:', { count: inventory.length, sample: inventory[0] });

    const dt = Date.now() - t0;
    console.log(`\nSmoke success in ${dt} ms`);
  } catch (err: any) {
    console.error('Smoke failed:', err?.message || err);
    process.exit(2);
  }
}

main();

