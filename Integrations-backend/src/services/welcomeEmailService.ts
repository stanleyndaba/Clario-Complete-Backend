import { supabaseAdmin } from '../database/supabaseClient';
import { EmailService } from '../notifications/services/delivery/email_service';
import logger from '../utils/logger';

interface WorkspaceWelcomeEmailInput {
  userId: string;
  email: string | null;
  tenantId: string;
  tenantName?: string | null;
  tenantSlug?: string | null;
  retryFailedOnly?: boolean;
}

interface WelcomeSetupState {
  amazonConnected: boolean;
  reliable: boolean;
}

const WELCOME_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

function buildAppUrl(tenantSlug?: string | null, path = ''): string {
  const baseUrl = (process.env.FRONTEND_URL || 'https://app.margin-finance.com').replace(/\/+$/, '');
  if (tenantSlug) {
    return `${baseUrl}/app/${encodeURIComponent(tenantSlug)}${path}`;
  }
  return `${baseUrl}/app`;
}

export function buildWelcomeEmail(
  input: WorkspaceWelcomeEmailInput,
  setupState: WelcomeSetupState
): { subject: string; html: string; text: string } {
  const workspaceName = input.tenantName?.trim() || 'your Margin workspace';
  const safeWorkspaceName = escapeHtml(workspaceName);
  const subject = 'Welcome to Margin';
  const intro = 'Your workspace is ready.';
  const setupLine = setupState.amazonConnected && setupState.reliable
    ? 'Your Amazon connection is already in place. Margin will use that connection to keep the workspace current as account activity changes.'
    : 'When you are ready, start with one setup path: connect Amazon for the most complete setup, or upload FBA reports if you prefer to begin manually.';
  const text = [
    'Welcome to Margin',
    '=================',
    '',
    intro,
    '',
    `Workspace: ${workspaceName}`,
    '',
    'Margin is here to give your Amazon operations a calmer place to see what needs attention, what is already moving, and what requires action next.',
    '',
    setupLine,
    '',
    'A good first step:',
    '- Connect Amazon SP-API if you want the workspace to stay current automatically.',
    '- Upload FBA reports if you would rather start with files you already have.',
    '',
    'You do not need to solve everything today. Start with the setup path that is easiest for you. Margin will organize the next steps from there.',
    '',
    'If anything feels unclear, reply to this email and we will help.',
    '',
    'Margin Team'
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
        <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
          ${escapeHtml(intro)}
        </div>
        <div style="max-width:600px; margin:0 auto; padding:36px 24px 40px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:20px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Margin
            </div>
            <h1 style="margin:28px 0 0 0; font-size:28px; line-height:1.18; font-weight:600; color:#111827;">
              Welcome to Margin
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              ${escapeHtml(intro)}
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#525252; font-size:14px; line-height:1.7;">
              Workspace: <strong style="color:#171717; font-weight:600;">${safeWorkspaceName}</strong>
            </p>

            <p style="margin:20px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Margin is here to give your Amazon operations a calmer place to see what needs attention,
              what is already moving, and what requires action next.
            </p>

            <p style="margin:18px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              ${escapeHtml(setupLine)}
            </p>

            <div style="margin-top:24px; padding-top:20px; border-top:1px solid #eeeeee;">
              <p style="margin:0; color:#111827; font-size:14px; line-height:1.7; font-weight:600;">
                A good first step
              </p>
              <ol style="margin:12px 0 0 20px; padding:0; color:#333333; font-size:14px; line-height:1.8;">
                <li style="margin-bottom:8px;">Connect Amazon SP-API if you want the workspace to stay current automatically.</li>
                <li>Upload FBA reports if you would rather start with files you already have.</li>
              </ol>
            </div>

            <p style="margin:24px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              You do not need to solve everything today. Start with the setup path that is easiest for you.
              Margin will organize the next steps from there.
            </p>

            <p style="margin:24px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              If anything feels unclear, reply to this email and we will help.
            </p>

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Margin Team
            </p>
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

      if (user.welcome_email_attempted_at) {
        const lastAttempt = new Date(user.welcome_email_attempted_at).getTime();
        if (!Number.isNaN(lastAttempt) && now.getTime() - lastAttempt < WELCOME_RETRY_INTERVAL_MS) {
          return;
        }
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
