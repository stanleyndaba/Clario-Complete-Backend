import axios, { AxiosError } from 'axios';
import config from '../config/env';
import tokenManager, { TokenData } from '../utils/tokenManager';
import {
  AccountingProviderError,
  CanonicalAccountingRecord,
  classifyProviderHttpError,
  persistAccountingRead,
  recordAccountingReadFailure,
  resolveAccountingSource
} from './accountingEvidenceService';

const QUICKBOOKS_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const PAGE_SIZE = 1000;
const MAX_PAGES_PER_ENTITY = 100;

interface QuickBooksEntity {
  Id?: string | number;
  VendorRef?: { name?: string; value?: string };
  TxnDate?: string;
  DueDate?: string;
  CurrencyRef?: { value?: string };
  TotalAmt?: number | string;
  Line?: Array<Record<string, unknown>>;
  DocNumber?: string;
  PrivateNote?: string;
  MetaData?: { LastUpdatedTime?: string };
  Balance?: number | string;
  TxnStatus?: string;
  [key: string]: unknown;
}

function providerBaseUrl(): string {
  return config.QUICKBOOKS_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

function normalizedAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeLineItems(lines: Array<Record<string, unknown>> | undefined): Array<Record<string, unknown>> {
  return (lines || []).map((line) => ({
    id: typeof line.Id === 'string' || typeof line.Id === 'number' ? String(line.Id) : null,
    description: typeof line.Description === 'string' ? line.Description : null,
    amount: normalizedAmount(line.Amount),
    detail_type: typeof line.DetailType === 'string' ? line.DetailType : null,
    item_ref: typeof (line as any)?.ItemBasedExpenseLineDetail?.ItemRef?.value === 'string'
      ? (line as any).ItemBasedExpenseLineDetail.ItemRef.value
      : null,
    quantity: normalizedAmount((line as any)?.ItemBasedExpenseLineDetail?.Qty),
    unit_price: normalizedAmount((line as any)?.ItemBasedExpenseLineDetail?.UnitPrice),
    account_ref: typeof (line as any)?.AccountBasedExpenseLineDetail?.AccountRef?.value === 'string'
      ? (line as any).AccountBasedExpenseLineDetail.AccountRef.value
      : null
  }));
}

function normalizeQuickBooksRecord(entity: QuickBooksEntity, recordType: 'bill' | 'purchase'): CanonicalAccountingRecord {
  if (entity.Id === undefined || entity.Id === null) {
    throw new AccountingProviderError('QuickBooks returned an accounting object without an identifier.', 'provider');
  }

  const balance = normalizedAmount(entity.Balance);
  return {
    provider: 'quickbooks',
    providerRecordId: String(entity.Id),
    recordType,
    supplierName: entity.VendorRef?.name || entity.VendorRef?.value || null,
    transactionDate: entity.TxnDate || null,
    dueDate: entity.DueDate || null,
    currency: entity.CurrencyRef?.value || null,
    totalAmount: normalizedAmount(entity.TotalAmt),
    lineItems: normalizeLineItems(entity.Line),
    referenceNumber: entity.DocNumber || null,
    memo: entity.PrivateNote || null,
    status: typeof entity.TxnStatus === 'string' ? entity.TxnStatus : balance === 0 ? 'paid' : 'open',
    rawData: entity,
    providerUpdatedAt: entity.MetaData?.LastUpdatedTime || null
  };
}

function providerError(error: unknown): AccountingProviderError {
  if (error instanceof AccountingProviderError) return error;
  const axiosError = error as AxiosError;
  if (axiosError?.response?.status) {
    return classifyProviderHttpError('QuickBooks', axiosError.response.status);
  }
  return new AccountingProviderError('QuickBooks could not complete the accounting read.', 'provider');
}

async function refreshAccessToken(userId: string, tenantId: string, current: TokenData): Promise<TokenData> {
  const stillUsable = current.expiresAt.getTime() > Date.now() + 60_000;
  if (stillUsable) return current;
  if (!current.refreshToken) {
    throw new AccountingProviderError('QuickBooks authorization is expired and cannot be refreshed. Reconnect to continue.', 'auth');
  }
  if (!config.QUICKBOOKS_CLIENT_ID || !config.QUICKBOOKS_CLIENT_SECRET) {
    throw new AccountingProviderError('QuickBooks credential configuration is incomplete.', 'configuration');
  }

  try {
    const basic = Buffer.from(`${config.QUICKBOOKS_CLIENT_ID}:${config.QUICKBOOKS_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post(QUICKBOOKS_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken
    }), {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      }
    });

    const refreshed: TokenData = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || current.refreshToken,
      expiresAt: new Date(Date.now() + (Number(response.data.expires_in) || 3600) * 1000)
    };
    await tokenManager.refreshToken(userId, 'quickbooks', refreshed, tenantId);
    return refreshed;
  } catch (error) {
    throw providerError(error);
  }
}

async function readEntityPages(
  accessToken: string,
  realmId: string,
  entityName: 'Bill' | 'Purchase'
): Promise<QuickBooksEntity[]> {
  const records: QuickBooksEntity[] = [];
  let startPosition = 1;

  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_ENTITY; pageIndex += 1) {
    try {
      const query = `SELECT * FROM ${entityName} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;
      const response = await axios.get(`${providerBaseUrl()}/v3/company/${encodeURIComponent(realmId)}/query`, {
        params: { query },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      });
      const page = Array.isArray(response.data?.QueryResponse?.[entityName])
        ? response.data.QueryResponse[entityName] as QuickBooksEntity[]
        : [];
      records.push(...page);

      if (page.length < PAGE_SIZE) return records;
      startPosition += PAGE_SIZE;
    } catch (error) {
      throw providerError(error);
    }
  }

  throw new AccountingProviderError(`QuickBooks ${entityName} pagination exceeded the configured safety limit.`, 'provider');
}

export async function readQuickBooksFinancialRecords(userId: string, tenantId: string): Promise<CanonicalAccountingRecord[]> {
  const source = await resolveAccountingSource(userId, tenantId, 'quickbooks');
  const realmId = typeof source.metadata?.realm_id === 'string' ? source.metadata.realm_id : undefined;
  if (!realmId) {
    throw new AccountingProviderError('QuickBooks company identity is missing. Reconnect this workspace to continue.', 'configuration');
  }

  const storedToken = await tokenManager.getRefreshableToken(userId, 'quickbooks', undefined, tenantId);
  if (!storedToken) {
    throw new AccountingProviderError('QuickBooks authorization is unavailable. Reconnect to restore financial evidence reads.', 'auth');
  }
  const token = await refreshAccessToken(userId, tenantId, storedToken);

  const [bills, purchases] = await Promise.all([
    readEntityPages(token.accessToken, realmId, 'Bill'),
    readEntityPages(token.accessToken, realmId, 'Purchase')
  ]);

  return [
    ...bills.map((bill) => normalizeQuickBooksRecord(bill, 'bill')),
    ...purchases.map((purchase) => normalizeQuickBooksRecord(purchase, 'purchase'))
  ];
}

export async function syncQuickBooksFinancialEvidence(userId: string, tenantId: string): Promise<{
  provider: 'quickbooks';
  recordCount: number;
  status: 'verified' | 'no_data';
  readAt: string;
}> {
  let sourceId: string | undefined;
  try {
    const source = await resolveAccountingSource(userId, tenantId, 'quickbooks');
    sourceId = source.id;
    const records = await readQuickBooksFinancialRecords(userId, tenantId);
    const result = await persistAccountingRead({ userId, tenantId, sourceId, provider: 'quickbooks', records });
    return { provider: 'quickbooks', ...result };
  } catch (error) {
    await recordAccountingReadFailure({ userId, tenantId, sourceId, provider: 'quickbooks', error });
    throw providerError(error);
  }
}

export default { readQuickBooksFinancialRecords, syncQuickBooksFinancialEvidence };
