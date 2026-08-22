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

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_INVOICES_URL = 'https://api.xero.com/api.xro/2.0/Invoices';
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

interface XeroInvoice {
  InvoiceID?: string;
  Type?: string;
  Contact?: { Name?: string; ContactID?: string };
  DateString?: string;
  Date?: string;
  DueDateString?: string;
  DueDate?: string;
  CurrencyCode?: string;
  Total?: number | string;
  LineItems?: Array<Record<string, unknown>>;
  InvoiceNumber?: string;
  Reference?: string;
  Status?: string;
  UpdatedDateUTCString?: string;
  UpdatedDateUTC?: string;
  [key: string]: unknown;
}

function normalizedAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeXeroDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const dotNetMatch = value.match(/\/Date\((\d+)/);
  if (dotNetMatch?.[1]) {
    const date = new Date(Number(dotNetMatch[1]));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeXeroTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const dotNetMatch = value.match(/\/Date\((\d+)/);
  if (dotNetMatch?.[1]) {
    const date = new Date(Number(dotNetMatch[1]));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeLineItems(lines: Array<Record<string, unknown>> | undefined): Array<Record<string, unknown>> {
  return (lines || []).map((line) => ({
    id: typeof line.LineItemID === 'string' ? line.LineItemID : null,
    description: typeof line.Description === 'string' ? line.Description : null,
    quantity: normalizedAmount(line.Quantity),
    unit_amount: normalizedAmount(line.UnitAmount),
    line_amount: normalizedAmount(line.LineAmount),
    tax_amount: normalizedAmount(line.TaxAmount),
    item_code: typeof line.ItemCode === 'string' ? line.ItemCode : null,
    account_code: typeof line.AccountCode === 'string' ? line.AccountCode : null,
    tax_type: typeof line.TaxType === 'string' ? line.TaxType : null
  }));
}

function normalizeXeroBill(invoice: XeroInvoice): CanonicalAccountingRecord {
  if (!invoice.InvoiceID) {
    throw new AccountingProviderError('Xero returned an accounting object without an identifier.', 'provider');
  }
  if (invoice.Type !== 'ACCPAY') {
    throw new AccountingProviderError('Xero returned a record outside the approved Phase-0 ACCPAY scope.', 'provider');
  }

  return {
    provider: 'xero',
    providerRecordId: invoice.InvoiceID,
    recordType: 'accpay',
    supplierName: invoice.Contact?.Name || invoice.Contact?.ContactID || null,
    transactionDate: normalizeXeroDate(invoice.DateString || invoice.Date),
    dueDate: normalizeXeroDate(invoice.DueDateString || invoice.DueDate),
    currency: invoice.CurrencyCode || null,
    totalAmount: normalizedAmount(invoice.Total),
    lineItems: normalizeLineItems(invoice.LineItems),
    referenceNumber: invoice.InvoiceNumber || invoice.Reference || null,
    memo: invoice.Reference || null,
    status: invoice.Status || null,
    rawData: invoice,
    providerUpdatedAt: normalizeXeroTimestamp(invoice.UpdatedDateUTCString || invoice.UpdatedDateUTC)
  };
}

function providerError(error: unknown): AccountingProviderError {
  if (error instanceof AccountingProviderError) return error;
  const axiosError = error as AxiosError;
  if (axiosError?.response?.status) {
    return classifyProviderHttpError('Xero', axiosError.response.status);
  }
  return new AccountingProviderError('Xero could not complete the accounting read.', 'provider');
}

async function refreshAccessToken(userId: string, tenantId: string, current: TokenData): Promise<TokenData> {
  const stillUsable = current.expiresAt.getTime() > Date.now() + 60_000;
  if (stillUsable) return current;
  if (!current.refreshToken) {
    throw new AccountingProviderError('Xero authorization is expired and cannot be refreshed. Reconnect to continue.', 'auth');
  }
  if (!config.XERO_CLIENT_ID || !config.XERO_CLIENT_SECRET) {
    throw new AccountingProviderError('Xero credential configuration is incomplete.', 'configuration');
  }

  try {
    const basic = Buffer.from(`${config.XERO_CLIENT_ID}:${config.XERO_CLIENT_SECRET}`).toString('base64');
    const response = await axios.post(XERO_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken
    }), {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const refreshed: TokenData = {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || current.refreshToken,
      expiresAt: new Date(Date.now() + (Number(response.data.expires_in) || 1800) * 1000)
    };
    await tokenManager.refreshToken(userId, 'xero', refreshed, tenantId);
    return refreshed;
  } catch (error) {
    throw providerError(error);
  }
}

async function readAccpayPages(accessToken: string, xeroTenantId: string): Promise<XeroInvoice[]> {
  const records: XeroInvoice[] = [];
  let page = 1;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    try {
      const response = await axios.get(XERO_INVOICES_URL, {
        params: {
          where: 'Type=="ACCPAY"',
          page,
          pageSize: PAGE_SIZE,
          order: 'UpdatedDateUTC ASC'
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'xero-tenant-id': xeroTenantId,
          Accept: 'application/json'
        }
      });
      const pageRecords = Array.isArray(response.data?.Invoices)
        ? response.data.Invoices as XeroInvoice[]
        : [];
      records.push(...pageRecords);

      const pagination = response.data?.pagination || response.data?.Pagination;
      const pageCount = Number(pagination?.pageCount ?? pagination?.PageCount);
      if (Number.isFinite(pageCount) && page >= pageCount) return records;
      if (pageRecords.length < PAGE_SIZE) return records;
      page += 1;
    } catch (error) {
      throw providerError(error);
    }
  }

  throw new AccountingProviderError('Xero ACCPAY pagination exceeded the configured safety limit.', 'provider');
}

export async function readXeroAccpayBills(userId: string, tenantId: string): Promise<CanonicalAccountingRecord[]> {
  const source = await resolveAccountingSource(userId, tenantId, 'xero');
  const xeroTenantId = typeof source.metadata?.xero_tenant_id === 'string' ? source.metadata.xero_tenant_id : undefined;
  if (!xeroTenantId) {
    throw new AccountingProviderError('Xero organisation identity is missing. Reconnect this workspace to continue.', 'configuration');
  }

  const storedToken = await tokenManager.getRefreshableToken(userId, 'xero', undefined, tenantId);
  if (!storedToken) {
    throw new AccountingProviderError('Xero authorization is unavailable. Reconnect to restore financial evidence reads.', 'auth');
  }
  const token = await refreshAccessToken(userId, tenantId, storedToken);
  const bills = await readAccpayPages(token.accessToken, xeroTenantId);
  return bills.map(normalizeXeroBill);
}

export async function syncXeroFinancialEvidence(userId: string, tenantId: string): Promise<{
  provider: 'xero';
  recordCount: number;
  status: 'verified' | 'no_data';
  readAt: string;
}> {
  let sourceId: string | undefined;
  try {
    const source = await resolveAccountingSource(userId, tenantId, 'xero');
    sourceId = source.id;
    const records = await readXeroAccpayBills(userId, tenantId);
    const result = await persistAccountingRead({ userId, tenantId, sourceId, provider: 'xero', records });
    return { provider: 'xero', ...result };
  } catch (error) {
    await recordAccountingReadFailure({ userId, tenantId, sourceId, provider: 'xero', error });
    throw providerError(error);
  }
}

export default { readXeroAccpayBills, syncXeroFinancialEvidence };
