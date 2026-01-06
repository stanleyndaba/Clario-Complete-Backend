import axios from 'axios';
import { logger } from '../utils/logger';

export interface MCDEProcessingRequest {
  documentId: string;
  fileKey: string;
  claimId: string;
  skuId: string;
  processingOptions?: Record<string, any>;
}

export interface MCDEProcessingResponse {
  documentId: string;
  extractedMetadata: Record<string, any>;
  costEstimate?: {
    estimatedCost: number;
    confidence: number;
    costComponents: Record<string, number>;
  };
  complianceStatus?: {
    isCompliant: boolean;
    validationErrors: string[];
    complianceScore: number;
  };
  processingStatus: 'completed' | 'failed' | 'processing';
  error?: string;
}

export class MCDEIntegrationService {
  private static baseUrl = process.env.MCDE_API_BASE_URL || 'http://localhost:8000';
  private static timeout = parseInt(process.env.MCDE_API_TIMEOUT || '30000');

  /**
   * Send document to MCDE for OCR and cost estimation
   */
  static async processDocument(request: MCDEProcessingRequest): Promise<MCDEProcessingResponse> {
    try {
      logger.info('Sending document to MCDE for processing', {
        documentId: request.documentId,
        claimId: request.claimId,
        skuId: request.skuId,
      });

      const response = await axios.post(
        `${this.baseUrl}/process-document`,
        {
          document_id: request.documentId,
          file_key: request.fileKey,
          claim_id: request.claimId,
          sku_id: request.skuId,
          processing_options: request.processingOptions || {},
        },
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MCDE_API_KEY || ''}`,
          },
        }
      );

      const result = response.data;
      logger.info('MCDE processing completed', {
        documentId: request.documentId,
        status: result.processing_status,
      });

      return {
        documentId: request.documentId,
        extractedMetadata: result.extracted_metadata || {},
        costEstimate: result.cost_estimate,
        complianceStatus: result.compliance_status,
        processingStatus: result.processing_status,
      };
    } catch (error) {
      logger.error('MCDE processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId: request.documentId,
        claimId: request.claimId,
      });

      return {
        documentId: request.documentId,
        extractedMetadata: {},
        processingStatus: 'failed',
        error: error instanceof Error ? error.message : 'Processing failed',
      };
    }
  }

  /**
   * Get cost estimate for a document
   */
  static async getCostEstimate(documentId: string, claimId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/cost-estimate`,
        {
          params: {
            document_id: documentId,
            claim_id: claimId,
          },
          timeout: this.timeout,
          headers: {
            'Authorization': `Bearer ${process.env.MCDE_API_KEY || ''}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to get cost estimate from MCDE', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId,
        claimId,
      });
      throw error;
    }
  }

  /**
   * Validate compliance with Amazon requirements
   */
  static async validateCompliance(documentId: string, claimId: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/validate-compliance`,
        {
          document_id: documentId,
          claim_id: claimId,
        },
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MCDE_API_KEY || ''}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to validate compliance with MCDE', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId,
        claimId,
      });
      throw error;
    }
  }

  /**
   * Generate cost document
   */
  static async generateCostDocument(claimId: string, costData: any): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/generate-document`,
        {
          claim_id: claimId,
          cost_estimate: costData,
          document_type: 'cost_document',
        },
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MCDE_API_KEY || ''}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to generate cost document with MCDE', {
        error: error instanceof Error ? error.message : 'Unknown error',
        claimId,
      });
      throw error;
    }
  }

  /**
   * Check MCDE service health
   */
  static async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 5000,
      });

      return response.status === 200;
    } catch (error) {
      logger.error('MCDE health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Process document asynchronously (fire and forget)
   */
  static async processDocumentAsync(request: MCDEProcessingRequest): Promise<void> {
    // Fire and forget - don't wait for response
    this.processDocument(request).catch((error) => {
      logger.error('Async MCDE processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId: request.documentId,
      });
    });
  }
} 