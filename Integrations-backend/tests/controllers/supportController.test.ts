import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createSupportRequest, listSupportRequests } from '../../src/controllers/supportController';

const mockCreateOrGet = jest.fn();
const mockListSupportRequests = jest.fn();
const mockMarkDeliveryAttempt = jest.fn();
const mockMarkDeliveryAccepted = jest.fn();
const mockMarkDeliveryFailure = jest.fn();
const mockSendEmail = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/services/supportRequestService', () => ({
  supportRequestService: {
    createOrGet: (...args: any[]) => mockCreateOrGet(...args),
    listForTenantUser: (...args: any[]) => mockListSupportRequests(...args),
    markDeliveryAttempt: (...args: any[]) => mockMarkDeliveryAttempt(...args),
    markDeliveryAccepted: (...args: any[]) => mockMarkDeliveryAccepted(...args),
    markDeliveryFailure: (...args: any[]) => mockMarkDeliveryFailure(...args),
  },
}));

jest.mock('../../src/notifications/services/notification_service', () => ({
  __esModule: true,
  default: {
    sendEmail: (...args: any[]) => mockSendEmail(...args),
  },
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

function createResponse() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'support-request-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    category: 'technical',
    subject: 'Help page test',
    message: 'I need help with my workspace.',
    status: 'submitted',
    source_page: 'help',
    created_at: '2026-04-20T00:00:00.000Z',
    updated_at: '2026-04-20T00:00:00.000Z',
    internal_email_status: 'pending',
    internal_email_attempt_count: 0,
    acknowledgement_email_status: 'pending',
    acknowledgement_email_attempt_count: 0,
    ...overrides,
  } as any;
}

function mockUserEmailLookup(email: string | null, error: any = null) {
  const builder = {
    select: mockSelect,
    eq: mockEq,
    maybeSingle: mockMaybeSingle,
  };

  mockFrom.mockReturnValue(builder);
  mockSelect.mockReturnValue(builder);
  mockEq.mockReturnValue(builder);
  mockMaybeSingle.mockResolvedValue({ data: email ? { email } : null, error } as never);
}

function deliveryField(kind: 'internal' | 'acknowledgement') {
  return kind === 'internal'
    ? { status: 'internal_email_status', attempts: 'internal_email_attempt_count', messageId: 'internal_email_provider_message_id', error: 'internal_email_last_error' }
    : { status: 'acknowledgement_email_status', attempts: 'acknowledgement_email_attempt_count', messageId: 'acknowledgement_email_provider_message_id', error: 'acknowledgement_email_last_error' };
}

describe('supportController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPPORT_INBOX_EMAIL = 'support@margin-finance.com';
    mockUserEmailLookup('seller@example.com');
    mockCreateOrGet.mockResolvedValue({ record: baseRecord(), created: true } as never);
    mockMarkDeliveryAttempt.mockImplementation((record: any, kind: 'internal' | 'acknowledgement') => {
      const fields = deliveryField(kind);
      return Promise.resolve({
        ...record,
        [fields.status]: 'pending',
        [fields.attempts]: Number(record[fields.attempts] || 0) + 1,
      });
    });
    mockMarkDeliveryAccepted.mockImplementation((record: any, kind: 'internal' | 'acknowledgement', providerMessageId: string) => {
      const fields = deliveryField(kind);
      return Promise.resolve({
        ...record,
        [fields.status]: 'accepted',
        [fields.messageId]: providerMessageId,
      });
    });
    mockMarkDeliveryFailure.mockImplementation((record: any, kind: 'internal' | 'acknowledgement', error: string) => {
      const fields = deliveryField(kind);
      return Promise.resolve({
        ...record,
        [fields.status]: 'failed',
        [fields.error]: error,
      });
    });
    mockSendEmail.mockResolvedValue({ provider: 'resend', providerMessageId: 'resend-message-1' } as never);
  });

  it('uses the canonical authenticated user email for support reply routing and acknowledgement, not browser metadata', async () => {
    const req: any = {
      tenant: { tenantId: 'tenant-1' },
      userId: 'user-1',
      body: {
        category: 'technical',
        subject: 'Help page test',
        message: 'I need help with my workspace.',
        source_page: 'help',
        idempotency_key: 'help-request-1',
        metadata: { contact_email: 'untrusted@example.com' },
      },
    };
    const res = createResponse();

    await createSupportRequest(req, res);

    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockCreateOrGet).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      idempotencyKey: 'help-request-1',
      metadata: expect.objectContaining({
        contact_email: 'seller@example.com',
      }),
    }));
    expect(mockSendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: 'support@margin-finance.com',
      replyTo: 'seller@example.com',
      idempotencyKey: 'support-internal-support-request-1',
    }));
    expect(mockSendEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({
      to: 'seller@example.com',
      replyTo: 'support@margin-finance.com',
      idempotencyKey: 'support-ack-support-request-1',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      request: expect.objectContaining({
        request_id: 'support-request-1',
        delivery: expect.objectContaining({
          internal_notification: expect.objectContaining({ status: 'accepted' }),
          seller_acknowledgement: expect.objectContaining({ status: 'accepted' }),
        }),
      }),
    }));
  });

  it('keeps the persisted request successful and recoverable when email delivery fails', async () => {
    const req: any = {
      tenant: { tenantId: 'tenant-1' },
      userId: 'user-1',
      body: {
        category: 'technical',
        subject: 'Provider outage',
        message: 'Please record this support request even if email fails.',
        source_page: 'help',
        idempotency_key: 'help-request-provider-failure',
      },
    };
    const res = createResponse();
    mockSendEmail.mockRejectedValue(new Error('Resend temporarily unavailable') as never);

    await createSupportRequest(req, res);

    expect(mockCreateOrGet).toHaveBeenCalledTimes(1);
    expect(mockMarkDeliveryFailure).toHaveBeenCalledTimes(4);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      request: expect.objectContaining({
        request_id: 'support-request-1',
        delivery: expect.objectContaining({
          internal_notification: expect.objectContaining({ status: 'failed' }),
          seller_acknowledgement: expect.objectContaining({ status: 'failed' }),
        }),
      }),
    }));
  });

  it('replays an existing idempotent support request without sending duplicate emails', async () => {
    const existing = baseRecord({
      internal_email_status: 'accepted',
      internal_email_provider_message_id: 'existing-internal',
      internal_email_attempt_count: 1,
      acknowledgement_email_status: 'accepted',
      acknowledgement_email_provider_message_id: 'existing-ack',
      acknowledgement_email_attempt_count: 1,
    });
    mockCreateOrGet.mockResolvedValue({ record: existing, created: false } as never);

    const req: any = {
      tenant: { tenantId: 'tenant-1' },
      userId: 'user-1',
      body: {
        category: 'technical',
        subject: 'Retry after timeout',
        message: 'The first response was not received by the browser.',
        source_page: 'help',
        idempotency_key: 'same-request-key',
      },
    };
    const res = createResponse();

    await createSupportRequest(req, res);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ request_id: 'support-request-1', created: false }),
    }));
  });

  it.each([
    [{ category: 'technical', subject: '   ', message: 'Valid message', source_page: 'help' }],
    [{ category: 'technical', subject: 'Valid subject', message: '   ', source_page: 'help' }],
    [{ category: 'unsupported', subject: 'Valid subject', message: 'Valid message', source_page: 'help' }],
  ])('rejects malformed authenticated Help payloads before persistence', async (body) => {
    const req: any = { tenant: { tenantId: 'tenant-1' }, userId: 'user-1', body };
    const res = createResponse();

    await createSupportRequest(req, res);

    expect(mockCreateOrGet).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('lists support records only through the resolved tenant and authenticated user scope', async () => {
    mockListSupportRequests.mockResolvedValue([baseRecord()] as never);
    const req: any = { tenant: { tenantId: 'tenant-1' }, userId: 'user-1', query: { limit: '10' } };
    const res = createResponse();

    await listSupportRequests(req, res);

    expect(mockListSupportRequests).toHaveBeenCalledWith('tenant-1', 'user-1', 10);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      requests: [expect.objectContaining({ request_id: 'support-request-1' })],
    }));
  });
});
