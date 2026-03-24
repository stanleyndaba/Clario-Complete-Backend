import { Request, Response } from 'express';
import { supportRequestService } from '../services/supportRequestService';
import logger from '../utils/logger';

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

        const record = await supportRequestService.create({
            tenantId,
            userId,
            category: String(category).trim(),
            subject: String(subject).trim(),
            message: String(message).trim(),
            severity: severity ? String(severity).trim() : null,
            additionalContext: additional_context ? String(additional_context).trim() : null,
            sourcePage: source_page ? String(source_page).trim() : null,
            metadata: typeof metadata === 'object' && metadata ? metadata : {},
        });

        return res.status(201).json({
            success: true,
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
