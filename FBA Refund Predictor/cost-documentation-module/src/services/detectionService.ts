import { PrismaClient } from '@prisma/client';
import { S3Service } from './s3Service';
import { logger } from '../utils/logger';

export interface DetectionJob {
  id: string;
  claimId: string;
  userId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  attemptCount: number;
  maxAttempts: number;
  failureReason?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DetectionResult {
  id: string;
  detectionJobId: string;
  costDocId: string;
  skuId: string;
  anomalyType: 'LOST_UNITS' | 'OVERCHARGED_FEES' | 'DAMAGED_STOCK' | 'DUPLICATE_CHARGES' | 'INVALID_SHIPPING' | 'PRICING_DISCREPANCY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  evidenceUrl: string;
  evidenceJson: any;
  thresholdValue: number;
  actualValue: number;
  isWhitelisted: boolean;
  createdAt: Date;
}

export interface AnomalyEvidence {
  sync_id: string;
  seller_id: string;
  detected_anomalies: Array<{
    event_type: string;
    item_id: string;
    amount_discrepancy: number;
    evidence_refs: string[];
  }>;
  metadata: {
    source_tables: string[];
    detection_version: string;
    thresholds_applied: Record<string, number>;
    whitelist_checks: Record<string, boolean>;
  };
  created_at: string;
}

export interface DetectionThreshold {
  id: string;
  anomalyType: string;
  threshold: number;
  operator: 'GREATER_THAN' | 'LESS_THAN' | 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN_OR_EQUAL';
  isActive: boolean;
  description?: string;
}

export interface DetectionWhitelist {
  id: string;
  skuCode?: string;
  vendorName?: string;
  accountId?: string;
  reason?: string;
  isActive: boolean;
  createdBy: string;
}

export class DetectionService {
  private prisma: PrismaClient;
  private s3Service: S3Service;
  private isProcessing: boolean = false;
  private processingInterval?: NodeJS.Timeout;

  constructor(prisma: PrismaClient, s3Service: S3Service) {
    this.prisma = prisma;
    this.s3Service = s3Service;
  }

  /**
   * Enqueue a detection job for a claim
   */
  async enqueueDetectionJob(claimId: string, userId: string, priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'): Promise<DetectionJob> {
    try {
      const job = await this.prisma.detectionJob.create({
        data: {
          claimId,
          userId,
          priority,
          status: 'PENDING',
          attemptCount: 0,
          maxAttempts: 3
        }
      });

      logger.info(`Detection job enqueued`, { jobId: job.id, claimId, userId, priority });
      return job;
    } catch (error) {
      logger.error('Failed to enqueue detection job', { claimId, userId, error });
      throw new Error(`Failed to enqueue detection job: ${error}`);
    }
  }

  /**
   * Start the detection worker process
   */
  startDetectionWorker(intervalMs: number = 5000): void {
    if (this.isProcessing) {
      logger.warn('Detection worker is already running');
      return;
    }

    this.isProcessing = true;
    this.processingInterval = setInterval(async () => {
      await this.processDetectionJobs();
    }, intervalMs);

    logger.info('Detection worker started', { intervalMs });
  }

  /**
   * Stop the detection worker process
   */
  stopDetectionWorker(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    this.isProcessing = false;
    logger.info('Detection worker stopped');
  }

  /**
   * Process pending detection jobs
   */
  private async processDetectionJobs(): Promise<void> {
    try {
      // Get pending jobs with priority ordering
      const pendingJobs = await this.prisma.detectionJob.findMany({
        where: {
          status: 'PENDING',
          attemptCount: { lt: 3 }
        },
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'asc' }
        ],
        take: 10 // Process in batches
      });

      if (pendingJobs.length === 0) {
        return;
      }

      logger.info(`Processing ${pendingJobs.length} detection jobs`);

      // Process jobs concurrently with concurrency limit
      const concurrencyLimit = 3;
      const chunks = this.chunkArray(pendingJobs, concurrencyLimit);

      for (const chunk of chunks) {
        await Promise.all(chunk.map(job => this.processDetectionJob(job)));
      }
    } catch (error) {
      logger.error('Error processing detection jobs', { error });
    }
  }

  /**
   * Process a single detection job
   */
  private async processDetectionJob(job: DetectionJob): Promise<void> {
    try {
      // Update job status to processing
      await this.prisma.detectionJob.update({
        where: { id: job.id },
        data: {
          status: 'PROCESSING',
          startedAt: new Date(),
          attemptCount: { increment: 1 }
        }
      });

      // Get claim and related data
      const claim = await this.prisma.claim.findUnique({
        where: { id: job.claimId },
        include: {
          costDocuments: true
        }
      });

      if (!claim) {
        throw new Error(`Claim not found: ${job.claimId}`);
      }

      // Run detection algorithms
      const anomalies = await this.runDetectionAlgorithms(claim, job);

      // Generate evidence artifacts
      const evidence = await this.generateEvidenceArtifact(job, anomalies);

      // Store detection results
      await this.storeDetectionResults(job, anomalies, evidence);

      // Update job status to completed
      await this.prisma.detectionJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });

      logger.info(`Detection job completed successfully`, { jobId: job.id, anomaliesFound: anomalies.length });
    } catch (error) {
      logger.error('Detection job failed', { jobId: job.id, error });
      
      // Update job status and handle retries
      await this.handleDetectionJobFailure(job, error);
    }
  }

  /**
   * Run detection algorithms on claim data
   */
  private async runDetectionAlgorithms(claim: any, job: DetectionJob): Promise<any[]> {
    const anomalies: any[] = [];
    const thresholds = await this.getDetectionThresholds();
    const whitelists = await this.getDetectionWhitelists();

    // Analyze each cost document
    for (const costDoc of claim.costDocuments) {
      const metadata = costDoc.metadata as any;
      
      // Check for lost units
      if (metadata.lostUnits !== undefined) {
        const threshold = thresholds.find(t => t.anomalyType === 'LOST_UNITS');
        if (threshold && this.checkThreshold(metadata.lostUnits, threshold)) {
          const isWhitelisted = this.checkWhitelist(costDoc, whitelists);
          if (!isWhitelisted) {
            anomalies.push({
              type: 'LOST_UNITS',
              costDocId: costDoc.id,
              skuId: costDoc.skuId,
              severity: this.calculateSeverity(metadata.lostUnits, threshold.threshold),
              confidence: this.calculateConfidence(metadata.lostUnits, threshold.threshold),
              thresholdValue: threshold.threshold,
              actualValue: metadata.lostUnits,
              evidence: {
                claimId: claim.id,
                costDocument: costDoc.id,
                metadata: metadata
              }
            });
          }
        }
      }

      // Check for overcharged fees
      if (metadata.feeAmount !== undefined && metadata.expectedFee !== undefined) {
        const threshold = thresholds.find(t => t.anomalyType === 'OVERCHARGED_FEES');
        const discrepancy = metadata.feeAmount - metadata.expectedFee;
        if (threshold && this.checkThreshold(discrepancy, threshold)) {
          const isWhitelisted = this.checkWhitelist(costDoc, whitelists);
          if (!isWhitelisted) {
            anomalies.push({
              type: 'OVERCHARGED_FEES',
              costDocId: costDoc.id,
              skuId: costDoc.skuId,
              severity: this.calculateSeverity(discrepancy, threshold.threshold),
              confidence: this.calculateConfidence(discrepancy, threshold.threshold),
              thresholdValue: threshold.threshold,
              actualValue: discrepancy,
              evidence: {
                claimId: claim.id,
                costDocument: costDoc.id,
                metadata: metadata
              }
            });
          }
        }
      }

      // Check for damaged stock
      if (metadata.damagedStock !== undefined) {
        const threshold = thresholds.find(t => t.anomalyType === 'DAMAGED_STOCK');
        if (threshold && this.checkThreshold(metadata.damagedStock, threshold)) {
          const isWhitelisted = this.checkWhitelist(costDoc, whitelists);
          if (!isWhitelisted) {
            anomalies.push({
              type: 'DAMAGED_STOCK',
              costDocId: costDoc.id,
              skuId: costDoc.skuId,
              severity: this.calculateSeverity(metadata.damagedStock, threshold.threshold),
              confidence: this.calculateConfidence(metadata.damagedStock, threshold.threshold),
              thresholdValue: threshold.threshold,
              actualValue: metadata.damagedStock,
              evidence: {
                claimId: claim.id,
                costDocument: costDoc.id,
                metadata: metadata
              }
            });
          }
        }
      }
    }

    return anomalies;
  }

  /**
   * Check if a value exceeds a threshold based on the operator
   */
  private checkThreshold(value: number, threshold: DetectionThreshold): boolean {
    switch (threshold.operator) {
      case 'GREATER_THAN':
        return value > threshold.threshold;
      case 'GREATER_THAN_OR_EQUAL':
        return value >= threshold.threshold;
      case 'LESS_THAN':
        return value < threshold.threshold;
      case 'LESS_THAN_OR_EQUAL':
        return value <= threshold.threshold;
      case 'EQUALS':
        return value === threshold.threshold;
      case 'NOT_EQUALS':
        return value !== threshold.threshold;
      default:
        return false;
    }
  }

  /**
   * Check if a cost document is whitelisted
   */
  private checkWhitelist(costDoc: any, whitelists: DetectionWhitelist[]): boolean {
    return whitelists.some(whitelist => {
      if (!whitelist.isActive) return false;
      
      if (whitelist.skuCode && costDoc.skuId === whitelist.skuCode) return true;
      if (whitelist.vendorName && costDoc.metadata?.vendorName === whitelist.vendorName) return true;
      if (whitelist.accountId && costDoc.metadata?.accountId === whitelist.accountId) return true;
      
      return false;
    });
  }

  /**
   * Calculate anomaly severity based on value and threshold
   */
  private calculateSeverity(value: number, threshold: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const ratio = Math.abs(value) / Math.abs(threshold);
    
    if (ratio >= 5) return 'CRITICAL';
    if (ratio >= 3) return 'HIGH';
    if (ratio >= 1.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculate confidence score based on value and threshold
   */
  private calculateConfidence(value: number, threshold: number): number {
    const ratio = Math.abs(value) / Math.abs(threshold);
    // Higher ratio = higher confidence
    return Math.min(0.95, Math.max(0.5, ratio / 10));
  }

  /**
   * Generate evidence artifact and upload to S3
   */
  private async generateEvidenceArtifact(job: DetectionJob, anomalies: any[]): Promise<string> {
    const evidence: AnomalyEvidence = {
      sync_id: job.id,
      seller_id: job.userId,
      detected_anomalies: anomalies.map(anomaly => ({
        event_type: anomaly.type,
        item_id: anomaly.skuId,
        amount_discrepancy: anomaly.actualValue,
        evidence_refs: [`claim:${anomaly.evidence.claimId}`, `doc:${anomaly.evidence.costDocument}`]
      })),
      metadata: {
        source_tables: ['claims', 'cost_documents', 'skus'],
        detection_version: 'v1.0',
        thresholds_applied: {},
        whitelist_checks: {}
      },
      created_at: new Date().toISOString()
    };

    // Upload evidence to S3
    const evidenceKey = `evidence/${job.userId}/${job.id}/detection.json`;
    await this.s3Service.uploadJson(evidenceKey, evidence);

    return evidenceKey;
  }

  /**
   * Store detection results in database
   */
  private async storeDetectionResults(job: DetectionJob, anomalies: any[], evidenceKey: string): Promise<void> {
    const results = anomalies.map(anomaly => ({
      detectionJobId: job.id,
      costDocId: anomaly.costDocId,
      skuId: anomaly.skuId,
      anomalyType: anomaly.type,
      severity: anomaly.severity,
      confidence: anomaly.confidence,
      evidenceUrl: evidenceKey,
      evidenceJson: anomaly.evidence,
      thresholdValue: anomaly.thresholdValue,
      actualValue: anomaly.actualValue,
      isWhitelisted: false
    }));

    if (results.length > 0) {
      await this.prisma.detectionResult.createMany({
        data: results
      });
    }
  }

  /**
   * Handle detection job failure and retry logic
   */
  private async handleDetectionJobFailure(job: DetectionJob, error: any): Promise<void> {
    const shouldRetry = job.attemptCount < job.maxAttempts;
    
    if (shouldRetry) {
      await this.prisma.detectionJob.update({
        where: { id: job.id },
        data: {
          status: 'RETRYING',
          failureReason: error.message
        }
      });
    } else {
      await this.prisma.detectionJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          failureReason: error.message
        }
      });
    }
  }

  /**
   * Get detection thresholds
   */
  private async getDetectionThresholds(): Promise<DetectionThreshold[]> {
    return await this.prisma.detectionThreshold.findMany({
      where: { isActive: true }
    });
  }

  /**
   * Get detection whitelists
   */
  private async getDetectionWhitelists(): Promise<DetectionWhitelist[]> {
    return await this.prisma.detectionWhitelist.findMany({
      where: { isActive: true }
    });
  }

  /**
   * Get detection results for a claim
   */
  async getDetectionResults(claimId: string): Promise<DetectionResult[]> {
    return await this.prisma.detectionResult.findMany({
      where: {
        detectionJob: {
          claimId: claimId
        }
      },
      include: {
        detectionJob: true,
        costDocument: true,
        sku: true
      }
    });
  }

  /**
   * Get detection statistics
   */
  async getDetectionStatistics(userId: string): Promise<any> {
    const [totalJobs, completedJobs, failedJobs, totalAnomalies] = await Promise.all([
      this.prisma.detectionJob.count({ where: { userId } }),
      this.prisma.detectionJob.count({ where: { userId, status: 'COMPLETED' } }),
      this.prisma.detectionJob.count({ where: { userId, status: 'FAILED' } }),
      this.prisma.detectionResult.count({ where: { detectionJob: { userId } } })
    ]);

    return {
      totalJobs,
      completedJobs,
      failedJobs,
      totalAnomalies,
      successRate: totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0
    };
  }

  /**
   * Utility function to chunk array for concurrency control
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}


