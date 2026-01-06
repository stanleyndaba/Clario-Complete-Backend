import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { 
  SyncCrossCheck, 
  GeneratedPDF,
  AuditEvent 
} from '../types/costDocumentation';
import { auditService } from './auditService';

const prisma = new PrismaClient();

export class SyncCrossCheckService {
  /**
   * Perform sync cross-check for a document
   */
  async performSyncCrossCheck(
    docId: string,
    actor: string
  ): Promise<SyncCrossCheck> {
    // Get the current document
    const document = await prisma.generatedPDF.findUnique({
      where: { id: docId }
    });

    if (!document) {
      throw new Error('Document not found');
    }

    // Get the latest sync state for this seller
    const latestSyncState = await this.getLatestSyncState(document.seller_id);
    
    // Compute current document hash
    const currentHash = document.content_hash;
    
    // Compute latest sync hash
    const latestSyncHash = this.computeSyncStateHash(latestSyncState);
    
    // Check if document is in sync
    const isSynced = currentHash === latestSyncHash;
    
    // Generate sync warnings if out of sync
    const syncWarnings = isSynced ? [] : this.generateSyncWarnings(document, latestSyncState);
    
    // Log sync warning if out of sync
    if (!isSynced) {
      await auditService.logSyncWarning(docId, actor, {
        current_hash: currentHash,
        latest_sync_hash: latestSyncHash,
        sync_warnings: syncWarnings,
        seller_id: document.seller_id,
        anomaly_id: document.anomaly_id
      });
    }

    return {
      doc_id: docId,
      current_hash: currentHash,
      latest_sync_hash: latestSyncHash,
      is_synced: isSynced,
      sync_warnings: syncWarnings,
      last_sync_check: new Date().toISOString()
    };
  }

  /**
   * Get latest sync state for a seller
   */
  private async getLatestSyncState(sellerId: string): Promise<any> {
    // Get the most recent detection job for this seller
    const latestJob = await prisma.detectionJob.findFirst({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: {
        detectionResults: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!latestJob) {
      return { seller_id: sellerId, last_sync: null, anomalies: [] };
    }

    // Get all detection results for this sync
    const detectionResults = await prisma.detectionResult.findMany({
      where: { 
        detectionJobId: latestJob.id,
        sellerId 
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      seller_id: sellerId,
      last_sync: latestJob.createdAt,
      sync_id: latestJob.syncId,
      job_status: latestJob.status,
      anomalies: detectionResults.map(result => ({
        id: result.id,
        rule_type: result.ruleType,
        severity: result.severity,
        score: result.score,
        summary: result.summary,
        evidence_hash: result.dedupeHash,
        created_at: result.createdAt
      }))
    };
  }

  /**
   * Compute hash of sync state for comparison
   */
  private computeSyncStateHash(syncState: any): string {
    // Create a canonical representation of the sync state
    const canonicalState = {
      seller_id: syncState.seller_id,
      last_sync: syncState.last_sync?.toISOString(),
      sync_id: syncState.sync_id,
      job_status: syncState.job_status,
      anomalies: syncState.anomalies
        .sort((a: any, b: any) => a.id.localeCompare(b.id))
        .map((anomaly: any) => ({
          id: anomaly.id,
          rule_type: anomaly.rule_type,
          severity: anomaly.severity,
          score: anomaly.score,
          evidence_hash: anomaly.evidence_hash
        }))
    };

    const stateString = JSON.stringify(canonicalState, Object.keys(canonicalState).sort());
    return createHash('sha256').update(stateString).digest('hex');
  }

  /**
   * Generate sync warnings for out-of-sync documents
   */
  private generateSyncWarnings(document: GeneratedPDF, latestSyncState: any): string[] {
    const warnings: string[] = [];
    
    if (!latestSyncState.last_sync) {
      warnings.push('No recent sync data available for this seller');
      return warnings;
    }

    // Check if document was created before last sync
    const docCreatedAt = new Date(document.generated_at);
    const lastSyncAt = new Date(latestSyncState.last_sync);
    
    if (docCreatedAt < lastSyncAt) {
      warnings.push('Document was created before the latest sync - new data may be available');
    }

    // Check for new anomalies that might affect this document
    const newAnomalies = latestSyncState.anomalies.filter((anomaly: any) => {
      const anomalyCreatedAt = new Date(anomaly.created_at);
      return anomalyCreatedAt > docCreatedAt;
    });

    if (newAnomalies.length > 0) {
      warnings.push(`${newAnomalies.length} new anomalies detected since document creation`);
    }

    // Check for high-severity anomalies
    const highSeverityAnomalies = latestSyncState.anomalies.filter(
      (anomaly: any) => anomaly.severity === 'HIGH' || anomaly.severity === 'CRITICAL'
    );

    if (highSeverityAnomalies.length > 0) {
      warnings.push(`${highSeverityAnomalies.length} high-severity anomalies detected`);
    }

    return warnings;
  }

  /**
   * Get sync cross-check status for multiple documents
   */
  async getBulkSyncCrossCheck(
    docIds: string[],
    actor: string
  ): Promise<SyncCrossCheck[]> {
    const results = await Promise.all(
      docIds.map(docId => this.performSyncCrossCheck(docId, actor))
    );

    return results;
  }

  /**
   * Get sync cross-check summary for a seller
   */
  async getSellerSyncSummary(sellerId: string): Promise<{
    total_documents: number;
    synced_documents: number;
    out_of_sync_documents: number;
    last_sync_check: string;
    sync_warnings: string[];
  }> {
    // Get all documents for this seller
    const documents = await prisma.generatedPDF.findMany({
      where: { seller_id: sellerId },
      select: { id: true, content_hash: true, generated_at: true }
    });

    // Get latest sync state
    const latestSyncState = await this.getLatestSyncState(sellerId);
    const latestSyncHash = this.computeSyncStateHash(latestSyncState);

    // Check each document
    let syncedCount = 0;
    let outOfSyncCount = 0;
    const syncWarnings: string[] = [];

    for (const doc of documents) {
      if (doc.content_hash === latestSyncHash) {
        syncedCount++;
      } else {
        outOfSyncCount++;
        syncWarnings.push(`Document ${doc.id} is out of sync`);
      }
    }

    return {
      total_documents: documents.length,
      synced_documents: syncedCount,
      out_of_sync_documents: outOfSyncCount,
      last_sync_check: new Date().toISOString(),
      sync_warnings: syncWarnings
    };
  }

  /**
   * Refresh a document with latest sync state
   */
  async refreshDocument(
    docId: string,
    actor: string
  ): Promise<{
    success: boolean;
    new_hash: string;
    refresh_reason: string;
    warnings: string[];
  }> {
    const document = await prisma.generatedPDF.findUnique({
      where: { id: docId }
    });

    if (!document) {
      throw new Error('Document not found');
    }

    if (document.status === 'LOCKED') {
      throw new Error('Cannot refresh locked document - it is immutable');
    }

    // Get latest sync state
    const latestSyncState = await this.getLatestSyncState(document.seller_id);
    const latestSyncHash = this.computeSyncStateHash(latestSyncState);

    // Check if refresh is actually needed
    if (document.content_hash === latestSyncHash) {
      return {
        success: false,
        new_hash: document.content_hash,
        refresh_reason: 'Document is already in sync',
        warnings: []
      };
    }

    // Store previous hash for audit trail
    const prevHash = document.content_hash;

    // Update document with new hash and sync data
    const updatedDocument = await prisma.generatedPDF.update({
      where: { id: docId },
      data: {
        content_hash: latestSyncHash,
        linked_tx_ids: this.extractTransactionIds(latestSyncState),
        metadata: {
          ...document.metadata,
          last_refresh: new Date().toISOString(),
          refresh_reason: 'sync_cross_check',
          previous_hash: prevHash
        }
      }
    });

    // Log the refresh in audit trail
    await auditService.logDocumentRefreshed(
      docId,
      actor,
      prevHash,
      latestSyncHash,
      {
        refresh_reason: 'sync_cross_check',
        latest_sync_state: latestSyncState
      }
    );

    // Generate warnings for the refresh
    const warnings = this.generateSyncWarnings(updatedDocument, latestSyncState);

    return {
      success: true,
      new_hash: latestSyncHash,
      refresh_reason: 'Document refreshed with latest sync state',
      warnings
    };
  }

  /**
   * Extract transaction IDs from sync state
   */
  private extractTransactionIds(syncState: any): string[] {
    if (!syncState.anomalies) return [];
    
    return syncState.anomalies
      .map((anomaly: any) => anomaly.id)
      .filter(Boolean);
  }

  /**
   * Get sync health metrics
   */
  async getSyncHealthMetrics(): Promise<{
    total_sellers: number;
    sellers_with_sync_issues: number;
    total_documents: number;
    documents_out_of_sync: number;
    sync_coverage_percentage: number;
    last_sync_check: string;
  }> {
    // Get all unique sellers
    const sellers = await prisma.generatedPDF.groupBy({
      by: ['seller_id'],
      _count: { seller_id: true }
    });

    let sellersWithIssues = 0;
    let totalDocuments = 0;
    let documentsOutOfSync = 0;

    // Check each seller
    for (const seller of sellers) {
      const summary = await this.getSellerSyncSummary(seller.seller_id);
      
      if (summary.out_of_sync_documents > 0) {
        sellersWithIssues++;
      }
      
      totalDocuments += summary.total_documents;
      documentsOutOfSync += summary.out_of_sync_documents;
    }

    const syncCoveragePercentage = totalDocuments > 0 
      ? ((totalDocuments - documentsOutOfSync) / totalDocuments) * 100
      : 100;

    return {
      total_sellers: sellers.length,
      sellers_with_sync_issues: sellersWithIssues,
      total_documents: totalDocuments,
      documents_out_of_sync: documentsOutOfSync,
      sync_coverage_percentage: Math.round(syncCoveragePercentage * 100) / 100,
      last_sync_check: new Date().toISOString()
    };
  }
}

export const syncCrossCheckService = new SyncCrossCheckService();


