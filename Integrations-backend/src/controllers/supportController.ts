import { Request, Response } from 'express';
import { supportRequestService } from '../services/supportRequestService';
import notificationService from '../notifications/services/notification_service';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const SUPPORT_INBOX_EMAIL = process.env.SUPPORT_INBOX_EMAIL || 'support@margin-finance.com';

function getRequestScope(req: Request): { tenantId: string; userId: string } {
    const tenantId = String((req as any).tenant?.tenantId || '').trim();
    const userId = String((req as any).userId || (req as any).user?.id || '').trim();

    if (!tenantId) {
        throw new Error('Tenant context required');
    }

    if (!userId) {
        throw new Error('User authentication required');
    }

    return { tenantId, userId };
}

function escapeHtml(value: string): string {
    const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return String(value || '').replace(/[&<>"']/g, (char) => entities[char] || char);
}

function normalizeContactEmail(raw: unknown): string | null {
    const email = typeof raw === 'string' ? raw.trim() : '';
    if (!email) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function resolveUserReplyEmail(userId: string): Promise<string | null> {
    if (!userId) return null;

    const { data, error } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        logger.warn('Failed to resolve support request user email', {
            userId,
            error: error.message,
        });
        return null;
    }

    return normalizeContactEmail(data?.email);
}

async function sendSupportInboxEmail(args: {
    requestId: string;
    tenantId: string;
    userId: string;
    category: string;
    subject: string;
    message: string;
    contactEmail: string | null;
    sourcePage: string | null;
}): Promise<void> {
    const safeSubject = args.subject.trim();
    const rows = [
        ['Request ID', args.requestId],
        ['Tenant ID', args.tenantId],
        ['User ID', args.userId],
        ['Reply email', args.contactEmail || 'Not provided'],
        ['Category', args.category],
        ['Source page', args.sourcePage || 'Not provided'],
    ];
    const htmlRows = rows.map(([label, value]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#666;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#111;">${escapeHtml(value)}</td>
        </tr>
      `).join('');

    const text = [
        `New Margin support query`,
        ``,
        ...rows.map(([label, value]) => `${label}: ${value}`),
        ``,
        `Subject: ${safeSubject}`,
        ``,
        args.message,
    ].join('\n');

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#111;line-height:1.5;">
        <h2 style="margin:0 0 12px;font-size:18px;">New Margin support query</h2>
        <table style="border-collapse:collapse;margin-bottom:16px;">${htmlRows}</table>
        <h3 style="margin:16px 0 8px;font-size:14px;">Subject</h3>
        <p style="margin:0 0 16px;">${escapeHtml(safeSubject)}</p>
        <h3 style="margin:16px 0 8px;font-size:14px;">Query</h3>
        <div style="white-space:pre-wrap;border-top:1px solid #ddd;padding-top:12px;">${escapeHtml(args.message)}</div>
      </div>
    `;

    await notificationService.sendEmail({
        to: SUPPORT_INBOX_EMAIL,
        subject: `[Margin Support] ${safeSubject}`,
        html,
        text,
        replyTo: args.contactEmail || undefined,
    });
}

export async function createSupportRequest(req: Request, res: Response) {
    try {
        const { tenantId, userId } = getRequestScope(req);
        const {
            category,
            subject,
            message,
            severity,
            additional_context,
            source_page,
            metadata,
        } = req.body || {};

        if (!category || !subject || !message) {
            return res.status(400).json({
                success: false,
                error: 'Category, subject, and message are required'
            });
        }

        const metadataInput = typeof metadata === 'object' && metadata ? metadata : {};
        const submittedContactEmail = normalizeContactEmail((metadataInput as any).contact_email);
        const contactEmail = submittedContactEmail || await resolveUserReplyEmail(userId);

        const record = await supportRequestService.create({
            tenantId,
            userId,
            category: String(category).trim(),
            subject: String(subject).trim(),
            message: String(message).trim(),
            severity: severity ? String(severity).trim() : null,
            additionalContext: additional_context ? String(additional_context).trim() : null,
            sourcePage: source_page ? String(source_page).trim() : null,
            metadata: {
                ...metadataInput,
                contact_email: contactEmail,
                submitted_contact_email: submittedContactEmail,
                support_recipient: SUPPORT_INBOX_EMAIL,
            },
        });

        try {
            await sendSupportInboxEmail({
                requestId: record.id,
                tenantId,
                userId,
                category: record.category,
                subject: record.subject,
                message: record.message,
                contactEmail,
                sourcePage: record.source_page || null,
            });
        } catch (emailError: any) {
            logger.error('Support request persisted but email delivery failed', {
                requestId: record.id,
                recipient: SUPPORT_INBOX_EMAIL,
                error: emailError?.message,
                stack: emailError?.stack,
            });
            return res.status(502).json({
                success: false,
                request_id: record.id,
                error: `Support request was saved, but email delivery to ${SUPPORT_INBOX_EMAIL} failed. Please email ${SUPPORT_INBOX_EMAIL} directly.`
            });
        }

        return res.status(201).json({
            success: true,
            email_sent_to: SUPPORT_INBOX_EMAIL,
            request: {
                request_id: record.id,
                status: record.status,
                created_at: record.created_at,
                category: record.category,
                subject: record.subject,
                message: record.message,
            }
        });
    } catch (error: any) {
        logger.error('Failed to create support request', { error: error.message, stack: error.stack });
        const status = error.message === 'Tenant context required' || error.message === 'User authentication required' ? 400 : 500;
        return res.status(status).json({
            success: false,
            error: error.message || 'Failed to submit support request'
        });
    }
}

export async function listSupportRequests(req: Request, res: Response) {
    try {
        const { tenantId, userId } = getRequestScope(req);
        const limit = Math.min(20, Math.max(1, Number(req.query.limit || 10)));
        const requests = await supportRequestService.listForTenantUser(tenantId, userId, limit);

        return res.json({
            success: true,
            requests: requests.map((request) => ({
                request_id: request.id,
                status: request.status,
                category: request.category,
                subject: request.subject,
                message: request.message,
                severity: request.severity || null,
                created_at: request.created_at,
            }))
        });
    } catch (error: any) {
        logger.error('Failed to fetch support requests', { error: error.message, stack: error.stack });
        const status = error.message === 'Tenant context required' || error.message === 'User authentication required' ? 400 : 500;
        return res.status(status).json({
            success: false,
            error: error.message || 'Failed to fetch support requests'
        });
    }
}
