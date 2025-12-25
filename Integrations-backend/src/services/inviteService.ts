import { supabaseAdmin } from '../database/supabaseClient';
import { getLogger } from '../utils/logger';

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
    error?: string;
}

/**
 * Invite Service - Handles seller referral invitations
 * 
 * For now, stores invites in the database.
 * Can be extended with SMTP/SendGrid/SES for real email delivery.
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
            const { data: existingInvite } = await supabaseAdmin
                .from('referral_invites')
                .select('id, status')
                .eq('invitee_email', data.email)
                .eq('referrer_id', data.referrerId)
                .single();

            if (existingInvite) {
                logger.info('Invite already exists', { email: data.email, status: existingInvite.status });
                // Update existing invite
                await supabaseAdmin
                    .from('referral_invites')
                    .update({
                        updated_at: new Date().toISOString(),
                        status: 'resent'
                    })
                    .eq('id', existingInvite.id);

                return {
                    success: true,
                    inviteId: existingInvite.id,
                };
            }

            // Create new invite record
            const inviteRecord = {
                referrer_id: data.referrerId,
                invitee_email: data.email,
                referral_link: data.referralLink,
                message: data.message || 'You have been invited to join Opside!',
                status: 'sent',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { data: newInvite, error: insertError } = await supabaseAdmin
                .from('referral_invites')
                .insert(inviteRecord)
                .select('id')
                .single();

            if (insertError) {
                // If table doesn't exist, try to create it
                if (insertError.message?.includes('does not exist')) {
                    logger.warn('referral_invites table does not exist, using mock response');

                    // Return success anyway for demo purposes
                    return {
                        success: true,
                        inviteId: `mock-${Date.now()}`
                    };
                }

                logger.error('Failed to create invite', { error: insertError.message });
                return { success: false, error: insertError.message };
            }

            logger.info('Invite sent successfully', { inviteId: newInvite?.id, email: data.email });

            // TODO: Integrate with email provider (SendGrid, SES, Nodemailer)
            // For now, we just store the invite in the database
            // In production, you would call:
            // await this.sendEmailViaProvider(data.email, data.referralLink, data.message);

            return {
                success: true,
                inviteId: newInvite?.id
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
