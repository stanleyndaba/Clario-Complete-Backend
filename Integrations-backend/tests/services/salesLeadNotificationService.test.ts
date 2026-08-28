import { afterEach, describe, expect, it, jest } from '@jest/globals';

const sendEmailMock: any = jest.fn();
jest.mock('../../src/notifications/services/delivery/email_service', () => ({
  EmailService: jest.fn().mockImplementation(() => ({ sendEmail: sendEmailMock }))
}));

import { notifySalesLead } from '../../src/services/salesLeadNotificationService';

const lead = {
  id: 'lead-123',
  name: 'Alex <Seller>',
  email: 'alex@example.com',
  company: 'Example Brands',
  role: 'CFO',
  annualGmv: '$1M-$5M',
  accounts: '3 Seller Central accounts',
  complexity: 'Multiple marketplaces',
  process: 'Spreadsheets',
  objective: 'Understand recovery burden',
  notes: 'Please review.',
  createdAt: '2026-08-28T00:00:00.000Z'
};

describe('salesLeadNotificationService', () => {
  const originalEmails = process.env.SALES_LEAD_NOTIFICATION_EMAILS;
  const originalEmail = process.env.SALES_LEAD_NOTIFICATION_EMAIL;

  afterEach(() => {
    sendEmailMock.mockReset();
    if (originalEmails === undefined) delete process.env.SALES_LEAD_NOTIFICATION_EMAILS;
    else process.env.SALES_LEAD_NOTIFICATION_EMAILS = originalEmails;
    if (originalEmail === undefined) delete process.env.SALES_LEAD_NOTIFICATION_EMAIL;
    else process.env.SALES_LEAD_NOTIFICATION_EMAIL = originalEmail;
  });

  it('notifies hello@margin-finance.com by default with safe content and a lead-specific key', async () => {
    sendEmailMock.mockResolvedValue({ provider: 'resend', providerMessageId: 'msg-1' });

    await notifySalesLead(lead);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'hello@margin-finance.com',
      replyTo: 'alex@example.com',
      idempotencyKey: 'sales-lead:lead-123:hello@margin-finance.com'
    }));
    const payload = sendEmailMock.mock.calls[0][0];
    expect(payload.html).toContain('Alex &lt;Seller&gt;');
    expect(payload.html).not.toContain('Alex <Seller>');
    expect(payload.text).toContain('Company: Example Brands');
  });

  it('fans out to configured admin recipients without changing the default safety contract', async () => {
    process.env.SALES_LEAD_NOTIFICATION_EMAILS = 'hello@margin-finance.com, admin@margin-finance.com, hello@margin-finance.com';
    sendEmailMock.mockResolvedValue({ provider: 'resend', providerMessageId: 'msg-2' });

    await notifySalesLead(lead);

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock.mock.calls.map((call: any[]) => call[0].to)).toEqual([
      'hello@margin-finance.com',
      'admin@margin-finance.com'
    ]);
  });
});
