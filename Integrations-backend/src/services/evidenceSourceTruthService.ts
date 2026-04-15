import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { getManagedTokenSourceFields } from '../utils/evidenceSourceRecordShape';
import config from '../config/env';

export type EvidenceProvider =
  | 'gmail'
  | 'outlook'
  | 'gdrive'
  | 'dropbox'
  | 'onedrive'
  | 'adobe_sign'
  | 'slack';

export interface EvidenceSourceContext {
  id: string;
  provider: EvidenceProvider;
  tenantId: string;
  accountEmail?: string;
  metadata: Record<string, any>;
  permissions: any;
  lastIngestedAt?: string;
  authSource: 'evidence_source' | 'token_recovery' | 'token_manager' | 'configured_provider_token';
}

export interface SkippedEvidenceSource {
  provider: string;
  reason: string;
}

export interface EvidenceSourceResolution {
  resolvedSources: EvidenceSourceContext[];
  skippedSources: SkippedEvidenceSource[];
}

const TOKEN_RECOVERY_PROVIDERS: ReadonlyArray<EvidenceProvider> = ['gmail', 'outlook', 'gdrive', 'dropbox'];
const TOKEN_MANAGER_PROVIDERS: ReadonlyArray<'gmail' | 'outlook' | 'gdrive' | 'dropbox'> = ['gmail', 'outlook', 'gdrive', 'dropbox'];

const PROVIDER_ALIASES: Record<string, EvidenceProvider> = {
  gmail: 'gmail',
  outlook: 'outlook',
  gdrive: 'gdrive',
  google_drive: 'gdrive',
  dropbox: 'dropbox',
  onedrive: 'onedrive',
  adobe_sign: 'adobe_sign',
  slack: 'slack'
};

const FILTER_CONFIG_KEYS = [
  'senderPatterns',
  'includeSenders',
  'excludeSenders',
  'subjectKeywords',
  'excludeSubjects',
  'fileTypes',
  'fileNamePatterns',
  'folders',
  'dateRange',
  'skipDuplicates',
  'skipExisting'
] as const;

function normalizeProvider(provider: string): EvidenceProvider | null {
  return PROVIDER_ALIASES[String(provider || '').trim().toLowerCase()] || null;
}

function isFilterConfig(value: any): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return FILTER_CONFIG_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

async function loadTenantEvidenceFilters(tenantId: string): Promise<Record<string, any> | undefined> {
  const adminClient = supabaseAdmin || supabase;
  const { data, error } = await adminClient
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    logger.warn('⚠️ [EVIDENCE SOURCE TRUTH] Failed to load tenant evidence filters', {
      tenantId,
      error: error.message
    });
    return undefined;
  }

  const filters = data?.settings?.evidenceIngestion?.filters;
  return isFilterConfig(filters) ? filters : undefined;
}

function mergeTenantFiltersIntoMetadata(metadata: any, tenantFilters?: Record<string, any>) {
  const currentMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};

  if (!tenantFilters) {
    return {
      metadata: currentMetadata,
      changed: false
    };
  }

  const hasCanonicalFilters = isFilterConfig(currentMetadata.filters);
  const hasNestedCanonicalFilters = isFilterConfig(currentMetadata.ingestion_settings?.filters);

  if (hasCanonicalFilters && hasNestedCanonicalFilters) {
    return {
      metadata: currentMetadata,
      changed: false
    };
  }

  return {
    metadata: {
      ...currentMetadata,
      filters: hasCanonicalFilters ? currentMetadata.filters : tenantFilters,
      ingestion_settings: {
        ...(currentMetadata.ingestion_settings || {}),
        filters: hasNestedCanonicalFilters ? currentMetadata.ingestion_settings.filters : tenantFilters
      }
    },
    changed: true
  };
}

function isExpiryUsable(rawExpiry: string | null | undefined): boolean {
  if (!rawExpiry) return true;
  const parsed = new Date(rawExpiry);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed > new Date();
}

function hasMetadataAccessToken(source: { metadata?: any }): boolean {
  return typeof source?.metadata?.access_token === 'string' && source.metadata.access_token.trim().length > 0;
}

function hasConfiguredProviderAuth(provider: EvidenceProvider): boolean {
  if (provider !== 'slack') {
    return false;
  }

  return Boolean(
    (
      config.SLACK_BOT_USER_OAUTH_TOKEN ||
      process.env.SLACK_BOT_USER_OAUTH_TOKEN ||
      process.env.BOT_USER_OAUTH_TOKEN ||
      ''
    ).trim()
  );
}

export function buildEvidenceUserFilter(userId: string): string {
  const safeUserId = convertUserIdToUuid(userId);
  return safeUserId === userId
    ? `user_id.eq.${userId},seller_id.eq.${userId}`
    : `user_id.eq.${safeUserId},seller_id.eq.${safeUserId},seller_id.eq.${userId}`;
}

async function hasUsableTokenManagerAuth(userId: string, provider: EvidenceProvider): Promise<boolean> {
  if (!TOKEN_MANAGER_PROVIDERS.includes(provider as any)) {
    return false;
  }

  if (await tokenManager.isTokenValid(userId, provider as 'gmail' | 'outlook' | 'gdrive' | 'dropbox')) {
    return true;
  }

  if (provider === 'gdrive') {
    return tokenManager.isTokenValid(userId, 'gmail');
  }

  return false;
}

async function recoverSourceFromTokens(
  userId: string,
  tenantId: string,
  provider: EvidenceProvider
): Promise<EvidenceSourceContext | null> {
  if (!TOKEN_RECOVERY_PROVIDERS.includes(provider)) {
    return null;
  }

  const adminClient = supabaseAdmin || supabase;
  const safeUserId = convertUserIdToUuid(userId);

  const tokenValid = await hasUsableTokenManagerAuth(userId, provider);
  if (!tokenValid) {
    return null;
  }

  const { data: tokenRow, error: tokenError } = await adminClient
    .from('tokens')
    .select('provider, expires_at')
    .eq('user_id', safeUserId)
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .maybeSingle();

  if (tokenError && tokenError.code !== 'PGRST116') {
    logger.warn('⚠️ [EVIDENCE SOURCE TRUTH] Failed token lookup during source recovery', {
      userId,
      tenantId,
      provider,
      error: tokenError.message
    });
  }

  const metadata = {
    source: 'token_recovery',
    token_source: 'evidence_source_truth_service',
    recovered_at: new Date().toISOString(),
    expires_at: tokenRow?.expires_at || null
  };
  const tenantFilters = await loadTenantEvidenceFilters(tenantId);
  const mergedRecoveryMetadata = mergeTenantFiltersIntoMetadata(metadata, tenantFilters).metadata;

  const { data: existingSource, error: existingError } = await adminClient
    .from('evidence_sources')
    .select('id, provider, account_email, metadata, permissions, tenant_id, last_ingested_at')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .or(buildEvidenceUserFilter(userId))
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError && existingError.code !== 'PGRST116') {
    logger.warn('⚠️ [EVIDENCE SOURCE TRUTH] Failed to inspect existing source during token recovery', {
      userId,
      tenantId,
      provider,
      error: existingError.message
    });
  }

  if (existingSource?.id) {
    const mergedMetadata = mergeTenantFiltersIntoMetadata({
      ...(existingSource.metadata || {}),
      ...metadata
    }, tenantFilters).metadata;

    const { data: updated, error: updateError } = await adminClient
      .from('evidence_sources')
      .update({
        status: 'connected',
        ...getManagedTokenSourceFields(),
        metadata: mergedMetadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingSource.id)
      .select('id, provider, account_email, metadata, permissions, tenant_id, last_ingested_at')
      .maybeSingle();

    if (updateError || !updated?.id) {
      logger.warn('⚠️ [EVIDENCE SOURCE TRUTH] Failed to refresh token-backed evidence source', {
        userId,
        tenantId,
        provider,
        error: updateError?.message
      });
      return null;
    }

    return {
      id: updated.id,
      provider,
      tenantId: updated.tenant_id,
      accountEmail: updated.account_email || undefined,
      metadata: updated.metadata || mergedMetadata,
      permissions: updated.permissions || [],
      lastIngestedAt: updated.last_ingested_at || undefined,
      authSource: 'token_recovery'
    };
  }

  const { data: inserted, error: insertError } = await adminClient
    .from('evidence_sources')
    .insert({
      user_id: safeUserId,
      seller_id: safeUserId,
      provider,
      account_email: 'unknown',
      status: 'connected',
      ...getManagedTokenSourceFields(),
      metadata: mergedRecoveryMetadata,
      permissions: [],
      tenant_id: tenantId
    })
    .select('id, provider, account_email, metadata, permissions, tenant_id, last_ingested_at')
    .maybeSingle();

  if (insertError || !inserted?.id) {
    logger.warn('⚠️ [EVIDENCE SOURCE TRUTH] Failed to recover evidence source from token-backed auth', {
      userId,
      tenantId,
      provider,
      error: insertError?.message
    });
    return null;
  }

  return {
    id: inserted.id,
    provider,
    tenantId: inserted.tenant_id,
    accountEmail: inserted.account_email || undefined,
    metadata: inserted.metadata || metadata,
    permissions: inserted.permissions || [],
    lastIngestedAt: inserted.last_ingested_at || undefined,
    authSource: 'token_recovery'
  };
}

function toContext(source: any, provider: EvidenceProvider, authSource: EvidenceSourceContext['authSource']): EvidenceSourceContext | null {
  if (!source?.id || !source?.tenant_id) {
    return null;
  }

  return {
    id: source.id,
    provider,
    tenantId: source.tenant_id,
    accountEmail: source.account_email || undefined,
    metadata: source.metadata || {},
    permissions: source.permissions || [],
    lastIngestedAt: source.last_ingested_at || undefined,
    authSource
  };
}

export async function resolveEvidenceSourceContext(
  userId: string,
  provider: string,
  tenantId: string
): Promise<EvidenceSourceContext | null> {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) {
    return null;
  }

  const adminClient = supabaseAdmin || supabase;
  const { data: existingSource, error } = await adminClient
    .from('evidence_sources')
    .select('id, provider, account_email, metadata, permissions, tenant_id, last_ingested_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('provider', normalizedProvider)
    .eq('status', 'connected')
    .or(buildEvidenceUserFilter(userId))
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    logger.warn('⚠️ [EVIDENCE SOURCE TRUTH] Failed to resolve evidence source context', {
      userId,
      tenantId,
      provider: normalizedProvider,
      error: error.message
    });
  }

  if (existingSource) {
    const tenantFilters = await loadTenantEvidenceFilters(tenantId);
    const enrichedMetadataResult = mergeTenantFiltersIntoMetadata(existingSource.metadata, tenantFilters);
    const enrichedMetadata = enrichedMetadataResult.metadata;

    if (enrichedMetadataResult.changed && existingSource.id) {
      await adminClient
        .from('evidence_sources')
        .update({
          metadata: enrichedMetadata,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingSource.id);
    }

    const hasMetadataAuth = hasMetadataAccessToken(existingSource) && isExpiryUsable(existingSource.metadata?.expires_at || existingSource.metadata?.token_expires_at);
    const hasTokenManagerAuth = await hasUsableTokenManagerAuth(userId, normalizedProvider);
    if (hasMetadataAuth) {
      return toContext({
        ...existingSource,
        metadata: enrichedMetadata
      }, normalizedProvider, 'evidence_source');
    }
    if (hasTokenManagerAuth) {
      return toContext({
        ...existingSource,
        metadata: enrichedMetadata
      }, normalizedProvider, 'token_manager');
    }
    if (hasConfiguredProviderAuth(normalizedProvider)) {
      return toContext({
        ...existingSource,
        metadata: enrichedMetadata
      }, normalizedProvider, 'configured_provider_token');
    }
  }

  return recoverSourceFromTokens(userId, tenantId, normalizedProvider);
}

export async function resolveEvidenceSourcesForIngestion(
  userId: string,
  tenantId: string,
  providerFilter?: string[]
): Promise<EvidenceSourceResolution> {
  const adminClient = supabaseAdmin || supabase;
  const requestedProviders = providerFilter && providerFilter.length > 0
    ? providerFilter.map(normalizeProvider).filter((provider): provider is EvidenceProvider => !!provider)
    : null;

  const { data: sourceRows, error } = await adminClient
    .from('evidence_sources')
    .select('id, provider, account_email, metadata, permissions, tenant_id, last_ingested_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'connected')
    .or(buildEvidenceUserFilter(userId))
    .order('updated_at', { ascending: false });

  const resolvedSources = new Map<EvidenceProvider, EvidenceSourceContext>();
  const skippedSources: SkippedEvidenceSource[] = [];

  if (error) {
    logger.warn('⚠️ [UNIFIED INGESTION] Failed to query evidence_sources during source resolution', {
      userId,
      tenantId,
      error: error.message
    });
  }

  for (const source of sourceRows || []) {
    const provider = normalizeProvider(source.provider);
    if (!provider) continue;
    if (requestedProviders && !requestedProviders.includes(provider)) continue;
    if (resolvedSources.has(provider)) continue;

    const hasMetadataAuth = hasMetadataAccessToken(source) && isExpiryUsable(source.metadata?.expires_at || source.metadata?.token_expires_at);
    const hasTokenAuth = await hasUsableTokenManagerAuth(userId, provider);
    const hasConfiguredAuth = hasConfiguredProviderAuth(provider);

    if (!hasMetadataAuth && !hasTokenAuth && !hasConfiguredAuth) {
      skippedSources.push({
        provider,
        reason: 'connected_row_missing_usable_auth'
      });
      continue;
    }

    const context = toContext(
      source,
      provider,
      hasMetadataAuth
        ? 'evidence_source'
        : hasTokenAuth
          ? 'token_manager'
          : 'configured_provider_token'
    );
    if (!context) {
      skippedSources.push({
        provider,
        reason: 'tenant_context_missing_on_evidence_source'
      });
      continue;
    }

    resolvedSources.set(provider, context);
  }

  const fallbackCandidates = requestedProviders || TOKEN_RECOVERY_PROVIDERS;
  for (const provider of fallbackCandidates) {
    if (resolvedSources.has(provider)) continue;
    if (!TOKEN_RECOVERY_PROVIDERS.includes(provider)) continue;

    const recovered = await recoverSourceFromTokens(userId, tenantId, provider);
    if (recovered) {
      resolvedSources.set(provider, recovered);
      continue;
    }

    skippedSources.push({
      provider,
      reason: 'no_usable_auth_for_provider'
    });
  }

  return {
    resolvedSources: Array.from(resolvedSources.values()),
    skippedSources
  };
}

export async function markEvidenceSourceIngested(
  sourceId: string,
  ingestedAt: string = new Date().toISOString()
): Promise<void> {
  const adminClient = supabaseAdmin || supabase;
  const { data: source, error: sourceError } = await adminClient
    .from('evidence_sources')
    .select('metadata')
    .eq('id', sourceId)
    .maybeSingle();

  if (sourceError) {
    logger.warn('⚠️ [EVIDENCE SOURCE TRUTH] Failed to load source metadata before updating last_ingested_at', {
      sourceId,
      error: sourceError.message
    });
  }

  const { error } = await adminClient
    .from('evidence_sources')
    .update({
      last_ingested_at: ingestedAt,
      updated_at: ingestedAt,
      metadata: {
        ...(source?.metadata || {}),
        last_ingested_at: ingestedAt
      }
    })
    .eq('id', sourceId);

  if (error) {
    logger.warn('⚠️ [EVIDENCE SOURCE TRUTH] Failed to update last_ingested_at', {
      sourceId,
      error: error.message
    });
  }
}
