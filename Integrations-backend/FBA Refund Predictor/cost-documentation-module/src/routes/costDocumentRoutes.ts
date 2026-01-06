import { Router } from 'express';
import multer from 'multer';
import { CostDocumentController, uploadDocumentValidation, updateDocumentValidation, searchDocumentsValidation } from '../controllers/costDocumentController';
import { authenticateToken, requireRole, requireUser } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  },
});

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Upload document
router.post(
  '/upload',
  upload.single('file'),
  uploadDocumentValidation,
  CostDocumentController.uploadDocument
);

// Get document by ID
router.get(
  '/:id',
  requireUser,
  CostDocumentController.getDocument
);

// Update document metadata
router.put(
  '/:id',
  requireUser,
  updateDocumentValidation,
  CostDocumentController.updateDocument
);

// Delete document
router.delete(
  '/:id',
  requireRole(['admin', 'agent']),
  CostDocumentController.deleteDocument
);

// Search documents
router.get(
  '/search',
  requireUser,
  searchDocumentsValidation,
  CostDocumentController.searchDocuments
);

// Get documents by claim ID
router.get(
  '/claim/:claimId',
  requireUser,
  CostDocumentController.getDocumentsByClaim
);

// Get documents by SKU ID
router.get(
  '/sku/:skuId',
  requireUser,
  CostDocumentController.getDocumentsBySku
);

// Get document statistics
router.get(
  '/stats/overview',
  requireUser,
  CostDocumentController.getDocumentStats
);

// Get audit logs for a document
router.get(
  '/:id/audit-logs',
  requireRole(['admin', 'agent']),
  CostDocumentController.getDocumentAuditLogs
);

// Get audit statistics
router.get(
  '/stats/audit',
  requireRole(['admin']),
  CostDocumentController.getAuditStats
);

// Error handling middleware for multer
router.use((error: any, req: any, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    logger.error('Multer error', { error: error.message });
    return res.status(400).json({
      success: false,
      error: 'File upload error',
      details: error.message,
    });
  }

  if (error.message.includes('File type')) {
    logger.warn('Invalid file type uploaded', { 
      fileType: req.file?.mimetype,
      originalName: req.file?.originalname,
    });
    return res.status(400).json({
      success: false,
      error: 'Invalid file type',
      details: error.message,
    });
  }

  next(error);
});

export default router; 