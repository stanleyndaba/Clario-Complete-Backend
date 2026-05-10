import { EmailService, EmailSendResult } from '../notifications/services/delivery/email_service';
import config from '../config/env';

const EARLY_ACCESS_CHECKOUT_URL = 'https://www.paypal.com/ncp/payment/P4XPE6PAPWT56';

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
  const subject = `New Early Access paid-intent lead: ${normalizedEmail}`;
  const capturedAt = new Date().toISOString();
  const detailLines = [
    ['Email', normalizedEmail],
    ['Offer', input.offer || 'Early Access'],
    ['Price', input.price || '$99'],
    ['Intent', input.intent || 'reserve_early_access'],
    ['Source page', input.source_page || '/early-access'],
    ['IP', input.ip || 'Not provided'],
    ['User agent', input.user_agent || 'Not provided'],
    ['Captured at', capturedAt],
  ];

  const text = [
    'New Margin Early Access paid-intent lead',
    '========================================',
    '',
    ...detailLines.map(([label, value]) => `${label}: ${value}`),
    '',
    'Action: match this email against the PayPal payment notification, then send the Founding 100 onboarding invitation within the batch window.',
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
              Margin Early Access
            </div>
            <h1 style="margin:22px 0 0 0; font-size:26px; line-height:1.2; font-weight:600; color:#111827;">
              New paid-intent lead captured
            </h1>
          </div>
          <div style="padding-top:24px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%; border-collapse:collapse;">
              ${rows}
            </table>
            <div style="margin-top:22px; padding:16px; border-radius:12px; background:#f8fafc; color:#111827; font-size:14px; line-height:1.7;">
              Match this email against the PayPal payment notification, then send the Founding 100 onboarding invitation within the batch window.
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
  const subject = 'Your Founding Recovery Audit next step';
  const preheader = 'Your Founding Recovery Audit request is received.';
  const text = [
    'Hi,',
    '',
    'Your Founding Recovery Audit request is received.',
    '',
    'Next, complete your $99 audit activation using the checkout link below:',
    '',
    EARLY_ACCESS_CHECKOUT_URL,
    '',
    'Your audit activation includes a founder-led first recovery cycle, read-only setup guidance, claim-clock review, evidence readiness review, and a walkthrough of any recovery issues Margin surfaces.',
    '',
    'Founding 100 is onboarded in controlled batches so each workspace can be prepared carefully before read-only setup begins.',
    '',
    'After your payment is confirmed, we’ll send your intake form and First Recovery Setup Call instructions.',
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
              Your Founding Recovery Audit request is received.
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              Next, complete your $99 audit activation using the checkout link below.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#262626; font-size:15px; line-height:1.8;">
              Your audit activation includes a founder-led first recovery cycle, read-only setup guidance, claim-clock review, evidence readiness review, and a walkthrough of any recovery issues Margin surfaces.
            </p>

            <div style="margin-top:24px;">
              <a href="${EARLY_ACCESS_CHECKOUT_URL}" style="display:inline-block; padding:12px 18px; border-radius:999px; background:#111827; color:#ffffff; text-decoration:none; font-size:14px; font-weight:700;">
                Complete audit activation
              </a>
            </div>

            <p style="margin:24px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Founding 100 is onboarded in controlled batches so each workspace can be prepared carefully before read-only setup begins.
            </p>

            <p style="margin:18px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              After your payment is confirmed, we&rsquo;ll send your intake form and First Recovery Setup Call instructions.
            </p>

            <p style="margin:22px 0 0 0; color:#525252; font-size:14px; line-height:1.7;">
              Margin charges no recovery commissions. Sellers pay for ongoing recovery management, and approved recoveries stay with the seller.
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
    'Your $99 audit activation includes a founder-led first recovery cycle, read-only setup guidance, claim-clock review, evidence readiness review, and a walkthrough of any recovery issues Margin surfaces.',
    '',
    'Next step: complete your intake form so we can prepare your workspace:',
    '',
    '{{intake_link}}',
    '',
    'Then book your First Recovery Setup Call:',
    '',
    '{{booking_link}}',
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
              Your $99 audit activation includes a founder-led first recovery cycle, read-only setup guidance, claim-clock review, evidence readiness review, and a walkthrough of any recovery issues Margin surfaces.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:22px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Next step: complete your intake form so we can prepare your workspace:
            </p>

            <p style="margin:10px 0 0 0; color:#111827; font-size:15px; line-height:1.8; font-weight:700;">
              {{intake_link}}
            </p>

            <p style="margin:22px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Then book your First Recovery Setup Call:
            </p>

            <p style="margin:10px 0 0 0; color:#111827; font-size:15px; line-height:1.8; font-weight:700;">
              {{booking_link}}
            </p>

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
}

export const earlyAccessEmailService = new EarlyAccessEmailService();
