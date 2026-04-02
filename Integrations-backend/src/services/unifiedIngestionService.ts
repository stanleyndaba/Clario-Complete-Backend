/**
 * Unified Ingestion Service
 * Orchestrates evidence ingestion from all connected sources
 * Processes multiple sources in parallel for efficiency
 */

import logger from '../utils/logger';
import { gmailIngestionService } from './gmailIngestionService';
import { outlookIngestionService } from './outlookIngestionService';
import { googleDriveIngestionService } from './googleDriveIngestionService';
import { dropboxIngestionService } from './dropboxIngestionService';
import { oneDriveIngestionService } from './oneDriveIngestionService';
import { adobeSignIngestionService } from './adobeSignIngestionService';
import { slackIngestionService } from './slackIngestionService';
import {
  EvidenceSourceContext,
  resolveEvidenceSourcesForIngestion,
  markEvidenceSourceIngested
} from './evidenceSourceTruthService';

export interface UnifiedIngestionResult {
  success: boolean;
  totalDocumentsIngested: number;
  totalItemsProcessed: number;
  errors: string[];
  sourcesResolved: number;
  providersAttempted: string[];
  skippedProviders: Array<{ provider: string; reason: string }>;
  results: {
    gmail?: {
      success: boolean;
      documentsIngested: number;
      emailsProcessed: number;
      errors: string[];
    };
    outlook?: {
      success: boolean;
      documentsIngested: number;
      emailsProcessed: number;
      errors: string[];
    };
    gdrive?: {
      success: boolean;
      documentsIngested: number;
      filesProcessed: number;
      errors: string[];
    };
    dropbox?: {
      success: boolean;
      documentsIngested: number;
      filesProcessed: number;
      errors: string[];
    };
    onedrive?: {
      success: boolean;
      documentsIngested: number;
      filesProcessed: number;
      errors: string[];
    };
    adobe_sign?: {
      success: boolean;
      documentsIngested: number;
      agreementsProcessed: number;
      errors: string[];
    };
    slack?: {
      success: boolean;
      documentsIngested: number;
      messagesProcessed: number;
      errors: string[];
    };
  };
  jobId?: string;
}

export interface IngestionOptions {
  providers?: string[]; // ['gmail', 'outlook', 'gdrive', 'dropbox', 'onedrive', 'adobe_sign', 'slack'] - if not specified, uses all connected
  query?: string;
  maxResults?: number;
  autoParse?: boolean;
  folderId?: string; // For Google Drive
  folderPath?: string; // For Dropbox
}

export class UnifiedIngestionService {
  /**
   * Ingest evidence from all connected sources
   * Processes sources in parallel for efficiency
   */
  async ingestFromAllSources(
    userId: string,
    options: IngestionOptions = {},
    tenantId?: string
  ): Promise<UnifiedIngestionResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let totalDocumentsIngested = 0;
    let totalItemsProcessed = 0;
    const results: UnifiedIngestionResult['results'] = {};
    let sourcesResolved = 0;
    const providersAttempted: string[] = [];
    let skippedProviders: UnifiedIngestionResult['skippedProviders'] = [];

    try {
      logger.info('🔍 [UNIFIED INGESTION] Starting unified evidence ingestion', {
        userId,
        tenantId,
        providers: options.providers,
        maxResults: options.maxResults || 50
      });

      if (!tenantId) {
        return {
          success: false,
          totalDocumentsIngested: 0,
          totalItemsProcessed: 0,
          errors: ['Tenant context is required for evidence ingestion'],
          sourcesResolved: 0,
          providersAttempted: [],
          skippedProviders: [{ provider: 'all', reason: 'tenant_context_missing' }],
          results: {}
        };
      }

      const resolution = await resolveEvidenceSourcesForIngestion(userId, tenantId, options.providers);
      const connectedSources = resolution.resolvedSources;
      skippedProviders = resolution.skippedSources;
      sourcesResolved = connectedSources.length;

      if (connectedSources.length === 0) {
        logger.warn('⚠️ [UNIFIED INGESTION] No connected evidence sources found', {
          userId,
          tenantId,
          skippedProviders
        });
        return {
          success: false,
          totalDocumentsIngested: 0,
          totalItemsProcessed: 0,
          errors: ['No ingestable evidence sources found for this tenant'],
          sourcesResolved: 0,
          providersAttempted: [],
          skippedProviders,
          results: {}
        };
      }

      logger.info(`✅ [UNIFIED INGESTION] Resolved ${connectedSources.length} ingestable sources`, {
        userId,
        tenantId,
        sources: connectedSources.map(s => s.provider),
        skippedProviders
      });

      // Process all sources in parallel
      const ingestionPromises = connectedSources.map(source => {
        providersAttempted.push(source.provider);
        return this.ingestFromSource(userId, source, {
          ...options,
          tenantId
        });
      }
      );

      const ingestionResults = await Promise.allSettled(ingestionPromises);

      // Aggregate results
      for (let index = 0; index < ingestionResults.length; index += 1) {
        const result = ingestionResults[index];
        const source = connectedSources[index];
        const provider = source.provider;

        if (result.status === 'fulfilled') {
          const providerResult = result.value;
          results[provider as keyof typeof results] = providerResult as any;

          totalDocumentsIngested += providerResult.documentsIngested || 0;
          totalItemsProcessed += providerResult.itemsProcessed || 0;

          if ((providerResult.documentsIngested || 0) > 0) {
            await markEvidenceSourceIngested(source.id);
          }

          if (providerResult.errors && providerResult.errors.length > 0) {
            errors.push(...providerResult.errors.map(e => `[${provider}] ${e}`));
          }
        } else {
          const errorMsg = `[${provider}] ${result.reason?.message || String(result.reason)}`;
          errors.push(errorMsg);
          logger.error(`❌ [UNIFIED INGESTION] Error ingesting from ${provider}`, {
            error: result.reason,
            userId
          });
        }
      }

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const noDocumentsIngested = totalDocumentsIngested === 0;
      if (noDocumentsIngested && errors.length === 0) {
        errors.push('No documents were ingested from the resolved evidence sources');
      }

      logger.info('✅ [UNIFIED INGESTION] Unified evidence ingestion completed', {
        userId,
        totalDocumentsIngested,
        totalItemsProcessed,
        errors: errors.length,
        elapsedTime: `${elapsedTime}s`,
        sources: connectedSources.map(s => s.provider)
      });

      return {
        success: !noDocumentsIngested && errors.length === 0,
        totalDocumentsIngested,
        totalItemsProcessed,
        errors,
        sourcesResolved,
        providersAttempted,
        skippedProviders,
        results
      };
    } catch (error: any) {
      logger.error('❌ [UNIFIED INGESTION] Critical error in unified ingestion', {
        error: error?.message || String(error),
        stack: error?.stack,
        userId
      });

      return {
        success: false,
        totalDocumentsIngested,
        totalItemsProcessed,
        errors: [error?.message || String(error)],
        sourcesResolved,
        providersAttempted,
        skippedProviders,
        results
      };
    }
  }

  /**
   * Ingest from a specific source
   */
  private async ingestFromSource(
    userId: string,
    source: EvidenceSourceContext,
    options: IngestionOptions & { tenantId: string }
  ): Promise<{
    success: boolean;
    documentsIngested: number;
    itemsProcessed: number;
    errors: string[];
  }> {
    const provider = source.provider;
    try {
      logger.info(`🔍 [UNIFIED INGESTION] Ingesting from ${provider}`, {
        userId,
        provider,
        tenantId: options.tenantId,
        sourceId: source.id
      });

      switch (provider) {
        case 'gmail':
          const gmailResult = await gmailIngestionService.ingestEvidenceFromGmail(userId, {
            query: options.query,
            maxResults: options.maxResults,
            autoParse: options.autoParse,
            tenantId: options.tenantId
          });
          return {
            success: gmailResult.success,
            documentsIngested: gmailResult.documentsIngested,
            itemsProcessed: gmailResult.emailsProcessed,
            errors: gmailResult.errors
          };

        case 'outlook':
          const outlookResult = await outlookIngestionService.ingestEvidenceFromOutlook(userId, {
            query: options.query,
            maxResults: options.maxResults,
            autoParse: options.autoParse,
            tenantId: options.tenantId
          });
          return {
            success: outlookResult.success,
            documentsIngested: outlookResult.documentsIngested,
            itemsProcessed: outlookResult.emailsProcessed,
            errors: outlookResult.errors
          };

        case 'gdrive':
          const gdriveResult = await googleDriveIngestionService.ingestEvidenceFromGoogleDrive(userId, {
            query: options.query,
            maxResults: options.maxResults,
            autoParse: options.autoParse,
            folderId: options.folderId,
            tenantId: options.tenantId
          });
          return {
            success: gdriveResult.success,
            documentsIngested: gdriveResult.documentsIngested,
            itemsProcessed: gdriveResult.filesProcessed,
            errors: gdriveResult.errors
          };

        case 'dropbox':
          const dropboxResult = await dropboxIngestionService.ingestEvidenceFromDropbox(userId, {
            query: options.query,
            maxResults: options.maxResults,
            autoParse: options.autoParse,
            folderPath: options.folderPath,
            tenantId: options.tenantId
          });
          return {
            success: dropboxResult.success,
            documentsIngested: dropboxResult.documentsIngested,
            itemsProcessed: dropboxResult.filesProcessed,
            errors: dropboxResult.errors
          };

        case 'onedrive':
          const onedriveResult = await oneDriveIngestionService.ingestEvidenceFromOneDrive(userId, {
            query: options.query,
            maxResults: options.maxResults,
            autoParse: options.autoParse,
            folderId: options.folderId,
            tenantId: options.tenantId
          });
          return {
            success: onedriveResult.success,
            documentsIngested: onedriveResult.documentsIngested,
            itemsProcessed: onedriveResult.filesProcessed,
            errors: onedriveResult.errors
          };

        case 'adobe_sign':
          const adobeSignResult = await adobeSignIngestionService.ingestEvidenceFromAdobeSign(userId, {
            query: options.query,
            maxResults: options.maxResults,
            autoParse: options.autoParse,
            tenantId: options.tenantId
          });
          return {
            success: adobeSignResult.success,
            documentsIngested: adobeSignResult.documentsIngested,
            itemsProcessed: adobeSignResult.agreementsProcessed,
            errors: adobeSignResult.errors
          };

        case 'slack':
          const slackResult = await slackIngestionService.ingestEvidenceFromSlack(userId, {
            query: options.query,
            maxResults: options.maxResults,
            autoParse: options.autoParse,
            tenantId: options.tenantId
          });
          return {
            success: slackResult.success,
            documentsIngested: slackResult.documentsIngested,
            itemsProcessed: slackResult.messagesProcessed,
            errors: slackResult.errors
          };

        default:
          logger.warn(`⚠️ [UNIFIED INGESTION] Unknown provider: ${provider}`, {
            userId,
            provider
          });
          return {
            success: false,
            documentsIngested: 0,
            itemsProcessed: 0,
            errors: [`Unknown provider: ${provider}`]
          };
      }
    } catch (error: any) {
      logger.error(`❌ [UNIFIED INGESTION] Error ingesting from ${provider}`, {
        error: error?.message || String(error),
        userId,
        provider
      });
      return {
        success: false,
        documentsIngested: 0,
        itemsProcessed: 0,
        errors: [error?.message || String(error)]
      };
    }
  }
}

export const unifiedIngestionService = new UnifiedIngestionService();
export default unifiedIngestionService;

