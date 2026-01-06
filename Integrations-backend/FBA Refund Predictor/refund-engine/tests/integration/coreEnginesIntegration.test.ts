import { IntegratedRecoveryEngine, ClaimData } from '../../src/services/integratedRecoveryEngine';
import { TransactionJournalService } from '../../src/services/transactionJournalService';
import { CertaintyRepo } from '../../src/services/certaintyRepo';

// Mock dependencies
jest.mock('../../src/services/transactionJournalService');
jest.mock('../../src/services/certaintyRepo');
jest.mock('child_process');

describe('Core Engines Integration Tests', () => {
  let mockTransactionJournalService: jest.Mocked<TransactionJournalService>;
  let mockCertaintyRepo: jest.Mocked<CertaintyRepo>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup mock implementations
    mockTransactionJournalService = {
      recordIntegratedRecoveryEvent: jest.fn().mockResolvedValue({
        id: 'tx-123',
        tx_type: 'integrated_recovery_assessment',
        entity_id: 'claim-123',
        actor_id: 'user-123',
        payload: {},
        timestamp: new Date().toISOString(),
        hash: 'mock-hash'
      })
    } as any;

    mockCertaintyRepo = {
      insertCertaintyScore: jest.fn().mockResolvedValue({
        id: 'certainty-123',
        claim_id: 'claim-123',
        refund_probability: 0.85,
        risk_level: 'High',
        created_at: new Date().toISOString()
      })
    } as any;

    // Inject mocks
    (IntegratedRecoveryEngine as any).transactionJournalService = mockTransactionJournalService;
    (IntegratedRecoveryEngine as any).certaintyRepo = mockCertaintyRepo;
  });

  describe('End-to-End Integration', () => {
    it('should process claim through both engines successfully', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-123',
        userId: 'user-123',
        actorId: 'user-123',
        discrepancyType: 'missing_refund',
        discrepancySize: 150.0,
        daysOutstanding: 30,
        marketplace: 'amazon',
        historicalPayoutRate: 0.8,
        sellerRating: 4.5,
        evidenceQuality: 0.9,
        description: 'Missing refund for order #12345',
        reason: 'Customer reported non-delivery',
        notes: 'Tracking shows delivered but customer disputes'
      };

      // Mock Python script responses
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              // Simulate successful Python execution
              const mockStdout = {
                on: jest.fn((event, callback) => {
                  if (event === 'data') {
                    callback('JSON_RESULT:{"confidence_scores":[0.85],"predictions":[true]}');
                  }
                })
              };
              mockProcess.stdout = mockStdout;
              callback(0);
            }
          })
        };
        return mockProcess;
      });

      // Act
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(result).toBeDefined();
      expect(result.claimId).toBe('claim-123');
      expect(result.evidence).toBeDefined();
      expect(result.certainty).toBeDefined();
      expect(result.decision).toBeDefined();
      expect(result.traceability).toBeDefined();

      // Verify evidence engine results
      expect(result.evidence.confidenceScore).toBeGreaterThan(0);
      expect(result.evidence.evidenceQuality.overall_confidence).toBeGreaterThan(0);
      expect(result.evidence.proofBundleId).toContain('claim-123');

      // Verify certainty engine results
      expect(result.certainty.successProbability).toBeGreaterThan(0);
      expect(result.certainty.timelineDays).toBeGreaterThan(0);
      expect(result.certainty.riskCategory).toBeDefined();

      // Verify decision logic
      expect(result.decision.recommendedAction).toBeDefined();
      expect(result.decision.confidence).toBeGreaterThan(0);
      expect(result.decision.reasoning).toBeInstanceOf(Array);
      expect(result.decision.priority).toBeDefined();

      // Verify traceability
      expect(result.traceability.hash).toBeDefined();
      expect(result.traceability.timestamp).toBeDefined();
      expect(result.traceability.engineCorrelation).toBeGreaterThan(0);
      expect(result.traceability.decisionConfidence).toBeGreaterThan(0);

      // Verify transaction logging
      expect(mockTransactionJournalService.recordIntegratedRecoveryEvent).toHaveBeenCalledWith(
        'claim-123',
        expect.any(Object),
        expect.any(Object),
        'user-123'
      );

      // Verify certainty score persistence
      expect(mockCertaintyRepo.insertCertaintyScore).toHaveBeenCalledWith(
        expect.objectContaining({
          claim_id: 'claim-123',
          refund_probability: expect.any(Number),
          risk_level: expect.any(String)
        })
      );
    });

    it('should handle evidence engine failure gracefully', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-456',
        userId: 'user-456',
        actorId: 'user-456',
        discrepancyType: 'overcharge',
        discrepancySize: 75.0,
        daysOutstanding: 15,
        marketplace: 'shopify',
        historicalPayoutRate: 0.6
      };

      // Mock Python script failure
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              callback(1); // Non-zero exit code
            }
          })
        };
        return mockProcess;
      });

      // Act
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(result).toBeDefined();
      expect(result.evidence.confidenceScore).toBe(0.5); // Fallback value
      expect(result.evidence.evidenceQuality.validation_status).toBe('low');
      expect(result.certainty.successProbability).toBe(0.5); // Fallback value
      expect(result.decision.recommendedAction).toBe('review'); // Should default to review for uncertain cases
    });

    it('should handle certainty engine failure gracefully', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-789',
        userId: 'user-789',
        actorId: 'user-789',
        discrepancyType: 'damaged_item',
        discrepancySize: 200.0,
        daysOutstanding: 45,
        marketplace: 'amazon',
        historicalPayoutRate: 0.7
      };

      // Mock evidence engine success but certainty engine failure
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              // Simulate different behavior based on script type
              const isEvidenceEngine = args.includes('evidence_engine');
              if (isEvidenceEngine) {
                callback(0); // Success for evidence engine
              } else {
                callback(1); // Failure for certainty engine
              }
            }
          })
        };
        return mockProcess;
      });

      // Act
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(result).toBeDefined();
      expect(result.evidence.confidenceScore).toBeGreaterThan(0.5); // Should have evidence results
      expect(result.certainty.successProbability).toBe(0.5); // Should have fallback certainty
      expect(result.decision.recommendedAction).toBe('review'); // Should default to review
    });
  });

  describe('Decision Logic', () => {
    it('should recommend proceed for high-confidence claims', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-high',
        userId: 'user-high',
        actorId: 'user-high',
        discrepancyType: 'missing_refund',
        discrepancySize: 100.0,
        daysOutstanding: 20,
        marketplace: 'amazon',
        historicalPayoutRate: 0.9,
        sellerRating: 4.8,
        evidenceQuality: 0.95
      };

      // Mock high-confidence responses
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              const mockStdout = {
                on: jest.fn((event, callback) => {
                  if (event === 'data') {
                    // High confidence responses
                    if (args.includes('evidence_engine')) {
                      callback('JSON_RESULT:{"confidence_scores":[0.95]}');
                    } else {
                      callback('JSON_RESULT:{"success_probability":0.88,"timeline_days":12,"risk_category":"High","confidence_level":0.92}');
                    }
                  }
                })
              };
              mockProcess.stdout = mockStdout;
              callback(0);
            }
          })
        };
        return mockProcess;
      });

      // Act
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(result.decision.recommendedAction).toBe('proceed');
      expect(result.decision.confidence).toBeGreaterThan(0.8);
      expect(result.decision.priority).toBe('high');
      expect(result.decision.reasoning).toContain('High evidence quality and success probability');
    });

    it('should recommend reject for low-confidence claims', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-low',
        userId: 'user-low',
        actorId: 'user-low',
        discrepancyType: 'wrong_item',
        discrepancySize: 500.0,
        daysOutstanding: 90,
        marketplace: 'ebay',
        historicalPayoutRate: 0.2,
        sellerRating: 2.5,
        evidenceQuality: 0.3
      };

      // Mock low-confidence responses
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              const mockStdout = {
                on: jest.fn((event, callback) => {
                  if (event === 'data') {
                    // Low confidence responses
                    if (args.includes('evidence_engine')) {
                      callback('JSON_RESULT:{"confidence_scores":[0.25]}');
                    } else {
                      callback('JSON_RESULT:{"success_probability":0.15,"timeline_days":45,"risk_category":"Low","confidence_level":0.3}');
                    }
                  }
                })
              };
              mockProcess.stdout = mockStdout;
              callback(0);
            }
          })
        };
        return mockProcess;
      });

      // Act
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(result.decision.recommendedAction).toBe('reject');
      expect(result.decision.confidence).toBeLessThan(0.5);
      expect(result.decision.priority).toBe('low');
      expect(result.decision.reasoning).toContain('Low success probability');
    });

    it('should recommend escalate for uncertain claims', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-uncertain',
        userId: 'user-uncertain',
        actorId: 'user-uncertain',
        discrepancyType: 'damaged_item',
        discrepancySize: 250.0,
        daysOutstanding: 60,
        marketplace: 'walmart',
        historicalPayoutRate: 0.5,
        sellerRating: 3.5,
        evidenceQuality: 0.6
      };

      // Mock mixed-confidence responses
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              const mockStdout = {
                on: jest.fn((event, callback) => {
                  if (event === 'data') {
                    // Mixed confidence responses
                    if (args.includes('evidence_engine')) {
                      callback('JSON_RESULT:{"confidence_scores":[0.65]}');
                    } else {
                      callback('JSON_RESULT:{"success_probability":0.45,"timeline_days":25,"risk_category":"Medium","confidence_level":0.55}');
                    }
                  }
                })
              };
              mockProcess.stdout = mockStdout;
              callback(0);
            }
          })
        };
        return mockProcess;
      });

      // Act
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(result.decision.recommendedAction).toBe('escalate');
      expect(result.decision.priority).toBe('high');
      expect(result.decision.reasoning).toContain('Uncertain outcome requires escalation');
    });
  });

  describe('Feature Enhancement', () => {
    it('should enhance features with evidence context', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-enhanced',
        userId: 'user-enhanced',
        actorId: 'user-enhanced',
        discrepancyType: 'overcharge',
        discrepancySize: 120.0,
        daysOutstanding: 25,
        marketplace: 'amazon',
        historicalPayoutRate: 0.75,
        sellerRating: 4.2,
        evidenceQuality: 0.85
      };

      // Mock successful responses
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              const mockStdout = {
                on: jest.fn((event, callback) => {
                  if (event === 'data') {
                    if (args.includes('evidence_engine')) {
                      callback('JSON_RESULT:{"confidence_scores":[0.82]}');
                    } else {
                      callback('JSON_RESULT:{"success_probability":0.78,"timeline_days":18,"risk_category":"High","confidence_level":0.81}');
                    }
                  }
                })
              };
              mockProcess.stdout = mockStdout;
              callback(0);
            }
          })
        };
        return mockProcess;
      });

      // Act
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(result.evidence.evidenceQuality.overall_confidence).toBe(0.82);
      expect(result.certainty.evidenceEnhancement).toBeDefined();
      expect(result.certainty.evidenceEnhancement).toBeGreaterThan(0);
      expect(result.traceability.engineCorrelation).toBeGreaterThan(0.7);
    });
  });

  describe('Traceability and Audit', () => {
    it('should generate deterministic traceability hash', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-trace',
        userId: 'user-trace',
        actorId: 'user-trace',
        discrepancyType: 'missing_refund',
        discrepancySize: 100.0,
        daysOutstanding: 30,
        marketplace: 'amazon',
        historicalPayoutRate: 0.8
      };

      // Mock successful responses
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              const mockStdout = {
                on: jest.fn((event, callback) => {
                  if (event === 'data') {
                    if (args.includes('evidence_engine')) {
                      callback('JSON_RESULT:{"confidence_scores":[0.8]}');
                    } else {
                      callback('JSON_RESULT:{"success_probability":0.75,"timeline_days":15,"risk_category":"High","confidence_level":0.8}');
                    }
                  }
                })
              };
              mockProcess.stdout = mockStdout;
              callback(0);
            }
          })
        };
        return mockProcess;
      });

      // Act
      const result1 = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);
      const result2 = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(result1.traceability.hash).toBeDefined();
      expect(result1.traceability.hash).toHaveLength(64); // SHA256 hash length
      expect(result1.traceability.hash).toBe(result2.traceability.hash); // Deterministic
      expect(result1.traceability.timestamp).toBeDefined();
      expect(result1.traceability.actorId).toBe('user-trace');
      expect(result1.traceability.engineCorrelation).toBeGreaterThan(0);
      expect(result1.traceability.decisionConfidence).toBeGreaterThan(0);
    });

    it('should log comprehensive transaction data', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-log',
        userId: 'user-log',
        actorId: 'user-log',
        discrepancyType: 'overcharge',
        discrepancySize: 200.0,
        daysOutstanding: 40,
        marketplace: 'shopify',
        historicalPayoutRate: 0.7
      };

      // Mock successful responses
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              const mockStdout = {
                on: jest.fn((event, callback) => {
                  if (event === 'data') {
                    if (args.includes('evidence_engine')) {
                      callback('JSON_RESULT:{"confidence_scores":[0.75]}');
                    } else {
                      callback('JSON_RESULT:{"success_probability":0.7,"timeline_days":20,"risk_category":"Medium","confidence_level":0.75}');
                    }
                  }
                })
              };
              mockProcess.stdout = mockStdout;
              callback(0);
            }
          })
        };
        return mockProcess;
      });

      // Act
      await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);

      // Assert
      expect(mockTransactionJournalService.recordIntegratedRecoveryEvent).toHaveBeenCalledWith(
        'claim-log',
        expect.objectContaining({
          confidenceScore: expect.any(Number),
          evidenceQuality: expect.any(Object),
          proofBundleId: expect.stringContaining('claim-log')
        }),
        expect.objectContaining({
          successProbability: expect.any(Number),
          timelineDays: expect.any(Number),
          riskCategory: expect.any(String)
        }),
        'user-log'
      );
    });
  });

  describe('Performance and Statistics', () => {
    it('should provide processing statistics', async () => {
      // Act
      const stats = await IntegratedRecoveryEngine.getProcessingStatistics();

      // Assert
      expect(stats).toBeDefined();
      expect(stats.evidence_engine).toBeDefined();
      expect(stats.certainty_engine).toBeDefined();
      expect(stats.transactions).toBeDefined();
      expect(stats.integration_health).toBeDefined();
      
      expect(stats.integration_health.engine_correlation_avg).toBeGreaterThan(0);
      expect(stats.integration_health.decision_confidence_avg).toBeGreaterThan(0);
      expect(stats.integration_health.processing_time_avg).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle Python script execution errors', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-error',
        userId: 'user-error',
        actorId: 'user-error',
        discrepancyType: 'missing_refund',
        discrepancySize: 100.0,
        daysOutstanding: 30,
        marketplace: 'amazon',
        historicalPayoutRate: 0.8
      };

      // Mock Python script error
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              callback(1); // Error exit code
            }
          })
        };
        return mockProcess;
      });

      // Act & Assert
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);
      
      expect(result).toBeDefined();
      expect(result.evidence.confidenceScore).toBe(0.5); // Fallback
      expect(result.certainty.successProbability).toBe(0.5); // Fallback
      expect(result.decision.recommendedAction).toBe('review'); // Should default to review
    });

    it('should handle database persistence errors gracefully', async () => {
      // Arrange
      const claimData: ClaimData = {
        claimId: 'claim-db-error',
        userId: 'user-db-error',
        actorId: 'user-db-error',
        discrepancyType: 'overcharge',
        discrepancySize: 150.0,
        daysOutstanding: 25,
        marketplace: 'amazon',
        historicalPayoutRate: 0.8
      };

      // Mock successful Python execution but database error
      const mockSpawn = require('child_process').spawn;
      mockSpawn.mockImplementation((command, args, options) => {
        const mockProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              const mockStdout = {
                on: jest.fn((event, callback) => {
                  if (event === 'data') {
                    if (args.includes('evidence_engine')) {
                      callback('JSON_RESULT:{"confidence_scores":[0.8]}');
                    } else {
                      callback('JSON_RESULT:{"success_probability":0.75,"timeline_days":15,"risk_category":"High","confidence_level":0.8}');
                    }
                  }
                })
              };
              mockProcess.stdout = mockStdout;
              callback(0);
            }
          })
        };
        return mockProcess;
      });

      // Mock database error
      mockCertaintyRepo.insertCertaintyScore.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert - should not throw error
      const result = await IntegratedRecoveryEngine.processClaimEndToEnd(claimData);
      
      expect(result).toBeDefined();
      expect(result.evidence).toBeDefined();
      expect(result.certainty).toBeDefined();
      expect(result.decision).toBeDefined();
    });
  });
});




