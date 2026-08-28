import { EmailService } from '../notifications/services/delivery/email_service';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const emailService = new EmailService();
const DEFAULT_FRONTEND_URL = 'https://margin-finance.com';

type EngagementNotificationInput = {
  engagementId: string;
  userId: string;
  tenantId: string;
  tenantSlug?: string | null;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

async function resolveTenantSlug(tenantId: string, tenantSlug?: string | null): Promise<string> {
  const supplied = String(tenantSlug || '').trim();
  if (supplied) return supplied;
  const { data, error } = await supabaseAdmin.from('tenants').select('slug').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(`Failed to resolve Recover Once workspace URL: ${error.message}`);
  return String(data?.slug || tenantId).trim();
}

function engagementUrl(engagementId: string, tenantSlug: string): string {
  const base = (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).replace(/\/$/, '');
  return `${base}/app/${encodeURIComponent(tenantSlug)}/recover-once/${encodeURIComponent(engagementId)}`;
}

function readinessWindow(): string {
  const configured = String(process.env.RECOVER_ONCE_READINESS_WINDOW_TEXT || '').trim();
  return configured ? ` ${configured}` : '';
}

async function getRecipientEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to resolve Recover Once customer email: ${error.message}`);
  const email = String(data?.email || '').trim().toLowerCase();
  return email || null;
}

export async function notifyRecoverOnceActivated(input: EngagementNotificationInput): Promise<void> {
  const email = await getRecipientEmail(input.userId);
  if (!email) {
    logger.warn('[RECOVER_ONCE] Customer email unavailable; lifecycle email skipped', { engagementId: input.engagementId });
    return;
  }

  const url = engagementUrl(input.engagementId, await resolveTenantSlug(input.tenantId, input.tenantSlug));
  const firstSubject = 'Payment confirmed — your Recover Once engagement is active';
  const firstText = [
    'Payment confirmed — your Recover Once engagement is active.',
    '',
    'Margin has recorded your one-time recovery engagement and is preparing the evidence-backed next steps. This is separate from a Recovery Workspace subscription.',
    '',
    `Open your Recover Once workspace: ${url}`,
  ].join('\n');
  const firstHtml = `<h2>Payment confirmed — your Recover Once engagement is active.</h2><p>Margin has recorded your one-time recovery engagement and is preparing the evidence-backed next steps.</p><p>This is separate from a recurring Recovery Workspace subscription.</p><p><a href="${escapeHtml(url)}">Open your Recover Once workspace</a></p>`;

  const preparationSubject = 'Your Recover Once recovery workspace is being prepared';
  const preparationText = [
    'Your recovery workspace is being prepared.',
    '',
    'Margin is reviewing your evidence, organising the recovery work, and preparing the next steps.',
    readinessWindow(),
    '',
    `View the current engagement state: ${url}`,
    '',
    'A ready-for-review state does not mean Amazon has accepted a claim or that reimbursement is guaranteed. Seller approval remains required before any filing or recovery operation proceeds.',
  ].join('\n').replace(/\n +\n/g, '\n\n');
  const preparationHtml = `<h2>Your recovery workspace is being prepared.</h2><p>Margin is reviewing your evidence, organising the recovery work, and preparing the next steps.</p>${readinessWindow() ? `<p>${escapeHtml(readinessWindow().trim())}</p>` : ''}<p><a href="${escapeHtml(url)}">View the current engagement state</a></p><p>A ready-for-review state does not mean Amazon has accepted a claim or that reimbursement is guaranteed. Seller approval remains required before any filing or recovery operation proceeds.</p>`;

  await emailService.sendEmail({
    to: email,
    subject: firstSubject,
    html: firstHtml,
    text: firstText,
    replyTo: process.env.EMAIL_REPLY_TO || 'support@margin-finance.com',
    idempotencyKey: `recover-once:${input.engagementId}:activated:${email}`,
  });
  await emailService.sendEmail({
    to: email,
    subject: preparationSubject,
    html: preparationHtml,
    text: preparationText,
    replyTo: process.env.EMAIL_REPLY_TO || 'support@margin-finance.com',
    idempotencyKey: `recover-once:${input.engagementId}:preparing:${email}`,
  });

  logger.info('[RECOVER_ONCE] Customer lifecycle notifications sent', { engagementId: input.engagementId });
}
