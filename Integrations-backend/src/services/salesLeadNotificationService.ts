import { EmailService } from '../notifications/services/delivery/email_service';
import logger from '../utils/logger';

const DEFAULT_RECIPIENT = 'hello@margin-finance.com';
const emailService = new EmailService();

export interface SalesLeadNotificationInput {
  id: string;
  name: string;
  email: string;
  company: string;
  role: string;
  annualGmv: string;
  accounts?: string | null;
  complexity?: string | null;
  process?: string | null;
  objective?: string | null;
  notes?: string | null;
  createdAt: string;
}

function recipients(): string[] {
  const configured = (process.env.SALES_LEAD_NOTIFICATION_EMAILS || process.env.SALES_LEAD_NOTIFICATION_EMAIL || DEFAULT_RECIPIENT)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(configured)];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] || character);
}

function detail(label: string, value?: string | null): string {
  return value ? `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>` : '';
}

export async function notifySalesLead(input: SalesLeadNotificationInput): Promise<void> {
  const to = recipients();
  const subject = `New Talk-to-Sales lead: ${input.company}`;
  const html = `<!doctype html><html><body><h2>New Talk-to-Sales lead</h2>${detail('Name', input.name)}${detail('Email', input.email)}${detail('Company', input.company)}${detail('Role', input.role)}${detail('Annual GMV', input.annualGmv)}${detail('Accounts / marketplaces', input.accounts)}${detail('Catalogue complexity', input.complexity)}${detail('Current process', input.process)}${detail('Objective', input.objective)}${detail('Notes', input.notes)}${detail('Lead ID', input.id)}${detail('Created at', input.createdAt)}<p><a href="${escapeHtml(`${process.env.FRONTEND_URL || 'https://margin-finance.com'}/sales`)}">Open Talk to Sales</a></p></body></html>`;
  const text = [
    'New Talk-to-Sales lead',
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Company: ${input.company}`,
    `Role: ${input.role}`,
    `Annual GMV: ${input.annualGmv}`,
    input.accounts ? `Accounts / marketplaces: ${input.accounts}` : '',
    input.complexity ? `Catalogue complexity: ${input.complexity}` : '',
    input.process ? `Current process: ${input.process}` : '',
    input.objective ? `Objective: ${input.objective}` : '',
    input.notes ? `Notes: ${input.notes}` : '',
    `Lead ID: ${input.id}`,
    `Created at: ${input.createdAt}`
  ].filter(Boolean).join('\n');

  for (const recipient of to) {
    await emailService.sendEmail({
      to: recipient,
      subject,
      html,
      text,
      replyTo: input.email,
      idempotencyKey: `sales-lead:${input.id}:${recipient}`
    });
  }

  logger.info('[SALES_LEADS] Internal notification sent', { leadId: input.id, recipientCount: to.length });
}
