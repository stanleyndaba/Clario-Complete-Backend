import axios from 'axios';
import { ClaimsService } from './claimsService';
import { LedgerService } from './ledgerService';
import { db } from '../../utils/db';

export interface MLPredictionRequest {
  claim_amount: number;
  customer_history_score: number;
  product_category: string;
  days_since_purchase: number;
  claim_description?: string;
}

export interface MLPredictionResponse {
  success_probability: number;
  confidence: number;
  prediction_class: string;
  uncertainty_score?: number;
}

export interface DiscrepancyCase {
  case_id: string;
  case_number: string;
  claim_amount: number;
  customer_history_score: number;
  product_category: string;
  days_since_purchase: number;
  claim_description?: string;
  ml_prediction: number;
  ml_confidence: number;
  prediction_class: string;
  discrepancy_reason: string;
  created_at: Date;
}

export interface DiscrepancyQueryParams {
  threshold?: number;
  min_confidence?: number;
  product_category?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export class DiscrepancyService {
  private static readonly ML_API_BASE_URL = process.env.ML_API_BASE_URL || 'http://localhost:8000';
  private static readonly DEFAULT_THRESHOLD = 0.7;
  private static readonly DEFAULT_MIN_CONFIDENCE = 0.6;

  /**
   * Call ML prediction service
   */
  static async callMLPrediction(claimData: MLPredictionRequest): Promise<MLPredictionResponse> {
    try {
      const response = await axios.post(
        `${this.ML_API_BASE_URL}/predict-success`,
        claimData,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10 second timeout
        }
      );

      return response.data;
    } catch (error) {
      console.error('ML API call failed:', error);
      
      // Return fallback prediction if ML service is unavailable
      return {
        success_probability: 0.5,
        confidence: 0.5,
        prediction_class: 'uncertain',
        uncertainty_score: 1.0
      };
    }
  }

  /**
   * Get claims predicted for reimbursement (discrepancies)
   */
  static async getDiscrepancies(userId: string, params: DiscrepancyQueryParams = {}): Promise<{
    discrepancies: DiscrepancyCase[];
    total: number;
    summary: {
      total_cases: number;
      high_probability_cases: number;
      total_potential_refund: number;
      avg_prediction: number;
    };
  }> {
    const {
      threshold = this.DEFAULT_THRESHOLD,
      min_confidence = this.DEFAULT_MIN_CONFIDENCE,
      product_category,
      date_from,
      date_to,
      limit = 10,
      offset = 0
    } = params;

    // Build query conditions
    let whereConditions = ['c.user_id = $1'];
    let queryParams = [userId];
    let paramIndex = 2;

    if (product_category) {
      whereConditions.push(`c.product_category = $${paramIndex}`);
      queryParams.push(product_category);
      paramIndex++;
    }

    if (date_from) {
      whereConditions.push(`c.created_at >= $${paramIndex}`);
      queryParams.push(date_from);
      paramIndex++;
    }

    if (date_to) {
      whereConditions.push(`c.created_at <= $${paramIndex}`);
      queryParams.push(date_to);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get all cases that need ML prediction or have existing predictions
    const casesResult = await db.query(
      `SELECT * FROM refund_engine_cases 
       WHERE ${whereClause}
       ORDER BY created_at DESC`,
      queryParams,
      userId
    );

    const cases = casesResult.rows;
    const discrepancies: DiscrepancyCase[] = [];

    // Process each case
    for (const caseData of cases) {
      let mlPrediction: MLPredictionResponse;

      // Use existing prediction if available and recent, otherwise call ML API
      if (caseData.ml_prediction && caseData.ml_confidence) {
        mlPrediction = {
          success_probability: caseData.ml_prediction,
          confidence: caseData.ml_confidence,
          prediction_class: caseData.ml_prediction > 0.5 ? 'likely_success' : 'likely_failure'
        };
      } else {
        // Call ML API for prediction
        mlPrediction = await this.callMLPrediction({
          claim_amount: caseData.claim_amount,
          customer_history_score: caseData.customer_history_score,
          product_category: caseData.product_category,
          days_since_purchase: caseData.days_since_purchase,
          claim_description: caseData.claim_description
        });

        // Update case with ML prediction
        await ClaimsService.updateMLPrediction(
          userId,
          caseData.id,
          mlPrediction.success_probability,
          mlPrediction.confidence
        );
      }

      // Check if this case meets discrepancy criteria
      if (mlPrediction.success_probability >= threshold && 
          mlPrediction.confidence >= min_confidence) {
        
        const discrepancyReason = this.generateDiscrepancyReason(caseData, mlPrediction);
        
        discrepancies.push({
          case_id: caseData.id,
          case_number: caseData.case_number,
          claim_amount: caseData.claim_amount,
          customer_history_score: caseData.customer_history_score,
          product_category: caseData.product_category,
          days_since_purchase: caseData.days_since_purchase,
          claim_description: caseData.claim_description,
          ml_prediction: mlPrediction.success_probability,
          ml_confidence: mlPrediction.confidence,
          prediction_class: mlPrediction.prediction_class,
          discrepancy_reason: discrepancyReason,
          created_at: caseData.created_at
        });
      }
    }

    // Apply pagination
    const total = discrepancies.length;
    const paginatedDiscrepancies = discrepancies.slice(offset, offset + limit);

    // Calculate summary
    const summary = {
      total_cases: cases.length,
      high_probability_cases: discrepancies.length,
      total_potential_refund: discrepancies.reduce((sum, d) => sum + d.claim_amount, 0),
      avg_prediction: discrepancies.length > 0 
        ? discrepancies.reduce((sum, d) => sum + d.ml_prediction, 0) / discrepancies.length 
        : 0
    };

    return {
      discrepancies: paginatedDiscrepancies,
      total,
      summary
    };
  }

  /**
   * Get discrepancy statistics
   */
  static async getDiscrepancyStats(userId: string): Promise<{
    total_discrepancies: number;
    total_potential_refund: number;
    avg_prediction: number;
    by_product_category: Record<string, { count: number; amount: number; avg_prediction: number }>;
    by_prediction_class: Record<string, number>;
  }> {
    const result = await db.query(
      `SELECT 
        COUNT(*) as total_discrepancies,
        COALESCE(SUM(claim_amount), 0) as total_potential_refund,
        COALESCE(AVG(ml_prediction), 0) as avg_prediction,
        product_category,
        COUNT(*) as category_count,
        COALESCE(SUM(claim_amount), 0) as category_amount,
        COALESCE(AVG(ml_prediction), 0) as category_avg_prediction
       FROM refund_engine_cases
       WHERE user_id = $1 
       AND ml_prediction >= $2 
       AND ml_confidence >= $3
       GROUP BY product_category`,
      [userId, this.DEFAULT_THRESHOLD, this.DEFAULT_MIN_CONFIDENCE],
      userId
    );

    const byProductCategory: Record<string, { count: number; amount: number; avg_prediction: number }> = {};
    let totalDiscrepancies = 0;
    let totalPotentialRefund = 0;
    let totalPrediction = 0;

    result.rows.forEach(row => {
      const category = row.product_category;
      const count = parseInt(row.category_count);
      const amount = parseFloat(row.category_amount);
      const avgPrediction = parseFloat(row.category_avg_prediction);

      byProductCategory[category] = { count, amount, avg_prediction: avgPrediction };
      totalDiscrepancies += count;
      totalPotentialRefund += amount;
      totalPrediction += avgPrediction * count;
    });

    // Get prediction class distribution
    const classResult = await db.query(
      `SELECT 
        CASE 
          WHEN ml_prediction >= 0.8 THEN 'very_high'
          WHEN ml_prediction >= 0.7 THEN 'high'
          WHEN ml_prediction >= 0.6 THEN 'medium'
          ELSE 'low'
        END as prediction_class,
        COUNT(*) as count
       FROM refund_engine_cases
       WHERE user_id = $1 
       AND ml_prediction >= $2 
       AND ml_confidence >= $3
       GROUP BY prediction_class`,
      [userId, this.DEFAULT_THRESHOLD, this.DEFAULT_MIN_CONFIDENCE],
      userId
    );

    const byPredictionClass: Record<string, number> = {};
    classResult.rows.forEach(row => {
      byPredictionClass[row.prediction_class] = parseInt(row.count);
    });

    return {
      total_discrepancies: totalDiscrepancies,
      total_potential_refund: totalPotentialRefund,
      avg_prediction: totalDiscrepancies > 0 ? totalPrediction / totalDiscrepancies : 0,
      by_product_category: byProductCategory,
      by_prediction_class: byPredictionClass
    };
  }

  /**
   * Batch predict discrepancies for multiple cases
   */
  static async batchPredictDiscrepancies(userId: string, caseIds: string[]): Promise<DiscrepancyCase[]> {
    const discrepancies: DiscrepancyCase[] = [];

    for (const caseId of caseIds) {
      const caseData = await ClaimsService.getClaimById(userId, caseId);
      if (!caseData) continue;

      const mlPrediction = await this.callMLPrediction({
        claim_amount: caseData.claim_amount,
        customer_history_score: caseData.customer_history_score,
        product_category: caseData.product_category,
        days_since_purchase: caseData.days_since_purchase,
        claim_description: caseData.claim_description
      });

      // Update case with ML prediction
      await ClaimsService.updateMLPrediction(
        userId,
        caseId,
        mlPrediction.success_probability,
        mlPrediction.confidence
      );

      // Check if it's a discrepancy
      if (mlPrediction.success_probability >= this.DEFAULT_THRESHOLD && 
          mlPrediction.confidence >= this.DEFAULT_MIN_CONFIDENCE) {
        
        const discrepancyReason = this.generateDiscrepancyReason(caseData, mlPrediction);
        
        discrepancies.push({
          case_id: caseData.id,
          case_number: caseData.case_number,
          claim_amount: caseData.claim_amount,
          customer_history_score: caseData.customer_history_score,
          product_category: caseData.product_category,
          days_since_purchase: caseData.days_since_purchase,
          claim_description: caseData.claim_description,
          ml_prediction: mlPrediction.success_probability,
          ml_confidence: mlPrediction.confidence,
          prediction_class: mlPrediction.prediction_class,
          discrepancy_reason: discrepancyReason,
          created_at: caseData.created_at
        });
      }
    }

    return discrepancies;
  }

  /**
   * Generate human-readable discrepancy reason
   */
  private static generateDiscrepancyReason(caseData: any, mlPrediction: MLPredictionResponse): string {
    const reasons: string[] = [];

    if (mlPrediction.success_probability >= 0.8) {
      reasons.push('Very high success probability');
    } else if (mlPrediction.success_probability >= 0.7) {
      reasons.push('High success probability');
    }

    if (caseData.customer_history_score >= 0.8) {
      reasons.push('Excellent customer history');
    } else if (caseData.customer_history_score >= 0.6) {
      reasons.push('Good customer history');
    }

    if (caseData.days_since_purchase <= 30) {
      reasons.push('Recent purchase');
    }

    if (mlPrediction.confidence >= 0.8) {
      reasons.push('High confidence prediction');
    }

    if (reasons.length === 0) {
      reasons.push('Meets threshold criteria');
    }

    return reasons.join(', ');
  }

  /**
   * Test ML API connection
   */
  static async testMLConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.ML_API_BASE_URL}/health`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      console.error('ML API health check failed:', error);
      return false;
    }
  }
} 