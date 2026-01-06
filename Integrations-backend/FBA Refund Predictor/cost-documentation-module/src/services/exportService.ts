import { PrismaClient } from '@prisma/client';
import { S3 } from 'aws-sdk';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream as createWriteStreamAsync } from 'fs';
import { createReadStream as createReadStreamAsync } from 'fs';
import { createGzip } from 'zlib';
import { createHash } from 'crypto';
import { 
  ExportBundle, 
  ExportBundleItem, 
  ExportRequest, 
  ExportStatus,
  NotificationLog,
  GeneratedPDF 
} from '../types/costDocumentation';

const prisma = new PrismaClient();

export class ExportService {
  private s3: S3;

  constructor() {
    this.s3 = new S3({
      accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'],
      region: process.env['AWS_REGION'] || 'us-east-1'
    });
  }

  /**
   * Create an export bundle from selected documents
   */
  async createExportBundle(request: ExportRequest, userId: string): Promise<ExportBundle> {
    const { document_ids, bundle_name, description, format } = request;

    // Validate documents exist and are accessible
    const documents = await prisma.generatedPDF.findMany({
      where: {
        id: { in: document_ids },
        status: { in: ['DRAFT', 'LOCKED'] } // Only export draft or locked docs
      }
    });

    if (documents.length !== document_ids.length) {
      throw new Error('Some documents not found or not exportable');
    }

    // Create export bundle record
    const bundle = await prisma.exportBundle.create({
      data: {
        name: bundle_name,
        description,
        created_by: userId,
        status: ExportStatus.PROCESSING,
        document_count: documents.length,
        s3_key: '', // Will be set after upload
        s3_url: '', // Will be set after upload
        file_size: 0 // Will be set after upload
      }
    });

    try {
      // Create bundle items
      await prisma.exportBundleItem.createMany({
        data: document_ids.map(docId => ({
          bundle_id: bundle.id,
          document_id: docId
        }))
      });

      // Generate the export file
      const exportResult = await this.generateExportFile(documents, format, bundle.id);
      
      // Update bundle with S3 details
      const updatedBundle = await prisma.exportBundle.update({
        where: { id: bundle.id },
        data: {
          s3_key: exportResult.s3Key,
          s3_url: exportResult.s3Url,
          file_size: exportResult.fileSize,
          status: ExportStatus.COMPLETED,
          completed_at: new Date()
        }
      });

      // Mark documents as exported
      await prisma.generatedPDF.updateMany({
        where: { id: { in: document_ids } },
        data: {
          status: 'EXPORTED',
          exported_at: new Date(),
          exported_by: userId,
          export_bundle_id: bundle.id
        }
      });

      // Create notification log entry
      await this.createNotificationLog({
        event_type: 'export_completed',
        event_data: {
          bundle_id: bundle.id,
          bundle_name,
          document_ids,
          document_count: documents.length,
          s3_url: exportResult.s3Url,
          format
        },
        user_id: userId
      });

      return updatedBundle;

    } catch (error) {
      // Update bundle status to failed
      await prisma.exportBundle.update({
        where: { id: bundle.id },
        data: {
          status: ExportStatus.FAILED
        }
      });

      throw error;
    }
  }

  /**
   * Generate export file (ZIP or combined PDF)
   */
  private async generateExportFile(
    documents: GeneratedPDF[], 
    format: 'zip' | 'combined_pdf',
    bundleId: string
  ): Promise<{ s3Key: string; s3Url: string; fileSize: number }> {
    const tempDir = join(process.cwd(), 'temp', 'exports', bundleId);
    await mkdir(tempDir, { recursive: true });

    try {
      let exportFilePath: string;
      let s3Key: string;

      if (format === 'zip') {
        exportFilePath = await this.createZipBundle(documents, tempDir);
        s3Key = `exports/bundles/${bundleId}/cost-docs-bundle.zip`;
      } else {
        exportFilePath = await this.createCombinedPDF(documents, tempDir);
        s3Key = `exports/bundles/${bundleId}/cost-docs-combined.pdf`;
      }

      // Upload to S3
      const uploadResult = await this.uploadToS3(exportFilePath, s3Key);
      
      // Clean up temp file
      await unlink(exportFilePath);

      return {
        s3Key,
        s3Url: uploadResult.url,
        fileSize: uploadResult.fileSize
      };

    } finally {
      // Clean up temp directory
      await this.cleanupTempDirectory(tempDir);
    }
  }

  /**
   * Create ZIP bundle of PDFs
   */
  private async createZipBundle(documents: GeneratedPDF[], tempDir: string): Promise<string> {
    const archiver = require('archiver');
    const zipPath = join(tempDir, 'bundle.zip');
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => resolve(zipPath));
      archive.on('error', reject);

      archive.pipe(output);

      // Add each PDF to the archive
      documents.forEach(doc => {
        const fileName = `${doc.anomaly_id}_${doc.seller_id}.pdf`;
        archive.append(createReadStream(doc.pdf_s3_key), { name: fileName });
      });

      archive.finalize();
    });
  }

  /**
   * Create combined PDF from multiple PDFs
   */
  private async createCombinedPDF(documents: GeneratedPDF[], tempDir: string): Promise<string> {
    const PDFMerger = require('pdf-merger-js');
    const merger = new PDFMerger();
    const outputPath = join(tempDir, 'combined.pdf');

    // Add each PDF to the merger
    for (const doc of documents) {
      await merger.add(doc.pdf_s3_key);
    }

    // Save combined PDF
    await merger.save(outputPath);
    return outputPath;
  }

  /**
   * Upload file to S3
   */
  private async uploadToS3(filePath: string, s3Key: string): Promise<{ url: string; fileSize: number }> {
    const fileStream = createReadStream(filePath);
    const stats = await import('fs').then(fs => fs.promises.stat(filePath));

    const uploadParams = {
      Bucket: process.env['S3_BUCKET']!,
      Key: s3Key,
      Body: fileStream,
      ContentType: s3Key.endsWith('.zip') ? 'application/zip' : 'application/pdf',
      Metadata: {
        'export-timestamp': new Date().toISOString(),
        'document-count': '1'
      }
    };

    await this.s3.upload(uploadParams).promise();

    // Generate signed URL
    const signedUrl = await this.s3.getSignedUrl('getObject', {
      Bucket: process.env['S3_BUCKET']!,
      Key: s3Key,
      Expires: parseInt(process.env['S3_SIGNED_URL_TTL'] || '3600')
    });

    return {
      url: signedUrl,
      fileSize: stats.size
    };
  }

  /**
   * Create notification log entry
   */
  private async createNotificationLog(notification: Omit<NotificationLog, 'id' | 'created_at' | 'is_read'>): Promise<void> {
    await prisma.notificationLog.create({
      data: {
        event_type: notification.event_type,
        event_data: notification.event_data,
        user_id: notification.user_id
      }
    });
  }

  /**
   * Clean up temporary directory
   */
  private async cleanupTempDirectory(tempDir: string): Promise<void> {
    try {
      const { rm } = await import('fs/promises');
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup temp directory:', error);
    }
  }

  /**
   * Get export bundle by ID
   */
  async getExportBundle(bundleId: string): Promise<ExportBundle | null> {
    return prisma.exportBundle.findUnique({
      where: { id: bundleId },
      include: {
        documents: {
          include: {
            document: true
          }
        }
      }
    });
  }

  /**
   * Get export bundles for user
   */
  async getUserExportBundles(userId: string, page: number = 1, limit: number = 20): Promise<{
    bundles: ExportBundle[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [bundles, total] = await Promise.all([
      prisma.exportBundle.findMany({
        where: { created_by: userId },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit
      }),
      prisma.exportBundle.count({
        where: { created_by: userId }
      })
    ]);

    return {
      bundles,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Delete export bundle (admin only)
   */
  async deleteExportBundle(bundleId: string): Promise<void> {
    // Delete from S3
    try {
      const bundle = await prisma.exportBundle.findUnique({
        where: { id: bundleId }
      });

      if (bundle?.s3_key) {
        await this.s3.deleteObject({
          Bucket: process.env['S3_BUCKET']!,
          Key: bundle.s3_key
        }).promise();
      }
    } catch (error) {
      console.warn('Failed to delete S3 object:', error);
    }

    // Delete from database
    await prisma.exportBundle.delete({
      where: { id: bundleId }
    });
  }
}

export const exportService = new ExportService();


