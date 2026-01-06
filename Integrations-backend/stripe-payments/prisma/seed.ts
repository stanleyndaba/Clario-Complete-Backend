#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { generateTestToken } from '../src/middlewares/auth';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  try {
    // Clean up existing data
    await prisma.transactionAudit.deleteMany();
    await prisma.stripeWebhookEvent.deleteMany();
    await prisma.stripeTransaction.deleteMany();
    await prisma.stripeAccount.deleteMany();
    await prisma.idempotencyKey.deleteMany();

    console.log('🧹 Cleaned up existing data');

    // Create test Stripe accounts
    const account1 = await prisma.stripeAccount.create({
      data: {
        userId: 1,
        stripeAccountId: 'acct_test_1',
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });

    const account2 = await prisma.stripeAccount.create({
      data: {
        userId: 2,
        stripeAccountId: 'acct_test_2',
        status: 'pending',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      },
    });

    console.log('✅ Created test Stripe accounts');

    // Create test transactions
    const transaction1 = await prisma.stripeTransaction.create({
      data: {
        userId: 1,
        claimId: 123,
        amountRecoveredCents: 10000, // $100.00
        platformFeeCents: 2000,      // $20.00 (20%)
        sellerPayoutCents: 8000,     // $80.00 (80%)
        currency: 'usd',
        status: 'pending',
        idempotencyKey: 'seed-key-1',
        metadata: {
          test: true,
          seedData: true,
        },
      },
    });

    const transaction2 = await prisma.stripeTransaction.create({
      data: {
        userId: 2,
        claimId: 456,
        amountRecoveredCents: 5000,  // $50.00
        platformFeeCents: 1000,      // $10.00 (20%)
        sellerPayoutCents: 4000,     // $40.00 (80%)
        currency: 'usd',
        status: 'charged',
        stripePaymentIntentId: 'pi_test_2',
        stripeChargeId: 'ch_test_2',
        idempotencyKey: 'seed-key-2',
        metadata: {
          test: true,
          seedData: true,
        },
      },
    });

    console.log('✅ Created test transactions');

    // Create test webhook events
    await prisma.stripeWebhookEvent.create({
      data: {
        eventId: 'evt_test_1',
        eventType: 'payment_intent.succeeded',
        payload: {
          id: 'evt_test_1',
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_test_1',
              amount: 2000,
              currency: 'usd',
              status: 'succeeded',
            },
          },
        },
        processed: true,
        processedAt: new Date(),
        transactionId: transaction1.id,
      },
    });

    console.log('✅ Created test webhook events');

    // Create test audit trail
    await prisma.transactionAudit.create({
      data: {
        transactionId: transaction1.id,
        action: 'transaction_created',
        status: 'success',
        metadata: {
          test: true,
          seedData: true,
        },
      },
    });

    await prisma.transactionAudit.create({
      data: {
        transactionId: transaction2.id,
        action: 'payment_intent_succeeded',
        status: 'success',
        stripeEventId: 'evt_test_2',
        metadata: {
          test: true,
          seedData: true,
        },
      },
    });

    console.log('✅ Created test audit trail');

    // Create test idempotency keys
    await prisma.idempotencyKey.create({
      data: {
        id: 'seed-key-1',
        userId: 1,
        endpoint: '/api/v1/stripe/charge-commission',
        response: {
          success: true,
          data: {
            transactionId: transaction1.id,
            status: 'pending',
          },
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      },
    });

    console.log('✅ Created test idempotency keys');

    // Generate test JWT tokens
    const user1Token = generateTestToken(1, 'user1@test.com', 'user');
    const user2Token = generateTestToken(2, 'user2@test.com', 'user');
    const adminToken = generateTestToken(999, 'admin@test.com', 'admin');

    console.log('🔑 Generated test JWT tokens:');
    console.log(`User 1 Token: ${user1Token}`);
    console.log(`User 2 Token: ${user2Token}`);
    console.log(`Admin Token: ${adminToken}`);

    console.log('🎉 Database seeding completed successfully!');
    console.log('\n📊 Seed Data Summary:');
    console.log(`- Stripe Accounts: 2`);
    console.log(`- Transactions: 2`);
    console.log(`- Webhook Events: 1`);
    console.log(`- Audit Trail Entries: 2`);
    console.log(`- Idempotency Keys: 1`);

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  });
