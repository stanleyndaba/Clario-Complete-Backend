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
    message.includes('welcome_email_last_error')
  );
}

function buildAppUrl(tenantSlug?: string | null, path = ''): string {
  const baseUrl = (process.env.FRONTEND_URL || 'https://app.margin-finance.com').replace(/\/+$/, '');
  if (tenantSlug) {
    return `${baseUrl}/app/${encodeURIComponent(tenantSlug)}${path}`;
  }
  return `${baseUrl}/app`;
}

function buildWelcomeEmail(
  input: WorkspaceWelcomeEmailInput,
  setupState: WelcomeSetupState
): { subject: string; html: string; text: string } {
  const workspaceName = input.tenantName?.trim() || 'your Margin workspace';
  const workspaceUrl = buildAppUrl(input.tenantSlug);
  const connectAmazonUrl = buildAppUrl(input.tenantSlug, '/connect-amazon');
  const dataUploadUrl = buildAppUrl(input.tenantSlug, '/data-upload');
  const primaryCta = !setupState.reliable
    ? { label: 'Open Margin', url: workspaceUrl }
    : setupState.amazonConnected
      ? { label: 'Upload FBA Data', url: dataUploadUrl }
      : { label: 'Connect Amazon', url: connectAmazonUrl };
  const secondaryCta = !setupState.reliable
    ? null
    : setupState.amazonConnected
      ? { label: 'Open Margin', url: workspaceUrl }
      : { label: 'Upload FBA Data', url: dataUploadUrl };
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safePrimaryUrl = escapeHtml(primaryCta.url);
  const safeSecondaryUrl = secondaryCta ? escapeHtml(secondaryCta.url) : null;

  const subject = 'Welcome to Margin';
  const summary = 'Your workspace is ready. To start your recovery audit, choose one of the setup options below.';
  const amazonSectionText = setupState.amazonConnected && setupState.reliable
    ? 'Your Amazon connection is already detected. Margin can use that connection to sync seller data, audit FBA activity, and identify eligible reimbursement opportunities.'
    : 'This is the fastest and most complete way to get started. Margin connects directly to your Amazon seller data so it can begin syncing, auditing, and identifying eligible reimbursement opportunities.';
  const text = [
    'Welcome to Margin',
    '=================',
    '',
    summary,
    '',
    `Workspace: ${workspaceName}`,
    '',
    'Setup option 1: Connect Amazon via SP-API',
    amazonSectionText,
    '',
    'Setup option 2: Upload your FBA data',
    'If you prefer to start manually, you can upload your FBA files through Data Uploads. Margin will use that data to begin reviewing your account for missed recoveries and what Amazon may owe you.',
    '',
    'Current audit coverage:',
    'Margin currently focuses on seven high-priority reimbursement detection categories first, with additional categories rolling out this month.',
    '',
    'What happens next:',
    'Once your data is connected or uploaded, Margin begins reviewing your FBA activity, identifying recovery opportunities, and preparing the next steps as cases move forward.',
    '',
    `${primaryCta.label}: ${primaryCta.url}`,
    ...(secondaryCta ? [`${secondaryCta.label}: ${secondaryCta.url}`] : []),
    '',
    'This is an automated account email from Margin.'
  ].join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0; padding:0; background:#f5f5f3; color:#171717; font-family:Arial, sans-serif;">
        <div style="max-width:620px; margin:0 auto; padding:28px 18px;">
          <div style="background:#0b0b0b; color:#ffffff; border-radius:18px; padding:28px;">
            <div style="font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:#a3a3a3; font-weight:700;">
              Margin workspace
            </div>
            <h1 style="margin:12px 0 0 0; font-size:30px; line-height:1.05; font-weight:700;">
              Welcome to Margin.
            </h1>
            <p style="margin:16px 0 0 0; color:#d4d4d4; font-size:15px; line-height:1.7;">
              ${escapeHtml(summary)}
            </p>
          </div>

          <div style="background:#ffffff; border-radius:18px; padding:24px; margin-top:14px; border:1px solid #e7e5e4;">
            <div style="font-size:12px; color:#737373; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
              Workspace
            </div>
            <p style="margin:8px 0 0 0; font-size:16px; color:#171717;">
              ${safeWorkspaceName}
            </p>

            <div style="margin-top:22px; padding:18px; background:#f7f7f5; border-radius:14px; border-left:4px solid #111827;">
              <div style="font-size:12px; color:#525252; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
                Option 1
              </div>
              <h2 style="margin:8px 0 0 0; color:#171717; font-size:18px; line-height:1.25;">
                Connect Amazon via SP-API
              </h2>
              <p style="margin:10px 0 0 0; color:#262626; line-height:1.65; font-size:14px;">
                ${escapeHtml(amazonSectionText)}
              </p>
            </div>

            <div style="margin-top:14px; padding:18px; background:#f7f7f5; border-radius:14px; border-left:4px solid #737373;">
              <div style="font-size:12px; color:#525252; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
                Option 2
              </div>
              <h2 style="margin:8px 0 0 0; color:#171717; font-size:18px; line-height:1.25;">
                Upload your FBA data
              </h2>
              <p style="margin:10px 0 0 0; color:#262626; line-height:1.65; font-size:14px;">
                If you prefer to start manually, you can upload your FBA files through Data Uploads. Margin will use that data to begin reviewing your account for missed recoveries and what Amazon may owe you.
              </p>
            </div>

            <div style="margin-top:14px; padding:16px; background:#fff8e6; border-radius:14px; border:1px solid #fde68a;">
              <div style="font-size:12px; color:#92400e; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
                Current audit coverage
              </div>
              <p style="margin:8px 0 0 0; color:#78350f; line-height:1.6; font-size:14px;">
                Margin currently focuses on seven high-priority reimbursement detection categories first, with additional categories rolling out this month.
              </p>
            </div>

            <p style="margin:22px 0 0 0; color:#525252; font-size:14px; line-height:1.6;">
              Once your data is connected or uploaded, Margin begins reviewing your FBA activity, identifying recovery opportunities, and preparing the next steps as cases move forward.
            </p>

            <div style="margin-top:24px; display:block;">
              <a href="${safePrimaryUrl}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:10px; font-weight:700; font-size:14px;">
                ${escapeHtml(primaryCta.label)}
              </a>
              ${secondaryCta && safeSecondaryUrl ? `
                <a href="${safeSecondaryUrl}" style="display:inline-block; margin-left:10px; color:#111827; text-decoration:none; padding:11px 17px; border-radius:10px; border:1px solid #d6d3d1; font-weight:700; font-size:14px;">
                  ${escapeHtml(secondaryCta.label)}
                </a>
              ` : ''}
            </div>

            <p style="margin:18px 0 0 0; color:#737373; font-size:12px; line-height:1.5;">
              If the button does not work, copy and paste this link:<br>
              <a href="${safePrimaryUrl}" style="color:#111827; word-break:break-all;">${safePrimaryUrl}</a>
            </p>
          </div>

          <p style="margin:18px 0 0 0; text-align:center; color:#737373; font-size:12px;">
            This is an automated account email from Margin.
          </p>
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
      await this.emailService.sendEmail({
        to: email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: emailTemplate.text
      });

      const { error: sentError } = await supabaseAdmin
        .from('users')
        .update({
          welcome_email_sent_at: new Date().toISOString(),
          welcome_email_last_error: null
        })
        .eq('id', input.userId);

      if (sentError) {
        throw new Error(`WELCOME_EMAIL_SENT_MARK_FAILED:${sentError.message}`);
      }

      logger.info('[WELCOME EMAIL] Sent workspace welcome email', {
        userId: input.userId,
        tenantId: input.tenantId
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
