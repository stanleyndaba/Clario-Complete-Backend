import { EmailService, EmailSendResult } from '../notifications/services/delivery/email_service';
import config from '../config/env';

const EARLY_ACCESS_CHECKOUT_URL = 'https://www.paypal.com/ncp/payment/P4XPE6PAPWT56';
const FOUNDING_RECOVERY_INTAKE_URL = 'https://forms.gle/Z6rTJfJ3L3EVkoF59';
const FOUNDING_RECOVERY_BOOKING_URL = 'https://calendly.com/mvelo-margin-finance/margin-founding-recovery-setup-call';
const EMAIL_BUTTON_STYLE = 'display:inline-block; padding:12px 18px; border-radius:12px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px; font-weight:700;';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface EarlyAccessCaptureInput {
  email: string;
  source_page?: string | null;
  offer?: string | null;
  price?: string | null;
  intent?: string | null;
  user_agent?: string | null;
  ip?: string | null;
}

function buildEarlyAccessLeadEmail(input: EarlyAccessCaptureInput): {
  subject: string;
  html: string;
  text: string;
} {
  const normalizedEmail = input.email.trim().toLowerCase();
  const subject = `New free FBA recovery audit request: ${normalizedEmail}`;
  const capturedAt = new Date().toISOString();
  const detailLines = [
    ['Email', normalizedEmail],
    ['Offer', input.offer || 'Early Access'],
    ['Price', input.price || 'Free pre-audit'],
    ['Intent', input.intent || 'request_free_pre_audit_report'],
    ['Source page', input.source_page || '/early-access'],
    ['IP', input.ip || 'Not provided'],
    ['User agent', input.user_agent || 'Not provided'],
    ['Captured at', capturedAt],
  ];

  const text = [
    'New Margin free FBA recovery audit request',
    '==========================================',
    '',
    ...detailLines.map(([label, value]) => `${label}: ${value}`),
    '',
    'Action: review this seller for a free pre-audit report, then send the report within the promised 48-hour window or follow up if more context is needed.',
  ].join('\n');

  const rows = detailLines
    .map(([label, value]) => `
      <tr>
        <td style="padding:10px 0; border-bottom:1px solid #f1f1f1; width:180px; vertical-align:top; color:#6b7280; font-size:13px; font-weight:600;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:10px 0; border-bottom:1px solid #f1f1f1; color:#111827; font-size:14px; line-height:1.6;">
          ${escapeHtml(String(value))}
        </td>
      </tr>
    `)
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0; padding:0; background:#ffffff; color:#171717; font-family:Arial, Helvetica, sans-serif;">
        <div style="max-width:640px; margin:0 auto; padding:32px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:18px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Margin Free Audit
            </div>
            <h1 style="margin:22px 0 0 0; font-size:26px; line-height:1.2; font-weight:600; color:#111827;">
              New free audit request captured
            </h1>
          </div>
          <div style="padding-top:24px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%; border-collapse:collapse;">
              ${rows}
            </table>
            <div style="margin-top:22px; padding:16px; border-radius:12px; background:#f8fafc; color:#111827; font-size:14px; line-height:1.7;">
              Review this seller for a free pre-audit report, then send the report within the promised 48-hour window or follow up if more context is needed.
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html: html.trim(),
    text,
  };
}

export function buildEarlyAccessConfirmationEmail(): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Your free Margin audit report request is received';
  const preheader = 'We will email your free FBA recovery audit report within 48 hours.';
  const text = [
    'Hi,',
    '',
    'Your free FBA recovery audit report request is received.',
    '',
    'We will review your FBA recovery signals and email your written pre-audit report within 48 hours.',
    '',
    'The report is designed to show hidden inventory losses, shipment issues, returns, fee errors, payout discrepancies, and which opportunities may be worth filing.',
    '',
    'No payment is required for the pre-audit report.',
    '',
    `If your report shows opportunities worth pursuing, you can upgrade to Founding 100 for $99 and get full recovery service through December 31, 2026 (regardless of when you join). No commissions, no monthly fees, no automatic renewal. After 2026, the service ends – unless you choose a new plan for 2027. This offer closes June 30, 2026.`,
    '',
    EARLY_ACCESS_CHECKOUT_URL,
    '',
    'Founding 100 includes guided filing support, 0% recovery commission to Margin, and seller approval before any filing.',
    '',
    'Margin does not guarantee reimbursement outcomes. Amazon makes final reimbursement decisions. Margin prepares and tracks evidence-backed recovery work.',
    '',
    'Best,',
    'Margin Support Team',
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
          ${escapeHtml(preheader)}
        </div>
        <div style="max-width:600px; margin:0 auto; padding:36px 24px 40px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:20px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Free FBA Recovery Audit Report
            </div>
            <h1 style="margin:28px 0 0 0; font-size:28px; line-height:1.18; font-weight:600; color:#111827;">
              Your free audit report request is received.
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              We will email your written pre-audit report within 48 hours.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#262626; font-size:15px; line-height:1.8;">
              We will review your FBA recovery signals for hidden inventory losses, shipment issues, returns, fee errors, payout discrepancies, and which opportunities may be worth filing.
            </p>

            <p style="margin:24px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              No payment is required for this pre-audit report.
            </p>

            <p style="margin:18px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              If your report shows opportunities worth pursuing, you can upgrade to Founding 100 for $99 and get full recovery service through December 31, 2026 (regardless of when you join). No commissions, no monthly fees, no automatic renewal. After 2026, the service ends &ndash; unless you choose a new plan for 2027. This offer closes June 30, 2026.
            </p>

            <div style="margin-top:20px;">
              <a href="${EARLY_ACCESS_CHECKOUT_URL}" style="display:inline-block; padding:12px 18px; border-radius:999px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px; font-weight:700;">
                Upgrade after reviewing your report
              </a>
            </div>

            <p style="margin:22px 0 0 0; color:#525252; font-size:14px; line-height:1.7;">
              Founding 100 includes guided filing support, 0% recovery commission to Margin, and seller approval before any filing.
            </p>

            <p style="margin:18px 0 0 0; color:#525252; font-size:14px; line-height:1.7;">
              Margin does not guarantee reimbursement outcomes. Amazon makes final reimbursement decisions. Margin prepares and tracks evidence-backed recovery work.
            </p>

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Best,<br>
              Margin Support Team
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html: html.trim(),
    text,
  };
}

export function buildEarlyAccessPaymentConfirmedEmail(): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Your Founding Recovery Audit is confirmed';
  const preheader = 'Your Founding Recovery Audit is confirmed.';
  const text = [
    'Hi {{first_name}},',
    '',
    'Your Founding Recovery Audit is confirmed.',
    '',
    'Your $99 payment activates Margin through December 31, 2026. You\'re covered for the rest of the year – no surprises, no renewals. We\'ll notify you before the end of the year about 2027 options. Founding 100 closes June 30 – you\'ve secured your spot.',
    '',
    'Next step: complete your intake form so we can prepare your workspace:',
    '',
    FOUNDING_RECOVERY_INTAKE_URL,
    '',
    'Then book your First Recovery Setup Call:',
    '',
    FOUNDING_RECOVERY_BOOKING_URL,
    '',
    'Founding 100 is onboarded in controlled batches so each workspace can be prepared carefully before read-only setup begins. In some cases, setup can begin within 24 hours after payment confirmation and intake completion. During heavier onboarding batches, setup may take up to 3–5 business days.',
    '',
    'Margin charges no recovery commissions. Sellers pay for ongoing recovery management, and approved recoveries stay with the seller.',
    '',
    'Margin does not guarantee reimbursement outcomes. Amazon makes final reimbursement decisions. Margin prepares and tracks evidence-backed recovery work.',
    '',
    'Best,',
    'Margin Support Team',
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
          ${escapeHtml(preheader)}
        </div>
        <div style="max-width:600px; margin:0 auto; padding:36px 24px 40px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:20px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Founding 100 Recovery Audit
            </div>
            <h1 style="margin:28px 0 0 0; font-size:28px; line-height:1.18; font-weight:600; color:#111827;">
              Your Founding Recovery Audit is confirmed.
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              Your $99 payment activates Margin through December 31, 2026. You're covered for the rest of the year &ndash; no surprises, no renewals. We'll notify you before the end of the year about 2027 options. Founding 100 closes June 30 &ndash; you've secured your spot.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:22px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Next step: complete your intake form so we can prepare your workspace:
            </p>

            <div style="margin-top:12px;">
              <a href="${FOUNDING_RECOVERY_INTAKE_URL}" style="${EMAIL_BUTTON_STYLE}">
                Complete intake form
              </a>
            </div>

            <p style="margin:22px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Then book your First Recovery Setup Call:
            </p>

            <div style="margin-top:12px;">
              <a href="${FOUNDING_RECOVERY_BOOKING_URL}" style="${EMAIL_BUTTON_STYLE}">
                Book setup call
              </a>
            </div>

            <p style="margin:22px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Founding 100 is onboarded in controlled batches so each workspace can be prepared carefully before read-only setup begins. In some cases, setup can begin within 24 hours after payment confirmation and intake completion. During heavier onboarding batches, setup may take up to 3&ndash;5 business days.
            </p>

            <p style="margin:18px 0 0 0; color:#525252; font-size:13px; line-height:1.7;">
              Margin charges no recovery commissions. Sellers pay for ongoing recovery management, and approved recoveries stay with the seller.
            </p>

            <p style="margin:18px 0 0 0; color:#525252; font-size:13px; line-height:1.7;">
              Margin does not guarantee reimbursement outcomes. Amazon makes final reimbursement decisions. Margin prepares and tracks evidence-backed recovery work.
            </p>

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Best,<br>
              Margin Support Team
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html: html.trim(),
    text,
  };
}

export function buildEarlyAccessIntakeReceivedEmail(): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Your Founding Recovery Audit intake is received';
  const preheader = 'Your intake is complete. Your setup call is the next step.';
  const text = [
    'Hi,',
    '',
    'Your Founding Recovery Audit intake is received.',
    '',
    'Thanks for completing the intake form. We will use those details to prepare your workspace, review marketplace coverage, and make the first recovery setup call more useful.',
    '',
    'Next step: book your First Recovery Setup Call if you have not already done so:',
    '',
    FOUNDING_RECOVERY_BOOKING_URL,
    '',
    'Founding 100 setup is handled in controlled batches so each seller gets a careful read-only start before recovery review begins.',
    '',
    'Your service is valid through Dec 31, 2026.',
    '',
    'Best,',
    'Margin Support Team',
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
          ${escapeHtml(preheader)}
        </div>
        <div style="max-width:600px; margin:0 auto; padding:36px 24px 40px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:20px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Founding 100 Recovery Audit
            </div>
            <h1 style="margin:28px 0 0 0; font-size:28px; line-height:1.18; font-weight:600; color:#111827;">
              Your intake is received.
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              Thanks for completing the intake form. We will use those details to prepare your workspace and make the first recovery setup call more useful.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#262626; font-size:15px; line-height:1.8;">
              Next step: book your First Recovery Setup Call if you have not already done so.
            </p>

            <div style="margin-top:18px;">
              <a href="${FOUNDING_RECOVERY_BOOKING_URL}" style="${EMAIL_BUTTON_STYLE}">
                Book setup call
              </a>
            </div>

            <p style="margin:24px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Founding 100 setup is handled in controlled batches so each seller gets a careful read-only start before recovery review begins.
            </p>

            <p style="margin:24px 0 0 0; color:#525252; font-size:13px; line-height:1.7;">
              Your service is valid through Dec 31, 2026.
            </p>

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Best,<br>
              Margin Support Team
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html: html.trim(),
    text,
  };
}

export function buildEarlyAccessSetupScheduledEmail(): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Your Founding Recovery setup is scheduled';
  const preheader = 'Your onboarding slot is confirmed.';
  const text = [
    'Hi,',
    '',
    'Your Founding Recovery setup is scheduled.',
    '',
    'Your onboarding slot is confirmed. We prepare Founding 100 workspaces in controlled batches so read-only setup, marketplace coverage, and first-cycle recovery review stay accurate.',
    '',
    'Before the call, please make sure your intake is complete:',
    '',
    FOUNDING_RECOVERY_INTAKE_URL,
    '',
    'On the setup call, we will confirm your marketplace coverage, walk through the read-only connection path, and explain what happens before any recovery case moves forward.',
    '',
    'Your service is valid through Dec 31, 2026.',
    '',
    'Best,',
    'Margin Support Team',
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
          ${escapeHtml(preheader)}
        </div>
        <div style="max-width:600px; margin:0 auto; padding:36px 24px 40px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:20px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Founding 100 Recovery Audit
            </div>
            <h1 style="margin:28px 0 0 0; font-size:28px; line-height:1.18; font-weight:600; color:#111827;">
              Your setup is scheduled.
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              Your onboarding slot is confirmed.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#262626; font-size:15px; line-height:1.8;">
              We prepare Founding 100 workspaces in controlled batches so read-only setup, marketplace coverage, and first-cycle recovery review stay accurate.
            </p>

            <p style="margin:22px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Before the call, please make sure your intake is complete.
            </p>

            <div style="margin-top:18px;">
              <a href="${FOUNDING_RECOVERY_INTAKE_URL}" style="${EMAIL_BUTTON_STYLE}">
                Complete intake form
              </a>
            </div>

            <p style="margin:24px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              On the setup call, we will confirm your marketplace coverage, walk through the read-only connection path, and explain what happens before any recovery case moves forward.
            </p>

            <p style="margin:24px 0 0 0; color:#525252; font-size:13px; line-height:1.7;">
              Your service is valid through Dec 31, 2026.
            </p>

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Best,<br>
              Margin Support Team
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html: html.trim(),
    text,
  };
}

class EarlyAccessEmailService {
  private emailService = new EmailService();

  async sendEarlyAccessLeadEmail(input: EarlyAccessCaptureInput): Promise<EmailSendResult> {
    const recipient = config.EARLY_ACCESS_CAPTURE_EMAIL.trim().toLowerCase();
    const template = buildEarlyAccessLeadEmail(input);

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: input.email.trim().toLowerCase(),
    });
  }

  async sendEarlyAccessConfirmationEmail(email: string): Promise<EmailSendResult> {
    const recipient = email.trim().toLowerCase();
    const template = buildEarlyAccessConfirmationEmail();

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: 'support@margin-finance.com',
    });
  }

  async sendEarlyAccessPaymentConfirmedEmail(email: string): Promise<EmailSendResult> {
    const recipient = email.trim().toLowerCase();
    const template = buildEarlyAccessPaymentConfirmedEmail();

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: 'support@margin-finance.com',
    });
  }

  async sendEarlyAccessIntakeReceivedEmail(email: string): Promise<EmailSendResult> {
    const recipient = email.trim().toLowerCase();
    const template = buildEarlyAccessIntakeReceivedEmail();

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: 'support@margin-finance.com',
    });
  }

  async sendEarlyAccessSetupScheduledEmail(email: string): Promise<EmailSendResult> {
    const recipient = email.trim().toLowerCase();
    const template = buildEarlyAccessSetupScheduledEmail();

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: 'support@margin-finance.com',
    });
  }
}

export const earlyAccessEmailService = new EarlyAccessEmailService();
