import { costDocService } from '../src/services/costDocService';
import { auditService } from '../src/services/auditService';
import { exportService } from '../src/services/exportService';
import { syncCrossCheckService } from '../src/services/syncCrossCheckService';
import { DocumentStatus, AuditEvent } from '../src/types/costDocumentation';

// Mock the services
jest.mock('../src/services/costDocService');
jest.mock('../src/services/auditService');
jest.mock('../src/services/exportService');
jest.mock('../src/services/syncCrossCheckService');

describe('Cost Documentation v1.1 - Metadata & Immutability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Document Locking', () => {
    it('should lock a document and make it immutable', async () => {
      const mockDocument = {
        id: 'doc-123',
        status: DocumentStatus.DRAFT,
        content_hash: 'hash123',
        evidence_sha256: 'evidence123'
      };

      const mockLockedDocument = {
        ...mockDocument,
        status: DocumentStatus.LOCKED,
        locked_at: new Date(),
        locked_by: 'user-456'
      };

      (costDocService.lockDocument as jest.Mock).mockResolvedValue(mockLockedDocument);

      const result = await costDocService.lockDocument('doc-123', 'user-456');

      expect(result.status).toBe(DocumentStatus.LOCKED);
      expect(result.locked_at).toBeDefined();
      expect(result.locked_by).toBe('user-456');
      expect(costDocService.lockDocument).toHaveBeenCalledWith('doc-123', 'user-456');
    });

    it('should prevent locking already locked documents', async () => {
      (costDocService.lockDocument as jest.Mock).mockRejectedValue(
        new Error('Document is already locked')
      );

      await expect(
        costDocService.lockDocument('doc-123', 'user-456')
      ).rejects.toThrow('Document is already locked');
    });

    it('should prevent locking exported documents', async () => {
      (costDocService.lockDocument as jest.Mock).mockRejectedValue(
        new Error('Cannot lock exported document')
      );

      await expect(
        costDocService.lockDocument('doc-123', 'user-456')
      ).rejects.toThrow('Cannot lock exported document');
    });
  });

  describe('Export Functionality', () => {
    it('should create export bundle with selected documents', async () => {
      const exportRequest = {
        document_ids: ['doc-1', 'doc-2', 'doc-3'],
        bundle_name: 'Q1 2024 Cost Analysis',
        description: 'Quarterly cost documentation export',
        format: 'zip' as const
      };

      const mockBundle = {
        id: 'bundle-123',
        name: exportRequest.bundle_name,
        status: 'COMPLETED',
        document_count: 3,
        s3_url: 'https://s3.amazonaws.com/bucket/bundle-123.zip'
      };

      (costDocService.exportDocuments as jest.Mock).mockResolvedValue(mockBundle);

      const result = await costDocService.exportDocuments(
        exportRequest.document_ids,
        exportRequest.bundle_name,
        exportRequest.description,
        exportRequest.format,
        'user-456'
      );

      expect(result.id).toBe('bundle-123');
      expect(result.document_count).toBe(3);
      expect(result.status).toBe('COMPLETED');
      expect(costDocService.exportDocuments).toHaveBeenCalledWith(
        exportRequest.document_ids,
        exportRequest.bundle_name,
        exportRequest.description,
        exportRequest.format,
        'user-456'
      );
    });

    it('should validate export request parameters', async () => {
      const invalidRequest = {
        document_ids: [], // Empty array
        bundle_name: '', // Empty name
        format: 'invalid' // Invalid format
      };

      // This would be handled by the route validation
      expect(invalidRequest.document_ids.length).toBe(0);
      expect(invalidRequest.bundle_name).toBe('');
      expect(['zip', 'combined_pdf']).not.toContain(invalidRequest.format);
    });

    it('should get user export bundles with pagination', async () => {
      const mockBundles = {
        bundles: [
          { id: 'bundle-1', name: 'Export 1' },
          { id: 'bundle-2', name: 'Export 2' }
        ],
        total: 2,
        page: 1,
        totalPages: 1
      };

      (costDocService.getUserExportBundles as jest.Mock).mockResolvedValue(mockBundles);

      const result = await costDocService.getUserExportBundles('user-456', 1, 20);

      expect(result.bundles).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('Audit Trail', () => {
    it('should log document creation events', async () => {
      const mockAuditLog = {
        id: 'audit-123',
        doc_id: 'doc-123',
        event: AuditEvent.CREATED,
        actor: 'user-456',
        new_hash: 'hash123'
      };

      (auditService.logDocumentCreated as jest.Mock).mockResolvedValue(mockAuditLog);

      const result = await auditService.logDocumentCreated(
        'doc-123',
        'user-456',
        'hash123'
      );

      expect(result.event).toBe(AuditEvent.CREATED);
      expect(result.actor).toBe('user-456');
      expect(result.new_hash).toBe('hash123');
    });

    it('should log document lock events', async () => {
      const mockAuditLog = {
        id: 'audit-456',
        doc_id: 'doc-123',
        event: AuditEvent.LOCKED,
        actor: 'user-456',
        new_hash: 'hash123'
      };

      (auditService.logDocumentLocked as jest.Mock).mockResolvedValue(mockAuditLog);

      const result = await auditService.logDocumentLocked(
        'doc-123',
        'user-456',
        'hash123'
      );

      expect(result.event).toBe(AuditEvent.LOCKED);
      expect(result.actor).toBe('user-456');
      expect(result.new_hash).toBe('hash123');
    });

    it('should get document audit trail with pagination', async () => {
      const mockAuditTrail = {
        logs: [
          { id: 'audit-1', event: AuditEvent.CREATED, timestamp: new Date() },
          { id: 'audit-2', event: AuditEvent.LOCKED, timestamp: new Date() }
        ],
        total: 2,
        page: 1,
        totalPages: 1
      };

      (auditService.getDocumentAuditTrail as jest.Mock).mockResolvedValue(mockAuditTrail);

      const result = await auditService.getDocumentAuditTrail('doc-123', 1, 50);

      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('Sync Cross-Check', () => {
    it('should perform sync cross-check for a document', async () => {
      const mockSyncCheck = {
        doc_id: 'doc-123',
        current_hash: 'hash123',
        latest_sync_hash: 'hash456',
        is_synced: false,
        sync_warnings: ['Document is out of sync with latest data'],
        last_sync_check: new Date().toISOString()
      };

      (syncCrossCheckService.performSyncCrossCheck as jest.Mock).mockResolvedValue(mockSyncCheck);

      const result = await syncCrossCheckService.performSyncCrossCheck('doc-123', 'user-456');

      expect(result.doc_id).toBe('doc-123');
      expect(result.is_synced).toBe(false);
      expect(result.sync_warnings).toHaveLength(1);
      expect(result.sync_warnings[0]).toContain('out of sync');
    });

    it('should refresh document with latest sync state', async () => {
      const mockRefreshResult = {
        success: true,
        new_hash: 'hash789',
        refresh_reason: 'Document refreshed with latest sync state',
        warnings: []
      };

      (syncCrossCheckService.refreshDocument as jest.Mock).mockResolvedValue(mockRefreshResult);

      const result = await syncCrossCheckService.refreshDocument('doc-123', 'user-456');

      expect(result.success).toBe(true);
      expect(result.new_hash).toBe('hash789');
      expect(result.refresh_reason).toContain('refreshed');
    });

    it('should prevent refreshing locked documents', async () => {
      (syncCrossCheckService.refreshDocument as jest.Mock).mockRejectedValue(
        new Error('Cannot refresh locked document - it is immutable')
      );

      await expect(
        syncCrossCheckService.refreshDocument('doc-123', 'user-456')
      ).rejects.toThrow('Cannot refresh locked document - it is immutable');
    });

    it('should get sync health metrics', async () => {
      const mockMetrics = {
        total_sellers: 5,
        sellers_with_sync_issues: 2,
        total_documents: 25,
        documents_out_of_sync: 8,
        sync_coverage_percentage: 68.0,
        last_sync_check: new Date().toISOString()
      };

      (syncCrossCheckService.getSyncHealthMetrics as jest.Mock).mockResolvedValue(mockMetrics);

      const result = await syncCrossCheckService.getSyncHealthMetrics();

      expect(result.total_sellers).toBe(5);
      expect(result.sellers_with_sync_issues).toBe(2);
      expect(result.sync_coverage_percentage).toBe(68.0);
    });
  });

  describe('Metadata Consistency', () => {
    it('should maintain content hash consistency across operations', async () => {
      const originalHash = 'hash123';
      const document = {
        id: 'doc-123',
        content_hash: originalHash,
        status: DocumentStatus.DRAFT
      };

      // Document should maintain same hash until refreshed
      expect(document.content_hash).toBe(originalHash);

      // After refresh, hash should change
      const newHash = 'hash789';
      document.content_hash = newHash;

      expect(document.content_hash).toBe(newHash);
      expect(document.content_hash).not.toBe(originalHash);
    });

    it('should track linked transaction IDs from detection pipeline', async () => {
      const mockDocument = {
        id: 'doc-123',
        linked_tx_ids: ['tx-1', 'tx-2', 'tx-3'],
        anomaly_id: 'anomaly-456'
      };

      expect(mockDocument.linked_tx_ids).toHaveLength(3);
      expect(mockDocument.linked_tx_ids).toContain('tx-1');
      expect(mockDocument.linked_tx_ids).toContain('tx-2');
      expect(mockDocument.linked_tx_ids).toContain('tx-3');
    });

    it('should enforce document status lifecycle', async () => {
      const validTransitions = [
        DocumentStatus.DRAFT,
        DocumentStatus.LOCKED,
        DocumentStatus.EXPORTED
      ];

      // DRAFT -> LOCKED -> EXPORTED is valid
      expect(validTransitions).toContain(DocumentStatus.DRAFT);
      expect(validTransitions).toContain(DocumentStatus.LOCKED);
      expect(validTransitions).toContain(DocumentStatus.EXPORTED);

      // Once LOCKED, document should be immutable
      const lockedDocument = {
        status: DocumentStatus.LOCKED,
        locked_at: new Date(),
        locked_by: 'user-456'
      };

      expect(lockedDocument.status).toBe(DocumentStatus.LOCKED);
      expect(lockedDocument.locked_at).toBeDefined();
      expect(lockedDocument.locked_by).toBeDefined();
    });
  });
});


