import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createSupportRequest } from '../../src/controllers/supportController';

const mockCreateSupportRequest = jest.fn();
const mockListSupportRequests = jest.fn();
const mockSendEmail = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/services/supportRequestService', () => ({
  supportRequestService: {
    create: (...args: any[]) => mockCreateSupportRequest(...args),
    listForTenantUser: (...args: any[]) => mockListSupportRequests(...args),
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

describe('supportController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPPORT_INBOX_EMAIL = 'support@margin-finance.com';
    mockUserEmailLookup('seller@example.com');
    mockCreateSupportRequest.mockResolvedValue({
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
    } as never);
    mockSendEmail.mockResolvedValue(undefined as never);
  });

  it('emails the support inbox and uses the authenticated user email as Reply-To', async () => {
    const req: any = {
      tenant: { tenantId: 'tenant-1' },
      userId: 'user-1',
      body: {
        category: 'technical',
        subject: 'Help page test',
        message: 'I need help with my workspace.',
        source_page: 'help',
        metadata: {
          tenant_slug: 'margin-finance',
        },
      },
    };
    const res = createResponse();

    await createSupportRequest(req, res);

    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockCreateSupportRequest).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-1',
      metadata: expect.objectContaining({
        contact_email: 'seller@example.com',
        submitted_contact_email: null,
        support_recipient: 'support@margin-finance.com',
      }),
    }));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'support@margin-finance.com',
      subject: '[Margin Support] Help page test',
      replyTo: 'seller@example.com',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      email_sent_to: 'support@margin-finance.com',
    }));
  });

  it('uses an explicit submitted contact email when one is provided', async () => {
    const req: any = {
      tenant: { tenantId: 'tenant-1' },
      userId: 'user-1',
      body: {
        category: 'billing',
        subject: 'Billing question',
        message: 'Please reply to my finance inbox.',
        source_page: 'help',
        metadata: {
          contact_email: 'finance@example.com',
        },
      },
    };
    const res = createResponse();

    await createSupportRequest(req, res);

    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCreateSupportRequest).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        contact_email: 'finance@example.com',
        submitted_contact_email: 'finance@example.com',
      }),
    }));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'support@margin-finance.com',
      replyTo: 'finance@example.com',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
