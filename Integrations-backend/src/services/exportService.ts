import { pdfGenerationService, DocumentData } from '../services/pdfGenerationService';
import { S3 } from 'aws-sdk';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { createReadStream } from 'fs';
import axios from 'axios';
import logger from '../utils/logger';
const archiver = require('archiver');

export interface ExportRequest {
  document_ids: string[];
  bundle_name: string;
  description?: string;
  format: 'zip' | 'combined_pdf';
}

export interface ExportResult {
  id: string;
  bundle_name: string;
  format: 'zip' | 'combined_pdf';
  status: 'processing' | 'completed' | 'failed';
  download_url?: string;
  s3_key?: string;
  file_size?: number;
  created_at: string;
  completed_at?: string;
  document_count: number;
}

export class ExportService {
  private s3: S3;
  private bucketName: string;

  constructor() {
    this.bucketName = process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || '';
    
    this.s3 = new S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }

  /**
   * Create export bundle from documents
   */
  async createExportBundle(
    request: ExportRequest,
    userId: string
  ): Promise<ExportResult> {
    const { document_ids, bundle_name, description, format } = request;
    const bundleId = `export-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      logger.info('Creating export bundle', {
        bundleId,
        documentCount: document_ids.length,
        format,
        userId
      });

      // Fetch documents (for now, we'll create mock documents or fetch from API)
      const documents = await this.fetchDocuments(document_ids);

      if (documents.length === 0) {
        throw new Error('No documents found to export');
      }

      // Initialize PDF service
      try {
        await pdfGenerationService.initialize();
      } catch (error: any) {
        logger.warn('PDF generation service not available, export will fail:', error.message);
        throw new Error(`PDF export is currently unavailable. Puppeteer is required for PDF generation but is not installed.`);
      }

      // Generate export file
      const exportResult = await this.generateExportFile(
        documents,
        format,
        bundleId
      );

      // Upload to S3
      const uploadResult = await this.uploadToS3(
        exportResult.filePath,
        exportResult.s3Key
      );

      // Clean up temp file
      await unlink(exportResult.filePath);

      const result: ExportResult = {
        id: bundleId,
        bundle_name,
        format,
        status: 'completed',
        download_url: uploadResult.url,
        s3_key: exportResult.s3Key,
        file_size: uploadResult.fileSize,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        document_count: documents.length
      };

      logger.info('Export bundle created successfully', {
        bundleId,
        s3Key: exportResult.s3Key,
        fileSize: uploadResult.fileSize
      });

      return result;
    } catch (error: any) {
      logger.error('Failed to create export bundle:', error);
      
      return {
        id: bundleId,
        bundle_name,
        format,
        status: 'failed',
        created_at: new Date().toISOString(),
        document_count: document_ids.length
      };
    }
  }

  /**
   * Fetch documents from database or API
   */
  private async fetchDocuments(documentIds: string[]): Promise<DocumentData[]> {
    logger.info('Fetching documents for export', { documentIds });

    // Try to fetch from Python backend first
    const pythonApiUrl = process.env.PYTHON_API_URL || 'https://python-api-7.onrender.com';
    
    try {
      // Fetch documents from Python backend
      const documents: DocumentData[] = [];
      
      for (const id of documentIds) {
        try {
          const response = await axios.get(`${pythonApiUrl}/api/documents/${id}`, {
            timeout: 10000,
            headers: {
              'Content-Type': 'application/json'
            }
          });

          if (response.data && response.data.data) {
            const doc = response.data.data;
            documents.push({
              id: doc.id || id,
              title: doc.title || doc.name || `Document ${id}`,
              content: doc.content || doc.data || {
                sections: [
                  {
                    title: 'Document Information',
                    content: doc
                  }
                ]
              },
              metadata: {
                created_at: doc.created_at || doc.createdAt,
                seller_id: doc.seller_id || doc.sellerId,
                anomaly_id: doc.anomaly_id || doc.anomalyId,
                claim_id: doc.claim_id || doc.claimId
              }
            });
          }
        } catch (error: any) {
          logger.warn(`Failed to fetch document ${id} from Python backend:`, error.message);
          // Create a placeholder document if fetch fails
          documents.push({
            id,
            title: `Document ${id}`,
            content: {
              sections: [
                {
                  title: 'Document Information',
                  content: {
                    id,
                    note: 'Document data could not be fetched. Using placeholder.'
                  }
                }
              ]
            },
            metadata: {
              created_at: new Date().toISOString(),
              document_id: id
            }
          });
        }
      }

      if (documents.length > 0) {
        logger.info(`Successfully fetched ${documents.length} documents for export`);
        return documents;
      }
    } catch (error: any) {
      logger.warn('Failed to fetch documents from Python backend:', error.message);
    }

    // Fallback: Create mock documents if API fetch fails
    logger.warn('Using mock documents for export (API fetch failed)');
    return documentIds.map((id, index) => ({
      id,
      title: `Document ${index + 1}`,
      content: {
        sections: [
          {
            title: 'Summary',
            content: `This is document ${id}. Content will be fetched from database or API.`
          },
          {
            title: 'Details',
            content: {
              document_id: id,
              created_at: new Date().toISOString(),
              status: 'active'
            }
          }
        ]
      },
      metadata: {
        created_at: new Date().toISOString(),
        document_id: id
      }
    }));
  }

  /**
   * Generate export file (ZIP or combined PDF)
   */
  private async generateExportFile(
    documents: DocumentData[],
    format: 'zip' | 'combined_pdf',
    bundleId: string
  ): Promise<{ filePath: string; s3Key: string }> {
    const tempDir = join(process.cwd(), 'temp', 'exports', bundleId);
    await mkdir(tempDir, { recursive: true });

    try {
      if (format === 'zip') {
        return await this.createZipBundle(documents, tempDir, bundleId);
      } else {
        return await this.createCombinedPDF(documents, tempDir, bundleId);
      }
    } catch (error) {
      // Cleanup on error
      try {
        await unlink(tempDir).catch(() => {});
      } catch {}
      throw error;
    }
  }

  /**
   * Create ZIP bundle of PDFs
   */
  private async createZipBundle(
    documents: DocumentData[],
    tempDir: string,
    bundleId: string
  ): Promise<{ filePath: string; s3Key: string }> {
    return new Promise((resolve, reject) => {
      const zipPath = join(tempDir, 'bundle.zip');
      const s3Key = `exports/bundles/${bundleId}/cost-docs-bundle.zip`;
      const output = require('fs').createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        resolve({ filePath: zipPath, s3Key });
      });

      archive.on('error', reject);
      archive.pipe(output);

      // Generate PDF for each document and add to ZIP
      Promise.all(
        documents.map(async (doc) => {
          try {
            const pdfBuffer = await pdfGenerationService.generatePDFFromDocument(doc);
            const fileName = `${doc.id}.pdf`;
            archive.append(pdfBuffer, { name: fileName });
          } catch (error) {
            logger.error(`Failed to generate PDF for document ${doc.id}:`, error);
            // Continue with other documents
          }
        })
      ).then(() => {
        archive.finalize();
      }).catch(reject);
    });
  }

  /**
   * Create combined PDF from multiple documents
   */
  private async createCombinedPDF(
    documents: DocumentData[],
    tempDir: string,
    bundleId: string
  ): Promise<{ filePath: string; s3Key: string }> {
    // Generate individual PDFs first
    const pdfBuffers: Buffer[] = [];

    for (const doc of documents) {
      try {
        const pdfBuffer = await pdfGenerationService.generatePDFFromDocument(doc);
        pdfBuffers.push(pdfBuffer);
      } catch (error) {
        logger.error(`Failed to generate PDF for document ${doc.id}:`, error);
        // Continue with other documents
      }
    }

    if (pdfBuffers.length === 0) {
      throw new Error('No PDFs generated');
    }

    // Combine PDFs using pdf-merger-js or similar
    // For now, we'll use a simple approach: combine all content into one PDF
    const combinedContent = {
      id: bundleId,
      title: 'Combined Export',
      content: {
        sections: documents.map((doc, index) => ({
          title: `Document ${index + 1}: ${doc.title}`,
          content: doc.content
        }))
      },
      metadata: {
        created_at: new Date().toISOString(),
        document_count: documents.length
      }
    };

    const combinedPdfBuffer = await pdfGenerationService.generatePDFFromDocument(
      combinedContent as DocumentData
    );

    const pdfPath = join(tempDir, 'combined.pdf');
    await writeFile(pdfPath, combinedPdfBuffer);

    return {
      filePath: pdfPath,
      s3Key: `exports/bundles/${bundleId}/cost-docs-combined.pdf`
    };
  }

  /**
   * Upload file to S3
   */
  private async uploadToS3(
    filePath: string,
    s3Key: string
  ): Promise<{ url: string; fileSize: number }> {
    if (!this.bucketName) {
      logger.warn('S3 bucket not configured, skipping upload');
      // Return a mock URL for development
      return {
        url: `https://example.com/${s3Key}`,
        fileSize: 0
      };
    }

    try {
      const fileStream = createReadStream(filePath);
      const stats = await require('fs').promises.stat(filePath);
      const fileSize = stats.size;

      const uploadParams = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: fileStream,
        ContentType: s3Key.endsWith('.pdf') ? 'application/pdf' : 'application/zip',
        ACL: 'private' // Make private, generate signed URLs when needed
      };

      const uploadResult = await this.s3.upload(uploadParams).promise();

      // Generate signed URL (valid for 1 hour)
      const signedUrl = this.s3.getSignedUrl('getObject', {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: 3600
      });

      logger.info('File uploaded to S3', {
        s3Key,
        fileSize,
        location: uploadResult.Location
      });

      return {
        url: signedUrl,
        fileSize
      };
    } catch (error: any) {
      logger.error('Failed to upload to S3:', error);
      throw new Error(`S3 upload failed: ${error.message}`);
    }
  }
}

// Export singleton instance
export const exportService = new ExportService();

