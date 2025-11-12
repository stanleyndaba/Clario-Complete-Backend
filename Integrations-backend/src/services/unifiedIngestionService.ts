/**
 * Unified Ingestion Service
 * Orchestrates evidence ingestion from all connected sources
 * Processes multiple sources in parallel for efficiency
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { gmailIngestionService } from './gmailIngestionService';
import { outlookIngestionService } from './outlookIngestionService';
import { googleDriveIngestionService } from './googleDriveIngestionService';
import { dropboxIngestionService } from './dropboxIngestionService';

export interface UnifiedIngestionResult {
  success: boolean;
  totalDocumentsIngested: number;
  totalItemsProcessed: number;
  errors: string[];
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
  };
  jobId?: string;
}

export interface IngestionOptions {
  providers?: string[]; // ['gmail', 'outlook', 'gdrive', 'dropbox'] - if not specified, uses all connected
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
    options: IngestionOptions = {}
  ): Promise<UnifiedIngestionResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let totalDocumentsIngested = 0;
    let totalItemsProcessed = 0;
    const results: UnifiedIngestionResult['results'] = {};

    try {
      logger.info('🔍 [UNIFIED INGESTION] Starting unified evidence ingestion', {
        userId,
        providers: options.providers,
        maxResults: options.maxResults || 50
      });

      // Get connected sources
      const connectedSources = await this.getConnectedSources(userId, options.providers);

      if (connectedSources.length === 0) {
        logger.warn('⚠️ [UNIFIED INGESTION] No connected evidence sources found', {
          userId
        });
        return {
          success: false,
          totalDocumentsIngested: 0,
          totalItemsProcessed: 0,
          errors: ['No connected evidence sources found'],
          results: {}
        };
      }

      logger.info(`✅ [UNIFIED INGESTION] Found ${connectedSources.length} connected sources`, {
        userId,
        sources: connectedSources.map(s => s.provider)
      });

      // Process all sources in parallel
      const ingestionPromises = connectedSources.map(source => 
        this.ingestFromSource(userId, source.provider, options)
      );

      const ingestionResults = await Promise.allSettled(ingestionPromises);

      // Aggregate results
      ingestionResults.forEach((result, index) => {
        const provider = connectedSources[index].provider;

        if (result.status === 'fulfilled') {
          const providerResult = result.value;
          results[provider as keyof typeof results] = providerResult as any;

          totalDocumentsIngested += providerResult.documentsIngested || 0;
          totalItemsProcessed += providerResult.itemsProcessed || 0;

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
      });

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('✅ [UNIFIED INGESTION] Unified evidence ingestion completed', {
        userId,
        totalDocumentsIngested,
        totalItemsProcessed,
        errors: errors.length,
        elapsedTime: `${elapsedTime}s`,
        sources: connectedSources.map(s => s.provider)
      });

      return {
        success: errors.length === 0,
        totalDocumentsIngested,
        totalItemsProcessed,
        errors,
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
        results
      };
    }
  }

  /**
   * Get connected evidence sources for user
   */
  private async getConnectedSources(
    userId: string,
    providerFilter?: string[]
  ): Promise<Array<{ provider: string; accountEmail?: string }>> {
    try {
      let query = supabase
        .from('evidence_sources')
        .select('provider, account_email')
        .eq('user_id', userId)
        .eq('status', 'connected');

      if (providerFilter && providerFilter.length > 0) {
        query = query.in('provider', providerFilter);
      }

      const { data: sources, error } = await query;

      if (error) {
        logger.error('❌ [UNIFIED INGESTION] Error fetching connected sources', {
          error: error.message,
          userId
        });
        return [];
      }

      return (sources || []).map((s: any) => ({
        provider: s.provider,
        accountEmail: s.account_email
      }));
    } catch (error: any) {
      logger.error('❌ [UNIFIED INGESTION] Error getting connected sources', {
        error: error?.message || String(error),
        userId
      });
      return [];
    }
  }

  /**
   * Ingest from a specific source
   */
  private async ingestFromSource(
    userId: string,
    provider: string,
    options: IngestionOptions
  ): Promise<{
    success: boolean;
    documentsIngested: number;
    itemsProcessed: number;
    errors: string[];
  }> {
    try {
      logger.info(`🔍 [UNIFIED INGESTION] Ingesting from ${provider}`, {
        userId,
        provider
      });

      switch (provider) {
        case 'gmail':
          const gmailResult = await gmailIngestionService.ingestEvidenceFromGmail(userId, {
            query: options.query,
            maxResults: options.maxResults,
            autoParse: options.autoParse
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
            autoParse: options.autoParse
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
            folderId: options.folderId
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
            folderPath: options.folderPath
          });
          return {
            success: dropboxResult.success,
            documentsIngested: dropboxResult.documentsIngested,
            itemsProcessed: dropboxResult.filesProcessed,
            errors: dropboxResult.errors
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

