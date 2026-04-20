import { EmailService, EmailSendResult } from '../notifications/services/delivery/email_service';

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
  const subject = 'Welcome to Margin';
  const preheader = "You're officially on the waitlist.";

  const text = [
    'Welcome to Margin',
    '=================',
    '',
    "You're officially on the waitlist.",
    '',
    'Margin helps Amazon FBA sellers identify missed reimbursement opportunities and uncover what Amazon may owe them.',
    '',
    'We will let you know as soon as access opens.',
    '',
    'If you would like to be considered for early access, reply to this email with a brief note about your store and marketplace.',
    '',
    'Margin'
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
              Welcome to Margin
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              You're officially on the waitlist.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#262626; font-size:15px; line-height:1.8;">
              Margin helps Amazon FBA sellers identify missed reimbursement opportunities and uncover what Amazon may owe them.
            </p>

            <p style="margin:20px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              We will let you know as soon as access opens.
            </p>

            <div style="margin-top:24px; padding-top:20px; border-top:1px solid #eeeeee;">
              <p style="margin:0; color:#111827; font-size:14px; line-height:1.7; font-weight:600;">
                Early access
              </p>
              <p style="margin:10px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
                If you would like to be considered for early access, reply to this email with a brief note about your store and marketplace.
              </p>
            </div>

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Margin
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
}

export const waitlistEmailService = new WaitlistEmailService();
