import { PrismaClient } from '@prisma/client';
import { DetectionJob, DetectionPriority } from '@prisma/client';

export interface DetectionJobRequest {
  sellerId: string;
  syncId: string;
  priority?: DetectionPriority;
  triggeredAt: Date;
}

export interface QueueStats {
  pendingCount: number;
  processingCount: number;
  totalCount: number;
  priorityBreakdown: Record<DetectionPriority, number>;
}

export class DetectionQueue {
  private prisma: PrismaClient;
  private maxConcurrency: number;
  private backpressureThreshold: number;

  constructor(prisma: PrismaClient, maxConcurrency: number = 5, backpressureThreshold: number = 20) {
    this.prisma = prisma;
    this.maxConcurrency = maxConcurrency;
    this.backpressureThreshold = backpressureThreshold;
  }

  async enqueueJob(request: DetectionJobRequest): Promise<DetectionJob> {
    const priority = this.calculatePriority(request.priority);
    
    const job = await this.prisma.detectionJob.create({
      data: {
        sellerId: request.sellerId,
        syncId: request.syncId,
        status: 'PENDING',
        priority,
        attempts: 0,
        createdAt: request.triggeredAt,
        updatedAt: request.triggeredAt
      }
    });

    console.log(`Detection job enqueued: ${job.id} for seller ${request.sellerId}, sync ${request.syncId}, priority ${priority}`);
    return job;
  }

  async getNextJob(): Promise<DetectionJob | null> {
    // Check backpressure
    const queueStats = await this.getQueueStats();
    
    if (queueStats.totalCount > this.backpressureThreshold) {
      console.log(`Backpressure threshold exceeded (${queueStats.totalCount}/${this.backpressureThreshold}), filtering by priority`);
      return this.getNextHighPriorityJob();
    }

    // Get next available job with priority ordering
    const job = await this.prisma.detectionJob.findFirst({
      where: {
        status: 'PENDING'
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' }
      ]
    });

    if (job) {
      await this.markJobAsProcessing(job.id);
    }

    return job;
  }

  private async getNextHighPriorityJob(): Promise<DetectionJob | null> {
    // Only process CRITICAL and HIGH priority jobs during backpressure
    const job = await this.prisma.detectionJob.findFirst({
      where: {
        status: 'PENDING',
        priority: {
          in: ['CRITICAL', 'HIGH']
        }
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' }
      ]
    });

    if (job) {
      await this.markJobAsProcessing(job.id);
    }

    return job;
  }

  private calculatePriority(requestedPriority?: DetectionPriority): DetectionPriority {
    if (requestedPriority) {
      return requestedPriority;
    }

    // Default priority logic based on business rules
    return 'NORMAL';
  }

  private async markJobAsProcessing(jobId: string): Promise<void> {
    await this.prisma.detectionJob.update({
      where: { id: jobId },
      data: {
        status: 'PROCESSING',
        updatedAt: new Date()
      }
    });
  }

  async markJobCompleted(jobId: string): Promise<void> {
    await this.prisma.detectionJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        updatedAt: new Date()
      }
    });
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    await this.prisma.detectionJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        lastError: error,
        attempts: {
          increment: 1
        },
        updatedAt: new Date()
      }
    });
  }

  async getQueueStats(): Promise<QueueStats> {
    const [pendingCount, processingCount, totalCount] = await Promise.all([
      this.prisma.detectionJob.count({ where: { status: 'PENDING' } }),
      this.prisma.detectionJob.count({ where: { status: 'PROCESSING' } }),
      this.prisma.detectionJob.count()
    ]);

    const priorityBreakdown = await this.prisma.detectionJob.groupBy({
      by: ['priority'],
      where: { status: 'PENDING' },
      _count: {
        priority: true
      }
    });

    const breakdown: Record<DetectionPriority, number> = {
      LOW: 0,
      NORMAL: 0,
      HIGH: 0,
      CRITICAL: 0
    };

    priorityBreakdown.forEach(item => {
      breakdown[item.priority] = item._count.priority;
    });

    return {
      pendingCount,
      processingCount,
      totalCount,
      priorityBreakdown: breakdown
    };
  }

  async getJobStatus(jobId: string): Promise<DetectionJob | null> {
    return this.prisma.detectionJob.findUnique({
      where: { id: jobId }
    });
  }

  async getJobsBySeller(sellerId: string, limit: number = 50): Promise<DetectionJob[]> {
    return this.prisma.detectionJob.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  async getJobsBySync(syncId: string): Promise<DetectionJob[]> {
    return this.prisma.detectionJob.findMany({
      where: { syncId }
    });
  }
}

