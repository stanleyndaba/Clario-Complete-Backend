import 'dotenv/config';
import logger from '../utils/logger';
import recoveriesWorker from './recoveriesWorker';

process.env.RUNTIME_ROLE = process.env.RUNTIME_ROLE || 'recoveries-lane';
process.env.ENABLE_BACKGROUND_JOBS = 'false';
process.env.ENABLE_RECOVERIES_WORKER = 'true';
process.env.ENABLE_BILLING_WORKER = 'false';

logger.info('🚀 [RECOVERIES LANE] Starting dedicated recovery finality runtime', {
  runtimeRole: process.env.RUNTIME_ROLE
});

recoveriesWorker.start();

const shutdown = () => {
  logger.info('🛑 [RECOVERIES LANE] Shutting down dedicated recovery finality runtime');
  recoveriesWorker.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
