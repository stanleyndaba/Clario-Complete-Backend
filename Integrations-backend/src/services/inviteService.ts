import { supabaseAdmin } from '../database/supabaseClient';
import { getLogger } from '../utils/logger';
import { notificationService } from '../notifications';

const logger = getLogger('InviteService');

export interface InviteData {
    email: string;
    referrerId: string;
    referralLink: string;
    message?: string;
}

export interface InviteResult {
    success: boolean;
    inviteId?: string;
    emailSent?: boolean;
    error?: string;
}

/**
 * Generate the HTML email template for referral invites
 */
function generateInviteEmailHTML(referralLink: string, referrerName?: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to Margin</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="padding: 40px 30px; text-align: center; background: linear-gradient(135deg, #1e3a5f 0%, #0a1929 100%);">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">Margin</h1>
        <p style="color: #94a3b8; margin: 10px 0 0; font-size: 14px;">Amazon FBA Recovery Platform</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 40px 30px;">
        <h2 style="color: #1e293b; margin: 0 0 20px; font-size: 22px; font-weight: 600;">
          You've Been Invited! 🎉
        </h2>
        <p style="color: #475569; line-height: 1.6; margin: 0 0 20px; font-size: 16px;">
          ${referrerName ? `<strong>${referrerName}</strong> has invited you` : 'You have been invited'} to join Margin, 
          the world's first autonomous AI audit engine for Amazon FBA sellers.
        </p>
        <p style="color: #475569; line-height: 1.6; margin: 0 0 30px; font-size: 16px;">
          Margin automatically identifies money Amazon owes you and recovers it—lost inventory, 
          refunds without returns, fee overcharges, and more.
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${referralLink}" 
             style="display: inline-block; background-color: #10b981; color: #ffffff; 
                    padding: 14px 32px; text-decoration: none; border-radius: 8px; 
                    font-size: 16px; font-weight: 600; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.3);">
            Start Recovering Money
          </a>
        </div>
        
        <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-top: 30px;">
          <h3 style="color: #1e293b; margin: 0 0 15px; font-size: 16px; font-weight: 600;">
            Why Sellers Love Margin:
          </h3>
          <ul style="color: #475569; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li><strong>11 AI Agents</strong> working 24/7 to find money owed to you</li>
            <li><strong>No upfront cost</strong> — we only earn when you recover funds</li>
            <li><strong>Average recovery</strong> of $3,000+ per seller</li>
            <li><strong>Connect in 2 minutes</strong> — just link your Amazon account</li>
          </ul>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 30px; text-align: center; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
        <p style="color: #64748b; font-size: 12px; margin: 0 0 10px;">
          This invitation was sent by a Margin user. If you didn't expect this email, you can ignore it.
        </p>
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          © ${new Date().getFullYear()} Margin. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Generate plain text email for clients that don't support HTML
 */
function generateInviteEmailText(referralLink: string, referrerName?: string): string {
    return `
You've Been Invited to Margin! 🎉

${referrerName ? `${referrerName} has invited you` : 'You have been invited'} to join Margin, the world's first autonomous AI audit engine for Amazon FBA sellers.

Margin automatically identifies money Amazon owes you and recovers it—lost inventory, refunds without returns, fee overcharges, and more.

Start recovering money now: ${referralLink}

Why Sellers Love Margin:
• 11 AI Agents working 24/7 to find money owed to you
• No upfront cost — we only earn when you recover funds
• Average recovery of $3,000+ per seller
• Connect in 2 minutes — just link your Amazon account

---
© ${new Date().getFullYear()} Margin. All rights reserved.
`;
}


/**
 * Invite Service - Handles seller referral invitations
 */
export class InviteService {
    /**
     * Send an invitation email to a potential seller
     */
    async sendInvite(data: InviteData): Promise<InviteResult> {
        try {
            logger.info('Sending invite', { email: data.email, referrerId: data.referrerId });

            // Validate email
            if (!data.email || !this.isValidEmail(data.email)) {
                return { success: false, error: 'Invalid email address' };
            }

            // Check if invite already exists
            let existingInvite: any = null;
            try {
                const { data: found } = await supabaseAdmin
                    .from('referral_invites')
                    .select('id, status')
                    .eq('invitee_email', data.email)
                    .eq('referrer_id', data.referrerId)
                    .single();
                existingInvite = found;
            } catch {
                // Table might not exist yet - that's OK
            }

            // Send the actual email
            let emailSent = false;
            try {
                await notificationService.sendEmail({
                    to: data.email,
                    subject: "You're Invited to Join Margin - Recover Money Amazon Owes You",
                    html: generateInviteEmailHTML(data.referralLink),
                    text: generateInviteEmailText(data.referralLink)
                });
                emailSent = true;
            } catch (emailError: any) {
                logger.error('Failed to send invite email via notification service', { error: emailError.message });
            }

            if (existingInvite) {
                // Update existing invite
                try {
                    await supabaseAdmin
                        .from('referral_invites')
                        .update({
                            updated_at: new Date().toISOString(),
                            status: 'resent',
                            email_sent_at: emailSent ? new Date().toISOString() : null
                        })
                        .eq('id', existingInvite.id);
                } catch {
                    // Ignore DB errors for now
                }

                return {
                    success: true,
                    inviteId: existingInvite.id,
                    emailSent: emailSent
                };
            }

            // Create new invite record
            let newInviteId = `local-${Date.now()}`;
            try {
                const inviteRecord = {
                    referrer_id: data.referrerId,
                    invitee_email: data.email,
                    referral_link: data.referralLink,
                    message: data.message || 'You have been invited to join Margin!',
                    status: 'sent',
                    email_sent_at: emailSent ? new Date().toISOString() : null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                const { data: newInvite } = await supabaseAdmin
                    .from('referral_invites')
                    .insert(inviteRecord)
                    .select('id')
                    .single();

                if (newInvite?.id) {
                    newInviteId = newInvite.id;
                }
            } catch (dbError: any) {
                logger.warn('Could not save invite to database', { error: dbError.message });
                // Continue anyway - email might have been sent
            }

            logger.info('Invite processed', {
                inviteId: newInviteId,
                email: data.email,
                emailSent: emailSent
            });

            return {
                success: true,
                inviteId: newInviteId,
                emailSent: emailSent
            };
        } catch (error: any) {
            logger.error('Error sending invite', { error: error.message });
            return { success: false, error: error.message || 'Failed to send invite' };
        }
    }

    /**
     * Get all invites sent by a user
     */
    async getInvitesByReferrer(referrerId: string): Promise<any[]> {
        try {
            const { data, error } = await supabaseAdmin
                .from('referral_invites')
                .select('*')
                .eq('referrer_id', referrerId)
                .order('created_at', { ascending: false });

            if (error) {
                logger.warn('Failed to fetch invites', { error: error.message });
                return [];
            }

            return data || [];
        } catch (error: any) {
            logger.error('Error fetching invites', { error: error.message });
            return [];
        }
    }

    /**
     * Simple email validation
     */
    private isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}

// Export singleton instance
export const inviteService = new InviteService();
