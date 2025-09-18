import { getLogger } from '../../../shared/utils/logger';
import { InventoryItem, Discrepancy, InventorySyncLog } from '../models/InventoryItem';
import { AmazonSPAPIService, AmazonInventoryItem } from './amazonSPAPIService';
import { ClaimDetectorIntegrationService, ClaimCalculationResult } from './claimDetectorIntegrationService';

const logger = getLogger('InventoryReconciliationService');

export interface ReconciliationRule {
  id: string;
  userId: string;
  ruleType: 'quantity_threshold' | 'price_threshold' | 'status_check' | 'auto_resolve';
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoResolve: boolean;
  enabled: boolean;
  conditions: {
    sourceSystem: string;
    targetSystem: string;
    field: string;
    operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains';
    value: any;
  }[];
}

export interface ReconciliationResult {
  success: boolean;
  itemsProcessed: number;
  itemsUpdated: number;
  itemsCreated: number;
  itemsDeleted: number;
  discrepanciesFound: number;
  discrepanciesResolved: number;
  errors: string[];
  metadata: {
    syncDuration: number;
    lastSyncTimestamp: Date;
    sourceSystems: string[];
    reconciliationRules: string[];
  };
}

export interface DiscrepancyAnalysis {
  sku: string;
  discrepancyType: 'quantity' | 'price' | 'status' | 'metadata';
  sourceSystem: string;
  sourceValue: any;
  targetSystem: string;
  targetValue: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-1, how confident we are in this discrepancy
  suggestedAction: 'investigate' | 'auto_resolve' | 'ignore' | 'escalate';
  metadata: {
    lastSyncTime: Date;
    historicalDrift: number;
    impactScore: number;
  };
}

export class InventoryReconciliationService {
  private reconciliationRules: Map<string, ReconciliationRule[]> = new Map();
  private claimDetectorService: ClaimDetectorIntegrationService | null = null;
  private defaultRules: ReconciliationRule[] = [
    {
      id: 'default-quantity-threshold',
      userId: 'global',
      ruleType: 'quantity_threshold',
      threshold: 1,
      severity: 'low',
      autoResolve: true,
      enabled: true,
      conditions: [
        {
          sourceSystem: 'amazon',
          targetSystem: 'internal',
          field: 'quantity_available',
          operator: 'greater_than',
          value: 0,
        },
      ],
    },
    {
      id: 'default-critical-stockout',
      userId: 'global',
      ruleType: 'quantity_threshold',
      threshold: 0,
      severity: 'critical',
      autoResolve: false,
      enabled: true,
      conditions: [
        {
          sourceSystem: 'amazon',
          targetSystem: 'internal',
          field: 'quantity_available',
          operator: 'equals',
          value: 0,
        },
      ],
    },
  ];

  constructor() {
    this.initializeDefaultRules();
    this.initializeClaimDetector();
  }

  private initializeDefaultRules(): void {
    this.reconciliationRules.set('global', this.defaultRules);
  }

  private initializeClaimDetector(): void {
    try {
      // Initialize Claim Detector integration if configured
      const claimDetectorUrl = process.env.CLAIM_DETECTOR_URL;
      if (claimDetectorUrl) {
        this.claimDetectorService = new ClaimDetectorIntegrationService({
          baseUrl: claimDetectorUrl,
          apiKey: process.env.CLAIM_DETECTOR_API_KEY,
          timeout: parseInt(process.env.CLAIM_DETECTOR_TIMEOUT || '30000'),
          retryAttempts: parseInt(process.env.CLAIM_DETECTOR_RETRY_ATTEMPTS || '3'),
          retryDelay: parseInt(process.env.CLAIM_DETECTOR_RETRY_DELAY || '5000'),
          batchSize: parseInt(process.env.CLAIM_DETECTOR_BATCH_SIZE || '10'),
          confidenceThreshold: parseFloat(process.env.CLAIM_DETECTOR_CONFIDENCE_THRESHOLD || '0.7'),
          autoSubmissionEnabled: process.env.CLAIM_DETECTOR_AUTO_SUBMISSION === 'true',
        });
        logger.info('Claim Detector integration initialized successfully');
      } else {
        logger.info('Claim Detector integration not configured, skipping initialization');
      }
    } catch (error) {
      logger.warn('Failed to initialize Claim Detector integration:', error);
    }
  }

  async addReconciliationRule(userId: string, rule: Omit<ReconciliationRule, 'id'>): Promise<ReconciliationRule> {
    const userRules = this.reconciliationRules.get(userId) || [];
    const newRule: ReconciliationRule = {
      ...rule,
      id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
    
    userRules.push(newRule);
    this.reconciliationRules.set(userId, userRules);
    
    logger.info(`Added reconciliation rule for user ${userId}: ${newRule.id}`);
    return newRule;
  }

  async getReconciliationRules(userId: string): Promise<ReconciliationRule[]> {
    const userRules = this.reconciliationRules.get(userId) || [];
    const globalRules = this.reconciliationRules.get('global') || [];
    
    return [...globalRules, ...userRules].filter(rule => rule.enabled);
  }

  async reconcileInventory(
    userId: string,
    sourceSystem: string,
    sourceData: any[],
    targetSystem: string = 'internal'
  ): Promise<ReconciliationResult> {
    const startTime = Date.now();
    logger.info(`Starting inventory reconciliation for user ${userId} from ${sourceSystem} to ${targetSystem}`);

    try {
      // Create sync log
      const syncLog = await InventorySyncLog.create({
        user_id: userId,
        provider: sourceSystem as any,
        sync_type: 'full',
        status: 'running',
        items_processed: 0,
        items_updated: 0,
        items_created: 0,
        items_deleted: 0,
        discrepancies_found: 0,
        started_at: new Date(),
      });

      let itemsProcessed = 0;
      let itemsUpdated = 0;
      let itemsCreated = 0;
      let itemsDeleted = 0;
      let discrepanciesFound = 0;
      let discrepanciesResolved = 0;
      const errors: string[] = [];
      const collectedDiscrepancies: DiscrepancyAnalysis[] = [];

      // Get existing inventory items
      const existingItems = await InventoryItem.findByUserId(userId);
      const existingItemsMap = new Map(existingItems.map(item => [item.sku, item]));

      // Process each source item
      for (const sourceItem of sourceData) {
        try {
          itemsProcessed++;
          
          const existingItem = existingItemsMap.get(sourceItem.sku);
          const reconciliationResult = await this.reconcileItem(
            userId,
            sourceItem,
            existingItem,
            sourceSystem,
            targetSystem
          );

          if (reconciliationResult.action === 'created') {
            itemsCreated++;
          } else if (reconciliationResult.action === 'updated') {
            itemsUpdated++;
          }

          if (reconciliationResult.discrepancy) {
            discrepanciesFound++;
            collectedDiscrepancies.push(reconciliationResult.discrepancy);
            await this.recordDiscrepancy(userId, reconciliationResult.discrepancy);
            
            // Check if we should auto-resolve
            if (await this.shouldAutoResolve(userId, reconciliationResult.discrepancy)) {
              await this.autoResolveDiscrepancy(reconciliationResult.discrepancy);
              discrepanciesResolved++;
            }
          }

          // Update sync log progress
          await syncLog.complete('running', {
            items_processed: itemsProcessed,
            items_updated: itemsUpdated,
            items_created: itemsCreated,
            items_deleted: itemsDeleted,
            discrepancies_found: discrepanciesFound,
          });

        } catch (error) {
          const errorMsg = `Error processing item ${sourceItem.sku}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          logger.error(errorMsg, error);
        }
      }

      // Check for items that exist in target but not in source (potential deletions)
      const sourceSkus = new Set(sourceData.map(item => item.sku));
      for (const existingItem of existingItems) {
        if (!sourceSkus.has(existingItem.sku)) {
          // Item exists in target but not in source - mark as inactive
          await existingItem.update({ is_active: false });
          itemsDeleted++;
        }
      }

      // Complete sync log
      await syncLog.complete('completed', {
        items_processed: itemsProcessed,
        items_updated: itemsUpdated,
        items_created: itemsCreated,
        items_deleted: itemsDeleted,
        discrepancies_found: discrepanciesFound,
      });

      // Automatically trigger claim detection if Claim Detector is available
      let claimResults: ClaimCalculationResult[] = [];
      let triggeredClaims = 0;
      if (this.claimDetectorService && discrepanciesFound > 0) {
        try {
          logger.info(`Triggering automatic claim detection for user ${userId} with ${discrepanciesFound} discrepancies`);
          
          const claimDetectionResult = await this.claimDetectorService.triggerClaimDetection(
            userId,
            {
              success: true,
              itemsProcessed,
              itemsUpdated,
              itemsCreated,
              itemsDeleted,
              discrepanciesFound,
              discrepanciesResolved,
              errors,
              metadata: {
                syncDuration: Date.now() - startTime,
                lastSyncTimestamp: new Date(),
                sourceSystems: [sourceSystem],
                reconciliationRules: (await this.getReconciliationRules(userId)).map(r => r.id),
              },
            },
            collectedDiscrepancies,
            `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          );
          
          triggeredClaims = claimDetectionResult.triggeredClaims;
          claimResults = claimDetectionResult.claimResults;
          
          logger.info(`Claim detection completed: ${triggeredClaims} claims triggered for user ${userId}`);
          
        } catch (error) {
          logger.error(`Failed to trigger claim detection for user ${userId}:`, error);
          // Don't fail the reconciliation if claim detection fails
        }
      }

      const syncDuration = Date.now() - startTime;
      logger.info(`Inventory reconciliation completed for user ${userId} in ${syncDuration}ms with ${triggeredClaims} claims triggered`);

      return {
        success: true,
        itemsProcessed,
        itemsUpdated,
        itemsCreated,
        itemsDeleted,
        discrepanciesFound,
        discrepanciesResolved,
        errors,
        metadata: {
          syncDuration,
          lastSyncTimestamp: new Date(),
          sourceSystems: [sourceSystem],
          reconciliationRules: (await this.getReconciliationRules(userId)).map(r => r.id),
        },
      };

    } catch (error) {
      logger.error(`Inventory reconciliation failed for user ${userId}:`, error);
      
      // Update sync log with failure
      if (syncLog) {
        await syncLog.complete('failed', {
          error_message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      return {
        success: false,
        itemsProcessed: 0,
        itemsUpdated: 0,
        itemsCreated: 0,
        itemsDeleted: 0,
        discrepanciesFound: 0,
        discrepanciesResolved: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        metadata: {
          syncDuration: Date.now() - startTime,
          lastSyncTimestamp: new Date(),
          sourceSystems: [sourceSystem],
          reconciliationRules: [],
        },
      };
    }
  }

  private async reconcileItem(
    userId: string,
    sourceItem: any,
    existingItem: InventoryItem | undefined,
    sourceSystem: string,
    targetSystem: string
  ): Promise<{
    action: 'created' | 'updated' | 'no_change';
    discrepancy?: DiscrepancyAnalysis;
  }> {
    if (!existingItem) {
      // Create new item
      await InventoryItem.create({
        user_id: userId,
        sku: sourceItem.sku,
        title: sourceItem.title,
        quantity_available: sourceItem.quantity_available || sourceItem.quantity || 0,
        quantity_reserved: sourceItem.quantity_reserved || 0,
        quantity_shipped: sourceItem.quantity_shipped || 0,
        reorder_point: sourceItem.reorder_point || 10,
        reorder_quantity: sourceItem.reorder_quantity || 50,
        is_active: true,
        metadata: {
          source_system: sourceSystem,
          last_synced: new Date(),
          ...sourceItem.metadata,
        },
      });

      return { action: 'created' };
    }

    // Check for discrepancies
    const discrepancy = await this.analyzeDiscrepancy(
      userId,
      sourceItem,
      existingItem,
      sourceSystem,
      targetSystem
    );

    if (discrepancy && discrepancy.severity !== 'low') {
      // Update item with source data if discrepancy is significant
      await existingItem.update({
        quantity_available: sourceItem.quantity_available || sourceItem.quantity || existingItem.quantity_available,
        metadata: {
          ...existingItem.metadata,
          source_system: sourceSystem,
          last_synced: new Date(),
          last_discrepancy: discrepancy,
        },
      });

      return { action: 'updated', discrepancy };
    }

    // No significant discrepancy, just update metadata
    await existingItem.update({
      metadata: {
        ...existingItem.metadata,
        source_system: sourceSystem,
        last_synced: new Date(),
      },
    });

    return { action: 'no_change' };
  }

  private async analyzeDiscrepancy(
    userId: string,
    sourceItem: any,
    targetItem: InventoryItem,
    sourceSystem: string,
    targetSystem: string
  ): Promise<DiscrepancyAnalysis | null> {
    const sourceQuantity = sourceItem.quantity_available || sourceItem.quantity || 0;
    const targetQuantity = targetItem.quantity_available;
    const quantityDifference = Math.abs(sourceQuantity - targetQuantity);

    // Get reconciliation rules
    const rules = await this.getReconciliationRules(userId);
    const quantityRule = rules.find(r => r.ruleType === 'quantity_threshold');

    if (!quantityRule || quantityDifference <= quantityRule.threshold) {
      return null; // No significant discrepancy
    }

    // Calculate severity based on rules and difference
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (quantityDifference <= 5) severity = 'low';
    else if (quantityDifference <= 20) severity = 'medium';
    else if (quantityDifference <= 100) severity = 'high';
    else severity = 'critical';

    // Override with rule severity if higher
    if (this.getSeverityLevel(quantityRule.severity) > this.getSeverityLevel(severity)) {
      severity = quantityRule.severity;
    }

    // Calculate confidence based on historical data and source reliability
    const confidence = this.calculateConfidence(sourceSystem, quantityDifference, targetItem);

    // Determine suggested action
    let suggestedAction: 'investigate' | 'auto_resolve' | 'ignore' | 'escalate' = 'investigate';
    if (quantityRule.autoResolve && severity === 'low') {
      suggestedAction = 'auto_resolve';
    } else if (severity === 'critical') {
      suggestedAction = 'escalate';
    }

    return {
      sku: sourceItem.sku,
      discrepancyType: 'quantity',
      sourceSystem,
      sourceValue: sourceQuantity,
      targetSystem,
      targetValue: targetQuantity,
      severity,
      confidence,
      suggestedAction,
      metadata: {
        lastSyncTime: new Date(),
        historicalDrift: quantityDifference,
        impactScore: this.calculateImpactScore(severity, quantityDifference, targetItem),
      },
    };
  }

  private getSeverityLevel(severity: string): number {
    const levels = { low: 1, medium: 2, high: 3, critical: 4 };
    return levels[severity as keyof typeof levels] || 1;
  }

  private calculateConfidence(sourceSystem: string, quantityDifference: number, targetItem: InventoryItem): number {
    // Base confidence on source system reliability
    let confidence = 0.8; // Default confidence
    
    if (sourceSystem === 'amazon') {
      confidence = 0.95; // Amazon is highly reliable
    } else if (sourceSystem === 'manual') {
      confidence = 0.7; // Manual entry has lower confidence
    }

    // Adjust based on quantity difference magnitude
    if (quantityDifference > 100) {
      confidence *= 0.9; // Large differences might indicate data issues
    }

    // Adjust based on item history
    if (targetItem.metadata?.last_discrepancy) {
      confidence *= 0.95; // Previous discrepancies reduce confidence
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  private calculateImpactScore(severity: string, quantityDifference: number, targetItem: InventoryItem): number {
    let impactScore = 0;
    
    // Base impact on severity
    switch (severity) {
      case 'low': impactScore = 1; break;
      case 'medium': impactScore = 3; break;
      case 'high': impactScore = 7; break;
      case 'critical': impactScore = 10; break;
    }

    // Adjust based on quantity difference
    impactScore += Math.min(5, quantityDifference / 20);

    // Adjust based on item value (if available)
    if (targetItem.selling_price) {
      impactScore += Math.min(3, (targetItem.selling_price * quantityDifference) / 1000);
    }

    return Math.min(10, impactScore);
  }

  private async recordDiscrepancy(userId: string, discrepancy: DiscrepancyAnalysis): Promise<void> {
    try {
      await Discrepancy.create({
        user_id: userId,
        sku: discrepancy.sku,
        discrepancy_type: discrepancy.discrepancy_type,
        source_system: discrepancy.sourceSystem,
        source_value: JSON.stringify(discrepancy.sourceValue),
        target_system: discrepancy.targetSystem,
        target_value: JSON.stringify(discrepancy.targetValue),
        severity: discrepancy.severity,
        status: 'open',
        notes: `Auto-detected during sync. Confidence: ${Math.round(discrepancy.confidence * 100)}%, Impact Score: ${discrepancy.metadata.impactScore.toFixed(1)}`,
      });

      logger.info(`Recorded discrepancy for SKU ${discrepancy.sku}: ${discrepancy.severity} severity`);
    } catch (error) {
      logger.error(`Failed to record discrepancy for SKU ${discrepancy.sku}:`, error);
    }
  }

  private async shouldAutoResolve(userId: string, discrepancy: DiscrepancyAnalysis): Promise<boolean> {
    const rules = await this.getReconciliationRules(userId);
    const autoResolveRule = rules.find(r => 
      r.ruleType === 'auto_resolve' && 
      r.enabled && 
      r.conditions.some(c => c.sourceSystem === discrepancy.sourceSystem)
    );

    return autoResolveRule?.autoResolve === true && discrepancy.severity === 'low';
  }

  private async autoResolveDiscrepancy(discrepancy: DiscrepancyAnalysis): Promise<void> {
    try {
      // Find the discrepancy record
      const discrepancies = await Discrepancy.findBySku(discrepancy.sku, discrepancy.user_id);
      const latestDiscrepancy = discrepancies[0];
      
      if (latestDiscrepancy) {
        await latestDiscrepancy.resolve('Auto-resolved by system based on reconciliation rules');
        logger.info(`Auto-resolved discrepancy for SKU ${discrepancy.sku}`);
      }
    } catch (error) {
      logger.error(`Failed to auto-resolve discrepancy for SKU ${discrepancy.sku}:`, error);
    }
  }

  async getDiscrepancySummary(userId: string): Promise<{
    total: number;
    bySeverity: { [key: string]: number };
    byStatus: { [key: string]: number };
    recentDiscrepancies: DiscrepancyAnalysis[];
    claimSummary?: {
      totalClaims: number;
      totalPotentialRecovery: number;
      claimsByStatus: { [key: string]: number };
      claimsByType: { [key: string]: number };
      averageConfidence: number;
      estimatedTotalPayout: number;
    };
  }> {
    try {
      const discrepancies = await Discrepancy.findByUserId(userId);
      
      const bySeverity: { [key: string]: number } = {};
      const byStatus: { [key: string]: number } = {};
      
      discrepancies.forEach(d => {
        bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
        byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      });

      // Get recent discrepancies (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentDiscrepancies = discrepancies
        .filter(d => d.created_at > sevenDaysAgo)
        .slice(0, 10); // Limit to 10 most recent

      // Get claim summary if Claim Detector is available
      let claimSummary;
      if (this.claimDetectorService) {
        try {
          claimSummary = await this.claimDetectorService.getClaimSummary(userId);
        } catch (error) {
          logger.warn(`Failed to get claim summary for user ${userId}:`, error);
        }
      }

      return {
        total: discrepancies.length,
        bySeverity,
        byStatus,
        recentDiscrepancies: recentDiscrepancies.map(d => ({
          sku: d.sku || 'Unknown',
          discrepancyType: d.discrepancy_type,
          sourceSystem: d.source_system,
          sourceValue: JSON.parse(d.source_value),
          targetSystem: d.target_system,
          targetValue: JSON.parse(d.target_value),
          severity: d.severity,
          confidence: 0.8, // Default confidence for historical data
          suggestedAction: 'investigate',
          metadata: {
            lastSyncTime: d.created_at,
            historicalDrift: 0,
            impactScore: 0,
          },
        })),
        claimSummary,
      };
    } catch (error) {
      logger.error(`Failed to get discrepancy summary for user ${userId}:`, error);
      return {
        total: 0,
        bySeverity: {},
        byStatus: {},
        recentDiscrepancies: [],
      };
    }
  }

  /**
   * Manually trigger claim detection for a user
   */
  async triggerManualClaimDetection(userId: string): Promise<{
    success: boolean;
    triggeredClaims: number;
    claimResults: ClaimCalculationResult[];
    errors: string[];
  }> {
    if (!this.claimDetectorService) {
      return {
        success: false,
        triggeredClaims: 0,
        claimResults: [],
        errors: ['Claim Detector integration not available'],
      };
    }

    try {
      // Get recent discrepancies for the user
      const discrepancies = await Discrepancy.findByUserId(userId, 'open');
      
      if (discrepancies.length === 0) {
        return {
          success: true,
          triggeredClaims: 0,
          claimResults: [],
          errors: [],
        };
      }

      // Convert discrepancies to DiscrepancyAnalysis format
      const discrepancyAnalyses: DiscrepancyAnalysis[] = discrepancies.map(d => ({
        sku: d.sku || 'Unknown',
        discrepancyType: d.discrepancy_type,
        sourceSystem: d.source_system,
        sourceValue: JSON.parse(d.source_value),
        targetSystem: d.target_system,
        targetValue: JSON.parse(d.target_value),
        severity: d.severity,
        confidence: 0.8, // Default confidence for historical data
        suggestedAction: 'investigate',
        metadata: {
          lastSyncTime: d.created_at,
          historicalDrift: 0,
          impactScore: 0,
        },
      }));

      const syncJobId = `manual-claim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const result = await this.claimDetectorService.triggerClaimDetection(
        userId,
        {
          success: true,
          itemsProcessed: 0,
          itemsUpdated: 0,
          itemsCreated: 0,
          itemsDeleted: 0,
          discrepanciesFound: discrepancies.length,
          discrepanciesResolved: 0,
          errors: [],
          metadata: {
            syncDuration: 0,
            lastSyncTimestamp: new Date(),
            sourceSystems: ['manual'],
            reconciliationRules: [],
          },
        },
        discrepancyAnalyses,
        syncJobId
      );

      return {
        success: true,
        ...result,
      };

    } catch (error) {
      const errorMsg = `Manual claim detection failed for user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logger.error(errorMsg, error);
      
      return {
        success: false,
        triggeredClaims: 0,
        claimResults: [],
        errors: [errorMsg],
      };
    }
  }

  /**
   * Get claim detection health status
   */
  async getClaimDetectionHealth(): Promise<{
    available: boolean;
    status: string;
    lastProcessed: Date | null;
    queueSize: number;
    cacheSize: number;
  }> {
    if (!this.claimDetectorService) {
      return {
        available: false,
        status: 'not_configured',
        lastProcessed: null,
        queueSize: 0,
        cacheSize: 0,
      };
    }

    try {
      const health = await this.claimDetectorService.healthCheck();
      return {
        available: true,
        status: health.status,
        lastProcessed: health.lastProcessed,
        queueSize: health.queueSize,
        cacheSize: health.cacheSize,
      };
    } catch (error) {
      logger.error('Failed to get claim detection health:', error);
      return {
        available: true,
        status: 'error',
        lastProcessed: null,
        queueSize: 0,
        cacheSize: 0,
      };
    }
  }
}
