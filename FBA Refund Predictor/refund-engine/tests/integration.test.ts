import request from 'supertest';
import express from 'express';
import { ClaimsController } from '../src/api/controllers/claimsController';
import { CertaintyEngine } from '../src/api/services/certaintyEngine';
import { CertaintyRepo } from '../src/api/services/certaintyRepo';
import { TransactionJournalService } from '../src/api/services/transactionJournalService';

// Mock the Evidence Engine
jest.mock('../src/api/services/evidenceEngine', () => ({
  flagClaimFromInvoiceText: jest.fn().mockResolvedValue({
    claim: {
      id: 'claim-integrated-1',
      claimNumber: 'INTEGRATED-001',
      userId: 'user-1',
      status: 'pending',
      amount: 150.00,
      anomaly_score: 0.9,
      claim_type: 'invoice_text',
      proof_bundle_id: null
    },
    proof: {
      id: 'proof-integrated-1',
      claim_id: null,
      payload: { source: 'invoice_text', text: 'Vendor: Amazon FBA, Overcharge detected $150.00' },
      content_hash: 'integratedhash123',
      created_at: new Date().toISOString(),
      created_by: 'user-1'
    }
  }),
  getProofBundleWithLinks: jest.fn().mockResolvedValue({
    proof_bundle: {
      id: 'proof-1',
      payload: { source: 'invoice_text', text: 'Test invoice' },
      content_hash: 'testhash123',
      created_at: new Date().toISOString(),
      created_by: 'test-user'
    },
    evidence_links: []
  })
}));

// Mock the Certainty Engine
jest.mock('../src/api/services/certaintyEngine', () => ({
  CertaintyEngine: {
    scoreClaim: jest.fn().mockResolvedValue({
      refund_probability: 0.75,
      risk_level: 'High',
      confidence: 0.85,
      factors: ['Overcharge detected', 'High anomaly score', 'Evidence documented']
    })
  }
}));

// Mock the Certainty Repository
jest.mock('../src/api/services/certaintyRepo', () => ({
  CertaintyRepo: {
    insertCertaintyScore: jest.fn().mockResolvedValue({
      id: 'certainty-integrated-1',
      claim_id: 'claim-integrated-1',
      refund_probability: 0.75,
      risk_level: 'High',
      created_at: new Date().toISOString()
    })
  }
}));

// Mock the Transaction Journal Service
jest.mock('../src/api/services/transactionJournalService', () => ({
  TransactionJournalService: {
    recordClaimFlaggedWithCertainty: jest.fn().mockResolvedValue({
      id: 'tx-integrated-1',
      tx_type: 'claim_flagged_with_certainty',
      entity_id: 'claim-integrated-1',
      payload: {
        claim_id: 'claim-integrated-1',
        proof_bundle_id: 'proof-integrated-1',
        certainty_score_id: 'certainty-integrated-1'
      },
      timestamp: new Date().toISOString(),
      actor_id: 'user-1',
      hash: 'integratedtxhash123'
    })
  }
}));

// Mock auth middleware
jest.mock('../src/api/middleware/authMiddleware', () => ({
  authenticateToken: () => (req: any, res: any, next: any) => {
    req.user = { id: 'user-1', email: 'test@example.com' };
    next();
  }
}));

describe('Certainty Engine Integration Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Mount the claims routes
    const claimsRoutes = require('../src/api/routes/claimsRoutes').default;
    app.use('/api/v1/claims', claimsRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/claims/flag (Enhanced with Certainty)', () => {
    const validPayload = {
      case_number: 'INTEGRATED-001',
      claim_amount: 150.00,
      invoice_text: 'Vendor: Amazon FBA, Invoice Number: INV-2024-001, Date: 2024-01-15, Overcharge detected on shipping fees $150.00',
      actor_id: 'user-1'
    };

    it('should flag claim and generate certainty score successfully', async () => {
      const response = await request(app)
        .post('/api/v1/claims/flag')
        .send(validPayload)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      
      // Verify claim data includes certainty_score_id
      expect(response.body.data.claim).toHaveProperty('certainty_score_id');
      expect(response.body.data.claim.certainty_score_id).toBe('certainty-integrated-1');
      
      // Verify proof bundle
      expect(response.body.data.proof).toHaveProperty('id', 'proof-integrated-1');
      
      // Verify certainty score
      expect(response.body.data.certainty_score).toHaveProperty('id', 'certainty-integrated-1');
      expect(response.body.data.certainty_score).toHaveProperty('risk_level', 'High');
      expect(response.body.data.certainty_score).toHaveProperty('refund_probability', 0.75);
      
      // Verify scoring details
      expect(response.body.data.scoring_details).toHaveProperty('refund_probability', 0.75);
      expect(response.body.data.scoring_details).toHaveProperty('risk_level', 'High');
      expect(response.body.data.scoring_details).toHaveProperty('confidence', 0.85);
      expect(response.body.data.scoring_details).toHaveProperty('factors');
      expect(response.body.data.scoring_details.factors).toContain('Overcharge detected');
    });

    it('should handle certainty scoring failures gracefully', async () => {
      // Mock certainty scoring to fail
      const { CertaintyEngine } = require('../src/api/services/certaintyEngine');
      CertaintyEngine.scoreClaim.mockRejectedValueOnce(new Error('Scoring engine failed'));

      const response = await request(app)
        .post('/api/v1/claims/flag')
        .send(validPayload)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('warning', 'Claim flagged but certainty scoring failed');
      
      // Should still return claim and proof
      expect(response.body.data).toHaveProperty('claim');
      expect(response.body.data).toHaveProperty('proof');
      
      // Should not have certainty score data
      expect(response.body.data).not.toHaveProperty('certainty_score');
      expect(response.body.data).not.toHaveProperty('scoring_details');
    });

    it('should validate required fields', async () => {
      const invalidPayload = {
        case_number: 'INTEGRATED-001',
        // Missing claim_amount and invoice_text
        actor_id: 'user-1'
      };

      const response = await request(app)
        .post('/api/v1/claims/flag')
        .send(invalidPayload)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Missing required fields');
    });
  });

  describe('POST /api/v1/claims/flag+score (Unified Endpoint)', () => {
    const validPayload = {
      case_number: 'UNIFIED-001',
      claim_amount: 200.00,
      invoice_text: 'Vendor: Test Corp, Invoice Number: INV-2024-002, Date: 2024-01-16, Damaged inventory reported $200.00',
      actor_id: 'user-1'
    };

    it('should complete full flag+score flow successfully', async () => {
      const response = await request(app)
        .post('/api/v1/claims/flag+score')
        .send(validPayload)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Claim flagged and certainty scored successfully');
      expect(response.body).toHaveProperty('data');
      
      const { data } = response.body;
      
      // Verify claim with full traceability
      expect(data.claim).toHaveProperty('id', 'claim-integrated-1');
      expect(data.claim).toHaveProperty('proof_bundle_id', 'proof-integrated-1');
      expect(data.claim).toHaveProperty('certainty_score_id', 'certainty-integrated-1');
      
      // Verify proof bundle
      expect(data.proof_bundle).toHaveProperty('id', 'proof-integrated-1');
      expect(data.proof_bundle).toHaveProperty('content_hash', 'integratedhash123');
      
      // Verify certainty score
      expect(data.certainty_score).toHaveProperty('id', 'certainty-integrated-1');
      expect(data.certainty_score).toHaveProperty('risk_level', 'High');
      expect(data.certainty_score).toHaveProperty('refund_probability', 0.75);
      
      // Verify scoring details
      expect(data.scoring_details).toHaveProperty('refund_probability', 0.75);
      expect(data.scoring_details).toHaveProperty('risk_level', 'High');
      expect(data.scoring_details).toHaveProperty('confidence', 0.85);
      expect(data.scoring_details).toHaveProperty('factors');
      
      // Verify transaction log
      expect(data.transaction_log).toHaveProperty('id', 'tx-integrated-1');
      expect(data.transaction_log).toHaveProperty('hash');
      expect(data.transaction_log).toHaveProperty('timestamp');
    });

    it('should validate required fields for unified endpoint', async () => {
      const invalidPayload = {
        case_number: 'UNIFIED-001',
        // Missing claim_amount and invoice_text
        actor_id: 'user-1'
      };

      const response = await request(app)
        .post('/api/v1/claims/flag+score')
        .send(invalidPayload)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Missing required fields');
      expect(response.body).toHaveProperty('message', 'case_number, claim_amount, and invoice_text are required');
    });

    it('should handle evidence engine failures gracefully', async () => {
      // Mock evidence engine to fail
      const { flagClaimFromInvoiceText } = require('../src/api/services/evidenceEngine');
      flagClaimFromInvoiceText.mockRejectedValueOnce(new Error('Evidence engine failed'));

      const response = await request(app)
        .post('/api/v1/claims/flag+score')
        .send(validPayload)
        .expect(500);

      expect(response.body).toHaveProperty('error', 'Internal server error');
      expect(response.body).toHaveProperty('message', 'Failed to complete flag+score flow');
    });
  });

  describe('Transaction Journal Integration', () => {
    it('should log claim flagged with certainty events', async () => {
      const { TransactionJournalService } = require('../src/api/services/transactionJournalService');
      
      const response = await request(app)
        .post('/api/v1/claims/flag')
        .send({
          case_number: 'TX-TEST-001',
          claim_amount: 100.00,
          invoice_text: 'Vendor: Test, Overcharge $100.00',
          actor_id: 'user-1'
        })
        .expect(201);

      // Verify transaction was logged
      expect(TransactionJournalService.recordClaimFlaggedWithCertainty).toHaveBeenCalledWith(
        'claim-integrated-1',
        'proof-integrated-1',
        'certainty-integrated-1',
        'user-1'
      );

      // Verify transaction log in response
      expect(response.body.data.claim).toHaveProperty('certainty_score_id');
    });

    it('should log unified flag+score events', async () => {
      const { TransactionJournalService } = require('../src/api/services/transactionJournalService');
      
      const response = await request(app)
        .post('/api/v1/claims/flag+score')
        .send({
          case_number: 'UNIFIED-TX-001',
          claim_amount: 150.00,
          invoice_text: 'Vendor: Test, Overcharge $150.00',
          actor_id: 'user-1'
        })
        .expect(201);

      // Verify transaction was logged
      expect(TransactionJournalService.recordClaimFlaggedWithCertainty).toHaveBeenCalledWith(
        'claim-integrated-1',
        'proof-integrated-1',
        'certainty-integrated-1',
        'user-1'
      );

      // Verify transaction log in response
      expect(response.body.data.transaction_log).toHaveProperty('id');
      expect(response.body.data.transaction_log).toHaveProperty('hash');
    });
  });

  describe('Data Consistency and Traceability', () => {
    it('should maintain consistent IDs across all entities', async () => {
      const response = await request(app)
        .post('/api/v1/claims/flag+score')
        .send({
          case_number: 'CONSISTENCY-001',
          claim_amount: 250.00,
          invoice_text: 'Vendor: Test, Overcharge $250.00',
          actor_id: 'user-1'
        })
        .expect(201);

      const { data } = response.body;
      
      // All entities should reference the same claim
      expect(data.claim.id).toBe('claim-integrated-1');
      expect(data.proof_bundle.claim_id).toBe('claim-integrated-1');
      expect(data.certainty_score.claim_id).toBe('claim-integrated-1');
      
      // Proof bundle and certainty score should have unique IDs
      expect(data.proof_bundle.id).toBe('proof-integrated-1');
      expect(data.certainty_score.id).toBe('certainty-integrated-1');
      
      // Claim should reference both
      expect(data.claim.proof_bundle_id).toBe('proof-integrated-1');
      expect(data.claim.certainty_score_id).toBe('certainty-integrated-1');
    });

    it('should provide full audit trail in transaction log', async () => {
      const response = await request(app)
        .post('/api/v1/claims/flag+score')
        .send({
          case_number: 'AUDIT-001',
          claim_amount: 300.00,
          invoice_text: 'Vendor: Test, Overcharge $300.00',
          actor_id: 'user-1'
        })
        .expect(201);

      const { data } = response.body;
      
      // Transaction log should contain all relevant IDs
      expect(data.transaction_log).toHaveProperty('id');
      expect(data.transaction_log).toHaveProperty('hash');
      expect(data.transaction_log).toHaveProperty('timestamp');
      
      // Hash should be deterministic and verifiable
      expect(data.transaction_log.hash).toMatch(/^[a-f0-9]{8}\.\.\.$/);
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle certainty scoring failures without breaking flagging', async () => {
      // Mock certainty scoring to fail
      const { CertaintyEngine } = require('../src/api/services/certaintyEngine');
      CertaintyEngine.scoreClaim.mockRejectedValueOnce(new Error('Scoring engine failed'));

      const response = await request(app)
        .post('/api/v1/claims/flag')
        .send({
          case_number: 'RESILIENCE-001',
          claim_amount: 100.00,
          invoice_text: 'Vendor: Test, Overcharge $100.00',
          actor_id: 'user-1'
        })
        .expect(201);

      // Should still succeed with warning
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('warning');
      
      // Should return claim and proof
      expect(response.body.data).toHaveProperty('claim');
      expect(response.body.data).toHaveProperty('proof');
    });

    it('should handle transaction logging failures gracefully', async () => {
      // Mock transaction logging to fail
      const { TransactionJournalService } = require('../src/api/services/transactionJournalService');
      TransactionJournalService.recordClaimFlaggedWithCertainty.mockRejectedValueOnce(
        new Error('Transaction logging failed')
      );

      const response = await request(app)
        .post('/api/v1/claims/flag')
        .send({
          case_number: 'TX-RESILIENCE-001',
          claim_amount: 100.00,
          invoice_text: 'Vendor: Test, Overcharge $100.00',
          actor_id: 'user-1'
        })
        .expect(201);

      // Should still succeed even if transaction logging fails
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.data).toHaveProperty('certainty_score');
    });
  });
});









