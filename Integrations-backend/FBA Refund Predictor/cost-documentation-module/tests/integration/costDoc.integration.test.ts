import request from 'supertest';
import { app } from '../../src/index';
import { costDocService } from '../../src/services/costDocService';
import { costDocWorker } from '../../src/workers/costDocWorker';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Cost Documentation Integration Tests', () => {
  beforeAll(async () => {
    // Initialize services
    await costDocService.initialize();
    await costDocWorker.initialize();
  });

  afterAll(async () => {
    // Cleanup
    await costDocService.cleanup();
    await costDocWorker.cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean database between tests
    await prisma.generatedPDF.deleteMany();
    await prisma.costDocumentationJob.deleteMany();
  });

  describe('Full Flow Integration', () => {
    it('should process manual documentation request end-to-end', async () => {
      const evidence = {
        anomaly_id: 'test-anomaly-123',
        seller_id: 'seller-456',
        anomaly_type: 'overcharges',
        evidence: {
          total_amount: 150.00,
          currency: 'USD',
          items: [
            { sku: 'SKU001', quantity: 2, unit_price: 25.00, total: 50.00 },
            { sku: 'SKU002', quantity: 1, unit_price: 100.00, total: 100.00 }
          ]
        },
        detected_at: '2024-01-15T10:00:00Z'
      };

      // Mock JWT token for testing
      const mockToken = 'mock-jwt-token';

      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(evidence)
        .expect(200);

      expect(response.body).toHaveProperty('pdf_url');
      expect(response.body).toHaveProperty('report_id');
      expect(response.body).toHaveProperty('evidence_sha256');

      // Verify database record was created
      const dbRecord = await prisma.generatedPDF.findFirst({
        where: { anomaly_id: evidence.anomaly_id }
      });
      expect(dbRecord).toBeTruthy();
      expect(dbRecord?.evidence_sha256).toBe(response.body.evidence_sha256);
    });

    it('should handle automatic job enqueue and processing', async () => {
      const evidence = {
        anomaly_id: 'test-anomaly-auto-789',
        seller_id: 'seller-456',
        anomaly_type: 'lost_units',
        evidence: {
          total_amount: 75.50,
          currency: 'USD',
          items: [
            { sku: 'SKU003', quantity: 3, unit_price: 25.17, total: 75.50 }
          ]
        },
        detected_at: '2024-01-15T11:00:00Z'
      };

      const mockToken = 'mock-jwt-token';

      // Enqueue automatic job
      const enqueueResponse = await request(app)
        .post('/api/v1/cost-documentation/generate/auto')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(evidence)
        .expect(200);

      expect(enqueueResponse.body).toHaveProperty('job_id');
      expect(enqueueResponse.body).toHaveProperty('status');
      expect(enqueueResponse.body.status).toBe('queued');

      // Wait for job processing (with timeout)
      let jobStatus;
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        
        const statusResponse = await request(app)
          .get(`/api/v1/cost-documentation/job/${enqueueResponse.body.job_id}`)
          .set('Authorization', `Bearer ${mockToken}`)
          .expect(200);

        jobStatus = statusResponse.body.status;
        
        if (jobStatus === 'completed' || jobStatus === 'failed') {
          break;
        }
        
        attempts++;
      }

      // Verify final status
      expect(jobStatus).toBe('completed');

      // Check that PDF was generated and stored
      const finalResponse = await request(app)
        .get(`/api/v1/cost-documentation/anomaly/${evidence.anomaly_id}`)
        .set('Authorization', `Bearer ${mockToken}`)
        .expect(200);

      expect(finalResponse.body).toHaveProperty('pdf_url');
      expect(finalResponse.body).toHaveProperty('evidence_sha256');
    });

    it('should maintain idempotency across multiple requests', async () => {
      const evidence = {
        anomaly_id: 'test-anomaly-idempotent',
        seller_id: 'seller-456',
        anomaly_type: 'overcharges',
        evidence: {
          total_amount: 200.00,
          currency: 'USD',
          items: [
            { sku: 'SKU004', quantity: 4, unit_price: 50.00, total: 200.00 }
          ]
        },
        detected_at: '2024-01-15T12:00:00Z'
      };

      const mockToken = 'mock-jwt-token';

      // First request
      const firstResponse = await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(evidence)
        .expect(200);

      const firstPdfUrl = firstResponse.body.pdf_url;
      const firstSha256 = firstResponse.body.evidence_sha256;

      // Second identical request
      const secondResponse = await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(evidence)
        .expect(200);

      // Should return same results
      expect(secondResponse.body.pdf_url).toBe(firstPdfUrl);
      expect(secondResponse.body.evidence_sha256).toBe(firstSha256);

      // Verify only one database record exists
      const dbRecords = await prisma.generatedPDF.findMany({
        where: { anomaly_id: evidence.anomaly_id }
      });
      expect(dbRecords).toHaveLength(1);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle invalid evidence gracefully', async () => {
      const invalidEvidence = {
        anomaly_id: 'test-invalid',
        seller_id: 'seller-456',
        // Missing required fields
      };

      const mockToken = 'mock-jwt-token';

      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(invalidEvidence)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should handle authentication failures', async () => {
      const evidence = {
        anomaly_id: 'test-auth-failure',
        seller_id: 'seller-456',
        anomaly_type: 'overcharges',
        evidence: { total_amount: 100.00 }
      };

      // No token
      await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .send(evidence)
        .expect(401);

      // Invalid token
      await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .set('Authorization', 'Bearer invalid-token')
        .send(evidence)
        .expect(401);
    });
  });
});



