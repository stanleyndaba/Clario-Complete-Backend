import { createHash } from 'crypto';

// Types for transaction journaling
export interface TransactionJournalEntry {
  id: string;
  tx_type: string;
  entity_id: string;
  payload: Record<string, any>;
  timestamp: string;
  actor_id: string;
  hash: string;
}

export interface RecordTransactionInput {
  tx_type: string;
  entity_id: string;
  payload: Record<string, any>;
  actor_id: string;
}

export interface TransactionQuery {
  tx_type?: string;
  entity_id?: string;
  actor_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Transaction Journal Service for Refund Engine
 * 
 * This service logs all domain transactions for audit and traceability.
 * Currently stubbed for MVP testing, but designed to integrate with
 * the main TransactionJournal table in the future.
 */
export class TransactionJournalService {
  
  /**
   * Record a transaction in the journal
   * 
   * @param input - Transaction details
   * @returns Promise<TransactionJournalEntry> - The recorded entry
   */
  static async recordTransaction(input: RecordTransactionInput): Promise<TransactionJournalEntry> {
    const timestamp = new Date().toISOString();
    const hash = this.computeTxHash(input.payload, timestamp);

    // Stub implementation for MVP testing
    const entry: TransactionJournalEntry = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      tx_type: input.tx_type,
      entity_id: input.entity_id,
      payload: input.payload,
      timestamp,
      actor_id: input.actor_id,
      hash
    };

    console.log('📝 [TransactionJournal] Recorded transaction:', {
      tx_type: entry.tx_type,
      entity_id: entry.entity_id,
      actor_id: entry.actor_id,
      hash: entry.hash.substring(0, 8) + '...'
    });

    return entry;

    /* Real implementation (commented out for MVP):
    const res = await fetch(`${SUPABASE_URL}/rest/v1/TransactionJournal`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify([{
        tx_type: input.tx_type,
        entity_id: input.entity_id,
        payload: input.payload,
        actor_id: input.actor_id,
        hash
      }])
    });

    if (!res.ok) {
      throw new Error(`Transaction journal insert failed: ${res.statusText}`);
    }

    const data = await res.json();
    return data[0];
    */
  }

  /**
   * Record a claim flagging + certainty scoring event
   * 
   * @param claim_id - The claim ID
   * @param proof_bundle_id - The proof bundle ID
   * @param certainty_score_id - The certainty score ID
   * @param actor_id - The actor who performed the action
   * @returns Promise<TransactionJournalEntry> - The recorded entry
   */
  static async recordClaimFlaggedWithCertainty(
    claim_id: string,
    proof_bundle_id: string,
    certainty_score_id: string,
    actor_id: string
  ): Promise<TransactionJournalEntry> {
    return this.recordTransaction({
      tx_type: 'claim_flagged_with_certainty',
      entity_id: claim_id,
      actor_id,
      payload: {
        claim_id,
        proof_bundle_id,
        certainty_score_id,
        actor_id,
        timestamp: new Date().toISOString(),
        description: 'Claim flagged and certainty scored in integrated flow'
      }
    });
  }

  /**
   * Record a proof bundle creation event
   * 
   * @param proof_bundle_id - The proof bundle ID
   * @param claim_id - The associated claim ID
   * @param actor_id - The actor who created the proof
   * @returns Promise<TransactionJournalEntry> - The recorded entry
   */
  static async recordProofBundleCreated(
    proof_bundle_id: string,
    claim_id: string,
    actor_id: string
  ): Promise<TransactionJournalEntry> {
    return this.recordTransaction({
      tx_type: 'proof_bundle_created',
      entity_id: proof_bundle_id,
      actor_id,
      payload: {
        proof_bundle_id,
        claim_id,
        actor_id,
        timestamp: new Date().toISOString(),
        description: 'Proof bundle created from invoice text analysis'
      }
    });
  }

  /**
   * Record a certainty score creation event
   * 
   * @param certainty_score_id - The certainty score ID
   * @param claim_id - The associated claim ID
   * @param actor_id - The actor who created the score
   * @returns Promise<TransactionJournalEntry> - The recorded entry
   */
  static async recordCertaintyScoreCreated(
    certainty_score_id: string,
    claim_id: string,
    actor_id: string
  ): Promise<TransactionJournalEntry> {
    return this.recordTransaction({
      tx_type: 'certainty_score_created',
      entity_id: certainty_score_id,
      actor_id,
      payload: {
        certainty_score_id,
        claim_id,
        actor_id,
        timestamp: new Date().toISOString(),
        description: 'Certainty score generated for flagged claim'
      }
    });
  }

  /**
   * Record a claim risk scoring event
   * 
   * @param certainty_score_id - The certainty score ID
   * @param actor_id - The actor who performed the scoring
   * @param claim_features - The claim features used for scoring
   * @param risk_assessment - The risk assessment results
   * @returns Promise<TransactionJournalEntry> - The recorded entry
   */
  static async recordClaimRiskScored(
    certainty_score_id: string,
    actor_id: string,
    claim_features: any,
    risk_assessment: any
  ): Promise<TransactionJournalEntry> {
    return this.recordTransaction({
      tx_type: 'claim_risk_scored',
      entity_id: certainty_score_id,
      actor_id,
      payload: {
        certainty_score_id,
        actor_id,
        claim_features,
        risk_assessment,
        timestamp: new Date().toISOString(),
        description: 'Claim risk assessment completed using ML models'
      }
    });
  }

  /**
   * Record a model training event
   * 
   * @param actor_id - The actor who initiated training
   * @param n_samples - Number of samples used for training
   * @param training_metrics - Training performance metrics
   * @returns Promise<TransactionJournalEntry> - The recorded entry
   */
  static async recordModelTraining(
    actor_id: string,
    n_samples: number,
    training_metrics: any
  ): Promise<TransactionJournalEntry> {
    return this.recordTransaction({
      tx_type: 'model_training',
      entity_id: 'ml_models',
      actor_id,
      payload: {
        actor_id,
        n_samples,
        training_metrics,
        timestamp: new Date().toISOString(),
        description: 'ML models trained with synthetic data'
      }
    });
  }

  /**
   * Get transactions by type and entity
   * 
   * @param query - Query parameters
   * @returns Promise<TransactionJournalEntry[]> - Array of transactions
   */
  static async getTransactions(query: TransactionQuery): Promise<TransactionJournalEntry[]> {
    // Stub implementation for MVP testing
    const mockTransactions: TransactionJournalEntry[] = [
      {
        id: 'tx-1',
        tx_type: 'claim_flagged_with_certainty',
        entity_id: 'claim-1',
        payload: { claim_id: 'claim-1', proof_bundle_id: 'proof-1', certainty_score_id: 'certainty-1' },
        timestamp: new Date().toISOString(),
        actor_id: 'user-1',
        hash: 'fakehash123'
      }
    ];

    console.log('📝 [TransactionJournal] Retrieved transactions:', mockTransactions.length);
    return mockTransactions;

    /* Real implementation (commented out for MVP):
    const params = new URLSearchParams();
    if (query.tx_type) params.append('tx_type', `eq.${query.tx_type}`);
    if (query.entity_id) params.append('entity_id', `eq.${query.entity_id}`);
    if (query.actor_id) params.append('actor_id', `eq.${query.actor_id}`);
    if (query.limit) params.append('limit', query.limit.toString());

    const res = await fetch(`${SUPABASE_URL}/rest/v1/TransactionJournal?${params}`, {
      headers: headers()
    });

    if (!res.ok) {
      throw new Error(`Transaction fetch failed: ${res.statusText}`);
    }

    return await res.json();
    */
  }

  /**
   * Get transaction by ID
   * 
   * @param id - Transaction ID
   * @returns Promise<TransactionJournalEntry | null> - The transaction or null
   */
  static async getTransactionById(id: string): Promise<TransactionJournalEntry | null> {
    // Stub implementation for MVP testing
    const mockTransaction: TransactionJournalEntry = {
      id,
      tx_type: 'claim_flagged_with_certainty',
      entity_id: 'claim-1',
      payload: { claim_id: 'claim-1', proof_bundle_id: 'proof-1', certainty_score_id: 'certainty-1' },
      timestamp: new Date().toISOString(),
      actor_id: 'user-1',
      hash: 'fakehash123'
    };

    console.log('📝 [TransactionJournal] Retrieved transaction:', id);
    return mockTransaction;

    /* Real implementation (commented out for MVP):
    const res = await fetch(`${SUPABASE_URL}/rest/v1/TransactionJournal?id=eq.${id}`, {
      headers: headers()
    });

    if (!res.ok) {
      throw new Error(`Transaction fetch failed: ${res.statusText}`);
    }

    const data = await res.json();
    return data.length > 0 ? data[0] : null;
    */
  }

  /**
   * Compute transaction hash for integrity
   * 
   * @param payload - Transaction payload
   * @param timestamp - ISO timestamp
   * @returns string - SHA256 hash
   */
  private static computeTxHash(payload: Record<string, any>, timestamp: string): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return createHash('sha256').update(`${canonical}|${timestamp}`).digest('hex');
  }
}






