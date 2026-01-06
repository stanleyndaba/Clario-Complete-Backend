import { createHash } from 'crypto';

// Types for the Certainty Engine
export interface CertaintyScore {
  id: string;
  claim_id: string;
  refund_probability: number;
  risk_level: 'Low' | 'Medium' | 'High';
  created_at: string;
}

export interface ClaimPayload {
  claim_id: string;
  actor_id: string;
  invoice_text: string;
  proof_bundle_id: string;
  claim_amount?: number;
  anomaly_score?: number;
  claim_type?: string;
}

export interface ScoringResult {
  refund_probability: number;
  risk_level: 'Low' | 'Medium' | 'High';
  confidence: number;
  factors: string[];
}

/**
 * Certainty Engine MVP - Deterministic scoring for refund likelihood
 * 
 * This stub implementation provides consistent scoring based on:
 * - Invoice text analysis (keyword patterns)
 * - Claim amount analysis
 * - Anomaly score from Evidence Engine
 * - Actor history (placeholder for future ML model)
 * 
 * Future: Replace with trained ML model using historical claim data
 */
export class CertaintyEngine {
  
  /**
   * Generate deterministic refund probability score for a flagged claim
   * 
   * @param payload - Claim payload from Evidence & Value Engine
   * @returns ScoringResult with probability, risk level, and confidence
   */
  static async scoreClaim(payload: ClaimPayload): Promise<ScoringResult> {
    // Create deterministic hash from payload for consistent scoring
    const payloadHash = this.createPayloadHash(payload);
    
    // Extract features for scoring
    const features = this.extractFeatures(payload);
    
    // Calculate base probability using deterministic algorithm
    const baseProbability = this.calculateBaseProbability(features, payloadHash);
    
    // Apply risk adjustments
    const adjustedProbability = this.applyRiskAdjustments(baseProbability, features);
    
    // Ensure probability is within valid range [0, 1]
    const finalProbability = Math.max(0.0, Math.min(1.0, adjustedProbability));
    
    // Determine risk level based on probability
    const riskLevel = this.mapProbabilityToRiskLevel(finalProbability);
    
    // Calculate confidence based on feature quality
    const confidence = this.calculateConfidence(features);
    
    // Identify contributing factors
    const factors = this.identifyFactors(features, finalProbability);
    
    return {
      refund_probability: finalProbability,
      risk_level: riskLevel,
      confidence,
      factors
    };
  }
  
  /**
   * Create deterministic hash from payload for consistent scoring
   */
  private static createPayloadHash(payload: ClaimPayload): string {
    const canonicalPayload = JSON.stringify({
      claim_id: payload.claim_id,
      actor_id: payload.actor_id,
      invoice_text: payload.invoice_text,
      proof_bundle_id: payload.proof_bundle_id,
      claim_amount: payload.claim_amount || 0,
      anomaly_score: payload.anomaly_score || 0,
      claim_type: payload.claim_type || 'unknown'
    }, Object.keys(payload).sort());
    
    return createHash('sha256').update(canonicalPayload).digest('hex');
  }
  
  /**
   * Extract features from claim payload for scoring
   */
  private static extractFeatures(payload: ClaimPayload) {
    const text = payload.invoice_text.toLowerCase();
    const amount = payload.claim_amount || 0;
    const anomalyScore = payload.anomaly_score || 0;
    
    return {
      // Text-based features
      hasOvercharge: /overcharge|overcharge|excessive|inflated/i.test(text),
      hasDamage: /damaged|damage|broken|defective/i.test(text),
      hasLost: /lost|missing|stolen|unaccounted/i.test(text),
      hasShippingIssue: /shipping|delivery|logistics|transport/i.test(text),
      hasStorageIssue: /storage|warehouse|inventory|stock/i.test(text),
      hasQualityIssue: /quality|defect|substandard|poor/i.test(text),
      
      // Amount-based features
      amountTier: this.getAmountTier(amount),
      isHighValue: amount > 1000,
      
      // Evidence quality features
      anomalyScore: anomalyScore,
      hasProofBundle: !!payload.proof_bundle_id,
      
      // Actor features (placeholder for future ML)
      actorId: payload.actor_id,
      
      // Text length and complexity
      textLength: text.length,
      hasStructuredData: /invoice|order|po|reference/i.test(text)
    };
  }
  
  /**
   * Calculate base probability using deterministic algorithm
   */
  private static calculateBaseProbability(features: any, payloadHash: string): number {
    let probability = 0.5; // Base 50% probability
    
    // Text-based scoring
    if (features.hasOvercharge) probability += 0.15;
    if (features.hasDamage) probability += 0.12;
    if (features.hasLost) probability += 0.10;
    if (features.hasShippingIssue) probability += 0.08;
    if (features.hasStorageIssue) probability += 0.06;
    if (features.hasQualityIssue) probability += 0.05;
    
    // Amount-based scoring
    if (features.amountTier === 'low') probability += 0.05;
    else if (features.amountTier === 'medium') probability += 0.02;
    else if (features.amountTier === 'high') probability -= 0.03;
    
    // Evidence quality scoring
    if (features.anomalyScore > 0.7) probability += 0.10;
    else if (features.anomalyScore > 0.5) probability += 0.05;
    
    if (features.hasProofBundle) probability += 0.05;
    
    // Text quality scoring
    if (features.textLength > 100) probability += 0.03;
    if (features.hasStructuredData) probability += 0.02;
    
    // Deterministic adjustment based on payload hash
    const hashAdjustment = this.hashToAdjustment(payloadHash);
    probability += hashAdjustment;
    
    return probability;
  }
  
  /**
   * Apply risk adjustments based on feature combinations
   */
  private static applyRiskAdjustments(baseProbability: number, features: any): number {
    let adjusted = baseProbability;
    
    // High-value claims get slight penalty (more scrutiny)
    if (features.isHighValue) {
      adjusted -= 0.05;
    }
    
    // Multiple issue types increase probability
    const issueCount = [
      features.hasOvercharge,
      features.hasDamage,
      features.hasLost,
      features.hasShippingIssue,
      features.hasStorageIssue,
      features.hasQualityIssue
    ].filter(Boolean).length;
    
    if (issueCount >= 3) adjusted += 0.08;
    else if (issueCount >= 2) adjusted += 0.04;
    
    // Strong evidence combination
    if (features.anomalyScore > 0.8 && features.hasProofBundle) {
      adjusted += 0.06;
    }
    
    return adjusted;
  }
  
  /**
   * Map probability to risk level
   */
  private static mapProbabilityToRiskLevel(probability: number): 'Low' | 'Medium' | 'High' {
    if (probability < 0.3) return 'Low';
    if (probability <= 0.7) return 'Medium';
    return 'High';
  }
  
  /**
   * Calculate confidence based on feature quality
   */
  private static calculateConfidence(features: any): number {
    let confidence = 0.6; // Base confidence
    
    // Evidence quality
    if (features.hasProofBundle) confidence += 0.15;
    if (features.anomalyScore > 0.7) confidence += 0.10;
    
    // Text quality
    if (features.textLength > 100) confidence += 0.08;
    if (features.hasStructuredData) confidence += 0.07;
    
    // Issue specificity
    const specificIssues = [
      features.hasOvercharge,
      features.hasDamage,
      features.hasLost
    ].filter(Boolean).length;
    
    if (specificIssues >= 2) confidence += 0.10;
    
    return Math.min(1.0, confidence);
  }
  
  /**
   * Identify contributing factors for the score
   */
  private static identifyFactors(features: any, probability: number): string[] {
    const factors: string[] = [];
    
    if (features.hasOvercharge) factors.push('Overcharge detected');
    if (features.hasDamage) factors.push('Damage reported');
    if (features.hasLost) factors.push('Lost inventory');
    if (features.hasShippingIssue) factors.push('Shipping problem');
    if (features.hasStorageIssue) factors.push('Storage issue');
    if (features.hasQualityIssue) factors.push('Quality concern');
    
    if (features.anomalyScore > 0.7) factors.push('High anomaly score');
    if (features.hasProofBundle) factors.push('Evidence documented');
    
    if (probability > 0.7) factors.push('High refund likelihood');
    else if (probability < 0.3) factors.push('Low refund likelihood');
    
    return factors;
  }
  
  /**
   * Get amount tier for scoring
   */
  private static getAmountTier(amount: number): 'low' | 'medium' | 'high' {
    if (amount <= 100) return 'low';
    if (amount <= 1000) return 'medium';
    return 'high';
  }
  
  /**
   * Convert hash to small probability adjustment for deterministic variation
   */
  private static hashToAdjustment(hash: string): number {
    // Use first 8 characters of hash to create small adjustment
    const hashPrefix = hash.substring(0, 8);
    const hashValue = parseInt(hashPrefix, 16);
    
    // Convert to small adjustment between -0.02 and +0.02
    return ((hashValue % 400) - 200) / 10000;
  }
}

