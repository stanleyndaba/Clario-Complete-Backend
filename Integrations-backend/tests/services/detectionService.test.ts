import { DetectionService, DetectionJob, DetectionResult } from '../../src/services/detectionService';

// Mock Supabase client
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  range: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  sql: jest.fn().mockReturnValue('attempts + 1')
};

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: mockSupabase
}));

// Mock Redis client
const mockRedisClient = {
  lpush: jest.fn(),
  brpop: jest.fn(),
  isReady: true
};

jest.mock('../../src/utils/redisClient', () => ({
  getRedisClient: jest.fn().mockResolvedValue(mockRedisClient)
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('DetectionService', () => {
  let service: DetectionService;
  let mockJob: DetectionJob;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DetectionService();
    
    mockJob = {
      seller_id: 'test-seller-123',
      sync_id: 'sync-456',
      timestamp: '2024-01-15T10:30:00Z'
    };
  });

  describe('enqueueDetectionJob', () => {
    it('should successfully enqueue a detection job', async () => {
      mockRedisClient.lpush.mockResolvedValue(1);
      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      await service.enqueueDetectionJob(mockJob);

      expect(mockRedisClient.lpush).toHaveBeenCalledWith(
        'detection_queue',
        JSON.stringify(mockJob)
      );
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        seller_id: mockJob.seller_id,
        sync_id: mockJob.sync_id,
        status: 'pending',
        priority: 1,
        payload: mockJob
      });
    });

    it('should handle database errors gracefully', async () => {
      mockRedisClient.lpush.mockResolvedValue(1);
      const dbError = new Error('Database error');
      mockSupabase.insert.mockResolvedValue({
        error: dbError
      });

      // Should not throw error as Redis queue is primary mechanism
      await expect(service.enqueueDetectionJob(mockJob)).resolves.toBeUndefined();
    });

    it('should handle Redis errors', async () => {
      const redisError = new Error('Redis connection failed');
      mockRedisClient.lpush.mockRejectedValue(redisError);

      await expect(service.enqueueDetectionJob(mockJob)).rejects.toThrow('Redis connection failed');
    });
  });

  describe('processDetectionJobs', () => {
    it('should process jobs from Redis queue', async () => {
      const jobData = ['detection_queue', JSON.stringify(mockJob)];
      mockRedisClient.brpop.mockResolvedValueOnce(jobData);
      mockRedisClient.brpop.mockResolvedValueOnce(null); // No more jobs

      mockSupabase.update.mockResolvedValue({
        error: null
      });

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      await service.processDetectionJobs();

      expect(mockRedisClient.brpop).toHaveBeenCalledWith('detection_queue', 1);
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: 'processing',
        processed_at: null
      });
    });

    it('should handle job processing errors', async () => {
      const jobData = ['detection_queue', JSON.stringify(mockJob)];
      mockRedisClient.brpop.mockResolvedValueOnce(jobData);
      mockRedisClient.brpop.mockResolvedValueOnce(null);

      const processingError = new Error('Processing failed');
      mockSupabase.update.mockRejectedValueOnce(processingError);

      await service.processDetectionJobs();

      // Should handle error gracefully and continue
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: 'failed',
        processed_at: expect.any(String),
        error_message: 'Processing failed'
      });
    });

    it('should handle empty queue', async () => {
      mockRedisClient.brpop.mockResolvedValue(null);

      await service.processDetectionJobs();

      expect(mockRedisClient.brpop).toHaveBeenCalledWith('detection_queue', 1);
      expect(mockSupabase.update).not.toHaveBeenCalled();
    });
  });

  describe('getDetectionResults', () => {
    it('should fetch detection results with default parameters', async () => {
      const mockResults = [
        {
          id: 'result-1',
          seller_id: 'test-seller-123',
          sync_id: 'sync-456',
          anomaly_type: 'missing_unit',
          severity: 'medium',
          estimated_value: 45.99,
          currency: 'USD',
          confidence_score: 0.85,
          evidence: { test: 'data' },
          status: 'pending',
          related_event_ids: ['event-1'],
          created_at: '2024-01-15T10:30:00Z',
          updated_at: '2024-01-15T10:30:00Z'
        }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockResults,
        error: null
      });

      const result = await service.getDetectionResults('test-seller-123');

      expect(result).toEqual(mockResults);
      expect(mockSupabase.eq).toHaveBeenCalledWith('seller_id', 'test-seller-123');
      expect(mockSupabase.order).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockSupabase.range).toHaveBeenCalledWith(0, 99);
    });

    it('should apply filters when provided', async () => {
      const mockResults = [
        {
          id: 'result-1',
          seller_id: 'test-seller-123',
          sync_id: 'sync-456',
          anomaly_type: 'missing_unit',
          severity: 'medium',
          estimated_value: 45.99,
          currency: 'USD',
          confidence_score: 0.85,
          evidence: { test: 'data' },
          status: 'pending',
          related_event_ids: ['event-1'],
          created_at: '2024-01-15T10:30:00Z',
          updated_at: '2024-01-15T10:30:00Z'
        }
      ];

      mockSupabase.range.mockResolvedValue({
        data: mockResults,
        error: null
      });

      const result = await service.getDetectionResults('test-seller-123', 'sync-456', 'pending', 50, 10);

      expect(result).toEqual(mockResults);
      expect(mockSupabase.eq).toHaveBeenCalledWith('sync_id', 'sync-456');
      expect(mockSupabase.eq).toHaveBeenCalledWith('status', 'pending');
      expect(mockSupabase.range).toHaveBeenCalledWith(10, 59);
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Query failed');
      mockSupabase.range.mockResolvedValue({
        data: null,
        error: dbError
      });

      await expect(service.getDetectionResults('test-seller-123')).rejects.toThrow(
        'Failed to fetch detection results: Query failed'
      );
    });
  });

  describe('getDetectionStatistics', () => {
    it('should calculate correct statistics', async () => {
      const mockData = [
        { anomaly_type: 'missing_unit', severity: 'medium', estimated_value: 45.99 },
        { anomaly_type: 'overcharge', severity: 'high', estimated_value: 12.50 },
        { anomaly_type: 'missing_unit', severity: 'low', estimated_value: 5.25 },
        { anomaly_type: 'damaged_stock', severity: 'critical', estimated_value: 100.00 }
      ];

      mockSupabase.eq.mockResolvedValue({
        data: mockData,
        error: null
      });

      const result = await service.getDetectionStatistics('test-seller-123');

      expect(result).toEqual({
        total_anomalies: 4,
        total_value: 163.74,
        by_severity: {
          medium: { count: 1, value: 45.99 },
          high: { count: 1, value: 12.50 },
          low: { count: 1, value: 5.25 },
          critical: { count: 1, value: 100.00 }
        },
        by_type: {
          missing_unit: { count: 2, value: 51.24 },
          overcharge: { count: 1, value: 12.50 },
          damaged_stock: { count: 1, value: 100.00 }
        }
      });
    });

    it('should handle empty data', async () => {
      mockSupabase.eq.mockResolvedValue({
        data: [],
        error: null
      });

      const result = await service.getDetectionStatistics('test-seller-123');

      expect(result).toEqual({
        total_anomalies: 0,
        total_value: 0,
        by_severity: {},
        by_type: {}
      });
    });
  });

  describe('runDetectionAlgorithms (private method)', () => {
    it('should return mock detection results', async () => {
      // This tests the private method indirectly through processDetectionJobs
      const jobData = ['detection_queue', JSON.stringify(mockJob)];
      mockRedisClient.brpop.mockResolvedValueOnce(jobData);
      mockRedisClient.brpop.mockResolvedValueOnce(null);

      mockSupabase.update.mockResolvedValue({
        error: null
      });

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      await service.processDetectionJobs();

      // Verify that detection results were stored
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            seller_id: mockJob.seller_id,
            sync_id: mockJob.sync_id,
            anomaly_type: 'missing_unit',
            severity: 'medium',
            estimated_value: 45.99
          }),
          expect.objectContaining({
            seller_id: mockJob.seller_id,
            sync_id: mockJob.sync_id,
            anomaly_type: 'overcharge',
            severity: 'high',
            estimated_value: 12.50
          })
        ])
      );
    });
  });
});



