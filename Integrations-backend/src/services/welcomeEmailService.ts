import { supabaseAdmin } from '../database/supabaseClient';
import { EmailService } from '../notifications/services/delivery/email_service';
import logger from '../utils/logger';

interface WorkspaceWelcomeEmailInput {
  userId: string;
  email: string | null;
  firstName?: string | null;
  tenantId: string;
  tenantName?: string | null;
  tenantSlug?: string | null;
  /**
   * The seller began the Audit journey before account bootstrap. The welcome
   * message would arrive after that journey has already started, so it must be
   * suppressed in favour of the appropriate progress/result communication.
   */
  suppressForAuditProgress?: boolean;
  retryFailedOnly?: boolean;
}

interface WelcomeSetupState {
  amazonConnected: boolean;
  reliable: boolean;
}

const WELCOME_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_FIRST_NAME_LENGTH = 80;

function truncateError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value || 'welcome_email_failed');
  return message.slice(0, 500);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeFirstName(value: string | null | undefined): string | null {
  const firstName = String(value || '').trim().replace(/\s+/g, ' ');
  return firstName ? firstName.slice(0, MAX_FIRST_NAME_LENGTH) : null;
}

function isMissingWelcomeEmailSchema(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42703' ||
    message.includes('welcome_email_attempted_at') ||
    message.includes('welcome_email_sent_at') ||
    message.includes('welcome_email_last_error') ||
    message.includes('welcome_email_provider_message_id') ||
    message.includes('welcome_email_delivery_status') ||
    message.includes('welcome_email_last_event_at')
  );
}

function getFrontendBaseUrl(): string {
  return (process.env.FRONTEND_URL || 'https://app.margin-finance.com').replace(/\/+$/, '');
}

function buildAppUrl(tenantSlug?: string | null, path = ''): string {
  const baseUrl = getFrontendBaseUrl();
  if (tenantSlug) {
    return `${baseUrl}/app/${encodeURIComponent(tenantSlug)}${path}`;
  }
  return `${baseUrl}/app${path}`;
}

function buildPublicUrl(path: string): string {
  return `${getFrontendBaseUrl()}${path}`;
}

/**
 * The welcome CTA must lead to the first usable authenticated Audit step. It
 * deliberately starts with the seller's read-only Amazon connection rather
 * than implying that a recovery has already been identified or authorized.
 */
export function buildAuditStartUrl(tenantSlug?: string | null): string {
  return buildAppUrl(tenantSlug, '/connect-amazon');
}

export function shouldSuppressWelcomeEmailForAuditProgress(params: {
  hasAttachedAuditIntent?: boolean;
  hasStartedOrCompletedAudit?: boolean;
}): boolean {
  return params.hasAttachedAuditIntent === true || params.hasStartedOrCompletedAudit === true;
}

export function buildWelcomeEmail(
  input: WorkspaceWelcomeEmailInput,
  _setupState: WelcomeSetupState
): { subject: string; html: string; text: string } {
  const subject = 'Welcome to Margin — your free Recovery Audit is ready';
  const preheader = 'You do not need to have it all figured out. Start with a clear view of what Amazon’s records say.';
  const firstName = normalizeFirstName(input.firstName);
  const greeting = firstName ? `Welcome to Margin, ${firstName}.` : 'Welcome to Margin.';
  const auditStartUrl = buildAuditStartUrl(input.tenantSlug);
  const logoUrl = buildPublicUrl('/logoimagetwo.png');
  const privacyUrl = buildPublicUrl('/privacy');
  const termsUrl = buildPublicUrl('/terms');

  const text = [
    'Margin',
    '',
    greeting,
    '',
    'Thank you for taking the first step with us.',
    '',
    'Amazon recovery work is easy to put off. A reimbursement may not make sense, an inventory event may be hard to explain, or the work may simply keep landing back on your plate. You do not need to know exactly what is wrong—or have every document ready—before you begin.',
    '',
    'Your free Recovery Audit is where we start.',
    '',
    'Margin will help you see what does not add up, what supports it, and what needs your decision next.',
    '',
    'Run your free Recovery Audit',
    auditStartUrl,
    '',
    'Read-only access · No payment to run the Audit · Nothing is submitted without your approval',
    '',
    'Here is how we will get you started',
    '',
    '1. Connect Amazon',
    'Use the Audit flow to connect your seller account. Margin starts with the relevant records, using read-only access.',
    '',
    '2. Get a clear view',
    'Margin checks the applicable source data and shows what is supported, settled, missing, or needs more evidence.',
    '',
    '3. Decide with the facts in front of you',
    'You can see what was found, the proof behind it, what needs your approval, and—where applicable—what happened to the money.',
    '',
    'You stay in control at every meaningful step. Margin is here to make the recovery work clearer and easier to carry—not to hand you another confusing dashboard or ask you to figure it out alone.',
    '',
    'If anything feels unclear, reply to this email. Whether you need help connecting or want to understand what your Audit is showing, we will point you to the right next step.',
    '',
    'We are glad you are here.',
    '',
    'The Margin Team',
    'Support: support@margin-finance.com',
    '',
    'Margin',
    'Clear recovery work. You stay in control.',
    '',
    'Questions about your account or Audit? Reply to this email or contact support@margin-finance.com.',
    '',
    '© 2026 Margin. All rights reserved.',
    `Privacy: ${privacyUrl}`,
    `Terms: ${termsUrl}`
  ].join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0; padding:0; background:#ffffff; color:#171717; font-family:Arial, Helvetica, sans-serif;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
          ${escapeHtml(preheader)}
        </div>
        <div style="max-width:600px; margin:0 auto; padding:36px 24px 40px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:20px;">
            <a href="${escapeHtml(getFrontendBaseUrl())}" style="display:inline-flex; align-items:center; color:#182026; text-decoration:none;" aria-label="Margin home">
              <img src="${escapeHtml(logoUrl)}" alt="Margin" width="24" height="24" style="display:block; width:24px; height:24px; margin-right:10px; object-fit:contain;" />
              <span style="font-family:Merriweather, Georgia, 'Times New Roman', serif; font-size:20px; font-weight:700; letter-spacing:-0.02em; line-height:24px;">Margin</span>
            </a>
            <h1 style="margin:28px 0 0 0; font-family:Merriweather, Georgia, 'Times New Roman', serif; font-size:29px; line-height:1.24; font-weight:600; letter-spacing:-0.02em; color:#111827;">
              ${escapeHtml(greeting)}
            </h1>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#262626; font-size:15px; line-height:1.8;">Thank you for taking the first step with us.</p>

            <p style="margin:18px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">Amazon recovery work is easy to put off. A reimbursement may not make sense, an inventory event may be hard to explain, or the work may simply keep landing back on your plate. You do not need to know exactly what is wrong—or have every document ready—before you begin.</p>

            <p style="margin:18px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">Your free Recovery Audit is where we start.</p>

            <p style="margin:18px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">Margin will help you see what does not add up, what supports it, and what needs your decision next.</p>

            <div style="margin:28px 0 0 0;">
              <a href="${escapeHtml(auditStartUrl)}" style="display:inline-block; border-radius:8px; background:#0b74de; color:#ffffff; font-size:15px; font-weight:700; line-height:1.2; padding:15px 22px; text-decoration:none;">Run your free Recovery Audit</a>
            </div>
            <p style="margin:12px 0 0 0; color:#5f6773; font-size:12px; line-height:1.7;">Read-only access &middot; No payment to run the Audit &middot; Nothing is submitted without your approval</p>

            <div style="margin-top:28px; padding-top:22px; border-top:1px solid #eeeeee;">
              <p style="margin:0; color:#111827; font-size:14px; line-height:1.7; font-weight:700;">Here is how we will get you started</p>
              <ol style="margin:15px 0 0 20px; padding:0; color:#262626; font-size:15px; line-height:1.75;">
                <li style="margin:0 0 14px 0;"><strong>Connect Amazon</strong><br />Use the Audit flow to connect your seller account. Margin starts with the relevant records, using read-only access.</li>
                <li style="margin:0 0 14px 0;"><strong>Get a clear view</strong><br />Margin checks the applicable source data and shows what is supported, settled, missing, or needs more evidence.</li>
                <li><strong>Decide with the facts in front of you</strong><br />You can see what was found, the proof behind it, what needs your approval, and—where applicable—what happened to the money.</li>
              </ol>
            </div>

            <p style="margin:24px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">You stay in control at every meaningful step. Margin is here to make the recovery work clearer and easier to carry—not to hand you another confusing dashboard or ask you to figure it out alone.</p>

            <p style="margin:18px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">If anything feels unclear, reply to this email. Whether you need help connecting or want to understand what your Audit is showing, we will point you to the right next step.</p>

            <p style="margin:24px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">We are glad you are here.</p>

            <div style="margin:24px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              <div>The Margin Team</div>
              <div style="color:#666666; font-size:14px;">Support: support@margin-finance.com</div>
            </div>
          </div>

          <div style="margin-top:34px; padding-top:22px; border-top:1px solid #e5e5e5; color:#646b75; font-size:12px; line-height:1.7;">
            <div style="font-family:Merriweather, Georgia, 'Times New Roman', serif; color:#182026; font-size:15px; font-weight:700; letter-spacing:-0.015em;">Margin</div>
            <div style="margin-top:3px;">Clear recovery work. You stay in control.</div>
            <div style="margin-top:14px;">Questions about your account or Audit? Reply to this email or contact <a href="mailto:support@margin-finance.com" style="color:#365b88; text-decoration:underline;">support@margin-finance.com</a>.</div>
            <div style="margin-top:14px;">© 2026 Margin. All rights reserved.</div>
            <div style="margin-top:6px;"><a href="${escapeHtml(privacyUrl)}" style="color:#365b88; text-decoration:underline;">Privacy</a><span style="color:#a1a6ad;"> &middot; </span><a href="${escapeHtml(termsUrl)}" style="color:#365b88; text-decoration:underline;">Terms</a></div>
          </div>
        </div>
      </body>
    </html>
  `;

  return { subject, html: html.trim(), text };
}

class WelcomeEmailService {
  private emailService = new EmailService();

  private async resolveAmazonSetupState(userId: string, tenantId: string): Promise<WelcomeSetupState> {
    const { data, error } = await supabaseAdmin
      .from('tokens')
      .select('expires_at')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('provider', 'amazon')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.warn('[WELCOME EMAIL] Could not resolve Amazon setup state; using generic CTA', {
        userId,
        tenantId,
        error: error.message
      });
      return { amazonConnected: false, reliable: false };
    }

    const expiresAt = data?.expires_at ? new Date(data.expires_at).getTime() : null;
    const tokenIsUsable = Boolean(data) && (!expiresAt || Number.isNaN(expiresAt) || expiresAt > Date.now());
    return { amazonConnected: tokenIsUsable, reliable: true };
  }

  private async hasStartedOrCompletedAudit(userId: string, tenantId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('audit_runs')
      .select('id')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`WELCOME_EMAIL_AUDIT_STATE_LOOKUP_FAILED:${error.message}`);
    }

    return Boolean(data?.id);
  }

  async sendWorkspaceCreatedWelcomeEmailOnce(input: WorkspaceWelcomeEmailInput): Promise<void> {
    const email = input.email?.trim().toLowerCase();
    if (!input.userId || !email) {
      return;
    }

    const now = new Date();

    try {
      const { data: user, error: loadError } = await supabaseAdmin
        .from('users')
        .select('id, welcome_email_attempted_at, welcome_email_sent_at, welcome_email_last_error')
        .eq('id', input.userId)
        .maybeSingle();

      if (loadError) {
        if (isMissingWelcomeEmailSchema(loadError)) {
          logger.warn('[WELCOME EMAIL] Migration 107 has not been applied yet; skipping welcome email');
          return;
        }

        throw new Error(`WELCOME_EMAIL_USER_LOOKUP_FAILED:${loadError.message}`);
      }

      if (!user?.id || user.welcome_email_sent_at) {
        return;
      }

      if (input.retryFailedOnly && !user.welcome_email_last_error) {
        return;
      }

      if (input.suppressForAuditProgress) {
        logger.info('[WELCOME EMAIL] Skipping welcome email because the seller has already entered the Audit journey', {
          userId: input.userId,
          tenantId: input.tenantId
        });
        return;
      }

      if (user.welcome_email_attempted_at) {
        const lastAttempt = new Date(user.welcome_email_attempted_at).getTime();
        if (!Number.isNaN(lastAttempt) && now.getTime() - lastAttempt < WELCOME_RETRY_INTERVAL_MS) {
          return;
        }
      }

      const hasAuditProgress = await this.hasStartedOrCompletedAudit(input.userId, input.tenantId);
      if (shouldSuppressWelcomeEmailForAuditProgress({ hasStartedOrCompletedAudit: hasAuditProgress })) {
        logger.info('[WELCOME EMAIL] Skipping welcome email because the seller already has Audit progress', {
          userId: input.userId,
          tenantId: input.tenantId
        });
        return;
      }

      const attemptedAt = now.toISOString();
      const { error: attemptError } = await supabaseAdmin
        .from('users')
        .update({
          welcome_email_attempted_at: attemptedAt,
          welcome_email_last_error: null
        })
        .eq('id', input.userId)
        .is('welcome_email_sent_at', null);

      if (attemptError) {
        if (isMissingWelcomeEmailSchema(attemptError)) {
          logger.warn('[WELCOME EMAIL] Migration 107 has not been applied yet; skipping welcome email');
          return;
        }

        throw new Error(`WELCOME_EMAIL_ATTEMPT_MARK_FAILED:${attemptError.message}`);
      }

      const setupState = await this.resolveAmazonSetupState(input.userId, input.tenantId);
      const emailTemplate = buildWelcomeEmail(input, setupState);
      const sendResult = await this.emailService.sendEmail({
        to: email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: emailTemplate.text,
        replyTo: 'support@margin-finance.com'
      });

      const sentAt = new Date().toISOString();
      const { error: sentError } = await supabaseAdmin
        .from('users')
        .update({
          welcome_email_sent_at: sentAt,
          welcome_email_last_error: null
        })
        .eq('id', input.userId);

      if (sentError) {
        throw new Error(`WELCOME_EMAIL_SENT_MARK_FAILED:${sentError.message}`);
      }

      if (sendResult.providerMessageId) {
        try {
          await supabaseAdmin
            .from('users')
            .update({
              welcome_email_provider_message_id: sendResult.providerMessageId,
              welcome_email_delivery_status: 'sent_to_provider',
              welcome_email_last_event_at: sentAt
            })
            .eq('id', input.userId);
        } catch (providerWriteError: any) {
          if (!isMissingWelcomeEmailSchema(providerWriteError)) {
            logger.warn('[WELCOME EMAIL] Provider tracking write failed', {
              userId: input.userId,
              tenantId: input.tenantId,
              error: providerWriteError?.message || String(providerWriteError)
            });
          }
        }
      }

      logger.info('[WELCOME EMAIL] Sent workspace welcome email', {
        userId: input.userId,
        tenantId: input.tenantId,
        providerMessageId: sendResult.providerMessageId || null
      });
    } catch (error) {
      const lastError = truncateError(error);
      logger.warn('[WELCOME EMAIL] Non-blocking welcome email failed', {
        userId: input.userId,
        tenantId: input.tenantId,
        error: lastError
      });

      try {
        await supabaseAdmin
          .from('users')
          .update({ welcome_email_last_error: lastError })
          .eq('id', input.userId);
      } catch {
        // Login must never fail because the welcome email audit write failed.
      }
    }
  }
}

export const welcomeEmailService = new WelcomeEmailService();
