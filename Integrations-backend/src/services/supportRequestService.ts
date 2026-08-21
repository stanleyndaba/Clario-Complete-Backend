import { supabaseAdmin } from '../database/supabaseClient';

export type SupportDeliveryKind = 'internal' | 'acknowledgement';
export type SupportDeliveryStatus = 'not_available' | 'pending' | 'accepted' | 'delivered' | 'failed' | 'bounced' | 'complained';

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
    idempotencyKey?: string | null;
    acknowledgementAvailable: boolean;
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
    idempotency_key?: string | null;
    internal_email_status?: SupportDeliveryStatus;
    internal_email_provider_message_id?: string | null;
    internal_email_attempt_count?: number;
    internal_email_last_error?: string | null;
    internal_email_last_attempt_at?: string | null;
    internal_email_last_event_at?: string | null;
    acknowledgement_email_status?: SupportDeliveryStatus;
    acknowledgement_email_provider_message_id?: string | null;
    acknowledgement_email_attempt_count?: number;
    acknowledgement_email_last_error?: string | null;
    acknowledgement_email_last_attempt_at?: string | null;
    acknowledgement_email_last_event_at?: string | null;
    created_at: string;
    updated_at: string;
}

export interface CreateOrGetSupportRequestResult {
    record: SupportRequestRecord;
    created: boolean;
}

function deliveryColumns(kind: SupportDeliveryKind) {
    return kind === 'internal'
        ? {
            status: 'internal_email_status',
            providerMessageId: 'internal_email_provider_message_id',
            attemptCount: 'internal_email_attempt_count',
            lastError: 'internal_email_last_error',
            lastAttemptAt: 'internal_email_last_attempt_at',
            lastEventAt: 'internal_email_last_event_at',
        }
        : {
            status: 'acknowledgement_email_status',
            providerMessageId: 'acknowledgement_email_provider_message_id',
            attemptCount: 'acknowledgement_email_attempt_count',
            lastError: 'acknowledgement_email_last_error',
            lastAttemptAt: 'acknowledgement_email_last_attempt_at',
            lastEventAt: 'acknowledgement_email_last_event_at',
        };
}

class SupportRequestService {
    async createOrGet(input: CreateSupportRequestInput): Promise<CreateOrGetSupportRequestResult> {
        const now = new Date().toISOString();
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
            idempotency_key: input.idempotencyKey || null,
            internal_email_status: 'pending' as SupportDeliveryStatus,
            internal_email_attempt_count: 0,
            acknowledgement_email_status: input.acknowledgementAvailable ? 'pending' as SupportDeliveryStatus : 'not_available' as SupportDeliveryStatus,
            acknowledgement_email_attempt_count: 0,
            created_at: now,
            updated_at: now,
        };

        const { data, error } = await supabaseAdmin
            .from('support_requests')
            .insert(payload)
            .select('*')
            .single();

        if (!error && data) {
            return { record: data as SupportRequestRecord, created: true };
        }

        if (error?.code === '23505' && input.idempotencyKey) {
            const { data: existing, error: existingError } = await supabaseAdmin
                .from('support_requests')
                .select('*')
                .eq('tenant_id', input.tenantId)
                .eq('user_id', input.userId)
                .eq('idempotency_key', input.idempotencyKey)
                .is('deleted_at', null)
                .maybeSingle();

            if (!existingError && existing) {
                return { record: existing as SupportRequestRecord, created: false };
            }

            throw new Error(existingError?.message || 'Failed to retrieve existing support request');
        }

        throw new Error(error?.message || 'Failed to persist support request');
    }

    async markDeliveryAttempt(record: SupportRequestRecord, kind: SupportDeliveryKind): Promise<SupportRequestRecord> {
        const columns = deliveryColumns(kind);
        const attemptCount = Number(record[columns.attemptCount as keyof SupportRequestRecord] || 0) + 1;
        const now = new Date().toISOString();
        const { data, error } = await supabaseAdmin
            .from('support_requests')
            .update({
                [columns.status]: 'pending',
                [columns.attemptCount]: attemptCount,
                [columns.lastAttemptAt]: now,
                [columns.lastError]: null,
                updated_at: now,
            })
            .eq('id', record.id)
            .select('*')
            .single();

        if (error || !data) {
            throw new Error(error?.message || 'Failed to record support email attempt');
        }

        return data as SupportRequestRecord;
    }

    async markDeliveryAccepted(record: SupportRequestRecord, kind: SupportDeliveryKind, providerMessageId: string | null): Promise<SupportRequestRecord> {
        const columns = deliveryColumns(kind);
        const now = new Date().toISOString();
        const { data, error } = await supabaseAdmin
            .from('support_requests')
            .update({
                [columns.status]: 'accepted',
                [columns.providerMessageId]: providerMessageId,
                [columns.lastError]: null,
                updated_at: now,
            })
            .eq('id', record.id)
            .select('*')
            .single();

        if (error || !data) {
            throw new Error(error?.message || 'Failed to record support email acceptance');
        }

        return data as SupportRequestRecord;
    }

    async markDeliveryFailure(record: SupportRequestRecord, kind: SupportDeliveryKind, errorMessage: string): Promise<SupportRequestRecord> {
        const columns = deliveryColumns(kind);
        const now = new Date().toISOString();
        const { data, error } = await supabaseAdmin
            .from('support_requests')
            .update({
                [columns.status]: 'failed',
                [columns.lastError]: errorMessage.slice(0, 1000),
                updated_at: now,
            })
            .eq('id', record.id)
            .select('*')
            .single();

        if (error || !data) {
            throw new Error(error?.message || 'Failed to record support email failure');
        }

        return data as SupportRequestRecord;
    }

    async recordProviderEvent(providerMessageId: string, status: SupportDeliveryStatus, occurredAt: string): Promise<void> {
        const updatesFor = (kind: SupportDeliveryKind) => {
            const columns = deliveryColumns(kind);
            const updates: Record<string, unknown> = {
                [columns.status]: status,
                [columns.lastEventAt]: occurredAt,
                updated_at: new Date().toISOString(),
            };

            if (status === 'bounced' || status === 'complained') {
                updates[columns.lastError] = `resend_${status}`;
            }

            return { columns, updates };
        };

        const internal = updatesFor('internal');
        const acknowledgement = updatesFor('acknowledgement');

        const [internalResult, acknowledgementResult] = await Promise.all([
            supabaseAdmin
                .from('support_requests')
                .update(internal.updates)
                .eq(internal.columns.providerMessageId, providerMessageId),
            supabaseAdmin
                .from('support_requests')
                .update(acknowledgement.updates)
                .eq(acknowledgement.columns.providerMessageId, providerMessageId),
        ]);

        if (internalResult.error) {
            throw new Error(internalResult.error.message || 'Failed to update internal support delivery state');
        }
        if (acknowledgementResult.error) {
            throw new Error(acknowledgementResult.error.message || 'Failed to update support acknowledgement delivery state');
        }
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
