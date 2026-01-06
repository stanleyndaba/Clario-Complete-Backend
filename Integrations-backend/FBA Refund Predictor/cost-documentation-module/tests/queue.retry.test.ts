import { CostDocumentationWorker } from '../src/workers/costDocumentationWorker';
import { CostDocumentationService } from '../src/services/costDocumentationService';
import { AnomalyEvidence } from '../types/costDocumentation';
import Bull from 'bull';

// Mock Bull queue
jest.mock('bull');
const MockBull = Bull as jest.MockedClass<typeof Bull>;

// Mock S3Service
jest.mock('../src/services/s3Service', () => ({
  S3Service: {
    uploadBuffer: jest.fn(),
    generateSignedUrl: jest.fn()
  }
}));

describe('Queue Retry and Backpressure', () => {
  let worker: CostDocumentationWorker;
  let mockQueue: any;
  
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
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock queue
    mockQueue = {
      add: jest.fn(),
      process: jest.fn(),
      getWaiting: jest.fn(),
      getActive: jest.fn(),
      getCompleted: jest.fn(),
      getFailed: jest.fn(),
      getDelayed: jest.fn(),
      getJob: jest.fn(),
      empty: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      close: jest.fn(),
      on: jest.fn()
    };
    
    MockBull.mockImplementation(() => mockQueue as any);
  });

  afterEach(() => {
    MockBull.mockClear();
  });

  describe('Queue Configuration', () => {
    it('should configure queue with proper retry settings', () => {
      // Set environment variables for testing
      process.env.MAX_CONCURRENCY = '2';
      process.env.MAX_RETRIES = '3';
      process.env.RETRY_DELAY = '2000';
      
      worker = new CostDocumentationWorker();
      
      expect(MockBull).toHaveBeenCalledWith('cost-documentation-queue', {
        redis: expect.any(Object)
      });
      
      // Verify queue configuration
      expect(mockQueue.process).toHaveBeenCalled();
    });

    it('should set concurrency from environment variable', () => {
      process.env.MAX_CONCURRENCY = '5';
      
      worker = new CostDocumentationWorker();
      
      // The worker should respect the concurrency setting
      expect(mockQueue.process).toHaveBeenCalled();
    });
  });

  describe('Job Retry Logic', () => {
    it('should retry failed jobs with exponential backoff', async () => {
      const { S3Service } = require('../src/services/s3Service');
      
      // Mock S3 to fail first time, succeed second time
      S3Service.uploadBuffer
        .mockRejectedValueOnce(new Error('S3 upload failed'))
        .mockResolvedValueOnce({ Location: 's3://bucket/file.pdf' });
      
      S3Service.generateSignedUrl.mockResolvedValue('https://signed-url.com/file.pdf');
      
      worker = new CostDocumentationWorker();
      
      // Simulate job processing
      const processHandler = mockQueue.process.mock.calls[0][0];
      
      // First attempt should fail
      try {
        await processHandler({
          id: 'job-123',
          data: { evidence: mockEvidence }
        });
        fail('Should have failed first time');
      } catch (error) {
        expect(error.message).toContain('S3 upload failed');
      }
      
      // Second attempt should succeed
      const result = await processHandler({
        id: 'job-123',
        data: { evidence: mockEvidence }
      });
      
      expect(result).toBeDefined();
      expect(S3Service.uploadBuffer).toHaveBeenCalledTimes(2);
    });

    it('should respect max retry attempts', async () => {
      const { S3Service } = require('../src/services/s3Service');
      
      // Mock S3 to always fail
      S3Service.uploadBuffer.mockRejectedValue(new Error('S3 upload failed'));
      
      worker = new CostDocumentationWorker();
      
      const processHandler = mockQueue.process.mock.calls[0][0];
      
      // Should fail max retry times
      for (let i = 0; i < 3; i++) {
        try {
          await processHandler({
            id: 'job-123',
            data: { evidence: mockEvidence }
          });
          fail(`Should have failed attempt ${i + 1}`);
        } catch (error) {
          expect(error.message).toContain('S3 upload failed');
        }
      }
      
      expect(S3Service.uploadBuffer).toHaveBeenCalledTimes(3);
    });
  });

  describe('Backpressure Handling', () => {
    it('should handle queue overflow gracefully', async () => {
      worker = new CostDocumentationWorker();
      
      // Mock queue statistics
      mockQueue.getWaiting.mockResolvedValue(Array(25).fill({ id: 'job' }));
      mockQueue.getActive.mockResolvedValue(Array(5).fill({ id: 'job' }));
      mockQueue.getCompleted.mockResolvedValue(Array(100).fill({ id: 'job' }));
      mockQueue.getFailed.mockResolvedValue(Array(3).fill({ id: 'job' }));
      
      const stats = await worker.getQueueStats();
      
      expect(stats.waiting).toBe(25);
      expect(stats.active).toBe(5);
      expect(stats.completed).toBe(100);
      expect(stats.failed).toBe(3);
    });

    it('should pause queue when overloaded', async () => {
      worker = new CostDocumentationWorker();
      
      // Simulate high load
      mockQueue.getWaiting.mockResolvedValue(Array(50).fill({ id: 'job' }));
      
      await worker.pauseQueue();
      
      expect(mockQueue.pause).toHaveBeenCalled();
    });

    it('should resume queue when load decreases', async () => {
      worker = new CostDocumentationWorker();
      
      await worker.resumeQueue();
      
      expect(mockQueue.resume).toHaveBeenCalled();
    });
  });

  describe('Job Priority Handling', () => {
    it('should assign priority based on loss amount', async () => {
      worker = new CostDocumentationWorker();
      
      const lowPriorityEvidence = { ...mockEvidence, total_loss: 50 };
      const normalPriorityEvidence = { ...mockEvidence, total_loss: 150 };
      const highPriorityEvidence = { ...mockEvidence, total_loss: 600 };
      const criticalPriorityEvidence = { ...mockEvidence, total_loss: 1500 };
      
      // Add jobs with different priorities
      await worker.addJob(lowPriorityEvidence, { priority: 'low' });
      await worker.addJob(normalPriorityEvidence, { priority: 'normal' });
      await worker.addJob(highPriorityEvidence, { priority: 'high' });
      await worker.addJob(criticalPriorityEvidence, { priority: 'critical' });
      
      expect(mockQueue.add).toHaveBeenCalledTimes(4);
      
      // Verify priority numbers (Bull uses lower numbers for higher priority)
      const calls = mockQueue.add.mock.calls;
      expect(calls[0][2].priority).toBe(10); // low
      expect(calls[1][2].priority).toBe(5);  // normal
      expect(calls[2][2].priority).toBe(1);  // high
      expect(calls[3][2].priority).toBe(0);  // critical
    });
  });

  describe('Error Recovery', () => {
    it('should handle service initialization errors gracefully', async () => {
      // Mock service to fail initialization
      const mockService = {
        initialize: jest.fn().mockRejectedValue(new Error('Service init failed'))
      };
      
      // Create worker with failing service
      const failingWorker = new (class extends CostDocumentationWorker {
        constructor() {
          super();
          (this as any).service = mockService;
        }
      })();
      
      try {
        await failingWorker.initialize();
        fail('Should have failed initialization');
      } catch (error) {
        expect(error.message).toContain('Service init failed');
      }
    });

    it('should handle queue connection errors', async () => {
      // Mock queue to fail on operations
      mockQueue.add.mockRejectedValue(new Error('Redis connection failed'));
      
      worker = new CostDocumentationWorker();
      
      try {
        await worker.addJob(mockEvidence);
        fail('Should have failed to add job');
      } catch (error) {
        expect(error.message).toContain('Redis connection failed');
      }
    });
  });

  describe('Queue Management', () => {
    it('should clear queue when requested', async () => {
      worker = new CostDocumentationWorker();
      
      await worker.clearQueue();
      
      expect(mockQueue.empty).toHaveBeenCalled();
    });

    it('should remove specific jobs', async () => {
      worker = new CostDocumentationWorker();
      
      const mockJob = {
        id: 'job-123',
        remove: jest.fn()
      };
      
      mockQueue.getJob.mockResolvedValue(mockJob);
      
      await worker.removeJob('job-123');
      
      expect(mockQueue.getJob).toHaveBeenCalledWith('job-123');
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('should retry failed jobs', async () => {
      worker = new CostDocumentationWorker();
      
      const mockJob = {
        id: 'job-123',
        retry: jest.fn()
      };
      
      mockQueue.getJob.mockResolvedValue(mockJob);
      
      await worker.retryJob('job-123');
      
      expect(mockQueue.getJob).toHaveBeenCalledWith('job-123');
      expect(mockJob.retry).toHaveBeenCalled();
    });
  });

  describe('Graceful Shutdown', () => {
    it('should shutdown gracefully', async () => {
      worker = new CostDocumentationWorker();
      
      await worker.shutdown();
      
      expect(mockQueue.close).toHaveBeenCalled();
    });

    it('should handle shutdown errors gracefully', async () => {
      worker = new CostDocumentationWorker();
      
      // Mock queue to fail on close
      mockQueue.close.mockRejectedValue(new Error('Close failed'));
      
      // Should not throw error during shutdown
      await expect(worker.shutdown()).resolves.not.toThrow();
    });
  });
});








