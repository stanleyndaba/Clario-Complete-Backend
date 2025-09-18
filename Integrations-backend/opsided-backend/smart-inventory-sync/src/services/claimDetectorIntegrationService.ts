import { getLogger } from '../../../shared/utils/logger';
import { DiscrepancyAnalysis, ReconciliationResult } from './inventoryReconciliationService';
import { InventoryItem } from '../models/InventoryItem';
import { getDatabase } from '../../../shared/db/connection';
import axios, { AxiosInstance } from 'axios';
import notificationService from '../../../shared/notifications/services/notification.service';

const logger = getLogger('ClaimDetectorIntegrationService');

export interface ClaimCalculationRequest {
  userId: string;
  discrepancyId: string;
  sku: string;
  discrepancyType: 'quantity' | 'price' | 'status' | 'metadata';
  sourceSystem: string;
  sourceValue: any;
  targetSystem: string;
  targetValue: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  historicalData: {
    lastSyncTime: Date;
    historicalDrift: number;
    impactScore: number;
    previousClaims?: ClaimSummary[];
  };
  inventoryContext: {
    currentQuantity: number;
    reorderPoint: number;
    sellingPrice?: number;
    costPrice?: number;
    asin?: string;
    marketplaceId?: string;
  };
  metadata: {
    syncJobId: string;
    reconciliationRuleId: string;
    sourceTimestamp: Date;
  };
}

export interface ClaimCalculationResult {
  claimId: string;
  userId: string;
  sku: string;
  discrepancyId: string;
  claimType: 'missing_units' | 'overcharge' | 'damage' | 'delayed_shipment' | 'other';
  claimAmount: number;
  currency: string;
  confidence: number;
  evidence: {
    discrepancyDetails: DiscrepancyAnalysis;
    inventorySnapshot: any;
    historicalClaims: ClaimSummary[];
    calculatedValue: {
      amazonDefault: number;
      opsideTrueValue: number;
      netGain: number;
      proof: any;
    };
  };
  status: 'pending' | 'validated' | 'submitted' | 'approved' | 'rejected';
  estimatedPayoutTime: Date;
  riskAssessment: {
    riskLevel: 'low' | 'medium' | 'high';
    riskFactors: string[];
    mitigationSteps: string[];
  };
  auditTrail: {
    createdAt: Date;
    processedAt: Date;
    updatedAt: Date;
    processedBy: string;
  };
}

export interface ClaimSummary {
  claimId: string;
  sku: string;
  claimAmount: number;
  status: string;
  submittedAt: Date;
  resolvedAt?: Date;
  payoutAmount?: number;
}

export interface ClaimDetectorConfig {
  baseUrl: string;
  apiKey?: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  batchSize: number;
  confidenceThreshold: number;
  autoSubmissionEnabled: boolean;
}

export class ClaimDetectorIntegrationService {
  private httpClient: AxiosInstance;
  private config: ClaimDetectorConfig;
  private processingQueue: Map<string, ClaimCalculationRequest> = new Map();
  private resultsCache: Map<string, ClaimCalculationResult> = new Map();
  private refundEngineClient?: AxiosInstance;
  private mcdeClient?: AxiosInstance;

  constructor(config: ClaimDetectorConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Smart-Inventory-Sync-Claim-Integration/1.0.0',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` }),
      },
    });

    // Add response interceptor for error handling
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        logger.error('Claim Detector API error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );

    // Optional Refund Engine client
    const refundEngineUrl = process.env.REFUND_ENGINE_URL;
    if (refundEngineUrl) {
      this.refundEngineClient = axios.create({
        baseURL: refundEngineUrl,
        timeout: parseInt(process.env.REFUND_ENGINE_TIMEOUT || '30000'),
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.REFUND_ENGINE_API_KEY && { 'Authorization': `Bearer ${process.env.REFUND_ENGINE_API_KEY}` }),
        },
      });
    }

    // Optional MCDE client
    const mcdeUrl = process.env.MCDE_BASE_URL;
    if (mcdeUrl) {
      this.mcdeClient = axios.create({
        baseURL: mcdeUrl,
        timeout: parseInt(process.env.MCDE_TIMEOUT || '30000'),
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.MCDE_API_KEY && { 'Authorization': `Bearer ${process.env.MCDE_API_KEY}` }),
        },
      });
    }
  }

  /**
   * Automatically trigger claim detection after successful inventory reconciliation
   */
  async triggerClaimDetection(
    userId: string,
    reconciliationResult: ReconciliationResult,
    discrepancies: DiscrepancyAnalysis[],
    syncJobId: string
  ): Promise<{
    triggeredClaims: number;
    claimResults: ClaimCalculationResult[];
    errors: string[];
  }> {
    const startTime = Date.now();
    logger.info(`Triggering claim detection for user ${userId} with ${discrepancies.length} discrepancies`);

    const claimResults: ClaimCalculationResult[] = [];
    const errors: string[] = [];
    let triggeredClaims = 0;

    try {
      // Filter discrepancies that meet confidence threshold
      const validDiscrepancies = discrepancies.filter(
        d => d.confidence >= this.config.confidenceThreshold
      );

      logger.info(`Processing ${validDiscrepancies.length} valid discrepancies for claim detection`);

      // Process discrepancies in batches
      for (let i = 0; i < validDiscrepancies.length; i += this.config.batchSize) {
        const batch = validDiscrepancies.slice(i, i + this.config.batchSize);
        
        try {
          const batchResults = await this.processDiscrepancyBatch(
            userId,
            batch,
            syncJobId
          );
          
          claimResults.push(...batchResults);
          triggeredClaims += batchResults.length;
          
        } catch (error) {
          const errorMsg = `Batch processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          logger.error(errorMsg, error);
        }
      }

      // Store results in cache and database
      await this.storeClaimResults(claimResults);

      const processingTime = Date.now() - startTime;
      logger.info(`Claim detection completed for user ${userId}: ${triggeredClaims} claims triggered in ${processingTime}ms`);

      return {
        triggeredClaims,
        claimResults,
        errors,
      };

    } catch (error) {
      const errorMsg = `Claim detection failed for user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      logger.error(errorMsg, error);
      
      return {
        triggeredClaims: 0,
        claimResults: [],
        errors,
      };
    }
  }

  /**
   * Process a batch of discrepancies for claim detection
   */
  private async processDiscrepancyBatch(
    userId: string,
    discrepancies: DiscrepancyAnalysis[],
    syncJobId: string
  ): Promise<ClaimCalculationResult[]> {
    const results: ClaimCalculationResult[] = [];

    for (const discrepancy of discrepancies) {
      try {
        // Get inventory context
        const inventoryContext = await this.getInventoryContext(userId, discrepancy.sku);
        
        // Get historical claims data
        const historicalClaims = await this.getHistoricalClaims(userId, discrepancy.sku);
        
        // Prepare claim calculation request
        const claimRequest: ClaimCalculationRequest = {
          userId,
          discrepancyId: `disc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          sku: discrepancy.sku,
          discrepancyType: discrepancy.discrepancyType,
          sourceSystem: discrepancy.sourceSystem,
          sourceValue: discrepancy.sourceValue,
          targetSystem: discrepancy.targetSystem,
          targetValue: discrepancy.targetValue,
          severity: discrepancy.severity,
          confidence: discrepancy.confidence,
          historicalData: {
            lastSyncTime: discrepancy.metadata.lastSyncTime,
            historicalDrift: discrepancy.metadata.historicalDrift,
            impactScore: discrepancy.metadata.impactScore,
            previousClaims: historicalClaims,
          },
          inventoryContext,
          metadata: {
            syncJobId,
            reconciliationRuleId: 'auto-triggered',
            sourceTimestamp: new Date(),
          },
        };

        // Calculate claim using Claim Detector
        const claimResult = await this.calculateClaim(claimRequest);

        // Generate proof document via MCDE if available
        if (this.mcdeClient) {
          try {
            const proofUrl = await this.generateProofDocument(claimResult.claimId, claimResult);
            (claimResult.evidence.calculatedValue.proof as any).document_url = proofUrl;
          } catch (mcdeErr) {
            logger.warn('MCDE proof generation failed', mcdeErr);
          }
        }
        results.push(claimResult);

        // Add to processing queue for tracking
        this.processingQueue.set(claimResult.claimId, claimRequest);

        // Fire notification for claim detected
        try {
          await notificationService.processEvent({
            type: 'claim_detected',
            userId,
            data: {
              claimId: claimResult.claimId,
              sku: claimResult.sku,
              amount: claimResult.claimAmount,
              confidence: claimResult.confidence,
              claimType: claimResult.claimType,
            },
            channels: ['inapp'],
            priority: 1,
          } as any);
        } catch (notifyErr) {
          logger.warn('Failed to send claim_detected notification', notifyErr);
        }

        // Auto-submit to Refund Engine if enabled
        if (this.config.autoSubmissionEnabled && this.refundEngineClient) {
          try {
            await this.submitToRefundEngine(userId, claimResult);
          } catch (submitErr) {
            logger.error('Auto-submission to Refund Engine failed', submitErr);
          }
        }

      } catch (error) {
        logger.error(`Failed to process discrepancy for SKU ${discrepancy.sku}:`, error);
        // Continue with other discrepancies
      }
    }

    return results;
  }

  /**
   * Calculate claim using the Claim Detector API
   */
  private async calculateClaim(request: ClaimCalculationRequest): Promise<ClaimCalculationResult> {
    try {
      logger.info(`Calculating claim for SKU ${request.sku} using Claim Detector`);

      // Call Claim Detector API
      const response = await this.httpClient.post('/evidence/claims/calculate', {
        discrepancy_data: request,
        inventory_context: request.inventoryContext,
        historical_data: request.historicalData,
      });

      const claimData = response.data;

      // Transform response to our format
      const claimResult: ClaimCalculationResult = {
        claimId: claimData.claim_id || `claim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: request.userId,
        sku: request.sku,
        discrepancyId: request.discrepancyId,
        claimType: this.determineClaimType(request.discrepancyType, request.sourceValue, request.targetValue),
        claimAmount: claimData.claim_amount || 0,
        currency: claimData.currency || 'USD',
        confidence: claimData.confidence || request.confidence,
        evidence: {
          discrepancyDetails: {
            sku: request.sku,
            discrepancyType: request.discrepancyType,
            sourceSystem: request.sourceSystem,
            sourceValue: request.sourceValue,
            targetSystem: request.targetSystem,
            targetValue: request.targetValue,
            severity: request.severity,
            confidence: request.confidence,
            suggestedAction: request.confidence > 0.8 ? 'auto_resolve' : 'investigate',
            metadata: request.historicalData,
          },
          inventorySnapshot: request.inventoryContext,
          historicalClaims: request.historicalData.previousClaims || [],
          calculatedValue: {
            amazonDefault: claimData.amazon_default_value || 0,
            opsideTrueValue: claimData.opside_true_value || 0,
            netGain: claimData.net_gain || 0,
            proof: claimData.proof || {},
          },
        },
        status: 'pending',
        estimatedPayoutTime: this.calculateEstimatedPayoutTime(request.severity, request.confidence),
        riskAssessment: {
          riskLevel: this.assessRiskLevel(request.severity, request.confidence),
          riskFactors: this.identifyRiskFactors(request),
          mitigationSteps: this.generateMitigationSteps(request),
        },
        auditTrail: {
          createdAt: new Date(),
          processedAt: new Date(),
          updatedAt: new Date(),
          processedBy: 'smart-inventory-sync',
        },
      };

      logger.info(`Claim calculated for SKU ${request.sku}: $${claimResult.claimAmount} (confidence: ${claimResult.confidence})`);
      return claimResult;

    } catch (error) {
      logger.error(`Claim calculation failed for SKU ${request.sku}:`, error);
      
      // Return a basic claim result with error status
      return {
        claimId: `claim-error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: request.userId,
        sku: request.sku,
        discrepancyId: request.discrepancyId,
        claimType: 'other',
        claimAmount: 0,
        currency: 'USD',
        confidence: 0,
        evidence: {
          discrepancyDetails: request as any,
          inventorySnapshot: request.inventoryContext,
          historicalClaims: [],
          calculatedValue: {
            amazonDefault: 0,
            opsideTrueValue: 0,
            netGain: 0,
            proof: { error: error instanceof Error ? error.message : 'Unknown error' },
          },
        },
        status: 'pending',
        estimatedPayoutTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        riskAssessment: {
          riskLevel: 'high',
          riskFactors: ['Calculation failed', 'Low confidence'],
          mitigationSteps: ['Manual review required', 'Verify discrepancy data'],
        },
        auditTrail: {
          createdAt: new Date(),
          processedAt: new Date(),
          updatedAt: new Date(),
          processedBy: 'smart-inventory-sync',
        },
      };
    }
  }

  /**
   * Call MCDE to generate a cost/proof document and return its URL
   */
  private async generateProofDocument(claimId: string, claim: ClaimCalculationResult): Promise<string | undefined> {
    if (!this.mcdeClient) return undefined;

    const costData = {
      estimated_cost: claim.evidence.calculatedValue.opsideTrueValue || 0,
      confidence: claim.confidence,
      cost_components: {
        material_cost: 0,
        labor_cost: 0,
        overhead_cost: 0,
        shipping_cost: 0,
        tax_cost: 0,
      },
    };

    const resp = await this.mcdeClient.post('/generate-document', {
      claim_id: claimId,
      cost_estimate: costData,
      document_type: 'cost_document',
    });

    if (resp.status >= 200 && resp.status < 300) {
      const url = resp.data?.document_url;
      // Notify proof generation
      try {
        await notificationService.processEvent({
          type: 'proof_generated',
          userId: claim.userId,
          data: { claimId, documentUrl: url },
          channels: ['inapp'],
        } as any);
      } catch {}
      return url;
    }

    throw new Error(`MCDE /generate-document failed with status ${resp.status}`);
  }

  /**
   * Submit a calculated claim to the Refund Engine service
   */
  private async submitToRefundEngine(userId: string, claim: ClaimCalculationResult): Promise<void> {
    if (!this.refundEngineClient) return;

    const payload = {
      case_number: `${claim.claimId}`,
      claim_amount: claim.claimAmount,
      customer_history_score: claim.riskAssessment.riskLevel === 'low' ? 0.9 : claim.riskAssessment.riskLevel === 'medium' ? 0.5 : 0.2,
      product_category: 'fba_reimbursement',
      days_since_purchase: 30,
      claim_description: `Auto-submitted ${claim.claimType} claim for SKU ${claim.sku}. Confidence ${Math.round(claim.confidence * 100)}%.`,
    };

    const response = await this.refundEngineClient.post('/api/v1/claims', payload, {
      headers: {
        // Propagate multi-tenant user if backend expects it via header
        'X-User-Id': userId,
      },
    });

    if (response.status >= 200 && response.status < 300) {
      logger.info('Submitted claim to Refund Engine', { claimId: claim.claimId, userId });

      // Notify submission event
      try {
        await notificationService.processEvent({
          type: 'claim_submitted',
          userId,
          data: { claimId: claim.claimId, amount: claim.claimAmount, sku: claim.sku },
          channels: ['inapp'],
          priority: 0,
        } as any);
      } catch {}
    } else {
      throw new Error(`Refund Engine create claim failed with status ${response.status}`);
    }
  }

  /**
   * Get inventory context for a SKU
   */
  private async getInventoryContext(userId: string, sku: string): Promise<any> {
    try {
      const db = getDatabase();
      
      // Get current inventory item
      const inventoryItem = await InventoryItem.findBySku(sku, userId);
      
      // Get recent inventory changes
      const recentChanges = await db('inventory_sync_logs')
        .where({ user_id: userId, provider: 'amazon' })
        .orderBy('started_at', 'desc')
        .limit(5);

      return {
        currentQuantity: inventoryItem?.quantity_available || 0,
        reorderPoint: inventoryItem?.reorder_point || 10,
        sellingPrice: inventoryItem?.selling_price || 0,
        costPrice: inventoryItem?.cost_price || 0,
        asin: inventoryItem?.metadata?.amazon_asin,
        marketplaceId: inventoryItem?.metadata?.amazon_marketplace_id,
        lastUpdated: inventoryItem?.updated_at,
        recentChanges: recentChanges.map(log => ({
          timestamp: log.started_at,
          itemsProcessed: log.items_processed,
          discrepanciesFound: log.discrepancies_found,
        })),
      };
    } catch (error) {
      logger.error(`Failed to get inventory context for SKU ${sku}:`, error);
      return {
        currentQuantity: 0,
        reorderPoint: 10,
        sellingPrice: 0,
        costPrice: 0,
        lastUpdated: new Date(),
        recentChanges: [],
      };
    }
  }

  /**
   * Get historical claims data for a SKU
   */
  private async getHistoricalClaims(userId: string, sku: string): Promise<ClaimSummary[]> {
    try {
      const db = getDatabase();
      
      // Query claims table (assuming it exists)
      const claims = await db('claims')
        .where({ user_id: userId, sku })
        .orderBy('submitted_at', 'desc')
        .limit(10);

      return claims.map(claim => ({
        claimId: claim.id,
        sku: claim.sku,
        claimAmount: claim.claim_amount,
        status: claim.status,
        submittedAt: claim.submitted_at,
        resolvedAt: claim.resolved_at,
        payoutAmount: claim.payout_amount,
      }));
    } catch (error) {
      logger.warn(`No historical claims found for SKU ${sku}:`, error);
      return [];
    }
  }

  /**
   * Determine claim type based on discrepancy
   */
  private determineClaimType(
    discrepancyType: string,
    sourceValue: any,
    targetValue: any
  ): 'missing_units' | 'overcharge' | 'damage' | 'delayed_shipment' | 'other' {
    if (discrepancyType === 'quantity') {
      const sourceQty = Number(sourceValue) || 0;
      const targetQty = Number(targetValue) || 0;
      
      if (sourceQty < targetQty) {
        return 'missing_units';
      } else if (sourceQty > targetQty) {
        return 'overcharge';
      }
    } else if (discrepancyType === 'status') {
      return 'damage';
    }
    
    return 'other';
  }

  /**
   * Calculate estimated payout time based on severity and confidence
   */
  private calculateEstimatedPayoutTime(severity: string, confidence: number): Date {
    const baseDays = {
      low: 7,
      medium: 14,
      high: 21,
      critical: 30,
    };

    const confidenceMultiplier = confidence > 0.9 ? 0.8 : confidence > 0.7 ? 1.0 : 1.2;
    const estimatedDays = Math.round(baseDays[severity as keyof typeof baseDays] * confidenceMultiplier);
    
    return new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Assess risk level for a claim
   */
  private assessRiskLevel(severity: string, confidence: number): 'low' | 'medium' | 'high' {
    if (severity === 'critical' || confidence < 0.6) return 'high';
    if (severity === 'high' || confidence < 0.8) return 'medium';
    return 'low';
  }

  /**
   * Identify risk factors for a claim
   */
  private identifyRiskFactors(request: ClaimCalculationRequest): string[] {
    const factors: string[] = [];
    
    if (request.confidence < 0.8) factors.push('Low confidence score');
    if (request.severity === 'critical') factors.push('Critical severity level');
    if (request.historicalData.historicalDrift > 100) factors.push('High historical drift');
    if (request.inventoryContext.currentQuantity === 0) factors.push('Zero inventory');
    
    return factors;
  }

  /**
   * Generate mitigation steps for a claim
   */
  private generateMitigationSteps(request: ClaimCalculationRequest): string[] {
    const steps: string[] = [];
    
    if (request.confidence < 0.8) {
      steps.push('Verify discrepancy data manually');
      steps.push('Check source system connectivity');
    }
    
    if (request.severity === 'critical') {
      steps.push('Immediate investigation required');
      steps.push('Notify operations team');
    }
    
    if (request.historicalData.historicalDrift > 100) {
      steps.push('Review historical patterns');
      steps.push('Check for systematic issues');
    }
    
    return steps;
  }

  /**
   * Store claim results in cache and database
   */
  private async storeClaimResults(results: ClaimCalculationResult[]): Promise<void> {
    try {
      // Store in cache
      results.forEach(result => {
        this.resultsCache.set(result.claimId, result);
      });

      // Store in database
      const db = getDatabase();
      
      for (const result of results) {
        await db('claim_calculations').insert({
          id: result.claimId,
          user_id: result.userId,
          sku: result.sku,
          discrepancy_id: result.discrepancyId,
          claim_type: result.claimType,
          claim_amount: result.claimAmount,
          currency: result.currency,
          confidence: result.confidence,
          status: result.status,
          estimated_payout_time: result.estimatedPayoutTime,
          evidence: JSON.stringify(result.evidence),
          risk_assessment: JSON.stringify(result.riskAssessment),
          audit_trail: JSON.stringify(result.auditTrail),
          created_at: result.auditTrail.createdAt,
          updated_at: result.auditTrail.updatedAt,
        });
      }

      logger.info(`Stored ${results.length} claim results in database`);
    } catch (error) {
      logger.error('Failed to store claim results:', error);
    }
  }

  /**
   * Get claim calculation results for a user
   */
  async getClaimResults(userId: string, limit: number = 50): Promise<ClaimCalculationResult[]> {
    try {
      const db = getDatabase();
      
      const results = await db('claim_calculations')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .limit(limit);

      return results.map(result => ({
        claimId: result.id,
        userId: result.user_id,
        sku: result.sku,
        discrepancyId: result.discrepancy_id,
        claimType: result.claim_type,
        claimAmount: result.claim_amount,
        currency: result.currency,
        confidence: result.confidence,
        status: result.status,
        estimatedPayoutTime: result.estimated_payout_time,
        evidence: JSON.parse(result.evidence),
        riskAssessment: JSON.parse(result.risk_assessment),
        auditTrail: JSON.parse(result.audit_trail),
      }));
    } catch (error) {
      logger.error(`Failed to get claim results for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get claim summary statistics for a user
   */
  async getClaimSummary(userId: string): Promise<{
    totalClaims: number;
    totalPotentialRecovery: number;
    claimsByStatus: { [key: string]: number };
    claimsByType: { [key: string]: number };
    averageConfidence: number;
    estimatedTotalPayout: number;
  }> {
    try {
      const results = await this.getClaimResults(userId, 1000);
      
      const totalClaims = results.length;
      const totalPotentialRecovery = results.reduce((sum, r) => sum + r.claimAmount, 0);
      const averageConfidence = results.length > 0 
        ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length 
        : 0;
      const estimatedTotalPayout = results
        .filter(r => r.status === 'approved')
        .reduce((sum, r) => sum + r.claimAmount, 0);

      const claimsByStatus: { [key: string]: number } = {};
      const claimsByType: { [key: string]: number } = {};

      results.forEach(result => {
        claimsByStatus[result.status] = (claimsByStatus[result.status] || 0) + 1;
        claimsByType[result.claimType] = (claimsByType[result.claimType] || 0) + 1;
      });

      return {
        totalClaims,
        totalPotentialRecovery,
        claimsByStatus,
        claimsByType,
        averageConfidence,
        estimatedTotalPayout,
      };
    } catch (error) {
      logger.error(`Failed to get claim summary for user ${userId}:`, error);
      return {
        totalClaims: 0,
        totalPotentialRecovery: 0,
        claimsByStatus: {},
        claimsByType: {},
        averageConfidence: 0,
        estimatedTotalPayout: 0,
      };
    }
  }

  /**
   * Health check for Claim Detector integration
   */
  async healthCheck(): Promise<{
    status: string;
    claimDetectorApi: boolean;
    database: boolean;
    lastProcessed: Date | null;
    queueSize: number;
    cacheSize: number;
  }> {
    try {
      // Check Claim Detector API
      const apiHealth = await this.httpClient.get('/health').catch(() => null);
      
      // Check database
      const db = getDatabase();
      const dbHealth = await db.raw('SELECT 1').catch(() => null);
      
      // Get last processed claim
      const lastProcessed = this.resultsCache.size > 0 
        ? Array.from(this.resultsCache.values())
            .sort((a, b) => b.auditTrail.processedAt.getTime() - a.auditTrail.processedAt.getTime())[0]
            ?.auditTrail.processedAt || null
        : null;

      return {
        status: apiHealth && dbHealth ? 'healthy' : 'degraded',
        claimDetectorApi: !!apiHealth,
        database: !!dbHealth,
        lastProcessed,
        queueSize: this.processingQueue.size,
        cacheSize: this.resultsCache.size,
      };
    } catch (error) {
      logger.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        claimDetectorApi: false,
        database: false,
        lastProcessed: null,
        queueSize: this.processingQueue.size,
        cacheSize: this.resultsCache.size,
      };
    }
  }
}

