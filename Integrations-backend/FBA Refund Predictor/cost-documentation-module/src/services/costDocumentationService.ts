import { prisma } from '../config/database';
import { S3Service } from './s3Service';
import { PDFGenerationService } from './pdfGenerationService';
import { logger } from '../utils/logger';
import { 
  AnomalyEvidence, 
  CostDocumentationJob, 
  GeneratedPDF, 
  PDFTemplate,
  PDFGenerationOptions 
} from '../types/costDocumentation';
import { v4 as uuidv4 } from 'uuid';

export class CostDocumentationService {
  private pdfService: PDFGenerationService;

  constructor() {
    this.pdfService = new PDFGenerationService();
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    await this.pdfService.initialize();
    logger.info('Cost Documentation Service initialized');
  }

  /**
   * Create a cost documentation job from evidence JSON
   */
  async createDocumentationJob(evidence: AnomalyEvidence): Promise<CostDocumentationJob> {
    try {
      const job: CostDocumentationJob = {
        id: uuidv4(),
        evidence,
        status: 'pending',
        priority: this.determinePriority(evidence),
        attempts: 0,
        max_attempts: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Store job in database
      await this.storeJob(job);

      logger.info('Cost documentation job created', { 
        job_id: job.id, 
        anomaly_id: evidence.anomaly_id 
      });

      return job;
    } catch (error) {
      logger.error('Failed to create cost documentation job', { error, evidence });
      throw error;
    }
  }

  /**
   * Process a cost documentation job
   */
  async processDocumentationJob(jobId: string): Promise<GeneratedPDF> {
    try {
      // Get job from database
      const job = await this.getJob(jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      // Update job status to processing
      await this.updateJobStatus(jobId, 'processing');

      // Get or create template
      const template = await this.getTemplateForAnomalyType(job.evidence.type);

      // Generate PDF
      const pdfBuffer = await this.pdfService.generatePDF(
        job.evidence,
        template,
        { include_watermark: true, include_timestamp: true }
      );

      // Upload PDF to S3
      const s3Key = `cost-docs/${job.evidence.seller_info?.seller_id || 'unknown'}/${job.evidence.anomaly_id}/${Date.now()}.pdf`;
      const uploadResult = await S3Service.uploadBuffer(
        pdfBuffer,
      s3Key,
      'application/pdf'
      );

      // Generate signed URL
      const signedUrl = await S3Service.generateSignedUrl(s3Key, 3600); // 1 hour expiry

      // Create generated PDF record
      const generatedPDF: GeneratedPDF = {
        id: uuidv4(),
        anomaly_id: job.evidence.anomaly_id,
        seller_id: job.evidence.seller_info?.seller_id || 'unknown',
        pdf_s3_key: s3Key,
        pdf_url: signedUrl,
        template_used: template.id,
        generated_at: new Date().toISOString(),
        file_size: pdfBuffer.length,
        metadata: {
          job_id: jobId,
          anomaly_type: job.evidence.type,
          sku: job.evidence.sku,
          total_loss: job.evidence.total_loss
        }
      };

      // Store generated PDF
      await this.storeGeneratedPDF(generatedPDF);

      // Update job status to completed
      await this.updateJobStatus(jobId, 'completed', {
        pdf_url: signedUrl,
        pdf_s3_key: s3Key,
        completed_at: new Date().toISOString()
      });

      logger.info('Cost documentation job completed successfully', { 
        job_id: jobId, 
        pdf_id: generatedPDF.id 
      });

      return generatedPDF;
    } catch (error) {
      logger.error('Failed to process cost documentation job', { error, job_id: jobId });
      
      // Update job status to failed
      await this.updateJobStatus(jobId, 'failed', {
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Generate cost documentation manually (for dashboard)
   */
  async generateManualDocumentation(evidence: AnomalyEvidence): Promise<GeneratedPDF> {
    try {
      // Create a job and process it immediately
      const job = await this.createDocumentationJob(evidence);
      return await this.processDocumentationJob(job.id);
    } catch (error) {
      logger.error('Failed to generate manual cost documentation', { error, evidence });
      throw error;
    }
  }

  /**
   * Get cost documentation by anomaly ID
   */
  async getDocumentationByAnomalyId(anomalyId: string): Promise<GeneratedPDF | null> {
    try {
      // This would query the database for existing documentation
      // For now, return null as we need to implement the database layer
      return null;
    } catch (error) {
      logger.error('Failed to get documentation by anomaly ID', { error, anomaly_id: anomalyId });
      throw error;
    }
  }

  /**
   * Get all cost documentation for a seller
   */
  async getDocumentationBySellerId(sellerId: string): Promise<GeneratedPDF[]> {
    try {
      // This would query the database for all documentation for a seller
      // For now, return empty array as we need to implement the database layer
      return [];
    } catch (error) {
      logger.error('Failed to get documentation by seller ID', { error, seller_id: sellerId });
      throw error;
    }
  }

  /**
   * Determine job priority based on evidence
   */
  private determinePriority(evidence: AnomalyEvidence): 'low' | 'normal' | 'high' | 'critical' {
    const lossAmount = evidence.total_loss;
    
    if (lossAmount >= 1000) return 'critical';
    if (lossAmount >= 500) return 'high';
    if (lossAmount >= 100) return 'normal';
    return 'low';
  }

  /**
   * Get or create template for anomaly type
   */
  private async getTemplateForAnomalyType(anomalyType: string): Promise<PDFTemplate> {
    try {
      // Try to get existing template from database
      // For now, create a default template
      const defaultTemplateHtml = this.pdfService.getDefaultTemplate(anomalyType);
      
      const template: PDFTemplate = {
        id: uuidv4(),
        name: `${anomalyType} Template`,
        anomaly_type: anomalyType,
        template_html: defaultTemplateHtml,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Store template in database
      await this.storeTemplate(template);

      return template;
    } catch (error) {
      logger.error('Failed to get template for anomaly type', { error, anomaly_type: anomalyType });
      throw error;
    }
  }

  /**
   * Store job in database
   */
  private async storeJob(job: CostDocumentationJob): Promise<void> {
    try {
      // This would store the job in the database
      // For now, just log it
      logger.info('Job stored', { job_id: job.id });
    } catch (error) {
      logger.error('Failed to store job', { error, job });
      throw error;
    }
  }

  /**
   * Get job from database
   */
  private async getJob(jobId: string): Promise<CostDocumentationJob | null> {
    try {
      // This would query the database for the job
      // For now, return null as we need to implement the database layer
      return null;
    } catch (error) {
      logger.error('Failed to get job', { error, job_id: jobId });
      throw error;
    }
  }

  /**
   * Update job status
   */
  private async updateJobStatus(
    jobId: string, 
    status: CostDocumentationJob['status'], 
    additionalData: Partial<CostDocumentationJob> = {}
  ): Promise<void> {
    try {
      // This would update the job in the database
      // For now, just log it
      logger.info('Job status updated', { job_id: jobId, status, additionalData });
    } catch (error) {
      logger.error('Failed to update job status', { error, job_id: jobId, status });
      throw error;
    }
  }

  /**
   * Store generated PDF
   */
  private async storeGeneratedPDF(pdf: GeneratedPDF): Promise<void> {
    try {
      // This would store the generated PDF in the database
      // For now, just log it
      logger.info('Generated PDF stored', { pdf_id: pdf.id });
    } catch (error) {
      logger.error('Failed to store generated PDF', { error, pdf });
      throw error;
    }
  }

  /**
   * Store template
   */
  private async storeTemplate(template: PDFTemplate): Promise<void> {
    try {
      // This would store the template in the database
      // For now, just log it
      logger.info('Template stored', { template_id: template.id });
    } catch (error) {
      logger.error('Failed to store template', { error, template });
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.pdfService.cleanup();
    logger.info('Cost Documentation Service cleaned up');
  }
}








