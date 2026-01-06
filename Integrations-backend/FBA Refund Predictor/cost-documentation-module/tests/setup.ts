import { prisma } from '../config/database';

// Global test setup
beforeAll(async () => {
  // Connect to test database
  await prisma.$connect();
});

// Global test teardown
afterAll(async () => {
  // Clean up and disconnect
  await prisma.$disconnect();
});

// Clean database between tests
beforeEach(async () => {
  // Clean all tables
  await prisma.auditLog.deleteMany();
  await prisma.costDocument.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.sKU.deleteMany();
  await prisma.user.deleteMany();
}); 