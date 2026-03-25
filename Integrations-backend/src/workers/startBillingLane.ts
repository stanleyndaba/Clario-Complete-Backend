import 'dotenv/config';
import logger from '../utils/logger';
import billingWorker from './billingWorker';

process.env.RUNTIME_ROLE = process.env.RUNTIME_ROLE || 'billing-lane';
process.env.ENABLE_BACKGROUND_JOBS = 'false';
process.env.ENABLE_RECOVERIES_WORKER = 'false';
process.env.ENABLE_BILLING_WORKER = 'true';

logger.info('🚀 [BILLING LANE] Starting dedicated billing finality runtime', {
  runtimeRole: process.env.RUNTIME_ROLE
});

billingWorker.start();

const shutdown = () => {
  logger.info('🛑 [BILLING LANE] Shutting down dedicated billing finality runtime');
  billingWorker.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
