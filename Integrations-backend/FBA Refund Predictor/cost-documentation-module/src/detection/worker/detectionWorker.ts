import { PrismaClient } from '@prisma/client';
import { DetectionJob, DetectionResult, RuleType } from '@prisma/client';
import { DetectionQueue } from '../queue/detectionQueue';
import { EvidenceBuilder } from '../evidence/evidenceBuilder';
import { ALL_RULES } from '../rules';
import { RuleInput, RuleContext, Threshold, WhitelistItem } from '../types';
import { S3Client } from '@aws-sdk/client-s3';

export interface WorkerConfig {
  maxConcurrency: number;
  pollIntervalMs: number;
  maxRetries: number;
}

export class DetectionWorker {
  private prisma: PrismaClient;
  private queue: DetectionQueue;
  private evidenceBuilder: EvidenceBuilder;
  private config: WorkerConfig;
  private isRunning: boolean = false;
  private activeWorkers: number = 0;

  constructor(
    prisma: PrismaClient,
    queue: DetectionQueue,
    evidenceBuilder: EvidenceBuilder,
    config: WorkerConfig
  ) {
    this.prisma = prisma;
    this.queue = queue;
    this.evidenceBuilder = evidenceBuilder;
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Detection worker is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting detection worker...');

    while (this.isRunning) {
      try {
        if (this.activeWorkers < this.config.maxConcurrency) {
          const job = await this.queue.getNextJob();
          
          if (job) {
            this.activeWorkers++;
            this.processJob(job).finally(() => {
              this.activeWorkers--;
            });
          } else {
            // No jobs available, wait before polling again
            await this.sleep(this.config.pollIntervalMs);
          }
        } else {
          // Max concurrency reached, wait before checking again
          await this.sleep(this.config.pollIntervalMs);
        }
      } catch (error) {
        console.error('Error in detection worker main loop:', error);
        await this.sleep(this.config.pollIntervalMs);
      }
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('Stopping detection worker...');
    
    // Wait for active workers to complete
    while (this.activeWorkers > 0) {
      await this.sleep(1000);
    }
    
    console.log('Detection worker stopped');
  }

  private async processJob(job: DetectionJob): Promise<void> {
    console.log(`Processing detection job: ${job.id} for seller ${job.sellerId}, sync ${job.syncId}`);

    try {
      // Fetch input data (this would come from your sync system)
      const inputData = await this.fetchInputData(job.sellerId, job.syncId);
      
      // Fetch thresholds and whitelist
      const [thresholds, whitelist] = await Promise.all([
        this.fetchThresholds(job.sellerId),
        this.fetchWhitelist(job.sellerId)
      ]);

      // Create rule context
      const context: RuleContext = {
        sellerId: job.sellerId,
        syncId: job.syncId,
        thresholds,
        whitelist
      };

      // Create rule input
      const ruleInput: RuleInput = {
        sellerId: job.sellerId,
        syncId: job.syncId,
        data: inputData
      };

      // Run all rules
      const allAnomalies: Array<{ anomaly: any; ruleType: RuleType }> = [];
      
      for (const rule of ALL_RULES) {
        try {
          const anomalies = rule.apply(ruleInput, context);
          allAnomalies.push(...anomalies.map(anomaly => ({ anomaly, ruleType: rule.ruleType })));
        } catch (error) {
          console.error(`Error applying rule ${rule.ruleType}:`, error);
        }
      }

      // Process anomalies and build evidence
      const results: DetectionResult[] = [];
      
      for (const { anomaly, ruleType } of allAnomalies) {
        try {
          // Check if result already exists (idempotency)
          const existingResult = await this.prisma.detectionResult.findUnique({
            where: {
              sellerId_ruleType_dedupeHash: {
                sellerId: job.sellerId,
                ruleType,
                dedupeHash: anomaly.dedupeHash
              }
            }
          });

          if (existingResult) {
            console.log(`Skipping duplicate result for ${ruleType} with hash ${anomaly.dedupeHash}`);
            continue;
          }

          // Build evidence
          const evidenceArtifact = await this.evidenceBuilder.buildEvidence(
            anomaly,
            job.sellerId,
            job.syncId,
            inputData,
            thresholds,
            whitelist
          );

          // Create detection result
          const result = await this.prisma.detectionResult.create({
            data: {
              sellerId: job.sellerId,
              syncId: job.syncId,
              ruleType,
              severity: anomaly.severity,
              score: anomaly.score,
              summary: anomaly.summary,
              evidenceJson: evidenceArtifact.evidenceJson,
              evidenceS3Url: evidenceArtifact.evidenceS3Url,
              dedupeHash: evidenceArtifact.dedupeHash,
              detectionJobId: job.id
            }
          });

          results.push(result);
          console.log(`Created detection result: ${result.id} for ${ruleType}`);
        } catch (error) {
          console.error(`Error processing anomaly for ${ruleType}:`, error);
        }
      }

      // Mark job as completed
      await this.queue.markJobCompleted(job.id);
      console.log(`Detection job ${job.id} completed successfully with ${results.length} results`);

    } catch (error) {
      console.error(`Error processing detection job ${job.id}:`, error);
      
      // Check if we should retry
      if (job.attempts < this.config.maxRetries) {
        await this.queue.markJobFailed(job.id, error.message);
        console.log(`Job ${job.id} marked for retry (attempt ${job.attempts + 1}/${this.config.maxRetries})`);
      } else {
        await this.queue.markJobFailed(job.id, `Max retries exceeded: ${error.message}`);
        console.log(`Job ${job.id} failed permanently after ${this.config.maxRetries} attempts`);
      }
    }
  }

  private async fetchInputData(sellerId: string, syncId: string): Promise<Record<string, any>> {
    // This would integrate with your existing sync system
    // For now, return mock data structure
    return {
      inventory: [
        {
          sku: 'SKU001',
          asin: 'B001234567',
          units: 5,
          value: 25.0,
          vendor: 'Vendor A'
        }
      ],
      totalUnits: 100,
      totalValue: 1000.0,
      fees: [
        {
          feeType: 'FBA_FEE',
          amount: 15.0,
          sku: 'SKU001',
          asin: 'B001234567',
          vendor: 'Vendor A',
          shipmentId: 'SHIP001'
        }
      ],
      expectedFees: {
        FBA_FEE: 12.0
      },
      totalRevenue: 2000.0,
      damagedStock: [
        {
          sku: 'SKU002',
          asin: 'B001234568',
          units: 2,
          value: 10.0,
          vendor: 'Vendor B',
          damageType: 'DAMAGED',
          damageReason: 'Shipping damage'
        }
      ],
      totalInventory: 100,
      totalInventoryValue: 1000.0
    };
  }

  private async fetchThresholds(sellerId: string): Promise<Threshold[]> {
    const thresholds = await this.prisma.detectionThreshold.findMany({
      where: {
        OR: [
          { sellerId: null }, // Global thresholds
          { sellerId } // Seller-specific thresholds
        ],
        active: true
      }
    });

    return thresholds.map(t => ({
      id: t.id,
      sellerId: t.sellerId,
      ruleType: t.ruleType,
      operator: t.operator,
      value: Number(t.value),
      active: t.active
    }));
  }

  private async fetchWhitelist(sellerId: string): Promise<WhitelistItem[]> {
    const whitelist = await this.prisma.detectionWhitelist.findMany({
      where: {
        sellerId,
        active: true
      }
    });

    return whitelist.map(w => ({
      id: w.id,
      sellerId: w.sellerId,
      scope: w.scope,
      value: w.value,
      reason: w.reason,
      active: w.active
    }));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

