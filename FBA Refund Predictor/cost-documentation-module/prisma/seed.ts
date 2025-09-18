import { PrismaClient, RuleType, ThresholdOperator } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding default detection thresholds...');

  // Default thresholds for LOST_UNITS
  await prisma.detectionThreshold.upsert({
    where: {
      id: 'default-lost-units-percentage'
    },
    update: {},
    create: {
      id: 'default-lost-units-percentage',
      sellerId: null, // Global threshold
      ruleType: RuleType.LOST_UNITS,
      operator: ThresholdOperator.LT,
      value: 0.01, // 1% of total units
      active: true
    }
  });

  await prisma.detectionThreshold.upsert({
    where: {
      id: 'default-lost-units-amount'
    },
    update: {},
    create: {
      id: 'default-lost-units-amount',
      sellerId: null, // Global threshold
      ruleType: RuleType.LOST_UNITS,
      operator: ThresholdOperator.LT,
      value: 5.0, // $5
      active: true
    }
  });

  // Default thresholds for OVERCHARGED_FEES
  await prisma.detectionThreshold.upsert({
    where: {
      id: 'default-overcharged-fees'
    },
    update: {},
    create: {
      id: 'default-overcharged-fees',
      sellerId: null, // Global threshold
      ruleType: RuleType.OVERCHARGED_FEES,
      operator: ThresholdOperator.LT,
      value: 2.0, // $2
      active: true
    }
  });

  // Default thresholds for DAMAGED_STOCK
  await prisma.detectionThreshold.upsert({
    where: {
      id: 'default-damaged-stock-amount'
    },
    update: {},
    create: {
      id: 'default-damaged-stock-amount',
      sellerId: null, // Global threshold
      ruleType: RuleType.DAMAGED_STOCK,
      operator: ThresholdOperator.LT,
      value: 5.0, // $5
      active: true
    }
  });

  await prisma.detectionThreshold.upsert({
    where: {
      id: 'default-damaged-stock-units'
    },
    update: {},
    create: {
      id: 'default-damaged-stock-units',
      sellerId: null, // Global threshold
      ruleType: RuleType.DAMAGED_STOCK,
      operator: ThresholdOperator.LT,
      value: 1.0, // 1 unit
      active: true
    }
  });

  console.log('Default detection thresholds seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

