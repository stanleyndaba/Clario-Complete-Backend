import app from './app';
import config from '@/config/env';
import { PayoutJobQueue } from '@/jobs/payoutJob';
import { prisma } from '@/prisma/client';

async function startServer() {
  try {
    // Initialize Prisma
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    // Initialize job queues
    PayoutJobQueue.initialize();
    console.log('✅ Job queues initialized successfully');

    // Start the server
    const server = app.listen(config.PORT, () => {
      console.log(`🚀 Stripe Payments microservice started on port ${config.PORT}`);
      console.log(`📊 Environment: ${config.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${config.PORT}/health`);
      console.log(`📝 API docs: http://localhost:${config.PORT}/api/v1`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      
      server.close(async () => {
        try {
          await PayoutJobQueue.close();
          await prisma.$disconnect();
          console.log('✅ Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          console.error('❌ Error during graceful shutdown:', error);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
startServer(); 