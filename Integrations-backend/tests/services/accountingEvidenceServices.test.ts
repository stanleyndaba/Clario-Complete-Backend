import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';
import tokenManager from '../../src/utils/tokenManager';
import {
  persistAccountingRead,
  recordAccountingReadFailure,
  resolveAccountingSource
} from '../../src/services/accountingEvidenceService';
import {
  readQuickBooksFinancialRecords,
  syncQuickBooksFinancialEvidence
} from '../../src/services/quickbooksService';
import {
  readXeroAccpayBills,
  syncXeroFinancialEvidence
} from '../../src/services/xeroService';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() }
}));

jest.mock('../../src/utils/tokenManager', () => ({
  __esModule: true,
  default: {
    getRefreshableToken: jest.fn(),
    refreshToken: jest.fn(),
    revokeToken: jest.fn()
  }
}));

jest.mock('../../src/services/accountingEvidenceService', () => ({
  resolveAccountingSource: jest.fn(),
  persistAccountingRead: jest.fn(),
  recordAccountingReadFailure: jest.fn(),
  classifyProviderHttpError: jest.fn((provider: string, status?: number) => {
    const error = new Error(`${provider} failed`) as Error & { kind: string; statusCode?: number };
    error.name = 'AccountingProviderError';
    error.kind = status === 401 || status === 403 ? 'auth' : 'provider';
    error.statusCode = status;
    return error;
  }),
  AccountingProviderError: class AccountingProviderError extends Error {
    constructor(message: string, public kind: string, public statusCode?: number) {
      super(message);
      this.name = 'AccountingProviderError';
    }
  }
}));

const axiosMock = axios as jest.Mocked<typeof axios>;
const tokenMock = tokenManager as jest.Mocked<typeof tokenManager>;
const resolveSourceMock = resolveAccountingSource as jest.MockedFunction<typeof resolveAccountingSource>;
const persistReadMock = persistAccountingRead as jest.MockedFunction<typeof persistAccountingRead>;
const recordFailureMock = recordAccountingReadFailure as jest.MockedFunction<typeof recordAccountingReadFailure>;

const userId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const reusableToken = {
  accessToken: 'access-token-not-a-fixture-secret',
  refreshToken: 'refresh-token-not-a-fixture-secret',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000)
};

function quickBooksBill(id: number) {
  return {
    Id: String(id),
    VendorRef: { name: `Supplier ${id}` },
    TxnDate: '2026-08-01',
    DueDate: '2026-08-31',
    CurrencyRef: { value: 'USD' },
    TotalAmt: 24.5,
    DocNumber: `BILL-${id}`,
    PrivateNote: 'Supplier purchase evidence',
    MetaData: { LastUpdatedTime: '2026-08-01T10:00:00Z' },
    Line: [{ Id: String(id), Description: 'Inventory unit', Amount: 24.5, DetailType: 'AccountBasedExpenseLineDetail' }]
  };
}

function quickBooksPurchase(id: number) {
  return {
    ...quickBooksBill(id),
    Id: String(id + 5000),
    DocNumber: `PURCHASE-${id}`
  };
}

function xeroBill(id: number) {
  return {
    InvoiceID: `invoice-${id}`,
    Type: 'ACCPAY',
    Contact: { Name: `Supplier ${id}` },
    DateString: '2026-08-01T00:00:00',
    DueDateString: '2026-08-31T00:00:00',
    CurrencyCode: 'USD',
    Total: 27.5,
    InvoiceNumber: `ACCPAY-${id}`,
    Reference: 'Purchase evidence',
    Status: 'AUTHORISED',
    UpdatedDateUTCString: '2026-08-01T10:00:00Z',
    LineItems: [{ LineItemID: `line-${id}`, Description: 'Inventory unit', Quantity: 1, UnitAmount: 27.5, LineAmount: 27.5 }]
  };
}

describe('Phase-0 accounting evidence provider services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenMock.getRefreshableToken.mockResolvedValue(reusableToken);
    persistReadMock.mockResolvedValue({ recordCount: 0, status: 'no_data', readAt: '2026-08-22T10:00:00.000Z' });
    recordFailureMock.mockResolvedValue();
  });

  it('reads every QuickBooks Bill and Purchase page and normalizes only the approved Phase-0 record types', async () => {
    resolveSourceMock.mockResolvedValue({
      id: 'source-qbo', provider: 'quickbooks', tenant_id: tenantId, user_id: userId,
      status: 'connected', metadata: { realm_id: 'realm-123' }
    });

    const firstBillPage = Array.from({ length: 1000 }, (_, index) => quickBooksBill(index + 1));
    const firstPurchasePage = Array.from({ length: 1000 }, (_, index) => quickBooksPurchase(index + 1));
    axiosMock.get.mockImplementation(async (_url: string, request: any) => {
      const query = request.params.query as string;
      if (query.includes('FROM Bill') && query.includes('STARTPOSITION 1001')) {
        return { data: { QueryResponse: { Bill: [quickBooksBill(1001)] } } } as any;
      }
      if (query.includes('FROM Bill') && query.includes('STARTPOSITION 1')) {
        return { data: { QueryResponse: { Bill: firstBillPage } } } as any;
      }
      if (query.includes('FROM Purchase') && query.includes('STARTPOSITION 1001')) {
        return { data: { QueryResponse: { Purchase: [quickBooksPurchase(1001)] } } } as any;
      }
      if (query.includes('FROM Purchase') && query.includes('STARTPOSITION 1')) {
        return { data: { QueryResponse: { Purchase: firstPurchasePage } } } as any;
      }
      throw new Error(`Unexpected QuickBooks query: ${query}`);
    });

    const records = await readQuickBooksFinancialRecords(userId, tenantId);

    expect(records).toHaveLength(2002);
    expect(records.filter((record) => record.recordType === 'bill')).toHaveLength(1001);
    expect(records.filter((record) => record.recordType === 'purchase')).toHaveLength(1001);
    expect(records.every((record) => record.provider === 'quickbooks')).toBe(true);
    expect(records[0]).toMatchObject({ supplierName: 'Supplier 1', currency: 'USD', totalAmount: 24.5, referenceNumber: 'BILL-1' });
    expect(tokenMock.getRefreshableToken).toHaveBeenCalledWith(userId, 'quickbooks', undefined, tenantId);
    expect(axiosMock.get).toHaveBeenCalledWith(
      expect.stringContaining('/v3/company/realm-123/query'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token-not-a-fixture-secret' }) })
    );
  });

  it('reads Xero ACCPAY pages with the resolved xero-tenant-id and normalizes only purchase bills', async () => {
    resolveSourceMock.mockResolvedValue({
      id: 'source-xero', provider: 'xero', tenant_id: tenantId, user_id: userId,
      status: 'connected', metadata: { xero_tenant_id: 'xero-tenant-123' }
    });

    const firstPage = Array.from({ length: 100 }, (_, index) => xeroBill(index + 1));
    axiosMock.get.mockImplementation(async (_url: string, request: any) => {
      if (request.params.page === 1) {
        return { data: { Invoices: firstPage, Pagination: { PageCount: 2 } } } as any;
      }
      if (request.params.page === 2) {
        return { data: { Invoices: [xeroBill(101)], Pagination: { PageCount: 2 } } } as any;
      }
      throw new Error(`Unexpected Xero page: ${request.params.page}`);
    });

    const records = await readXeroAccpayBills(userId, tenantId);

    expect(records).toHaveLength(101);
    expect(records.every((record) => record.provider === 'xero' && record.recordType === 'accpay')).toBe(true);
    expect(records[0]).toMatchObject({ supplierName: 'Supplier 1', currency: 'USD', totalAmount: 27.5, referenceNumber: 'ACCPAY-1' });
    expect(axiosMock.get).toHaveBeenCalledWith(
      'https://api.xero.com/api.xro/2.0/Invoices',
      expect.objectContaining({
        params: expect.objectContaining({ where: 'Type=="ACCPAY"', pageSize: 100 }),
        headers: expect.objectContaining({ 'xero-tenant-id': 'xero-tenant-123', Authorization: 'Bearer access-token-not-a-fixture-secret' })
      })
    );
    expect(tokenMock.getRefreshableToken).toHaveBeenCalledWith(userId, 'xero', undefined, tenantId);
  });

  it('records a healthy no-data result as verified provider access, not a failure or fabricated record count', async () => {
    resolveSourceMock.mockResolvedValue({
      id: 'source-qbo', provider: 'quickbooks', tenant_id: tenantId, user_id: userId,
      status: 'connected', metadata: { realm_id: 'realm-123' }
    });
    axiosMock.get.mockResolvedValue({ data: { QueryResponse: { Bill: [], Purchase: [] } } } as any);
    persistReadMock.mockResolvedValue({ recordCount: 0, status: 'no_data', readAt: '2026-08-22T10:00:00.000Z' });

    const result = await syncQuickBooksFinancialEvidence(userId, tenantId);

    expect(result).toEqual({ provider: 'quickbooks', recordCount: 0, status: 'no_data', readAt: '2026-08-22T10:00:00.000Z' });
    expect(persistReadMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      provider: 'quickbooks',
      sourceId: 'source-qbo',
      records: []
    }));
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  it('persists a zero-record Xero provider read without manufacturing a record and keeps the provider identity explicit', async () => {
    resolveSourceMock.mockResolvedValue({
      id: 'source-xero', provider: 'xero', tenant_id: tenantId, user_id: userId,
      status: 'connected', metadata: { xero_tenant_id: 'xero-tenant-123' }
    });
    axiosMock.get.mockResolvedValue({ data: { Invoices: [], Pagination: { PageCount: 1 } } } as any);
    persistReadMock.mockResolvedValue({ recordCount: 0, status: 'no_data', readAt: '2026-08-22T10:01:00.000Z' });

    const result = await syncXeroFinancialEvidence(userId, tenantId);

    expect(result).toEqual({ provider: 'xero', recordCount: 0, status: 'no_data', readAt: '2026-08-22T10:01:00.000Z' });
    expect(persistReadMock).toHaveBeenCalledWith(expect.objectContaining({ provider: 'xero', records: [] }));
  });
});
