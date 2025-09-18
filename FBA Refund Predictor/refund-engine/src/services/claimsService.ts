import { Request, Response } from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import axios from 'axios';

interface Claim {
  id: string;
  claim_number: string;
  customer_id: string;
  claim_amount: number;
  claim_description?: string;
  status: string;
  priority: string;
  assigned_agent?: string;
  created_at: Date;
  updated_at: Date;
  resolved_at?: Date;
  resolution_notes?: string;
}

interface PredictionResult {
  success_probability: number;
  confidence: number;
  prediction_class: string;
  uncertainty_score?: number;
}

interface FBAIntegrationConfig {
  fbaPredictorUrl: string;
  costDocsApiUrl: string;
  retryAttempts: number;
  retryDelay: number;
}

export class ClaimsService {
  private db: Pool;
  private redis: Redis;
  private config: FBAIntegrationConfig;

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
    this.config = {
      fbaPredictorUrl: process.env.FBA_PREDICTOR_URL || 'http://fba-predictor:8000',
      costDocsApiUrl: process.env.COST_DOCS_API_URL || 'http://cost-docs-api:3001',
      retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.RETRY_DELAY || '1000')
    };
  }

  /**
   * Create a new claim with automatic ML prediction
   */
  async createClaim(claimData: Partial<Claim>): Promise<Claim> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert claim
      const claimQuery = `
        INSERT INTO refunds.claims (
          claim_number, customer_id, claim_amount, claim_description, 
          status, priority, assigned_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      
      const claimValues = [
        claimData.claim_number,
        claimData.customer_id,
        claimData.claim_amount,
        claimData.claim_description,
        claimData.status || 'pending',
        claimData.priority || 'medium',
        claimData.assigned_agent
      ];
      
      const claimResult = await client.query(claimQuery, claimValues);
      const claim = claimResult.rows[0];
      
      // Trigger ML prediction asynchronously
      this.triggerMLPrediction(claim).catch(error => {
        console.error('ML prediction failed:', error);
      });
      
      await client.query('COMMIT');
      return claim;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Trigger ML prediction for a claim
   */
  private async triggerMLPrediction(claim: Claim): Promise<void> {
    try {
      // Prepare features for ML model
      const features = await this.prepareMLFeatures(claim);
      
      // Get prediction from FBA Predictor
      const prediction = await this.getMLPrediction(features);
      
      // Store prediction result
      await this.storePredictionResult(claim.id, prediction);
      
      // Update claim priority based on prediction
      await this.updateClaimPriority(claim.id, prediction);
      
      // Cache prediction for quick access
      await this.cachePrediction(claim.id, prediction);
      
    } catch (error) {
      console.error(`Failed to get ML prediction for claim ${claim.id}:`, error);
      throw error;
    }
  }

  /**
   * Prepare features for ML prediction
   */
  private async prepareMLFeatures(claim: Claim): Promise<any> {
    try {
      // Get customer history score
      const customerScore = await this.getCustomerHistoryScore(claim.customer_id);
      
      // Get product category from claim description or other sources
      const productCategory = await this.extractProductCategory(claim);
      
      // Calculate days since purchase (placeholder - would come from order data)
      const daysSincePurchase = 30; // This would be calculated from actual order date
      
      return {
        claim_amount: claim.claim_amount,
        customer_history_score: customerScore,
        product_category: productCategory,
        days_since_purchase: daysSincePurchase,
        claim_description: claim.claim_description || ''
      };
      
    } catch (error) {
      console.error('Failed to prepare ML features:', error);
      throw error;
    }
  }

  /**
   * Get ML prediction from FBA Predictor service
   */
  private async getMLPrediction(features: any): Promise<PredictionResult> {
    const maxRetries = this.config.retryAttempts;
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.config.fbaPredictorUrl}/predict-success`,
          features,
          {
            timeout: 10000,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (response.status === 200) {
          return response.data;
        }
        
      } catch (error: any) {
        lastError = error;
        console.warn(`ML prediction attempt ${attempt} failed:`, error.message);
        
        if (attempt < maxRetries) {
          await this.delay(this.config.retryDelay * attempt);
        }
      }
    }
    
    throw new Error(`ML prediction failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
  }

  /**
   * Store prediction result in database
   */
  private async storePredictionResult(claimId: string, prediction: PredictionResult): Promise<void> {
    const query = `
      INSERT INTO ml_predictions.predictions (
        claim_id, model_version, success_probability, confidence_score,
        prediction_class, uncertainty_score, features
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    
    const values = [
      claimId,
      'v1.0.0', // Model version
      prediction.success_probability,
      prediction.confidence,
      prediction.prediction_class,
      prediction.uncertainty_score,
      JSON.stringify(prediction)
    ];
    
    await this.db.query(query, values);
  }

  /**
   * Update claim priority based on ML prediction
   */
  private async updateClaimPriority(claimId: string, prediction: PredictionResult): Promise<void> {
    let newPriority = 'medium';
    
    if (prediction.success_probability > 0.8 && prediction.confidence > 0.8) {
      newPriority = 'high';
    } else if (prediction.success_probability < 0.3 || prediction.confidence < 0.5) {
      newPriority = 'low';
    }
    
    const query = `
      UPDATE refunds.claims 
      SET priority = $1, updated_at = NOW()
      WHERE id = $2
    `;
    
    await this.db.query(query, [newPriority, claimId]);
  }

  /**
   * Cache prediction result in Redis
   */
  private async cachePrediction(claimId: string, prediction: PredictionResult): Promise<void> {
    const key = `prediction:${claimId}`;
    const ttl = 3600; // 1 hour
    
    await this.redis.setex(key, ttl, JSON.stringify(prediction));
  }

  /**
   * Get customer history score
   */
  private async getCustomerHistoryScore(customerId: string): Promise<number> {
    try {
      // Query customer history from database
      const query = `
        SELECT 
          COUNT(*) as total_claims,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_claims,
          AVG(CASE WHEN status = 'resolved' THEN 1.0 ELSE 0.0 END) as success_rate
        FROM refunds.claims 
        WHERE customer_id = $1
      `;
      
      const result = await this.db.query(query, [customerId]);
      const row = result.rows[0];
      
      if (row.total_claims === 0) {
        return 0.5; // Default score for new customers
      }
      
      // Calculate score based on success rate and claim history
      let score = row.success_rate;
      
      // Bonus for customers with more claims (more data)
      if (row.total_claims > 5) {
        score += 0.1;
      }
      
      // Cap at 1.0
      return Math.min(score, 1.0);
      
    } catch (error) {
      console.error('Failed to get customer history score:', error);
      return 0.5; // Default fallback
    }
  }

  /**
   * Extract product category from claim
   */
  private async extractProductCategory(claim: Claim): Promise<string> {
    // Simple keyword-based extraction
    const description = (claim.claim_description || '').toLowerCase();
    
    if (description.includes('electronics') || description.includes('phone') || description.includes('laptop')) {
      return 'electronics';
    } else if (description.includes('book') || description.includes('magazine')) {
      return 'books';
    } else if (description.includes('clothing') || description.includes('shirt') || description.includes('pants')) {
      return 'clothing';
    } else if (description.includes('food') || description.includes('grocery')) {
      return 'food';
    } else {
      return 'other';
    }
  }

  /**
   * Get cached prediction for a claim
   */
  async getCachedPrediction(claimId: string): Promise<PredictionResult | null> {
    try {
      const key = `prediction:${claimId}`;
      const cached = await this.redis.get(key);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get cached prediction:', error);
      return null;
    }
  }

  /**
   * Get claim with prediction
   */
  async getClaimWithPrediction(claimId: string): Promise<any> {
    try {
      // Get claim data
      const claimQuery = `
        SELECT * FROM refunds.claims WHERE id = $1
      `;
      
      const claimResult = await this.db.query(claimQuery, [claimId]);
      
      if (claimResult.rows.length === 0) {
        throw new Error('Claim not found');
      }
      
      const claim = claimResult.rows[0];
      
      // Get prediction data
      const predictionQuery = `
        SELECT * FROM ml_predictions.predictions 
        WHERE claim_id = $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      
      const predictionResult = await this.db.query(predictionQuery, [claimId]);
      const prediction = predictionResult.rows[0] || null;
      
      return {
        ...claim,
        prediction
      };
      
    } catch (error) {
      console.error('Failed to get claim with prediction:', error);
      throw error;
    }
  }

  /**
   * Utility function for delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all claims with predictions
   */
  async getAllClaimsWithPredictions(limit: number = 100, offset: number = 0): Promise<any[]> {
    try {
      const query = `
        SELECT 
          c.*,
          p.success_probability,
          p.prediction_class,
          p.confidence_score
        FROM refunds.claims c
        LEFT JOIN ml_predictions.predictions p ON c.id = p.claim_id
        ORDER BY c.created_at DESC
        LIMIT $1 OFFSET $2
      `;
      
      const result = await this.db.query(query, [limit, offset]);
      return result.rows;
      
    } catch (error) {
      console.error('Failed to get claims with predictions:', error);
      throw error;
    }
  }

  /**
   * Update claim status
   */
  async updateClaimStatus(claimId: string, status: string, notes?: string): Promise<void> {
    const query = `
      UPDATE refunds.claims 
      SET status = $1, resolution_notes = $2, updated_at = NOW()
      WHERE id = $3
    `;
    
    await this.db.query(query, [status, notes, claimId]);
  }
}

