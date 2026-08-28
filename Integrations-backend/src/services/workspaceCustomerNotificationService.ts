import { EmailService } from '../notifications/services/delivery/email_service';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const emailService = new EmailService();
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://margin-finance.com').replace(/\/$/, '');

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

export async function notifyWorkspaceActivated(input: { paymentReference: string; userId: string; tenantId: string; tenantSlug?: string | null }): Promise<void> {
  const { data, error } = await supabaseAdmin.from('users').select('email').eq('id', input.userId).maybeSingle();
  if (error) throw new Error(`Failed to resolve Workspace customer email: ${error.message}`);
  const email = String(data?.email || '').trim().toLowerCase();
  if (!email) {
    logger.warn('[WORKSPACE] Customer email unavailable; activation email skipped', { paymentReference: input.paymentReference });
    return;
  }

  const slug = String(input.tenantSlug || input.tenantId).trim();
  const url = `${FRONTEND_URL}/app/${encodeURIComponent(slug)}/dashboard`;
  const subject = 'Recovery Workspace is active — Margin is ready to work with you';
  const text = [
    'Your Recovery Workspace subscription is active.',
    '',
    'Margin can now monitor the connected recovery workflow and keep the workspace available for ongoing evidence and recovery-control work.',
    '',
    `Open Recovery Workspace: ${url}`,
    '',
    'Amazon makes the final decision on any claim or reimbursement. Seller approval remains required before filing.',
  ].join('\n');
  const html = `<h2>Your Recovery Workspace subscription is active.</h2><p>Margin can now monitor the connected recovery workflow and keep the workspace available for ongoing evidence and recovery-control work.</p><p><a href="${escapeHtml(url)}">Open Recovery Workspace</a></p><p>Amazon makes the final decision on any claim or reimbursement. Seller approval remains required before filing.</p>`;

  await emailService.sendEmail({
    to: email,
    subject,
    html,
    text,
    replyTo: process.env.EMAIL_REPLY_TO || 'support@margin-finance.com',
    idempotencyKey: `workspace:${input.paymentReference}:activated:${email}`,
  });
  logger.info('[WORKSPACE] Customer activation notification sent', { paymentReference: input.paymentReference });
}
