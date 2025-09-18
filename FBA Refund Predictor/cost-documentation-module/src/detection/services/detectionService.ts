import { PrismaClient, DetectionJob, DetectionResult, RuleType } from '@prisma/client';
import { DetectionQueue } from '../queue/detectionQueue';
import { DetectionJobRequest } from '../queue/detectionQueue';

export interface DetectionStats {
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalResults: number;
  resultsByRuleType: Record<RuleType, number>;
  resultsBySeverity: Record<string, number>;
}

export interface DetectionResultFilter {
  sellerId?: string;
  syncId?: string;
  ruleType?: RuleType;
  severity?: string;
  limit?: number;
  offset?: number;
}

export class DetectionService {
  private prisma: PrismaClient;
  private queue: DetectionQueue;

  constructor(prisma: PrismaClient, queue: DetectionQueue) {
    this.prisma = prisma;
    this.queue = queue;
  }

  async enqueueDetectionJob(request: DetectionJobRequest): Promise<DetectionJob> {
    // Validate request
    if (!request.sellerId || !request.syncId) {
      throw new Error('sellerId and syncId are required');
    }

    // Check if job already exists for this sync
    const existingJob = await this.prisma.detectionJob.findFirst({
      where: {
        sellerId: request.sellerId,
        syncId: request.syncId
      }
    });

    if (existingJob) {
      throw new Error(`Detection job already exists for seller ${request.sellerId} and sync ${request.syncId}`);
    }

    // Enqueue the job
    return this.queue.enqueueJob(request);
  }

  async getJobStatus(jobId: string): Promise<DetectionJob | null> {
    return this.queue.getJobStatus(jobId);
  }

  async getDetectionResults(filter: DetectionResultFilter): Promise<{
    results: DetectionResult[];
    total: number;
    hasMore: boolean;
  }> {
    const where: any = {};

    if (filter.sellerId) {
      where.sellerId = filter.sellerId;
    }

    if (filter.syncId) {
      where.syncId = filter.syncId;
    }

    if (filter.ruleType) {
      where.ruleType = filter.ruleType;
    }

    if (filter.severity) {
      where.severity = filter.severity;
    }

    const limit = filter.limit || 50;
    const offset = filter.offset || 0;

    const [results, total] = await Promise.all([
      this.prisma.detectionResult.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1, // Take one extra to check if there are more
        skip: offset,
        include: {
          detectionJob: {
            select: {
              id: true,
              status: true,
              priority: true,
              createdAt: true
            }
          }
        }
      }),
      this.prisma.detectionResult.count({ where })
    ]);

    const hasMore = results.length > limit;
    const finalResults = hasMore ? results.slice(0, limit) : results;

    return {
      results: finalResults,
      total,
      hasMore
    };
  }

  async getDetectionStats(sellerId?: string): Promise<DetectionStats> {
    const where = sellerId ? { sellerId } : {};

    const [
      totalJobs,
      pendingJobs,
      processingJobs,
      completedJobs,
      failedJobs,
      totalResults,
      resultsByRuleType,
      resultsBySeverity
    ] = await Promise.all([
      this.prisma.detectionJob.count({ where }),
      this.prisma.detectionJob.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.detectionJob.count({ where: { ...where, status: 'PROCESSING' } }),
      this.prisma.detectionJob.count({ where: { ...where, status: 'COMPLETED' } }),
      this.prisma.detectionJob.count({ where: { ...where, status: 'FAILED' } }),
      this.prisma.detectionResult.count({ where }),
      this.prisma.detectionResult.groupBy({
        by: ['ruleType'],
        where,
        _count: { ruleType: true }
      }),
      this.prisma.detectionResult.groupBy({
        by: ['severity'],
        where,
        _count: { severity: true }
      })
    ]);

    // Build rule type breakdown
    const ruleTypeBreakdown: Record<RuleType, number> = {
      LOST_UNITS: 0,
      OVERCHARGED_FEES: 0,
      DAMAGED_STOCK: 0,
      DUPLICATE_CHARGES: 0,
      INVALID_SHIPPING: 0,
      PRICING_DISCREPANCY: 0
    };

    resultsByRuleType.forEach(item => {
      ruleTypeBreakdown[item.ruleType] = item._count.ruleType;
    });

    // Build severity breakdown
    const severityBreakdown: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0
    };

    resultsBySeverity.forEach(item => {
      severityBreakdown[item.severity] = item._count.severity;
    });

    return {
      totalJobs,
      pendingJobs,
      processingJobs,
      completedJobs,
      failedJobs,
      totalResults,
      resultsByRuleType: ruleTypeBreakdown,
      resultsBySeverity: severityBreakdown
    };
  }

  async getQueueStats(): Promise<any> {
    return this.queue.getQueueStats();
  }

  async getJobsBySeller(sellerId: string, limit: number = 50): Promise<DetectionJob[]> {
    return this.queue.getJobsBySeller(sellerId, limit);
  }

  async getJobsBySync(syncId: string): Promise<DetectionJob[]> {
    return this.queue.getJobsBySync(syncId);
  }

  async retryFailedJob(jobId: string): Promise<DetectionJob> {
    const job = await this.prisma.detectionJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== 'FAILED') {
      throw new Error(`Job ${jobId} is not in FAILED status`);
    }

    // Reset job to PENDING status
    const updatedJob = await this.prisma.detectionJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        lastError: null,
        updatedAt: new Date()
      }
    });

    console.log(`Job ${jobId} reset to PENDING status for retry`);
    return updatedJob;
  }

  async deleteDetectionJob(jobId: string): Promise<void> {
    // Delete associated results first
    await this.prisma.detectionResult.deleteMany({
      where: { detectionJobId: jobId }
    });

    // Delete the job
    await this.prisma.detectionJob.delete({
      where: { id: jobId }
    });

    console.log(`Detection job ${jobId} and associated results deleted`);
  }
}

