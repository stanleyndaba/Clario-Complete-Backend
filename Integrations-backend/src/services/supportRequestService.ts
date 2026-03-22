import { supabaseAdmin } from '../database/supabaseClient';

export interface CreateSupportRequestInput {
    tenantId: string;
    userId: string;
    category: string;
    subject: string;
    message: string;
    severity?: string | null;
    additionalContext?: string | null;
    sourcePage?: string | null;
    metadata?: Record<string, any>;
}

export interface SupportRequestRecord {
    id: string;
    tenant_id: string;
    user_id: string;
    category: string;
    subject: string;
    message: string;
    status: string;
    severity?: string | null;
    additional_context?: string | null;
    source_page?: string | null;
    metadata?: Record<string, any>;
    created_at: string;
    updated_at: string;
}

class SupportRequestService {
    async create(input: CreateSupportRequestInput): Promise<SupportRequestRecord> {
        const payload = {
            tenant_id: input.tenantId,
            user_id: input.userId,
            category: input.category,
            subject: input.subject,
            message: input.message,
            status: 'submitted',
            severity: input.severity || null,
            additional_context: input.additionalContext || null,
            source_page: input.sourcePage || null,
            metadata: input.metadata || {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabaseAdmin
            .from('support_requests')
            .insert(payload)
            .select('*')
            .single();

        if (error || !data) {
            throw new Error(error?.message || 'Failed to persist support request');
        }

        return data as SupportRequestRecord;
    }

    async listForTenantUser(tenantId: string, userId: string, limit = 10): Promise<SupportRequestRecord[]> {
        const { data, error } = await supabaseAdmin
            .from('support_requests')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw new Error(error.message || 'Failed to fetch support requests');
        }

        return (data || []) as SupportRequestRecord[];
    }
}

export const supportRequestService = new SupportRequestService();
