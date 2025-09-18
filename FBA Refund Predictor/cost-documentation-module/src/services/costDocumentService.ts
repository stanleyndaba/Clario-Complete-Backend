import { prisma } from '../config/database';
import { S3Service } from './s3Service';
import { logger } from '../utils/logger';
import { AuditService } from './auditService';

export interface CreateCostDocumentData {
  claimId: string;
  skuId: string;
  file: Express.Multer.File;
  uploadedBy: string;
  metadata?: Record<string, any>;
}

export interface UpdateCostDocumentData {
  metadata?: Record<string, any>;
  version?: number;
  updatedBy: string;
}

export interface SearchFilters {
  claimId?: string;
  skuId?: string;
  fileType?: string;
  uploadedBy?: string;
  dateFrom?: Date;
  dateTo?: Date;
  metadata?: Record<string, any>;
}

export interface SearchResult {
  documents: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class CostDocumentService {
  /**
   * Create a new cost document
   */
  static async createDocument(data: CreateCostDocumentData) {
    try {
      // Validate file
      S3Service.validateFile(data.file);

      // Upload to S3
      const uploadResult = await S3Service.uploadFile(
        data.file,
        data.claimId,
        data.skuId
      );

      // Create database record
      const document = await prisma.costDocument.create({
        data: {
          claimId: data.claimId,
          skuId: data.skuId,
          fileKey: uploadResult.fileKey,
          originalName: uploadResult.originalName,
          fileType: uploadResult.fileType,
          fileSize: uploadResult.fileSize,
          metadata: data.metadata || {},
          uploadedBy: data.uploadedBy,
        },
      });

      // Log audit event
      await AuditService.logAction({
        costDocId: document.id,
        action: 'UPLOAD',
        performedBy: data.uploadedBy,
        details: {
          fileKey: uploadResult.fileKey,
          originalName: uploadResult.originalName,
          fileSize: uploadResult.fileSize,
          claimId: data.claimId,
          skuId: data.skuId,
        },
      });

      logger.info('Cost document created', {
        documentId: document.id,
        claimId: data.claimId,
        skuId: data.skuId,
      });

      return document;
    } catch (error) {
      logger.error('Failed to create cost document', { error, data });
      throw error;
    }
  }

  /**
   * Get document by ID with download URL
   */
  static async getDocumentById(id: string, userId: string) {
    try {
      const document = await prisma.costDocument.findFirst({
        where: {
          id,
          isActive: true,
          // Add user access control here if needed
        },
        include: {
          auditLogs: {
            orderBy: { timestamp: 'desc' },
            take: 10,
          },
        },
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // Generate download URL
      const downloadResult = await S3Service.generateDownloadUrl(document.fileKey);

      return {
        ...document,
        downloadUrl: downloadResult.url,
        downloadUrlExpires: downloadResult.expiresIn,
      };
    } catch (error) {
      logger.error('Failed to get document', { error, id });
      throw error;
    }
  }

  /**
   * Update document metadata
   */
  static async updateDocument(id: string, data: UpdateCostDocumentData) {
    try {
      const existingDocument = await prisma.costDocument.findFirst({
        where: { id, isActive: true },
      });

      if (!existingDocument) {
        throw new Error('Document not found');
      }

      // Create new version if metadata is being updated
      const newVersion = data.metadata ? existingDocument.version + 1 : existingDocument.version;

      const updatedDocument = await prisma.costDocument.update({
        where: { id },
        data: {
          metadata: data.metadata || existingDocument.metadata,
          version: newVersion,
        },
      });

      // Log audit event
      await AuditService.logAction({
        costDocId: id,
        action: data.metadata ? 'VERSION_UPDATE' : 'UPDATE',
        performedBy: data.updatedBy,
        details: {
          oldVersion: existingDocument.version,
          newVersion: newVersion,
          metadataChanges: data.metadata,
        },
      });

      logger.info('Document updated', { id, newVersion });

      return updatedDocument;
    } catch (error) {
      logger.error('Failed to update document', { error, id });
      throw error;
    }
  }

  /**
   * Delete document (soft delete)
   */
  static async deleteDocument(id: string, deletedBy: string) {
    try {
      const document = await prisma.costDocument.findFirst({
        where: { id, isActive: true },
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // Soft delete
      await prisma.costDocument.update({
        where: { id },
        data: { isActive: false },
      });

      // Log audit event
      await AuditService.logAction({
        costDocId: id,
        action: 'DELETE',
        performedBy: deletedBy,
        details: {
          fileKey: document.fileKey,
          originalName: document.originalName,
        },
      });

      logger.info('Document deleted', { id, deletedBy });

      return { success: true };
    } catch (error) {
      logger.error('Failed to delete document', { error, id });
      throw error;
    }
  }

  /**
   * Search documents with filters and pagination
   */
  static async searchDocuments(
    filters: SearchFilters,
    page: number = 1,
    limit: number = 20
  ): Promise<SearchResult> {
    try {
      const skip = (page - 1) * limit;

      // Build where clause
      const where: any = {
        isActive: true,
      };

      if (filters.claimId) where.claimId = filters.claimId;
      if (filters.skuId) where.skuId = filters.skuId;
      if (filters.fileType) where.fileType = filters.fileType;
      if (filters.uploadedBy) where.uploadedBy = filters.uploadedBy;
      if (filters.dateFrom || filters.dateTo) {
        where.uploadedAt = {};
        if (filters.dateFrom) where.uploadedAt.gte = filters.dateFrom;
        if (filters.dateTo) where.uploadedAt.lte = filters.dateTo;
      }

      // Get total count
      const total = await prisma.costDocument.count({ where });

      // Get documents
      const documents = await prisma.costDocument.findMany({
        where,
        skip,
        take: limit,
        orderBy: { uploadedAt: 'desc' },
        include: {
          auditLogs: {
            orderBy: { timestamp: 'desc' },
            take: 5,
          },
        },
      });

      const totalPages = Math.ceil(total / limit);

      return {
        documents,
        total,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      logger.error('Failed to search documents', { error, filters });
      throw error;
    }
  }

  /**
   * Get documents by claim ID
   */
  static async getDocumentsByClaim(claimId: string, page: number = 1, limit: number = 20) {
    return this.searchDocuments({ claimId }, page, limit);
  }

  /**
   * Get documents by SKU ID
   */
  static async getDocumentsBySku(skuId: string, page: number = 1, limit: number = 20) {
    return this.searchDocuments({ skuId }, page, limit);
  }

  /**
   * Get document statistics
   */
  static async getDocumentStats(userId?: string) {
    try {
      const where: any = { isActive: true };
      if (userId) where.uploadedBy = userId;

      const [
        totalDocuments,
        totalSize,
        documentsByType,
        recentUploads,
      ] = await Promise.all([
        prisma.costDocument.count({ where }),
        prisma.costDocument.aggregate({
          where,
          _sum: { fileSize: true },
        }),
        prisma.costDocument.groupBy({
          by: ['fileType'],
          where,
          _count: { fileType: true },
        }),
        prisma.costDocument.findMany({
          where,
          orderBy: { uploadedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            originalName: true,
            uploadedAt: true,
            claimId: true,
            skuId: true,
          },
        }),
      ]);

      return {
        totalDocuments,
        totalSize: totalSize._sum.fileSize || 0,
        documentsByType,
        recentUploads,
      };
    } catch (error) {
      logger.error('Failed to get document stats', { error });
      throw error;
    }
  }
} 