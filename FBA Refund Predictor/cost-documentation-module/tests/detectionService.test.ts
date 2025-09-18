import { DetectionService, DetectionJob, DetectionResult, AnomalyEvidence } from '../services/detectionService';

// Mock Prisma client
const mockPrisma = {
  detectionJob: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn()
  },
  detectionResult: {
    createMany: jest.fn(),
    findMany: jest.fn()
  },
  detectionThreshold: {
    findMany: jest.fn()
  },
  detectionWhitelist: {
    findMany: jest.fn()
  },
  claim: {
    findUnique: jest.fn()
  }
};

// Mock S3 service
const mockS3Service = {
  uploadJson: jest.fn()
};

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('DetectionService', () => {
  let detectionService: DetectionService;
  let mockJob: DetectionJob;
  let mockClaim: any;
  let mockCostDocuments: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create service instance with mocked dependencies
    detectionService = new DetectionService(mockPrisma as any, mockS3Service as any);
    
    // Mock job data
    mockJob = {
      id: 'job-123',
      claimId: 'claim-456',
      userId: 'user-789',
      status: 'PENDING',
      priority: 'MEDIUM',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Mock claim data
    mockClaim = {
      id: 'claim-456',
      claimNumber: 'CLM-001',
      userId: 'user-789',
      status: 'pending',
      amount: 100.00,
      costDocuments: [
        {
          id: 'doc-1',
          skuId: 'sku-123',
          metadata: {
            lostUnits: 2,
            feeAmount: 15.50,
            expectedFee: 10.00,
            damagedStock: 1
          }
        },
        {
          id: 'doc-2',
          skuId: 'sku-456',
          metadata: {
            lostUnits: 0,
            feeAmount: 5.00,
            expectedFee: 5.00,
            damagedStock: 0
          }
        }
      ]
    };

    // Mock cost documents
    mockCostDocuments = mockClaim.costDocuments;
  });

  describe('enqueueDetectionJob', () => {
    it('should successfully enqueue a detection job', async () => {
      const mockCreatedJob = { ...mockJob, id: 'new-job-123' };
      mockPrisma.detectionJob.create.mockResolvedValue(mockCreatedJob);

      const result = await detectionService.enqueueDetectionJob('claim-456', 'user-789', 'HIGH');

      expect(result).toEqual(mockCreatedJob);
      expect(mockPrisma.detectionJob.create).toHaveBeenCalledWith({
        data: {
          claimId: 'claim-456',
          userId: 'user-789',
          priority: 'HIGH',
          status: 'PENDING',
          attemptCount: 0,
          maxAttempts: 3
        }
      });
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockPrisma.detectionJob.create.mockRejectedValue(dbError);

      await expect(
        detectionService.enqueueDetectionJob('claim-456', 'user-789')
      ).rejects.toThrow('Failed to enqueue detection job: Error: Database connection failed');
    });
  });

  describe('startDetectionWorker', () => {
    it('should start the detection worker', () => {
      detectionService.startDetectionWorker(3000);
      
      // Check that the worker is running
      expect(detectionService['isProcessing']).toBe(true);
    });

    it('should not start multiple workers', () => {
      detectionService.startDetectionWorker(3000);
      detectionService.startDetectionWorker(5000);
      
      // Should only start once
      expect(detectionService['isProcessing']).toBe(true);
    });
  });

  describe('stopDetectionWorker', () => {
    it('should stop the detection worker', () => {
      detectionService.startDetectionWorker(3000);
      detectionService.stopDetectionWorker();
      
      expect(detectionService['isProcessing']).toBe(false);
    });
  });

  describe('processDetectionJobs', () => {
    it('should process pending jobs successfully', async () => {
      // Mock pending jobs
      const pendingJobs = [mockJob];
      mockPrisma.detectionJob.findMany.mockResolvedValue(pendingJobs);
      
      // Mock claim lookup
      mockPrisma.claim.findUnique.mockResolvedValue(mockClaim);
      
      // Mock thresholds
      mockPrisma.detectionThreshold.findMany.mockResolvedValue([
        {
          id: 'thresh-1',
          anomalyType: 'LOST_UNITS',
          threshold: 1.0,
          operator: 'GREATER_THAN',
          isActive: true
        },
        {
          id: 'thresh-2',
          anomalyType: 'OVERCHARGED_FEES',
          threshold: 0.50,
          operator: 'GREATER_THAN',
          isActive: true
        }
      ]);
      
      // Mock whitelists
      mockPrisma.detectionWhitelist.findMany.mockResolvedValue([]);
      
      // Mock S3 upload
      mockS3Service.uploadJson.mockResolvedValue('evidence-url');
      
      // Mock result storage
      mockPrisma.detectionResult.createMany.mockResolvedValue({ count: 2 });
      
      // Mock job updates
      mockPrisma.detectionJob.update.mockResolvedValue({});

      // Start worker and process jobs
      detectionService.startDetectionWorker(100);
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Stop worker
      detectionService.stopDetectionWorker();

      // Verify job was processed
      expect(mockPrisma.detectionJob.findMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          attemptCount: { lt: 3 }
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'asc' }
        ],
        take: 10
      });
    });

    it('should handle no pending jobs', async () => {
      mockPrisma.detectionJob.findMany.mockResolvedValue([]);

      detectionService.startDetectionWorker(100);
      await new Promise(resolve => setTimeout(resolve, 150));
      detectionService.stopDetectionWorker();

      expect(mockPrisma.detectionJob.findMany).toHaveBeenCalled();
      expect(mockPrisma.claim.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('runDetectionAlgorithms', () => {
    it('should detect lost units anomaly', async () => {
      const thresholds = [
        {
          id: 'thresh-1',
          anomalyType: 'LOST_UNITS',
          threshold: 1.0,
          operator: 'GREATER_THAN',
          isActive: true
        }
      ];
      
      const whitelists: any[] = [];
      
      mockPrisma.detectionThreshold.findMany.mockResolvedValue(thresholds);
      mockPrisma.detectionWhitelist.findMany.mockResolvedValue(whitelists);

      // Access private method for testing
      const anomalies = await (detectionService as any).runDetectionAlgorithms(mockClaim, mockJob);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].type).toBe('LOST_UNITS');
      expect(anomalies[0].actualValue).toBe(2);
      expect(anomalies[0].severity).toBe('MEDIUM');
    });

    it('should detect overcharged fees anomaly', async () => {
      const thresholds = [
        {
          id: 'thresh-2',
          anomalyType: 'OVERCHARGED_FEES',
          threshold: 0.50,
          operator: 'GREATER_THAN',
          isActive: true
        }
      ];
      
      const whitelists: any[] = [];
      
      mockPrisma.detectionThreshold.findMany.mockResolvedValue(thresholds);
      mockPrisma.detectionWhitelist.findMany.mockResolvedValue(whitelists);

      const anomalies = await (detectionService as any).runDetectionAlgorithms(mockClaim, mockJob);

      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].type).toBe('OVERCHARGED_FEES');
      expect(anomalies[0].actualValue).toBe(5.50); // 15.50 - 10.00
      expect(anomalies[0].severity).toBe('HIGH');
    });

    it('should respect whitelist entries', async () => {
      const thresholds = [
        {
          id: 'thresh-1',
          anomalyType: 'LOST_UNITS',
          threshold: 1.0,
          operator: 'GREATER_THAN',
          isActive: true
        }
      ];
      
      const whitelists = [
        {
          id: 'whitelist-1',
          skuCode: 'sku-123',
          isActive: true
        }
      ];
      
      mockPrisma.detectionThreshold.findMany.mockResolvedValue(thresholds);
      mockPrisma.detectionWhitelist.findMany.mockResolvedValue(whitelists);

      const anomalies = await (detectionService as any).runDetectionAlgorithms(mockClaim, mockJob);

      // Should not detect anomaly for whitelisted SKU
      expect(anomalies).toHaveLength(0);
    });
  });

  describe('threshold checking', () => {
    it('should check greater than threshold correctly', () => {
      const threshold = {
        anomalyType: 'LOST_UNITS',
        threshold: 1.0,
        operator: 'GREATER_THAN',
        isActive: true
      };

      const result = (detectionService as any).checkThreshold(2, threshold);
      expect(result).toBe(true);

      const result2 = (detectionService as any).checkThreshold(0, threshold);
      expect(result2).toBe(false);
    });

    it('should check less than threshold correctly', () => {
      const threshold = {
        anomalyType: 'DAMAGED_STOCK',
        threshold: 5.0,
        operator: 'LESS_THAN',
        isActive: true
      };

      const result = (detectionService as any).checkThreshold(3, threshold);
      expect(result).toBe(true);

      const result2 = (detectionService as any).checkThreshold(7, threshold);
      expect(result2).toBe(false);
    });
  });

  describe('severity calculation', () => {
    it('should calculate severity levels correctly', () => {
      const lowSeverity = (detectionService as any).calculateSeverity(1.5, 1.0);
      expect(lowSeverity).toBe('MEDIUM');

      const highSeverity = (detectionService as any).calculateSeverity(4.0, 1.0);
      expect(highSeverity).toBe('HIGH');

      const criticalSeverity = (detectionService as any).calculateSeverity(6.0, 1.0);
      expect(criticalSeverity).toBe('CRITICAL');
    });
  });

  describe('confidence calculation', () => {
    it('should calculate confidence scores correctly', () => {
      const confidence = (detectionService as any).calculateConfidence(5.0, 1.0);
      expect(confidence).toBe(0.5);

      const highConfidence = (detectionService as any).calculateConfidence(20.0, 1.0);
      expect(highConfidence).toBe(0.95);
    });
  });

  describe('evidence generation', () => {
    it('should generate evidence artifact correctly', async () => {
      const anomalies = [
        {
          type: 'LOST_UNITS',
          costDocId: 'doc-1',
          skuId: 'sku-123',
          severity: 'MEDIUM',
          confidence: 0.7,
          thresholdValue: 1.0,
          actualValue: 2,
          evidence: {
            claimId: 'claim-456',
            costDocument: 'doc-1',
            metadata: {}
          }
        }
      ];

      mockS3Service.uploadJson.mockResolvedValue('evidence-url');

      const evidenceKey = await (detectionService as any).generateEvidenceArtifact(mockJob, anomalies);

      expect(evidenceKey).toBe('evidence/user-789/job-123/detection.json');
      expect(mockS3Service.uploadJson).toHaveBeenCalledWith(
        'evidence/user-789/job-123/detection.json',
        expect.objectContaining({
          sync_id: 'job-123',
          seller_id: 'user-789',
          detected_anomalies: expect.arrayContaining([
            expect.objectContaining({
              event_type: 'LOST_UNITS',
              item_id: 'sku-123',
              amount_discrepancy: 2
            })
          ])
        })
      );
    });
  });

  describe('result storage', () => {
    it('should store detection results correctly', async () => {
      const anomalies = [
        {
          type: 'LOST_UNITS',
          costDocId: 'doc-1',
          skuId: 'sku-123',
          severity: 'MEDIUM',
          confidence: 0.7,
          thresholdValue: 1.0,
          actualValue: 2,
          evidence: {}
        }
      ];

      mockPrisma.detectionResult.createMany.mockResolvedValue({ count: 1 });

      await (detectionService as any).storeDetectionResults(mockJob, anomalies, 'evidence-url');

      expect(mockPrisma.detectionResult.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            detectionJobId: 'job-123',
            costDocId: 'doc-1',
            skuId: 'sku-123',
            anomalyType: 'LOST_UNITS',
            severity: 'MEDIUM',
            confidence: 0.7,
            evidenceUrl: 'evidence-url'
          })
        ])
      });
    });
  });

  describe('getDetectionResults', () => {
    it('should retrieve detection results for a claim', async () => {
      const mockResults = [
        {
          id: 'result-1',
          anomalyType: 'LOST_UNITS',
          severity: 'MEDIUM',
          confidence: 0.7
        }
      ];

      mockPrisma.detectionResult.findMany.mockResolvedValue(mockResults);

      const results = await detectionService.getDetectionResults('claim-456');

      expect(results).toEqual(mockResults);
      expect(mockPrisma.detectionResult.findMany).toHaveBeenCalledWith({
        where: {
          detectionJob: {
            claimId: 'claim-456'
          }
        },
        include: {
          detectionJob: true,
          costDocument: true,
          sku: true
        }
      });
    });
  });

  describe('getDetectionStatistics', () => {
    it('should calculate detection statistics correctly', async () => {
      mockPrisma.detectionJob.count
        .mockResolvedValueOnce(10) // total jobs
        .mockResolvedValueOnce(8)  // completed jobs
        .mockResolvedValueOnce(1); // failed jobs

      mockPrisma.detectionResult.count.mockResolvedValue(15); // total anomalies

      const stats = await detectionService.getDetectionStatistics('user-789');

      expect(stats).toEqual({
        totalJobs: 10,
        completedJobs: 8,
        failedJobs: 1,
        totalAnomalies: 15,
        successRate: 80
      });
    });
  });

  describe('error handling', () => {
    it('should handle claim not found error', async () => {
      mockPrisma.claim.findUnique.mockResolvedValue(null);

      // Mock thresholds and whitelists
      mockPrisma.detectionThreshold.findMany.mockResolvedValue([]);
      mockPrisma.detectionWhitelist.findMany.mockResolvedValue([]);

      // Mock job updates
      mockPrisma.detectionJob.update.mockResolvedValue({});

      // Process job that will fail
      await (detectionService as any).processDetectionJob(mockJob);

      // Should update job status to failed
      expect(mockPrisma.detectionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: {
          status: 'FAILED',
          failureReason: 'Claim not found: claim-456'
        }
      });
    });

    it('should handle S3 upload errors', async () => {
      const anomalies = [
        {
          type: 'LOST_UNITS',
          costDocId: 'doc-1',
          skuId: 'sku-123',
          severity: 'MEDIUM',
          confidence: 0.7,
          thresholdValue: 1.0,
          actualValue: 2,
          evidence: {}
        }
      ];

      mockS3Service.uploadJson.mockRejectedValue(new Error('S3 upload failed'));

      await expect(
        (detectionService as any).generateEvidenceArtifact(mockJob, anomalies)
      ).rejects.toThrow('S3 upload failed');
    });
  });

  describe('concurrency control', () => {
    it('should process jobs in batches with concurrency limit', async () => {
      const pendingJobs = Array.from({ length: 5 }, (_, i) => ({
        ...mockJob,
        id: `job-${i}`,
        claimId: `claim-${i}`
      }));

      mockPrisma.detectionJob.findMany.mockResolvedValue(pendingJobs);
      mockPrisma.claim.findUnique.mockResolvedValue(mockClaim);
      mockPrisma.detectionThreshold.findMany.mockResolvedValue([]);
      mockPrisma.detectionWhitelist.findMany.mockResolvedValue([]);
      mockS3Service.uploadJson.mockResolvedValue('evidence-url');
      mockPrisma.detectionResult.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.detectionJob.update.mockResolvedValue({});

      detectionService.startDetectionWorker(100);
      await new Promise(resolve => setTimeout(resolve, 150));
      detectionService.stopDetectionWorker();

      // Should process jobs in batches of 3 (concurrency limit)
      expect(mockPrisma.claim.findUnique).toHaveBeenCalledTimes(5);
    });
  });
});
