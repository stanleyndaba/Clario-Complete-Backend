import { EmailService, EmailSendResult } from '../notifications/services/delivery/email_service';
import config from '../config/env';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildWaitlistConfirmationEmail(): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "You're on the Margin waitlist.";
  const preheader = 'Your place on the waitlist has been reserved.';

  const text = [
    'Welcome to Margin.',
    '',
    'Your place on the waitlist has been reserved.',
    '',
    "You're now in line for the next onboarding batch opening Monday.",
    '',
    'Margin helps Amazon FBA sellers prepare claim-ready evidence for reimbursement cases - bringing together invoices, shipment records, proof of delivery, case history, payout data, and supporting documents before Amazon reviews a claim.',
    '',
    "As we get closer to launch, we'll email you with:",
    '',
    'Your onboarding invitation',
    'Early access updates',
    'Product improvements',
    'Launch instructions',
    '',
    'Want to be considered for priority onboarding?',
    '',
    'Simply reply to this email and tell us:',
    '',
    'Which Amazon marketplace you sell on',
    'Approximately how many orders you process each month',
    "The biggest reimbursement challenge you're facing today",
    '',
    "We'll use this to prioritize onboarding for the next batch.",
    '',
    'Thank you for joining Margin.',
    '',
    "We're looking forward to welcoming you.",
    '',
    '- The Margin Team'
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
              Margin
            </div>
            <h1 style="margin:28px 0 0 0; font-size:28px; line-height:1.18; font-weight:600; color:#111827;">
              Welcome to Margin.
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              Your place on the waitlist has been reserved.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#262626; font-size:15px; line-height:1.8;">
              You're now in line for the next onboarding batch opening Monday.
            </p>

            <p style="margin:20px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              Margin helps Amazon FBA sellers prepare claim-ready evidence for reimbursement cases - bringing together invoices, shipment records, proof of delivery, case history, payout data, and supporting documents before Amazon reviews a claim.
            </p>

            <div style="margin-top:24px; padding-top:20px; border-top:1px solid #eeeeee;">
              <p style="margin:0; color:#111827; font-size:14px; line-height:1.7; font-weight:600;">
                As we get closer to launch, we'll email you with:
              </p>
              <ul style="margin:12px 0 0 0; padding-left:20px; color:#262626; font-size:15px; line-height:1.8;">
                <li>Your onboarding invitation</li>
                <li>Early access updates</li>
                <li>Product improvements</li>
                <li>Launch instructions</li>
              </ul>
            </div>

            <div style="margin-top:24px; padding-top:20px; border-top:1px solid #eeeeee;">
              <p style="margin:0; color:#111827; font-size:14px; line-height:1.7; font-weight:600;">
                Want to be considered for priority onboarding?
              </p>
              <p style="margin:10px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
                Simply reply to this email and tell us:
              </p>
              <ul style="margin:12px 0 0 0; padding-left:20px; color:#262626; font-size:15px; line-height:1.8;">
                <li>Which Amazon marketplace you sell on</li>
                <li>Approximately how many orders you process each month</li>
                <li>The biggest reimbursement challenge you're facing today</li>
              </ul>
              <p style="margin:14px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
                We'll use this to prioritize onboarding for the next batch.
              </p>
            </div>

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Thank you for joining Margin.<br><br>
              We're looking forward to welcoming you.<br><br>
              - The Margin Team
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html: html.trim(),
    text
  };
}

export interface WaitlistLeadCaptureInput {
  email: string;
  full_name?: string | null;
  amazon_marketplace?: string | null;
  monthly_revenue?: string | null;
  recovery_challenge?: string | null;
  seller_central_email?: string | null;
  priority_onboarding?: string | null;
  notes?: string | null;
  user_type?: string | null;
  brand_count?: string | null;
  annual_revenue?: string | null;
  contact_handle?: string | null;
  primary_goal?: string | null;
  source_page?: string | null;
  intent?: string | null;
  reason?: string | null;
  user_agent?: string | null;
  ip?: string | null;
}

function buildWaitlistLeadCaptureEmail(input: WaitlistLeadCaptureInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `New waitlist lead: ${input.email.trim().toLowerCase()}`;
  const detailLines = [
    ['Full name', input.full_name || 'Not provided'],
    ['Email', input.email],
    ['Amazon marketplace', input.amazon_marketplace || input.brand_count || 'Not provided'],
    ['Monthly Amazon revenue', input.monthly_revenue || input.annual_revenue || 'Not provided'],
    ['Biggest recovery challenge', input.recovery_challenge || input.primary_goal || 'Not provided'],
    ['Seller Central email', input.seller_central_email || input.contact_handle || 'Not provided'],
    ['Priority onboarding', input.priority_onboarding || 'Not provided'],
    ['Anything we should know', input.notes || 'Not provided'],
    ['User type', input.user_type || 'Not provided'],
    ['Brand count', input.brand_count || 'Not provided'],
    ['Annual revenue', input.annual_revenue || 'Not provided'],
    ['Primary goal', input.primary_goal || 'Not provided'],
    ['Contact handle', input.contact_handle || 'Not provided'],
    ['Source page', input.source_page || 'Not provided'],
    ['Intent', input.intent || 'Not provided'],
    ['Reason', input.reason || 'Not provided'],
    ['IP', input.ip || 'Not provided'],
    ['User agent', input.user_agent || 'Not provided'],
  ];

  const text = [
    'New Margin waitlist lead',
    '========================',
    '',
    ...detailLines.map(([label, value]) => `${label}: ${value}`),
    '',
    `Captured at: ${new Date().toISOString()}`,
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
        <div style="max-width:640px; margin:0 auto; padding:32px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:18px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Margin waitlist
            </div>
            <h1 style="margin:22px 0 0 0; font-size:26px; line-height:1.2; font-weight:600; color:#111827;">
              New waitlist lead captured
            </h1>
          </div>
          <div style="padding-top:24px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%; border-collapse:collapse;">
              ${detailLines.map(([label, value]) => `
                <tr>
                  <td style="padding:10px 0; border-bottom:1px solid #f1f1f1; width:180px; vertical-align:top; color:#6b7280; font-size:13px; font-weight:600;">
                    ${escapeHtml(label)}
                  </td>
                  <td style="padding:10px 0; border-bottom:1px solid #f1f1f1; color:#111827; font-size:14px; line-height:1.6;">
                    ${escapeHtml(String(value))}
                  </td>
                </tr>
              `).join('')}
            </table>
            <p style="margin:18px 0 0 0; color:#6b7280; font-size:13px; line-height:1.6;">
              Captured at ${escapeHtml(new Date().toISOString())}
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

class WaitlistEmailService {
  private emailService = new EmailService();

  async sendWaitlistConfirmationEmail(email: string): Promise<EmailSendResult> {
    const recipient = email.trim().toLowerCase();
    const template = buildWaitlistConfirmationEmail();

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: 'support@margin-finance.com'
    });
  }

  async sendWaitlistLeadCaptureEmail(input: WaitlistLeadCaptureInput): Promise<EmailSendResult> {
    const recipient = config.WAITLIST_CAPTURE_EMAIL.trim().toLowerCase();
    const template = buildWaitlistLeadCaptureEmail(input);

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: input.email.trim().toLowerCase(),
    });
  }
}

export const waitlistEmailService = new WaitlistEmailService();
