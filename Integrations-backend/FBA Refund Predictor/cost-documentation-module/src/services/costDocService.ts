import { PrismaClient } from '@prisma/client';
import { 
  computeEvidenceSha256, 
  computeSignatureHash, 
  shortHash,
  createReportId 
} from '../utils/canonicalize';
import { PDFRenderer, RenderResult } from './pdfRenderer';
import { CostDocumentationWorker } from '../workers/costDocWorker';
import { auditService } from './auditService';
import { exportService } from './exportService';
import { syncCrossCheckService } from './syncCrossCheckService';
import { DocumentStatus, AuditEvent } from '../types/costDocumentation';

export interface AnomalyEvidence {
  seller_id: string;
  anomaly_id: string;
  anomaly_type: string;
  detection_date: string;
  total_impact: number;
  evidence_data: any;
  [key: string]: any;
}

export interface CostDocumentationJob {
  id: string;
  seller_id: string;
  anomaly_id: string;
  template_version: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high';
  evidence_sha256: string;
  signature_sha256: string;
  s3_key: string | null;
  s3_url: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  job_id: string | null;
}

export interface GeneratedPDF {
  id: string;
  seller_id: string;
  anomaly_id: string;
  template_version: string;
  s3_key: string;
  s3_url: string;
  evidence_sha256: string;
  signature_sha256: string;
  file_size: number;
  created_at: Date;
  report_id: string;
}

export interface IdempotencyResult {
  isDuplicate: boolean;
  existingRecord?: GeneratedPDF;
  newRecord?: GeneratedPDF;
}

export class CostDocumentationService {
  private prisma: PrismaClient;
  private pdfRenderer: PDFRenderer;
  private worker: CostDocumentationWorker;

  constructor() {
    this.prisma = new PrismaClient();
    this.pdfRenderer = new PDFRenderer();
    this.worker = new CostDocumentationWorker();
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      await this.prisma.$connect();
      await this.pdfRenderer.initialize();
      await this.worker.initialize();
      console.log('Cost Documentation Service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Cost Documentation Service:', error);
      throw error;
    }
  }

  /**
   * Generate manual documentation (synchronous)
   */
  async generateManualDocumentation(
    evidence: AnomalyEvidence,
    templateVersion: string = '1.0'
  ): Promise<GeneratedPDF> {
    // Check idempotency first
    const idempotencyResult = await this.checkIdempotency(
      evidence.seller_id,
      evidence.anomaly_id,
      templateVersion,
      evidence
    );

    if (idempotencyResult.isDuplicate && idempotencyResult.existingRecord) {
      console.log(`Returning existing PDF for ${evidence.anomaly_id}`);
      return idempotencyResult.existingRecord;
    }

    // Generate new PDF
    const renderResult = await this.pdfRenderer.renderPdfBuffer(evidence, templateVersion);
    
    // Generate S3 key
    const s3Key = this.pdfRenderer.generateS3Key(
      evidence.seller_id,
      evidence.anomaly_id,
      templateVersion,
      renderResult.metadata.evidence_sha256
    );

    // Upload to S3
    const { s3Key: uploadedKey, url } = await this.pdfRenderer.renderPdfToS3(
      renderResult.buffer,
      s3Key
    );

    // Store in database
    const generatedPDF = await this.storeGeneratedPDF({
      seller_id: evidence.seller_id,
      anomaly_id: evidence.anomaly_id,
      template_version: templateVersion,
      s3_key: uploadedKey,
      s3_url: url,
      evidence_sha256: renderResult.metadata.evidence_sha256,
      signature_sha256: renderResult.metadata.signature_sha256,
      file_size: renderResult.buffer.length,
      report_id: renderResult.metadata.report_id
    });

    console.log(`Manual PDF generated successfully: ${generatedPDF.id}`);
    return generatedPDF;
  }

  /**
   * Enqueue automatic documentation job
   */
  async enqueueDocumentationJob(
    evidence: AnomalyEvidence,
    templateVersion: string = '1.0',
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<{ jobId: string; status: string }> {
    // Check idempotency
    const idempotencyResult = await this.checkIdempotency(
      evidence.seller_id,
      evidence.anomaly_id,
      templateVersion,
      evidence
    );

    if (idempotencyResult.isDuplicate && idempotencyResult.existingRecord) {
      console.log(`Job already completed for ${evidence.anomaly_id}`);
      return {
        jobId: `completed-${evidence.anomaly_id}`,
        status: 'completed'
      };
    }

    // Create job record
    const evidenceSha256 = computeEvidenceSha256(evidence);
    const signatureSha256 = computeSignatureHash(
      evidenceSha256,
      templateVersion,
      new Date().toISOString()
    );

    const job = await this.prisma.costDocumentationJob.create({
      data: {
        seller_id: evidence.seller_id,
        anomaly_id: evidence.anomaly_id,
        template_version: templateVersion,
        status: 'pending',
        priority,
        evidence_sha256: evidenceSha256,
        signature_sha256: signatureSha256,
        s3_key: null,
        s3_url: null,
        error_message: null,
        job_id: null
      }
    });

    // Enqueue in worker
    await this.worker.addJob({
      id: job.id,
      seller_id: evidence.seller_id,
      anomaly_id: evidence.anomaly_id,
      template_version: templateVersion,
      evidence,
      priority
    });

    console.log(`Documentation job enqueued: ${job.id}`);
    return {
      jobId: job.id,
      status: 'pending'
    };
  }

  /**
   * Check idempotency for a request
   */
  private async checkIdempotency(
    sellerId: string,
    anomalyId: string,
    templateVersion: string,
    evidence: AnomalyEvidence
  ): Promise<IdempotencyResult> {
    // Check if we already have a generated PDF
    const existingPDF = await this.prisma.generatedPDF.findFirst({
      where: {
        seller_id: sellerId,
        anomaly_id: anomalyId,
        template_version: templateVersion
      },
      orderBy: {
        created_at: 'desc'
      }
    });

    if (existingPDF) {
      // Verify the evidence hash matches
      const currentEvidenceHash = computeEvidenceSha256(evidence);
      if (existingPDF.evidence_sha256 === currentEvidenceHash) {
        return {
          isDuplicate: true,
          existingRecord: existingPDF
        };
      }
    }

    return {
      isDuplicate: false
    };
  }

  /**
   * Get documentation by anomaly ID
   */
  async getDocumentationByAnomalyId(anomalyId: string): Promise<GeneratedPDF | null> {
    return await this.prisma.generatedPDF.findFirst({
      where: { anomaly_id: anomalyId },
      orderBy: { created_at: 'desc' }
    });
  }

  /**
   * Get documentation by seller ID
   */
  async getDocumentationBySellerId(sellerId: string): Promise<GeneratedPDF[]> {
    return await this.prisma.generatedPDF.findMany({
      where: { seller_id: sellerId },
      orderBy: { created_at: 'desc' }
    });
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<CostDocumentationJob | null> {
    return await this.prisma.costDocumentationJob.findUnique({
      where: { id: jobId }
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  }> {
    const stats = await this.prisma.costDocumentationJob.groupBy({
      by: ['status'],
      _count: {
        status: true
      }
    });

    const result = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0
    };

    stats.forEach(stat => {
      const count = stat._count.status;
      result[stat.status as keyof typeof result] = count;
      result.total += count;
    });

    return result;
  }

  /**
   * Retry failed job
   */
  async retryJob(jobId: string): Promise<boolean> {
    try {
      const job = await this.prisma.costDocumentationJob.findUnique({
        where: { id: jobId }
      });

      if (!job || job.status !== 'failed') {
        return false;
      }

      // Reset job status
      await this.prisma.costDocumentationJob.update({
        where: { id: jobId },
        data: {
          status: 'pending',
          error_message: null,
          updated_at: new Date()
        }
      });

      // Re-enqueue in worker
      await this.worker.addJob({
        id: job.id,
        seller_id: job.seller_id,
        anomaly_id: job.anomaly_id,
        template_version: job.template_version,
        evidence: {}, // Would need to reconstruct from evidence_sha256
        priority: job.priority as 'low' | 'medium' | 'high'
      });

      console.log(`Job ${jobId} retried successfully`);
      return true;
    } catch (error) {
      console.error(`Failed to retry job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Remove job from queue
   */
  async removeJob(jobId: string): Promise<boolean> {
    try {
      await this.prisma.costDocumentationJob.delete({
        where: { id: jobId }
      });
      console.log(`Job ${jobId} removed successfully`);
      return true;
    } catch (error) {
      console.error(`Failed to remove job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Pause queue processing
   */
  async pauseQueue(): Promise<void> {
    await this.worker.pauseQueue();
    console.log('Queue processing paused');
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(): Promise<void> {
    await this.worker.resumeQueue();
    console.log('Queue processing resumed');
  }

  /**
   * Clear all jobs
   */
  async clearQueue(): Promise<number> {
    const result = await this.prisma.costDocumentationJob.deleteMany({
      where: {
        status: {
          in: ['pending', 'processing']
        }
      }
    });

    console.log(`Cleared ${result.count} jobs from queue`);
    return result.count;
  }

  /**
   * Store generated PDF in database
   */
  private async storeGeneratedPDF(data: {
    seller_id: string;
    anomaly_id: string;
    template_version: string;
    s3_key: string;
    s3_url: string;
    evidence_sha256: string;
    signature_sha256: string;
    file_size: number;
    report_id: string;
  }): Promise<GeneratedPDF> {
    return await this.prisma.generatedPDF.create({
      data: {
        ...data,
        created_at: new Date()
      }
    });
  }

  /**
   * Update job status
   */
  async updateJobStatus(
    jobId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    s3Key?: string,
    s3Url?: string,
    errorMessage?: string
  ): Promise<void> {
    const updateData: any = {
      status,
      updated_at: new Date()
    };

    if (status === 'completed') {
      updateData.completed_at = new Date();
      if (s3Key) updateData.s3_key = s3Key;
      if (s3Url) updateData.s3_url = s3Url;
    }

    if (status === 'failed' && errorMessage) {
      updateData.error_message = errorMessage;
    }

    await this.prisma.costDocumentationJob.update({
      where: { id: jobId },
      data: updateData
    });

    console.log(`Job ${jobId} status updated to ${status}`);
  }

  /**
   * Lock a document (make it immutable)
   */
  async lockDocument(docId: string, actor: string): Promise<GeneratedPDF> {
    const document = await this.prisma.generatedPDF.findUnique({
      where: { id: docId }
    });

    if (!document) {
      throw new Error('Document not found');
    }

    if (document.status === DocumentStatus.LOCKED) {
      throw new Error('Document is already locked');
    }

    if (document.status === DocumentStatus.EXPORTED) {
      throw new Error('Cannot lock exported document');
    }

    // Lock the document
    const lockedDocument = await this.prisma.generatedPDF.update({
      where: { id: docId },
      data: {
        status: DocumentStatus.LOCKED,
        locked_at: new Date(),
        locked_by: actor
      }
    });

    // Log the lock event
    await auditService.logDocumentLocked(
      docId,
      actor,
      document.content_hash || document.evidence_sha256,
      {
        locked_at: lockedDocument.locked_at,
        locked_by: actor,
        previous_status: document.status
      }
    );

    console.log(`Document ${docId} locked by ${actor}`);
    return lockedDocument;
  }

  /**
   * Export selected documents
   */
  async exportDocuments(
    documentIds: string[],
    bundleName: string,
    description: string | undefined,
    format: 'zip' | 'combined_pdf',
    actor: string
  ): Promise<any> {
    // Validate documents exist and are exportable
    const documents = await this.prisma.generatedPDF.findMany({
      where: {
        id: { in: documentIds },
        status: { in: [DocumentStatus.DRAFT, DocumentStatus.LOCKED] }
      }
    });

    if (documents.length !== documentIds.length) {
      throw new Error('Some documents not found or not exportable');
    }

    // Create export bundle
    const exportBundle = await exportService.createExportBundle({
      document_ids: documentIds,
      bundle_name: bundleName,
      description,
      format
    }, actor);

    // Log export events for each document
    for (const docId of documentIds) {
      await auditService.logDocumentExported(
        docId,
        actor,
        exportBundle.id,
        {
          bundle_name: bundleName,
          format,
          exported_at: exportBundle.completed_at
        }
      );
    }

    console.log(`Export bundle created: ${exportBundle.id} with ${documents.length} documents`);
    return exportBundle;
  }

  /**
   * Get document audit trail
   */
  async getDocumentAuditTrail(
    docId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<any> {
    return auditService.getDocumentAuditTrail(docId, page, limit);
  }

  /**
   * Perform sync cross-check for a document
   */
  async performSyncCrossCheck(docId: string, actor: string): Promise<any> {
    return syncCrossCheckService.performSyncCrossCheck(docId, actor);
  }

  /**
   * Refresh document with latest sync state
   */
  async refreshDocument(docId: string, actor: string): Promise<any> {
    return syncCrossCheckService.refreshDocument(docId, actor);
  }

  /**
   * Get sync health metrics
   */
  async getSyncHealthMetrics(): Promise<any> {
    return syncCrossCheckService.getSyncHealthMetrics();
  }

  /**
   * Get export bundles for user
   */
  async getUserExportBundles(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    return exportService.getUserExportBundles(userId, page, limit);
  }

  /**
   * Get export bundle by ID
   */
  async getExportBundle(bundleId: string): Promise<any> {
    return exportService.getExportBundle(bundleId);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.prisma.$disconnect();
    await this.pdfRenderer.cleanup();
    await this.worker.cleanup();
    console.log('Cost Documentation Service cleaned up');
  }
}

// Export singleton instance
export const costDocService = new CostDocumentationService();



