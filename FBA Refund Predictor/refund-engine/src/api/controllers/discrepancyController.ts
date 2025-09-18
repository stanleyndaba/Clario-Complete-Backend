import { Request, Response } from 'express';
import { DiscrepancyService, DiscrepancyQueryParams } from '../services/discrepancyService';

export class DiscrepancyController {
  /**
   * Get claims predicted for reimbursement (discrepancies)
   * GET /api/v1/discrepancies
   */
  static async getDiscrepancies(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const queryParams: DiscrepancyQueryParams = {
        threshold: req.query.threshold ? parseFloat(req.query.threshold as string) : 0.7,
        min_confidence: req.query.min_confidence ? parseFloat(req.query.min_confidence as string) : 0.6,
        product_category: req.query.product_category as string,
        date_from: req.query.date_from as string,
        date_to: req.query.date_to as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0
      };

      const result = await DiscrepancyService.getDiscrepancies(req.user.id, queryParams);
      
      res.status(200).json({
        success: true,
        data: result.discrepancies,
        summary: result.summary,
        pagination: {
          total: result.total,
          limit: queryParams.limit,
          offset: queryParams.offset,
          has_more: result.total > (queryParams.offset || 0) + (queryParams.limit || 10)
        },
        filters: {
          threshold: queryParams.threshold,
          min_confidence: queryParams.min_confidence,
          product_category: queryParams.product_category,
          date_from: queryParams.date_from,
          date_to: queryParams.date_to
        }
      });
    } catch (error) {
      console.error('Error getting discrepancies:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve discrepancies'
      });
    }
  }

  /**
   * Get discrepancy statistics
   * GET /api/v1/discrepancies/stats
   */
  static async getDiscrepancyStats(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const stats = await DiscrepancyService.getDiscrepancyStats(req.user.id);
      
      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting discrepancy stats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve discrepancy statistics'
      });
    }
  }

  /**
   * Batch predict discrepancies for multiple cases
   * POST /api/v1/discrepancies/batch-predict
   */
  static async batchPredictDiscrepancies(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { case_ids } = req.body;
      
      if (!case_ids || !Array.isArray(case_ids) || case_ids.length === 0) {
        res.status(400).json({
          error: 'Invalid case IDs',
          message: 'case_ids must be a non-empty array of case IDs'
        });
        return;
      }

      const discrepancies = await DiscrepancyService.batchPredictDiscrepancies(req.user.id, case_ids);
      
      res.status(200).json({
        success: true,
        data: discrepancies,
        summary: {
          total_cases_processed: case_ids.length,
          discrepancies_found: discrepancies.length,
          total_potential_refund: discrepancies.reduce((sum, d) => sum + d.claim_amount, 0)
        }
      });
    } catch (error) {
      console.error('Error batch predicting discrepancies:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to batch predict discrepancies'
      });
    }
  }

  /**
   * Test ML API connection
   * GET /api/v1/discrepancies/ml-health
   */
  static async testMLConnection(req: Request, res: Response): Promise<void> {
    try {
      const isConnected = await DiscrepancyService.testMLConnection();
      
      res.status(200).json({
        success: true,
        data: {
          ml_api_connected: isConnected,
          ml_api_url: process.env.ML_API_BASE_URL || 'http://localhost:8000'
        }
      });
    } catch (error) {
      console.error('Error testing ML connection:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to test ML API connection'
      });
    }
  }

  /**
   * Get discrepancy analysis for a specific case
   * GET /api/v1/discrepancies/case/:caseId
   */
  static async getCaseDiscrepancyAnalysis(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { caseId } = req.params;
      
      // Get case data and ML prediction
      const { ClaimsService } = await import('../services/claimsService');
      const caseData = await ClaimsService.getClaimById(req.user.id, caseId);
      
      if (!caseData) {
        res.status(404).json({
          error: 'Case not found',
          message: 'The specified case does not exist or you do not have access to it'
        });
        return;
      }

      // Get ML prediction
      const mlPrediction = await DiscrepancyService.callMLPrediction({
        claim_amount: caseData.claim_amount,
        customer_history_score: caseData.customer_history_score,
        product_category: caseData.product_category,
        days_since_purchase: caseData.days_since_purchase,
        claim_description: caseData.claim_description
      });

      // Update case with ML prediction
      await ClaimsService.updateMLPrediction(
        req.user.id,
        caseId,
        mlPrediction.success_probability,
        mlPrediction.confidence
      );

      // Determine if it's a discrepancy
      const isDiscrepancy = mlPrediction.success_probability >= 0.7 && mlPrediction.confidence >= 0.6;
      
      const analysis = {
        case_id: caseId,
        case_number: caseData.case_number,
        claim_amount: caseData.claim_amount,
        ml_prediction: mlPrediction.success_probability,
        ml_confidence: mlPrediction.confidence,
        prediction_class: mlPrediction.prediction_class,
        is_discrepancy: isDiscrepancy,
        discrepancy_reason: isDiscrepancy ? 'Meets threshold criteria for high success probability' : 'Below threshold criteria',
        factors: {
          customer_history_score: caseData.customer_history_score,
          product_category: caseData.product_category,
          days_since_purchase: caseData.days_since_purchase,
          claim_description: caseData.claim_description
        },
        thresholds: {
          success_probability_threshold: 0.7,
          confidence_threshold: 0.6
        }
      };
      
      res.status(200).json({
        success: true,
        data: analysis
      });
    } catch (error) {
      console.error('Error getting case discrepancy analysis:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to analyze case discrepancy'
      });
    }
  }

  /**
   * Get discrepancy trends over time
   * GET /api/v1/discrepancies/trends
   */
  static async getDiscrepancyTrends(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { period = '30d' } = req.query;
      
      // Calculate date range based on period
      const now = new Date();
      let dateFrom: string;
      
      switch (period) {
        case '7d':
          dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case '30d':
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case '90d':
          dateFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
          break;
        default:
          dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      const result = await DiscrepancyService.getDiscrepancies(req.user.id, {
        date_from: dateFrom,
        limit: 1000 // Get all discrepancies in the period
      });

      // Group by date for trend analysis
      const trends = result.discrepancies.reduce((acc: any, discrepancy) => {
        const date = new Date(discrepancy.created_at).toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = {
            date,
            count: 0,
            total_amount: 0,
            avg_prediction: 0,
            predictions: []
          };
        }
        acc[date].count++;
        acc[date].total_amount += discrepancy.claim_amount;
        acc[date].predictions.push(discrepancy.ml_prediction);
        acc[date].avg_prediction = acc[date].predictions.reduce((sum: number, p: number) => sum + p, 0) / acc[date].predictions.length;
        return acc;
      }, {});

      const trendData = Object.values(trends).sort((a: any, b: any) => a.date.localeCompare(b.date));
      
      res.status(200).json({
        success: true,
        data: {
          period,
          date_from: dateFrom,
          date_to: now.toISOString(),
          trends: trendData,
          summary: {
            total_discrepancies: result.total,
            total_potential_refund: result.summary.total_potential_refund,
            avg_prediction: result.summary.avg_prediction
          }
        }
      });
    } catch (error) {
      console.error('Error getting discrepancy trends:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve discrepancy trends'
      });
    }
  }
} 