import request from 'supertest';
import app from '../src/index';
import { supabase } from '../src/database/supabaseClient';
import enhancedDetectionService from '../src/services/enhancedDetectionService';
import disputeService from '../src/services/disputeService';

// Mock authentication middleware
jest.mock('../src/middleware/authMiddleware', () => ({
  authenticateUser: (req: any, res: any, next: any) => {
    req.user = { id: 'test-user-123' };
    next();
  }
}));

// Mock Supabase client
jest.mock('../src/database/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => ({
            data: null,
            error: null
          }))
        })),
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => ({
              data: { id: 'test-id' },
              error: null
            }))
          }))
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => ({
                data: { id: 'test-id', status: 'updated' },
                error: null
              }))
            }))
          }))
        })),
        delete: jest.fn(() => ({
          eq: jest.fn(() => ({
            data: null,
            error: null
          }))
        }))
      }))
    }))
  }
}));

// Mock Redis client
jest.mock('../src/utils/redisClient', () => ({
  getRedisClient: jest.fn(() => ({
    zadd: jest.fn(),
    zpopmax: jest.fn(),
    zcard: jest.fn(() => Promise.resolve(0))
  }))
}));

describe('Enhanced Detection System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Detection Pipeline Integration', () => {
    it('should trigger detection pipeline after sync completion', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        insert: jest.fn(() => ({
          data: { id: 'trigger-123' },
          error: null
        }))
      });

      const result = await enhancedDetectionService.triggerDetectionPipeline(
        'test-user-123',
        'sync-456',
        'inventory',
        { test: 'data' }
      );

      expect(result).toBeUndefined();
      expect(mockSupabase.from).toHaveBeenCalledWith('sync_detection_triggers');
    });

    it('should handle detection pipeline trigger errors gracefully', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        insert: jest.fn(() => ({
          data: null,
          error: { message: 'Database error' }
        }))
      });

      await expect(
        enhancedDetectionService.triggerDetectionPipeline(
          'test-user-123',
          'sync-456',
          'inventory'
        )
      ).rejects.toThrow('Failed to create sync detection trigger: Database error');
    });

    it('should determine correct priority based on trigger type', () => {
      const service = enhancedDetectionService as any;
      
      expect(service.determinePriority('financial')).toBe('critical');
      expect(service.determinePriority('inventory')).toBe('high');
      expect(service.determinePriority('product')).toBe('normal');
      expect(service.determinePriority('manual')).toBe('high');
    });
  });

  describe('Detection Job Processing', () => {
    it('should process detection jobs with priority ordering', async () => {
      const mockRedis = {
        zpopmax: jest.fn(() => Promise.resolve([{ member: JSON.stringify({
          id: 'job-123',
          seller_id: 'test-user-123',
          sync_id: 'sync-456',
          priority: 'high'
        }) }]))
      };

      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => ({
              data: [],
              error: null
            }))
          }))
        })),
        insert: jest.fn(() => ({
          data: [],
          error: null
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            data: null,
            error: null
          }))
        }))
      });

      // Mock the Redis client
      const { getRedisClient } = require('../src/utils/redisClient');
      getRedisClient.mockResolvedValue(mockRedis);

      await enhancedDetectionService.processDetectionJobs();

      expect(mockRedis.zpopmax).toHaveBeenCalled();
    });

    it('should handle job processing errors and implement retry logic', async () => {
      const mockRedis = {
        zpopmax: jest.fn(() => Promise.resolve([{ member: JSON.stringify({
          id: 'job-123',
          seller_id: 'test-user-123',
          sync_id: 'sync-456',
          priority: 'high',
          attempts: 0,
          max_attempts: 3
        }) }]))
      };

      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => ({
              data: [],
              error: null
            }))
          }))
        })),
        insert: jest.fn(() => ({
          data: [],
          error: null
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            data: null,
            error: null
          }))
        }))
      });

      // Mock the Redis client
      const { getRedisClient } = require('../src/utils/redisClient');
      getRedisClient.mockResolvedValue(mockRedis);

      // Mock the detection algorithms to throw an error
      const service = enhancedDetectionService as any;
      jest.spyOn(service, 'runEnhancedDetectionAlgorithms').mockRejectedValue(new Error('Detection failed'));

      await enhancedDetectionService.processDetectionJobs();

      expect(mockSupabase.from).toHaveBeenCalled();
    });
  });

  describe('Dispute Case Management', () => {
    it('should create dispute cases for high-severity anomalies', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => ({
              data: {
                id: 'dispute-123',
                case_number: 'DC-TEST123-MIS-12345-ABC',
                status: 'pending'
              },
              error: null
            }))
          }))
        }))
      });

      const disputeCase = await disputeService.createDisputeCase(
        'test-user-123',
        'detection-result-456',
        'amazon_fba',
        50.00,
        'USD'
      );

      expect(disputeCase).toBeDefined();
      expect(disputeCase.case_number).toMatch(/^DC-/);
    });

    it('should submit dispute cases to providers', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => ({
              data: {
                id: 'dispute-123',
                status: 'pending',
                provider: 'amazon'
              },
              error: null
            }))
          }))
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => ({
                data: {
                  id: 'dispute-123',
                  status: 'submitted'
                },
                error: null
              }))
            }))
          }))
        }))
      });

      const updatedCase = await disputeService.submitDisputeCase(
        'dispute-123',
        { test: 'data' },
        ['evidence-1', 'evidence-2']
      );

      expect(updatedCase.status).toBe('submitted');
    });

    it('should process case resolutions from providers', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => ({
              data: {
                id: 'dispute-123',
                status: 'submitted'
              },
              error: null
            }))
          }))
        })),
        update: jest.fn(() => ({
          eq: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn(() => ({
                data: {
                  id: 'dispute-123',
                  status: 'approved'
                },
                error: null
              }))
            }))
          }))
        }))
      });

      const updatedCase = await disputeService.processCaseResolution({
        dispute_case_id: 'dispute-123',
        resolution_status: 'approved',
        resolution_amount: 50.00,
        resolution_notes: 'Case approved',
        provider_response: { approved: true }
      });

      expect(updatedCase.status).toBe('approved');
    });
  });

  describe('Automation Rules', () => {
    it('should create automation rules for dispute cases', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => ({
              data: {
                id: 'rule-123',
                rule_name: 'Auto Submit High Value',
                rule_type: 'auto_submit'
              },
              error: null
            }))
          }))
        }))
      });

      const rule = await disputeService.createAutomationRule({
        seller_id: 'test-user-123',
        rule_name: 'Auto Submit High Value',
        rule_type: 'auto_submit',
        conditions: { min_amount: 100 },
        actions: { auto_submit: true },
        is_active: true,
        priority: 1
      });

      expect(rule).toBeDefined();
      expect(rule.rule_name).toBe('Auto Submit High Value');
    });

    it('should evaluate rule conditions correctly', async () => {
      const service = disputeService as any;
      
      const rule = {
        conditions: {
          case_type: 'amazon_fba',
          min_amount: 50,
          max_amount: 1000
        }
      };

      const disputeCase = {
        case_type: 'amazon_fba',
        claim_amount: 100
      };

      const result = await service.evaluateRuleConditions(rule, disputeCase);
      expect(result).toBe(true);
    });

    it('should execute rule actions when conditions are met', async () => {
      const service = disputeService as any;
      
      const rule = {
        id: 'rule-123',
        rule_name: 'Test Rule',
        actions: {
          auto_submit: true,
          auto_approve: false
        }
      };

      const disputeCase = {
        id: 'dispute-123',
        seller_id: 'test-user-123'
      };

      // Mock the submitDisputeCase method
      jest.spyOn(disputeService, 'submitDisputeCase').mockResolvedValue(disputeCase as any);

      await service.executeRuleActions(rule, disputeCase);

      expect(disputeService.submitDisputeCase).toHaveBeenCalled();
    });
  });

  describe('API Endpoints', () => {
    it('should trigger detection pipeline via API', async () => {
      const response = await request(app)
        .post('/api/enhanced-detection/trigger')
        .send({
          syncId: 'sync-123',
          triggerType: 'inventory',
          metadata: { test: 'data' }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should get detection results via API', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              range: jest.fn(() => ({
                data: [
                  {
                    id: 'result-123',
                    anomaly_type: 'missing_unit',
                    severity: 'high'
                  }
                ],
                error: null
              }))
            }))
          }))
        }))
      });

      const response = await request(app)
        .get('/api/enhanced-detection/results')
        .query({ limit: 10, offset: 0 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    it('should create dispute cases via API', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => ({
              data: {
                id: 'dispute-123',
                case_number: 'DC-TEST123-MIS-12345-ABC'
              },
              error: null
            }))
          }))
        }))
      });

      const response = await request(app)
        .post('/api/enhanced-detection/disputes')
        .send({
          detectionResultId: 'result-123',
          caseType: 'amazon_fba',
          claimAmount: 50.00,
          currency: 'USD'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.case_number).toMatch(/^DC-/);
    });

    it('should get dispute cases via API', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: jest.fn(() => ({
              range: jest.fn(() => ({
                data: [
                  {
                    id: 'dispute-123',
                    case_number: 'DC-TEST123-MIS-12345-ABC',
                    status: 'pending'
                  }
                ],
                count: 1,
                error: null
              }))
            }))
          }))
        }))
      });

      const response = await request(app)
        .get('/api/enhanced-detection/disputes')
        .query({ limit: 10, offset: 0 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.cases).toHaveLength(1);
    });
  });

  describe('Enhanced Sync Integration', () => {
    it('should start enhanced sync with detection pipeline', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        insert: jest.fn(() => ({
          data: { id: 'sync-123' },
          error: null
        }))
      });

      const response = await request(app)
        .post('/api/enhanced-sync/start')
        .send({
          syncType: 'inventory',
          enableDetection: true
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.detectionPipelineEnabled).toBe(true);
    });

    it('should get enhanced sync status with detection pipeline info', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => ({
              data: {
                sync_id: 'sync-123',
                step: 1,
                total_steps: 5,
                current_step: 'Processing',
                status: 'running',
                progress: 20
              },
              error: null
            }))
          }))
        }))
      });

      const response = await request(app)
        .get('/api/enhanced-sync/status/sync-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.syncId).toBe('sync-123');
    });
  });

  describe('Thresholds and Whitelist', () => {
    it('should get detection thresholds', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          or: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                data: [
                  {
                    rule_type: 'missing_unit',
                    threshold_value: 5.00,
                    threshold_operator: 'gte'
                  }
                ],
                error: null
              }))
            }))
          }))
        }))
      });

      const response = await request(app)
        .get('/api/enhanced-detection/thresholds');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    it('should create/update detection thresholds', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        upsert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => ({
              data: {
                rule_type: 'missing_unit',
                threshold_value: 10.00,
                threshold_operator: 'gte'
              },
              error: null
            }))
          }))
        }))
      });

      const response = await request(app)
        .post('/api/enhanced-detection/thresholds')
        .send({
          ruleType: 'missing_unit',
          thresholdValue: 10.00,
          thresholdOperator: 'gte',
          currency: 'USD'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should get detection whitelist', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                data: [
                  {
                    whitelist_type: 'sku',
                    whitelist_value: 'SKU123',
                    reason: 'Test reason'
                  }
                ],
                error: null
              }))
            }))
          }))
        }))
      });

      const response = await request(app)
        .get('/api/enhanced-detection/whitelist');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    it('should create whitelist entries', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => ({
              data: {
                whitelist_type: 'sku',
                whitelist_value: 'SKU456',
                reason: 'New test reason'
              },
              error: null
            }))
          }))
        }))
      });

      const response = await request(app)
        .post('/api/enhanced-detection/whitelist')
        .send({
          whitelistType: 'sku',
          whitelistValue: 'SKU456',
          reason: 'New test reason'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing required fields in API requests', async () => {
      const response = await request(app)
        .post('/api/enhanced-detection/trigger')
        .send({
          // Missing syncId and triggerType
          metadata: { test: 'data' }
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      const mockSupabase = supabase as any;
      mockSupabase.from.mockReturnValue({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() => ({
              data: null,
              error: { message: 'Database connection failed' }
            }))
          }))
        }))
      });

      const response = await request(app)
        .get('/api/enhanced-detection/results');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });

    it('should handle authentication errors', async () => {
      // Test without authentication middleware
      const appWithoutAuth = require('../src/index');
      
      const response = await request(appWithoutAuth)
        .get('/api/enhanced-detection/results');

      expect(response.status).toBe(401);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle backpressure correctly', async () => {
      const service = enhancedDetectionService as any;
      const mockRedis = {
        zcard: jest.fn(() => Promise.resolve(25)) // Above threshold
      };

      const { getRedisClient } = require('../src/utils/redisClient');
      getRedisClient.mockResolvedValue(mockRedis);

      const job = {
        id: 'job-123',
        seller_id: 'test-user-123',
        sync_id: 'sync-456',
        priority: 'low'
      };

      await service.enqueueDetectionJob(job);

      // Low priority jobs should be skipped when backpressure threshold is exceeded
      expect(mockRedis.zcard).toHaveBeenCalled();
    });

    it('should process jobs with correct priority ordering', async () => {
      const service = enhancedDetectionService as any;
      
      expect(service.getPriorityScore('critical')).toBe(4);
      expect(service.getPriorityScore('high')).toBe(3);
      expect(service.getPriorityScore('normal')).toBe(2);
      expect(service.getPriorityScore('low')).toBe(1);
    });
  });
});

