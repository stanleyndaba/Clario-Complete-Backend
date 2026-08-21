import crypto from 'crypto';
import { Request, Response } from 'express';
import { supportRequestService, SupportDeliveryKind, SupportDeliveryStatus, SupportRequestRecord } from '../services/supportRequestService';
import notificationService from '../notifications/services/notification_service';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const SUPPORT_INBOX_EMAIL = process.env.SUPPORT_INBOX_EMAIL || 'support@margin-finance.com';
const ALLOWED_CATEGORIES = new Set(['billing', 'technical', 'account', 'recovery', 'general']);
const ALLOWED_SEVERITIES = new Set(['low', 'normal', 'high']);
const ALLOWED_SOURCE_PAGES = new Set(['help', 'dashboard_contact_us_modal']);
const MAX_SUBJECT_LENGTH = 180;
const MAX_MESSAGE_LENGTH = 10_000;
const MAX_CONTEXT_LENGTH = 500;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_EMAIL_ATTEMPTS = 2;

type SupportDeliveryView = {
    status: SupportDeliveryStatus;
    provider_message_id: string | null;
    attempt_count: number;
};

function getRequestScope(req: Request): { tenantId: string; userId: string } {
    const tenantId = String((req as any).tenant?.tenantId || '').trim();
    const userId = String((req as any).userId || (req as any).user?.id || '').trim();

    if (!tenantId) throw new Error('Tenant context required');
    if (!userId) throw new Error('User authentication required');

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
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!email) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizedText(raw: unknown, label: string, maxLength: number, options?: { required?: boolean; singleLine?: boolean }): string | null {
    if (typeof raw !== 'string') {
        if (options?.required) throw new Error(`${label} is required`);
        return null;
    }

    const value = (options?.singleLine ? raw.replace(/[\r\n]+/g, ' ') : raw).trim();
    if (!value) {
        if (options?.required) throw new Error(`${label} is required`);
        return null;
    }
    if (value.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
    return value;
}

function normalizeCategory(raw: unknown): string {
    const category = normalizedText(raw, 'Category', 40, { required: true, singleLine: true })!;
    if (!ALLOWED_CATEGORIES.has(category)) throw new Error('Category is not supported');
    return category;
}

function normalizeSeverity(raw: unknown): string | null {
    const severity = normalizedText(raw, 'Severity', 20, { singleLine: true });
    if (!severity) return null;
    if (!ALLOWED_SEVERITIES.has(severity)) throw new Error('Severity is not supported');
    return severity;
}

function normalizeSourcePage(raw: unknown): string | null {
    const sourcePage = normalizedText(raw, 'Source page', 80, { singleLine: true });
    if (!sourcePage) return null;
    if (!ALLOWED_SOURCE_PAGES.has(sourcePage)) throw new Error('Source page is not supported');
    return sourcePage;
}

function normalizeIdempotencyKey(raw: unknown): string {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) return crypto.randomUUID();
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[A-Za-z0-9:_-]+$/.test(key)) {
        throw new Error('Invalid idempotency key');
    }
    return key;
}

function deliveryView(record: SupportRequestRecord, kind: SupportDeliveryKind): SupportDeliveryView {
    return kind === 'internal'
        ? {
            status: record.internal_email_status || 'pending',
            provider_message_id: record.internal_email_provider_message_id || null,
            attempt_count: Number(record.internal_email_attempt_count || 0),
        }
        : {
            status: record.acknowledgement_email_status || 'not_available',
            provider_message_id: record.acknowledgement_email_provider_message_id || null,
            attempt_count: Number(record.acknowledgement_email_attempt_count || 0),
        };
}

function shouldAttemptDelivery(status: SupportDeliveryStatus): boolean {
    return status === 'pending' || status === 'failed';
}

function toSupportResponse(record: SupportRequestRecord, created: boolean) {
    return {
        request_id: record.id,
        status: record.status,
        created_at: record.created_at,
        category: record.category,
        subject: record.subject,
        message: record.message,
        severity: record.severity || null,
        created,
        delivery: {
            internal_notification: deliveryView(record, 'internal'),
            seller_acknowledgement: deliveryView(record, 'acknowledgement'),
        }
    };
}

async function resolveCanonicalUserEmail(userId: string): Promise<string | null> {
    const { data, error } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        logger.warn('Failed to resolve canonical support reply email', { userId, error: error.message });
        return null;
    }

    return normalizeContactEmail(data?.email);
}

function supportEmailPayload(args: {
    requestId: string;
    tenantId: string;
    userId: string;
    category: string;
    subject: string;
    message: string;
    additionalContext: string | null;
    contactEmail: string | null;
    sourcePage: string | null;
}) {
    const rows = [
        ['Request ID', args.requestId],
        ['Tenant ID', args.tenantId],
        ['User ID', args.userId],
        ['Reply email', args.contactEmail || 'No verified email available'],
        ['Category', args.category],
        ['Source page', args.sourcePage || 'Not provided'],
        ['Additional context', args.additionalContext || 'Not provided'],
    ];
    const htmlRows = rows.map(([label, value]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#66737F;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#182026;">${escapeHtml(value)}</td>
        </tr>
      `).join('');
    const text = [
        'New Margin support request',
        '',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        '',
        `Subject: ${args.subject}`,
        '',
        args.message,
    ].join('\n');
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#182026;line-height:1.5;">
        <h2 style="margin:0 0 12px;font-size:18px;">New Margin support request</h2>
        <table style="border-collapse:collapse;margin-bottom:16px;">${htmlRows}</table>
        <h3 style="margin:16px 0 8px;font-size:14px;">Subject</h3>
        <p style="margin:0 0 16px;">${escapeHtml(args.subject)}</p>
        <h3 style="margin:16px 0 8px;font-size:14px;">Message</h3>
        <div style="white-space:pre-wrap;border-top:1px solid #DCE8EE;padding-top:12px;">${escapeHtml(args.message)}</div>
      </div>
    `;

    return { text, html };
}

function acknowledgementEmailPayload(args: {
    requestId: string;
    category: string;
    subject: string;
}) {
    const text = [
        'Margin recorded your support request.',
        '',
        `Request ID: ${args.requestId}`,
        `Topic: ${args.category}`,
        `Subject: ${args.subject}`,
        '',
        'This confirms that your request record was saved. Margin tracks support-notification delivery separately; this is not a guarantee of a response time or a live-chat status.',
        '',
        `Reply to this email or contact ${SUPPORT_INBOX_EMAIL} if you need to add material context.`,
    ].join('\n');
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#182026;line-height:1.5;">
        <h2 style="margin:0 0 12px;font-size:18px;">Your Margin support request was recorded</h2>
        <p style="margin:0 0 12px;">Request ID: <strong>${escapeHtml(args.requestId)}</strong></p>
        <p style="margin:0 0 12px;">Topic: ${escapeHtml(args.category)}<br/>Subject: ${escapeHtml(args.subject)}</p>
        <p style="margin:0;">This confirms that your request record was saved. Margin tracks support-notification delivery separately; this is not a guarantee of a response time or a live-chat status.</p>
      </div>
    `;
    return { text, html };
}

async function sendInternalSupportNotification(record: SupportRequestRecord, args: {
    tenantId: string;
    userId: string;
    contactEmail: string | null;
}) {
    const payload = supportEmailPayload({
        requestId: record.id,
        tenantId: args.tenantId,
        userId: args.userId,
        category: record.category,
        subject: record.subject,
        message: record.message,
        additionalContext: record.additional_context || null,
        contactEmail: args.contactEmail,
        sourcePage: record.source_page || null,
    });
    return notificationService.sendEmail({
        to: SUPPORT_INBOX_EMAIL,
        subject: `[Margin Support ${record.id.slice(0, 8)}] ${record.subject}`,
        html: payload.html,
        text: payload.text,
        replyTo: args.contactEmail || undefined,
        idempotencyKey: `support-internal-${record.id}`,
    });
}

async function sendSellerAcknowledgement(record: SupportRequestRecord, contactEmail: string) {
    const payload = acknowledgementEmailPayload({
        requestId: record.id,
        category: record.category,
        subject: record.subject,
    });
    return notificationService.sendEmail({
        to: contactEmail,
        subject: `Margin recorded support request ${record.id.slice(0, 8)}`,
        html: payload.html,
        text: payload.text,
        replyTo: SUPPORT_INBOX_EMAIL,
        idempotencyKey: `support-ack-${record.id}`,
    });
}

async function attemptDelivery(
    record: SupportRequestRecord,
    kind: SupportDeliveryKind,
    sender: () => ReturnType<typeof notificationService.sendEmail>,
): Promise<SupportRequestRecord> {
    let current = record;
    const existingStatus = deliveryView(current, kind).status;
    if (!shouldAttemptDelivery(existingStatus)) return current;

    for (let attempt = 0; attempt < MAX_EMAIL_ATTEMPTS; attempt += 1) {
        current = await supportRequestService.markDeliveryAttempt(current, kind);
        try {
            const result = await sender();
            return await supportRequestService.markDeliveryAccepted(current, kind, result.providerMessageId);
        } catch (error: any) {
            current = await supportRequestService.markDeliveryFailure(current, kind, error?.message || 'Support email delivery failed');
            logger.error('Support email delivery attempt failed', {
                requestId: current.id,
                kind,
                attempt: attempt + 1,
                error: error?.message,
            });
        }
    }

    return current;
}

async function deliverPendingSupportEmails(record: SupportRequestRecord, args: {
    tenantId: string;
    userId: string;
    contactEmail: string | null;
}): Promise<SupportRequestRecord> {
    let current = record;
    current = await attemptDelivery(current, 'internal', () => sendInternalSupportNotification(current, args));
    if (args.contactEmail) {
        current = await attemptDelivery(current, 'acknowledgement', () => sendSellerAcknowledgement(current, args.contactEmail!));
    }
    return current;
}

async function sendPublicSupportInboxEmail(args: {
    name: string;
    email: string;
    company: string | null;
    subject: string;
    message: string;
    sourcePage: string | null;
}): Promise<void> {
    const safeSubject = args.subject.trim();
    const rows = [
        ['Name', args.name],
        ['Reply email', args.email],
        ['Company', args.company || 'Not provided'],
        ['Source page', args.sourcePage || 'Public contact page'],
    ];
    const htmlRows = rows.map(([label, value]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#666;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#111;">${escapeHtml(value)}</td>
        </tr>
      `).join('');
    const text = [
        'New Margin public support request',
        '',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        '',
        `Subject: ${safeSubject}`,
        '',
        args.message,
    ].join('\n');
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;color:#111;line-height:1.5;">
        <h2 style="margin:0 0 12px;font-size:18px;">New Margin public support request</h2>
        <table style="border-collapse:collapse;margin-bottom:16px;">${htmlRows}</table>
        <h3 style="margin:16px 0 8px;font-size:14px;">Subject</h3>
        <p style="margin:0 0 16px;">${escapeHtml(safeSubject)}</p>
        <h3 style="margin:16px 0 8px;font-size:14px;">Message</h3>
        <div style="white-space:pre-wrap;border-top:1px solid #ddd;padding-top:12px;">${escapeHtml(args.message)}</div>
      </div>
    `;

    await notificationService.sendEmail({
        to: SUPPORT_INBOX_EMAIL,
        subject: `[Margin Contact] ${safeSubject}`,
        html,
        text,
        replyTo: args.email,
    });
}

export async function createPublicSupportContact(req: Request, res: Response) {
    try {
        const { name, email, company, subject, message, source_page } = req.body || {};
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        const normalizedEmail = normalizeContactEmail(email);
        const normalizedSubject = typeof subject === 'string' ? subject.trim() : '';
        const normalizedMessage = typeof message === 'string' ? message.trim() : '';
        const normalizedCompany = typeof company === 'string' && company.trim() ? company.trim() : null;
        const normalizedSourcePage = typeof source_page === 'string' && source_page.trim() ? source_page.trim() : null;

        if (!normalizedName || !normalizedEmail || !normalizedSubject || !normalizedMessage) {
            return res.status(400).json({ success: false, error: 'Name, valid email, subject, and message are required' });
        }

        await sendPublicSupportInboxEmail({
            name: normalizedName,
            email: normalizedEmail,
            company: normalizedCompany,
            subject: normalizedSubject,
            message: normalizedMessage,
            sourcePage: normalizedSourcePage,
        });

        return res.status(202).json({ success: true, email_sent_to: SUPPORT_INBOX_EMAIL });
    } catch (error: any) {
        logger.error('Failed to send public support contact email', { error: error?.message, stack: error?.stack });
        return res.status(502).json({
            success: false,
            error: `Email delivery to ${SUPPORT_INBOX_EMAIL} failed. Please email ${SUPPORT_INBOX_EMAIL} directly.`
        });
    }
}

export async function createSupportRequest(req: Request, res: Response) {
    try {
        const { tenantId, userId } = getRequestScope(req);
        const body = req.body || {};
        const category = normalizeCategory(body.category);
        const subject = normalizedText(body.subject, 'Subject', MAX_SUBJECT_LENGTH, { required: true, singleLine: true })!;
        const message = normalizedText(body.message, 'Message', MAX_MESSAGE_LENGTH, { required: true })!;
        const severity = normalizeSeverity(body.severity);
        const additionalContext = normalizedText(body.additional_context, 'Additional context', MAX_CONTEXT_LENGTH);
        const sourcePage = normalizeSourcePage(body.source_page);
        const idempotencyKey = normalizeIdempotencyKey(body.idempotency_key);

        // The authenticated account record is authoritative. Browser-provided contact addresses are never used when a verified account email exists.
        const canonicalContactEmail = await resolveCanonicalUserEmail(userId);
        const createdResult = await supportRequestService.createOrGet({
            tenantId,
            userId,
            category,
            subject,
            message,
            severity,
            additionalContext,
            sourcePage,
            idempotencyKey,
            acknowledgementAvailable: !!canonicalContactEmail,
            metadata: {
                contact_email: canonicalContactEmail,
                support_recipient: SUPPORT_INBOX_EMAIL,
                source_page: sourcePage,
            },
        });

        const record = await deliverPendingSupportEmails(createdResult.record, {
            tenantId,
            userId,
            contactEmail: canonicalContactEmail,
        });

        return res.status(createdResult.created ? 201 : 200).json({
            success: true,
            request: toSupportResponse(record, createdResult.created),
        });
    } catch (error: any) {
        logger.error('Failed to create support request', { error: error?.message, stack: error?.stack });
        const message = error?.message || 'Failed to submit support request';
        const isValidation = /required|characters or fewer|not supported|Invalid idempotency key/i.test(message);
        const isContext = message === 'Tenant context required' || message === 'User authentication required';
        return res.status(isValidation ? 400 : isContext ? 401 : 500).json({ success: false, error: message });
    }
}

export async function listSupportRequests(req: Request, res: Response) {
    try {
        const { tenantId, userId } = getRequestScope(req);
        const requestedLimit = Number(req.query.limit || 10);
        const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.floor(requestedLimit))) : 10;
        const requests = await supportRequestService.listForTenantUser(tenantId, userId, limit);

        return res.json({
            success: true,
            requests: requests.map((request) => toSupportResponse(request, false)),
        });
    } catch (error: any) {
        logger.error('Failed to fetch support requests', { error: error?.message, stack: error?.stack });
        const message = error?.message || 'Failed to fetch support requests';
        const status = message === 'Tenant context required' || message === 'User authentication required' ? 401 : 500;
        return res.status(status).json({ success: false, error: message });
    }
}
