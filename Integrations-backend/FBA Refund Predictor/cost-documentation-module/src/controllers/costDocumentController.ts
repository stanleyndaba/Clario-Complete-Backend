import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { CostDocumentService } from '../services/costDocumentService';
import { AuditService } from '../services/auditService';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

export class CostDocumentController {
  /**
   * Upload a new cost document
   */
  static async uploadDocument(req: AuthenticatedRequest, res: Response) {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { claimId, skuId, metadata } = req.body;
      const uploadedBy = req.user?.id || 'anonymous';

      // Create document
      const document = await CostDocumentService.createDocument({
        claimId,
        skuId,
        file: req.file,
        uploadedBy,
        metadata: metadata ? JSON.parse(metadata) : {},
      });

      logger.info('Document uploaded successfully', {
        documentId: document.id,
        claimId,
        skuId,
        uploadedBy,
      });

      res.status(201).json({
        success: true,
        data: document,
        message: 'Document uploaded successfully',
      });
    } catch (error) {
      logger.error('Upload document failed', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      });
    }
  }

  /**
   * Get document by ID
   */
  static async getDocument(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id || 'anonymous';

      const document = await CostDocumentService.getDocumentById(id, userId);

      res.json({
        success: true,
        data: document,
      });
    } catch (error) {
      logger.error('Get document failed', { error, id: req.params.id });
      res.status(404).json({
        success: false,
        error: error instanceof Error ? error.message : 'Document not found',
      });
    }
  }

  /**
   * Update document metadata
   */
  static async updateDocument(req: AuthenticatedRequest, res: Response) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { metadata } = req.body;
      const updatedBy = req.user?.id || 'anonymous';

      const document = await CostDocumentService.updateDocument(id, {
        metadata: metadata ? JSON.parse(metadata) : undefined,
        updatedBy,
      });

      res.json({
        success: true,
        data: document,
        message: 'Document updated successfully',
      });
    } catch (error) {
      logger.error('Update document failed', { error, id: req.params.id });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Update failed',
      });
    }
  }

  /**
   * Delete document
   */
  static async deleteDocument(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const deletedBy = req.user?.id || 'anonymous';

      await CostDocumentService.deleteDocument(id, deletedBy);

      res.json({
        success: true,
        message: 'Document deleted successfully',
      });
    } catch (error) {
      logger.error('Delete document failed', { error, id: req.params.id });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Delete failed',
      });
    }
  }

  /**
   * Search documents
   */
  static async searchDocuments(req: AuthenticatedRequest, res: Response) {
    try {
      const {
        claimId,
        skuId,
        fileType,
        uploadedBy,
        dateFrom,
        dateTo,
        page = '1',
        limit = '20',
      } = req.query;

      const filters = {
        claimId: claimId as string,
        skuId: skuId as string,
        fileType: fileType as string,
        uploadedBy: uploadedBy as string,
        dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
        dateTo: dateTo ? new Date(dateTo as string) : undefined,
      };

      const result = await CostDocumentService.searchDocuments(
        filters,
        parseInt(page as string),
        parseInt(limit as string)
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Search documents failed', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
      });
    }
  }

  /**
   * Get documents by claim ID
   */
  static async getDocumentsByClaim(req: AuthenticatedRequest, res: Response) {
    try {
      const { claimId } = req.params;
      const { page = '1', limit = '20' } = req.query;

      const result = await CostDocumentService.getDocumentsByClaim(
        claimId,
        parseInt(page as string),
        parseInt(limit as string)
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Get documents by claim failed', { error, claimId: req.params.claimId });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get documents',
      });
    }
  }

  /**
   * Get documents by SKU ID
   */
  static async getDocumentsBySku(req: AuthenticatedRequest, res: Response) {
    try {
      const { skuId } = req.params;
      const { page = '1', limit = '20' } = req.query;

      const result = await CostDocumentService.getDocumentsBySku(
        skuId,
        parseInt(page as string),
        parseInt(limit as string)
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Get documents by SKU failed', { error, skuId: req.params.skuId });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get documents',
      });
    }
  }

  /**
   * Get document statistics
   */
  static async getDocumentStats(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const stats = await CostDocumentService.getDocumentStats(userId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Get document stats failed', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get statistics',
      });
    }
  }

  /**
   * Get audit logs for a document
   */
  static async getDocumentAuditLogs(req: AuthenticatedRequest, res: Response) {
    try {
      const { id } = req.params;
      const { limit = '50' } = req.query;

      const auditLogs = await AuditService.getDocumentAuditLogs(
        id,
        parseInt(limit as string)
      );

      res.json({
        success: true,
        data: auditLogs,
      });
    } catch (error) {
      logger.error('Get audit logs failed', { error, id: req.params.id });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get audit logs',
      });
    }
  }

  /**
   * Get audit statistics
   */
  static async getAuditStats(req: AuthenticatedRequest, res: Response) {
    try {
      const { dateFrom, dateTo } = req.query;

      const stats = await AuditService.getAuditStats(
        dateFrom ? new Date(dateFrom as string) : undefined,
        dateTo ? new Date(dateTo as string) : undefined
      );

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Get audit stats failed', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get audit statistics',
      });
    }
  }
}

// Validation schemas
export const uploadDocumentValidation = [
  body('claimId').isString().notEmpty().withMessage('Claim ID is required'),
  body('skuId').isString().notEmpty().withMessage('SKU ID is required'),
  body('metadata').optional().isString().withMessage('Metadata must be a valid JSON string'),
];

export const updateDocumentValidation = [
  param('id').isUUID().withMessage('Invalid document ID'),
  body('metadata').optional().isString().withMessage('Metadata must be a valid JSON string'),
];

export const searchDocumentsValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('dateFrom').optional().isISO8601().withMessage('Date from must be a valid date'),
  query('dateTo').optional().isISO8601().withMessage('Date to must be a valid date'),
]; 