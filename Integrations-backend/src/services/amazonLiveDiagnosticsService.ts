import axios from 'axios';
import amazonService from './amazonService';

const REGION_ENDPOINTS = [
  { key: 'na', baseUrl: 'https://sellingpartnerapi-na.amazon.com' },
  { key: 'eu', baseUrl: 'https://sellingpartnerapi-eu.amazon.com' },
  { key: 'fe', baseUrl: 'https://sellingpartnerapi-fe.amazon.com' },
];

function maskValue(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}***`;
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

export interface AmazonLiveDiagnosticsOptions {
  preferredMarketplaceId?: string;
  userId?: string;
  storeId?: string;
}

export async function runAmazonLiveDiagnostics(options: AmazonLiveDiagnosticsOptions = {}) {
  const preferredMarketplaceId = options.preferredMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
  const diagnostics: any = {
    ok: false,
    timestamp: new Date().toISOString(),
    mode: {
      nodeEnv: process.env.NODE_ENV || 'unknown',
      useMockSpApi: process.env.USE_MOCK_SPAPI === 'true',
      spapiBaseUrl: process.env.AMAZON_SPAPI_BASE_URL || null,
      preferredMarketplaceId,
      tokenSource: options.userId ? 'database' : 'environment',
      userId: options.userId || null,
      storeId: options.storeId || null,
    },
    credentials: {
      applicationIdPresent: !!(process.env.AMAZON_APP_ID || process.env.AMAZON_APPLICATION_ID),
      applicationIdPreview: maskValue(process.env.AMAZON_APP_ID || process.env.AMAZON_APPLICATION_ID),
      clientIdPresent: !!(process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID),
      clientIdPreview: maskValue(process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID),
      clientSecretPresent: !!(process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET),
      redirectUri: process.env.AMAZON_REDIRECT_URI || process.env.AMAZON_SPAPI_REDIRECT_URI || null,
      envRefreshTokenPresent: !!process.env.AMAZON_SPAPI_REFRESH_TOKEN,
    },
    tokenRefresh: null as any,
    regionChecks: [] as any[],
    patchedLookup: null as any,
  };

  let accessToken = '';

  try {
    accessToken = await amazonService.getAccessTokenForService(options.userId, options.storeId);
    diagnostics.tokenRefresh = {
      ok: true,
      message: 'Access token refresh succeeded',
    };
  } catch (error: any) {
    diagnostics.tokenRefresh = {
      ok: false,
      error: error?.message || String(error),
    };
    return diagnostics;
  }

  for (const region of REGION_ENDPOINTS) {
    try {
      const sellersUrl = `${region.baseUrl}/sellers/v1/marketplaceParticipations`;
      const response = await axios.get(sellersUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      });

      const payload = response.data?.payload || response.data;
      const participations = Array.isArray(payload)
        ? payload
        : payload?.marketplaceParticipations || [];
      const marketplaces = participations
        .map((entry: any) => entry?.marketplace?.id || entry?.marketplaceId || entry?.id)
        .filter(Boolean);
      const sellerId =
        participations?.[0]?.participation?.sellerId ||
        participations?.[0]?.sellerId ||
        null;

      diagnostics.regionChecks.push({
        region: region.key,
        baseUrl: region.baseUrl,
        ok: true,
        status: response.status,
        sellerId,
        marketplaces,
      });
    } catch (error: any) {
      diagnostics.regionChecks.push({
        region: region.key,
        baseUrl: region.baseUrl,
        ok: false,
        status: error?.response?.status || null,
        error:
          error?.response?.data?.errors?.[0]?.message ||
          error?.response?.data?.message ||
          error?.message ||
          String(error),
      });
    }
  }

  try {
    const profile = await amazonService.getSellerProfile(accessToken, preferredMarketplaceId);
    diagnostics.patchedLookup = {
      ok: true,
      sellerId: profile.sellerId,
      marketplaces: profile.marketplaces,
      companyName: profile.companyName || null,
      sellerName: profile.sellerName || null,
    };
  } catch (error: any) {
    diagnostics.patchedLookup = {
      ok: false,
      error: error?.message || String(error),
    };
  }

  diagnostics.ok = !!diagnostics.tokenRefresh?.ok && !!diagnostics.patchedLookup?.ok;
  return diagnostics;
}
