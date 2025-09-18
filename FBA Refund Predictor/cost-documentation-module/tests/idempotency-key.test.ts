import { CostDocumentationService } from '../src/services/costDocumentationService';
import { CostDocumentationWorker } from '../src/workers/costDocumentationWorker';
import { AnomalyEvidence, GeneratedPDF } from '../types/costDocumentation';
import crypto from 'crypto';

// Mock S3Service
jest.mock('../src/services/s3Service', () => ({
  S3Service: {
    uploadBuffer: jest.fn(),
    generateSignedUrl: jest.fn()
  }
}));

// Mock Bull queue
jest.mock('bull');
const MockBull = require('bull');

describe('Idempotency and Deduplication', () => {
  let service: CostDocumentationService;
  let worker: CostDocumentationWorker;
  
  const mockEvidence: AnomalyEvidence = {
    anomaly_id: 'test-anomaly-123',
    type: 'lost_units',
    sku: 'TEST-SKU-001',
    expected_units: 100,
    received_units: 95,
    loss: 5,
    cost_per_unit: 12.50,
    total_loss: 62.50,
    detected_at: '2025-01-15T10:30:00Z',
    evidence_links: ['s3://artifacts/receiving_scan.pdf'],
    seller_info: {
      seller_id: 'seller-123',
      business_name: 'Test Company Inc.'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock S3Service
    const { S3Service } = require('../src/services/s3Service');
    S3Service.uploadBuffer.mockResolvedValue({ Location: 's3://bucket/file.pdf' });
    S3Service.generateSignedUrl.mockResolvedValue('https://signed-url.com/file.pdf');
    
    // Mock Bull
    MockBull.mockImplementation(() => ({
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      process: jest.fn(),
      on: jest.fn(),
      close: jest.fn()
    }));
    
    service = new CostDocumentationService();
    worker = new CostDocumentationWorker();
  });

  describe('Idempotency Key Generation', () => {
    it('should generate consistent idempotency keys for identical inputs', () => {
      const service = new CostDocumentationService() as any;
      
      // Generate idempotency key
      const key1 = service.generateIdempotencyKey(mockEvidence, 'v1.0');
      const key2 = service.generateIdempotencyKey(mockEvidence, 'v1.0');
      
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hash
    });

    it('should generate different keys for different template versions', () => {
      const service = new CostDocumentationService() as any;
      
      const key1 = service.generateIdempotencyKey(mockEvidence, 'v1.0');
      const key2 = service.generateIdempotencyKey(mockEvidence, 'v1.1');
      
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different evidence', () => {
      const service = new CostDocumentationService() as any;
      
      const evidence1 = { ...mockEvidence, anomaly_id: 'anomaly-1' };
      const evidence2 = { ...mockEvidence, anomaly_id: 'anomaly-2' };
      
      const key1 = service.generateIdempotencyKey(evidence1, 'v1.0');
      const key2 = service.generateIdempotencyKey(evidence2, 'v1.0');
      
      expect(key1).not.toBe(key2);
    });

    it('should include all relevant fields in idempotency key', () => {
      const service = new CostDocumentationService() as any;
      
      const key = service.generateIdempotencyKey(mockEvidence, 'v1.0');
      
      // Key should be deterministic based on evidence content
      const expectedHash = crypto
        .createHash('sha256')
        .update(`${mockEvidence.seller_info?.seller_id}|${mockEvidence.anomaly_id}|v1.0|${JSON.stringify(mockEvidence)}`)
        .digest('hex');
      
      expect(key).toBe(expectedHash);
    });
  });

  describe('S3 Path Stability', () => {
    it('should generate stable S3 keys for identical inputs', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key1 = service.generateS3Key(mockEvidence, 'v1.0');
      const s3Key2 = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(s3Key1).toBe(s3Key2);
      expect(s3Key1).toMatch(/^docs\/seller\/seller-123\/anomalies\/test-anomaly-123\/costdoc\/v1\.0\.pdf$/);
    });

    it('should include template version in S3 key', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(s3Key).toContain('v1.0.pdf');
    });

    it('should organize files by seller and anomaly', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(s3Key).toContain(`seller/${mockEvidence.seller_info?.seller_id}`);
      expect(s3Key).toContain(`anomalies/${mockEvidence.anomaly_id}`);
    });
  });

  describe('Duplicate Request Handling', () => {
    it('should return existing artifact for duplicate requests', async () => {
      const existingPDF: GeneratedPDF = {
        id: 'pdf-123',
        anomaly_id: mockEvidence.anomaly_id,
        seller_id: mockEvidence.seller_info?.seller_id || 'unknown',
        pdf_s3_key: 'docs/seller/seller-123/anomalies/test-anomaly-123/costdoc/v1.0.pdf',
        pdf_url: 'https://signed-url.com/existing.pdf',
        template_used: 'template-123',
        generated_at: '2025-01-15T10:30:00Z',
        file_size: 1024,
        metadata: { template_version: 'v1.0' }
      };
      
      // Mock database to return existing PDF
      const mockPrisma = {
        generatedPDF: {
          findFirst: jest.fn().mockResolvedValue(existingPDF)
        }
      };
      
      const service = new CostDocumentationService() as any;
      service.prisma = mockPrisma;
      
      // First request should create new PDF
      const result1 = await service.createDocumentationJob(mockEvidence);
      expect(result1).toBeDefined();
      
      // Second request with same evidence should return existing PDF
      const result2 = await service.createDocumentationJob(mockEvidence);
      expect(result2).toBeDefined();
      
      // Should not create duplicate jobs
      expect(mockPrisma.generatedPDF.findFirst).toHaveBeenCalled();
    });

    it('should handle concurrent duplicate requests', async () => {
      const service = new CostDocumentationService() as any;
      
      // Mock database operations
      const mockPrisma = {
        generatedPDF: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'pdf-123' })
        },
        costDocumentationJob: {
          create: jest.fn().mockResolvedValue({ id: 'job-123' })
        }
      };
      
      service.prisma = mockPrisma;
      
      // Simulate concurrent requests
      const promises = [
        service.createDocumentationJob(mockEvidence),
        service.createDocumentationJob(mockEvidence),
        service.createDocumentationJob(mockEvidence)
      ];
      
      const results = await Promise.all(promises);
      
      // All should succeed
      expect(results).toHaveLength(3);
      expect(results.every(r => r)).toBe(true);
      
      // Should check for existing PDF multiple times
      expect(mockPrisma.generatedPDF.findFirst).toHaveBeenCalledTimes(3);
    });
  });

  describe('Template Version Handling', () => {
    it('should use template version from environment', () => {
      process.env.PDF_TEMPLATE_VERSION = 'v2.1';
      
      const service = new CostDocumentationService() as any;
      const s3Key = service.generateS3Key(mockEvidence);
      
      expect(s3Key).toContain('v2.1.pdf');
      
      delete process.env.PDF_TEMPLATE_VERSION;
    });

    it('should default to v1.0 if no version specified', () => {
      const service = new CostDocumentationService() as any;
      const s3Key = service.generateS3Key(mockEvidence);
      
      expect(s3Key).toContain('v1.0.pdf');
    });
  });

  describe('Evidence Validation for Idempotency', () => {
    it('should validate evidence before generating idempotency key', () => {
      const service = new CostDocumentationService() as any;
      
      const invalidEvidence = { ...mockEvidence, anomaly_id: undefined };
      
      expect(() => {
        service.generateIdempotencyKey(invalidEvidence, 'v1.0');
      }).toThrow('Invalid evidence: missing required fields');
    });

    it('should handle missing seller info gracefully', () => {
      const service = new CostDocumentationService() as any;
      
      const evidenceWithoutSeller = { ...mockEvidence };
      delete evidenceWithoutSeller.seller_info;
      
      const key = service.generateIdempotencyKey(evidenceWithoutSeller, 'v1.0');
      
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(key).toContain('unknown'); // Should use 'unknown' for missing seller_id
    });
  });

  describe('Database Idempotency', () => {
    it('should use upsert for artifact storage', async () => {
      const service = new CostDocumentationService() as any;
      
      const mockPrisma = {
        generatedPDF: {
          upsert: jest.fn().mockResolvedValue({ id: 'pdf-123' })
        }
      };
      
      service.prisma = mockPrisma;
      
      await service.storeGeneratedPDF({
        id: 'pdf-123',
        anomaly_id: mockEvidence.anomaly_id,
        seller_id: mockEvidence.seller_info?.seller_id || 'unknown',
        pdf_s3_key: 'docs/seller/seller-123/anomalies/test-anomaly-123/costdoc/v1.0.pdf',
        pdf_url: 'https://signed-url.com/file.pdf',
        template_used: 'template-123',
        generated_at: '2025-01-15T10:30:00Z',
        file_size: 1024,
        metadata: { template_version: 'v1.0' }
      });
      
      expect(mockPrisma.generatedPDF.upsert).toHaveBeenCalledWith({
        where: {
          anomaly_id_seller_id_template_version: {
            anomaly_id: mockEvidence.anomaly_id,
            seller_id: mockEvidence.seller_info?.seller_id || 'unknown',
            template_version: 'v1.0'
          }
        },
        update: expect.any(Object),
        create: expect.any(Object)
      });
    });

    it('should handle database conflicts gracefully', async () => {
      const service = new CostDocumentationService() as any;
      
      const mockPrisma = {
        generatedPDF: {
          upsert: jest.fn().mockRejectedValue(new Error('Unique constraint violation'))
        }
      };
      
      service.prisma = mockPrisma;
      
      try {
        await service.storeGeneratedPDF({
          id: 'pdf-123',
          anomaly_id: mockEvidence.anomaly_id,
          seller_id: mockEvidence.seller_info?.seller_id || 'unknown',
          pdf_s3_key: 'docs/seller/seller-123/anomalies/test-anomaly-123/costdoc/v1.0.pdf',
          pdf_url: 'https://signed-url.com/file.pdf',
          template_used: 'template-123',
          generated_at: '2025-01-15T10:30:00Z',
          file_size: 1024,
          metadata: { template_version: 'v1.0' }
        });
        fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toContain('Unique constraint violation');
      }
    });
  });

  describe('Worker Idempotency', () => {
    it('should not process duplicate jobs', async () => {
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-123' }),
        process: jest.fn(),
        on: jest.fn(),
        close: jest.fn()
      };
      
      MockBull.mockImplementation(() => mockQueue);
      
      const worker = new CostDocumentationWorker();
      
      // Add same job multiple times
      await worker.addJob(mockEvidence);
      await worker.addJob(mockEvidence);
      await worker.addJob(mockEvidence);
      
      // Should only add once due to idempotency
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });
});








