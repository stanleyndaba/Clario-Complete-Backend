import { CertaintyScore } from './certaintyEngine';

const SUPABASE_URL = process.env['SUPABASE_URL'] as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string;

function headers() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer': 'return=representation'
  } as Record<string, string>;
}

/**
 * Supabase repository for Certainty Engine operations
 * 
 * MVP Implementation: Stubbed methods return fake data for testing
 * Future: Replace with real Supabase REST API calls
 */
export class CertaintyRepo {
  
  /**
   * Insert a new certainty score into the database
   * 
   * @param score - The certainty score to insert
   * @returns Promise<CertaintyScore> - The inserted score with generated ID
   */
  static async insertCertaintyScore(score: Omit<CertaintyScore, 'id' | 'created_at'>): Promise<CertaintyScore> {
    // Stub implementation for MVP testing
    const mockScore: CertaintyScore = {
      id: `certainty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      claim_id: score.claim_id,
      refund_probability: score.refund_probability,
      risk_level: score.risk_level,
      created_at: new Date().toISOString()
    };
    
    console.log('🔍 [CertaintyRepo] Inserted certainty score:', mockScore);
    return mockScore;
    
    /* Real implementation (commented out for MVP):
    const res = await fetch(`${SUPABASE_URL}/rest/v1/certainty_scores`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify([{
        claim_id: score.claim_id,
        refund_probability: score.refund_probability,
        risk_level: score.risk_level
      }])
    });
    
    if (!res.ok) {
      throw new Error(`Certainty score insert failed: ${res.statusText}`);
    }
    
    const data = await res.json();
    return data[0];
    */
  }
  
  /**
   * Retrieve all certainty scores for a specific claim
   * 
   * @param claim_id - The claim ID to search for
   * @returns Promise<CertaintyScore[]> - Array of certainty scores
   */
  static async getCertaintyScoresByClaim(claim_id: string): Promise<CertaintyScore[]> {
    // Stub implementation for MVP testing
    const mockScores: CertaintyScore[] = [
      {
        id: `certainty-${claim_id}-1`,
        claim_id,
        refund_probability: 0.75,
        risk_level: 'High',
        created_at: new Date(Date.now() - 86400000).toISOString() // 1 day ago
      },
      {
        id: `certainty-${claim_id}-2`,
        claim_id,
        refund_probability: 0.82,
        risk_level: 'High',
        created_at: new Date().toISOString()
      }
    ];
    
    console.log(`🔍 [CertaintyRepo] Retrieved ${mockScores.length} certainty scores for claim ${claim_id}`);
    return mockScores;
    
    /* Real implementation (commented out for MVP):
    const res = await fetch(`${SUPABASE_URL}/rest/v1/certainty_scores?claim_id=eq.${claim_id}&order=created_at.desc`, {
      headers: headers()
    });
    
    if (!res.ok) {
      throw new Error(`Certainty score fetch failed: ${res.statusText}`);
    }
    
    return await res.json();
    */
  }
  
  /**
   * Get the latest certainty score for a claim
   * 
   * @param claim_id - The claim ID to search for
   * @returns Promise<CertaintyScore | null> - The latest score or null if none exists
   */
  static async getLatestCertaintyScore(claim_id: string): Promise<CertaintyScore | null> {
    const scores = await this.getCertaintyScoresByClaim(claim_id);
    return scores.length > 0 ? scores[0] : null;
  }
  
  /**
   * Get certainty scores by risk level
   * 
   * @param risk_level - The risk level to filter by
   * @param limit - Maximum number of results to return
   * @returns Promise<CertaintyScore[]> - Array of certainty scores
   */
  static async getCertaintyScoresByRiskLevel(risk_level: 'Low' | 'Medium' | 'High', limit: number = 100): Promise<CertaintyScore[]> {
    // Stub implementation for MVP testing
    const mockScores: CertaintyScore[] = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      id: `certainty-risk-${risk_level}-${i}`,
      claim_id: `claim-${risk_level}-${i}`,
      refund_probability: risk_level === 'Low' ? 0.2 + (i * 0.05) : 
                         risk_level === 'Medium' ? 0.4 + (i * 0.1) : 
                         0.75 + (i * 0.05),
      risk_level,
      created_at: new Date(Date.now() - (i * 86400000)).toISOString() // i days ago
    }));
    
    console.log(`🔍 [CertaintyRepo] Retrieved ${mockScores.length} ${risk_level} risk certainty scores`);
    return mockScores;
    
    /* Real implementation (commented out for MVP):
    const res = await fetch(`${SUPABASE_URL}/rest/v1/certainty_scores?risk_level=eq.${risk_level}&order=created_at.desc&limit=${limit}`, {
      headers: headers()
    });
    
    if (!res.ok) {
      throw new Error(`Certainty score fetch by risk level failed: ${res.statusText}`);
    }
    
    return await res.json();
    */
  }
  
  /**
   * Get certainty score statistics
   * 
   * @returns Promise<object> - Statistics about certainty scores
   */
  static async getCertaintyScoreStats(): Promise<{
    total_scores: number;
    average_probability: number;
    risk_level_distribution: Record<string, number>;
    recent_scores_24h: number;
  }> {
    // Stub implementation for MVP testing
    const mockStats = {
      total_scores: 150,
      average_probability: 0.62,
      risk_level_distribution: {
        'Low': 45,
        'Medium': 78,
        'High': 27
      },
      recent_scores_24h: 12
    };
    
    console.log('🔍 [CertaintyRepo] Retrieved certainty score statistics:', mockStats);
    return mockStats;
    
    /* Real implementation (commented out for MVP):
    // This would require multiple API calls or a custom function in Supabase
    // For now, return stub data
    return mockStats;
    */
  }
  
  /**
   * Check if a certainty score already exists for a claim
   * 
   * @param claim_id - The claim ID to check
   * @returns Promise<boolean> - True if a score exists, false otherwise
   */
  static async hasCertaintyScore(claim_id: string): Promise<boolean> {
    const scores = await this.getCertaintyScoresByClaim(claim_id);
    return scores.length > 0;
  }
  
  /**
   * Delete all certainty scores for a claim (for testing/cleanup)
   * 
   * @param claim_id - The claim ID to delete scores for
   * @returns Promise<number> - Number of scores deleted
   */
  static async deleteCertaintyScoresByClaim(claim_id: string): Promise<number> {
    // Stub implementation for MVP testing
    console.log(`🗑️ [CertaintyRepo] Deleted certainty scores for claim ${claim_id} (stub)`);
    return 2; // Mock return value
    
    /* Real implementation (commented out for MVP):
    const res = await fetch(`${SUPABASE_URL}/rest/v1/certainty_scores?claim_id=eq.${claim_id}`, {
      method: 'DELETE',
      headers: headers()
    });
    
    if (!res.ok) {
      throw new Error(`Certainty score deletion failed: ${res.statusText}`);
    }
    
    // Return the number of deleted rows
    const deletedCount = await res.json();
    return deletedCount.length || 0;
    */
  }
}

