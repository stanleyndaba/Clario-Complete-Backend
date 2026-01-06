import { CostDocumentationService } from '../src/services/costDocumentationService';
import { AnomalyEvidence } from '../types/costDocumentation';
import crypto from 'crypto';

describe('S3 Pathing and Organization', () => {
  let service: CostDocumentationService;
  
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
    service = new CostDocumentationService();
  });

  describe('S3 Key Generation', () => {
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

    it('should handle missing seller info gracefully', () => {
      const service = new CostDocumentationService() as any;
      
      const evidenceWithoutSeller = { ...mockEvidence };
      delete evidenceWithoutSeller.seller_info;
      
      const s3Key = service.generateS3Key(evidenceWithoutSeller, 'v1.0');
      
      expect(s3Key).toContain('seller/unknown');
      expect(s3Key).toContain(`anomalies/${mockEvidence.anomaly_id}`);
    });

    it('should sanitize seller and anomaly IDs for S3 compatibility', () => {
      const service = new CostDocumentationService() as any;
      
      const evidenceWithSpecialChars = {
        ...mockEvidence,
        anomaly_id: 'anomaly/with/slashes',
        seller_info: {
          ...mockEvidence.seller_info,
          seller_id: 'seller.with.dots'
        }
      };
      
      const s3Key = service.generateS3Key(evidenceWithSpecialChars, 'v1.0');
      
      // Should sanitize special characters
      expect(s3Key).not.toContain('anomaly/with/slashes');
      expect(s3Key).not.toContain('seller.with.dots');
      expect(s3Key).toContain('anomaly-with-slashes');
      expect(s3Key).toContain('seller-with-dots');
    });
  });

  describe('S3 Path Structure', () => {
    it('should follow the correct path hierarchy', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      const pathParts = s3Key.split('/');
      
      expect(pathParts).toEqual([
        'docs',
        'seller',
        'seller-123',
        'anomalies',
        'test-anomaly-123',
        'costdoc',
        'v1.0.pdf'
      ]);
    });

    it('should use consistent naming conventions', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      
      // Should use lowercase with hyphens
      expect(s3Key).toMatch(/^[a-z0-9\/\-\.]+$/);
      expect(s3Key).toContain('costdoc');
      expect(s3Key).toContain('anomalies');
    });

    it('should support different anomaly types consistently', () => {
      const service = new CostDocumentationService() as any;
      
      const types = ['lost_units', 'overcharges', 'damaged_stock', 'incorrect_fee'];
      
      types.forEach(type => {
        const evidence = { ...mockEvidence, type: type as any };
        const s3Key = service.generateS3Key(evidence, 'v1.0');
        
        // Path structure should be identical regardless of type
        expect(s3Key).toMatch(/^docs\/seller\/seller-123\/anomalies\/test-anomaly-123\/costdoc\/v1\.0\.pdf$/);
      });
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

    it('should handle semantic versioning correctly', () => {
      const service = new CostDocumentationService() as any;
      
      const versions = ['v1.0', 'v1.1', 'v2.0', 'v2.1.3'];
      
      versions.forEach(version => {
        const s3Key = service.generateS3Key(mockEvidence, version);
        expect(s3Key).toContain(`${version}.pdf`);
      });
    });
  });

  describe('File Naming Consistency', () => {
    it('should generate consistent filenames', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key1 = service.generateS3Key(mockEvidence, 'v1.0');
      const s3Key2 = service.generateS3Key(mockEvidence, 'v1.0');
      
      const filename1 = s3Key1.split('/').pop();
      const filename2 = s3Key2.split('/').pop();
      
      expect(filename1).toBe(filename2);
      expect(filename1).toBe('v1.0.pdf');
    });

    it('should handle different file extensions', () => {
      const service = new CostDocumentationService() as any;
      
      // Test with different file types
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0', 'pdf');
      expect(s3Key).toEndWith('.pdf');
      
      const s3KeyHtml = service.generateS3Key(mockEvidence, 'v1.0', 'html');
      expect(s3KeyHtml).toEndWith('.html');
    });
  });

  describe('S3 Key Validation', () => {
    it('should validate S3 key length', () => {
      const service = new CostDocumentationService() as any;
      
      // S3 keys have a maximum length of 1024 characters
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(s3Key.length).toBeLessThan(1024);
      expect(s3Key.length).toBeGreaterThan(0);
    });

    it('should not contain double slashes', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(s3Key).not.toContain('//');
    });

    it('should not start or end with slashes', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(s3Key).not.toMatch(/^\/|$/);
    });
  });

  describe('Path Collision Prevention', () => {
    it('should generate unique paths for different evidence', () => {
      const service = new CostDocumentationService() as any;
      
      const evidence1 = { ...mockEvidence, anomaly_id: 'anomaly-1' };
      const evidence2 = { ...mockEvidence, anomaly_id: 'anomaly-2' };
      
      const s3Key1 = service.generateS3Key(evidence1, 'v1.0');
      const s3Key2 = service.generateS3Key(evidence2, 'v1.0');
      
      expect(s3Key1).not.toBe(s3Key2);
    });

    it('should generate unique paths for different sellers', () => {
      const service = new CostDocumentationService() as any;
      
      const evidence1 = {
        ...mockEvidence,
        seller_info: { ...mockEvidence.seller_info, seller_id: 'seller-1' }
      };
      const evidence2 = {
        ...mockEvidence,
        seller_info: { ...mockEvidence.seller_info, seller_id: 'seller-2' }
      };
      
      const s3Key1 = service.generateS3Key(evidence1, 'v1.0');
      const s3Key2 = service.generateS3Key(evidence2, 'v1.0');
      
      expect(s3Key1).not.toBe(s3Key2);
    });

    it('should generate unique paths for different template versions', () => {
      const service = new CostDocumentationService() as any;
      
      const s3Key1 = service.generateS3Key(mockEvidence, 'v1.0');
      const s3Key2 = service.generateS3Key(mockEvidence, 'v1.1');
      
      expect(s3Key1).not.toBe(s3Key2);
    });
  });

  describe('S3 Bucket Organization', () => {
    it('should use configurable bucket prefix', () => {
      process.env.S3_BUCKET_PREFIX = 'cost-docs';
      
      const service = new CostDocumentationService() as any;
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(s3Key).toMatch(/^cost-docs\/seller\/seller-123\/anomalies\/test-anomaly-123\/costdoc\/v1\.0\.pdf$/);
      
      delete process.env.SDF_BUCKET_PREFIX;
    });

    it('should support environment-specific paths', () => {
      process.env.NODE_ENV = 'staging';
      
      const service = new CostDocumentationService() as any;
      const s3Key = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(s3Key).toContain('staging');
      
      delete process.env.NODE_ENV;
    });
  });

  describe('Path Generation Performance', () => {
    it('should generate paths efficiently', () => {
      const service = new CostDocumentationService() as any;
      
      const startTime = Date.now();
      
      // Generate 1000 paths
      for (let i = 0; i < 1000; i++) {
        const evidence = { ...mockEvidence, anomaly_id: `anomaly-${i}` };
        service.generateS3Key(evidence, 'v1.0');
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete in reasonable time (less than 100ms)
      expect(duration).toBeLessThan(100);
    });

    it('should handle large anomaly IDs efficiently', () => {
      const service = new CostDocumentationService() as any;
      
      const largeAnomalyId = 'a'.repeat(1000); // Very long anomaly ID
      const evidence = { ...mockEvidence, anomaly_id: largeAnomalyId };
      
      const startTime = Date.now();
      const s3Key = service.generateS3Key(evidence, 'v1.0');
      const endTime = Date.now();
      
      const duration = endTime - startTime;
      
      // Should complete quickly even with large IDs
      expect(duration).toBeLessThan(10);
      expect(s3Key).toContain(largeAnomalyId);
    });
  });

  describe('Path Migration and Versioning', () => {
    it('should support path migration strategies', () => {
      const service = new CostDocumentationService() as any;
      
      // Old path format
      const oldPath = service.generateS3Key(mockEvidence, 'v1.0');
      
      // New path format with different structure
      const newPath = service.generateS3Key(mockEvidence, 'v2.0');
      
      expect(oldPath).not.toBe(newPath);
      expect(oldPath).toContain('v1.0.pdf');
      expect(newPath).toContain('v2.0.pdf');
    });

    it('should maintain backward compatibility', () => {
      const service = new CostDocumentationService() as any;
      
      // Should still support old path format
      const oldPath = service.generateS3Key(mockEvidence, 'v1.0');
      
      expect(oldPath).toMatch(/^docs\/seller\/seller-123\/anomalies\/test-anomaly-123\/costdoc\/v1\.0\.pdf$/);
    });
  });
});







