/**
 * Evidence Audit Service
 * Tracks and retrieves legal-grade audit trail for evidence documents
 * 
 * Events tracked:
 * - Document ingestion (source, timestamp)
 * - Document parsing (parser version, extracted fields)
 * - Claim linking (which claims, when)
 * - Manual edits (who, what field, old/new values)
 * - Usage in filings (attached to cases)
 */

import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';

// Current parser version - update when parser logic changes
export const PARSER_VERSION = '2.1.0';

export interface AuditEvent {
    id: string;
    documentId: string;
    eventType: 'ingested' | 'parsed' | 'linked' | 'unlinked' | 'edited' | 'filed' | 'verified' | 'error';
    timestamp: string;
    actor?: string; // User or system that performed action
    details: {
        source?: string; // gmail, gdrive, dropbox, manual
        parserVersion?: string;
        claimId?: string;
        claimNumber?: string;
        fieldName?: string;
        oldValue?: string;
        newValue?: string;
        reason?: string;
        extractedFields?: string[];
        confidence?: number;
    };
    narrative: string; // Human-readable description
}

export interface DocumentAuditTrail {
    documentId: string;
    filename: string;
    events: AuditEvent[];
    summary: {
        ingestedAt?: string;
        ingestedFrom?: string;
        parsedAt?: string;
        parserVersion?: string;
        linkedClaims: number;
        lastActivity: string;
    };
}

class EvidenceAuditService {

    /**
     * Get complete audit trail for a document
     */
    async getDocumentAuditTrail(documentId: string, tenantId?: string): Promise<DocumentAuditTrail | null> {
        try {
            logger.info('📋 [AUDIT] Getting audit trail for document', { documentId });

            // Get document details
            let docQuery = supabaseAdmin
                .from('evidence_documents')
                .select('*')
                .eq('id', documentId);

            if (tenantId) {
                docQuery = docQuery.eq('tenant_id', tenantId);
            }

            const { data: doc, error: docError } = await docQuery.single();

            if (docError || !doc) {
                logger.warn('⚠️ [AUDIT] Document not found', { documentId });
                return null;
            }

            const events: AuditEvent[] = [];
            const meta = typeof doc.parsed_metadata === 'string'
                ? JSON.parse(doc.parsed_metadata)
                : doc.parsed_metadata || {};

            // 1. Ingestion event
            events.push({
                id: `ingested-${doc.id}`,
                documentId: doc.id,
                eventType: 'ingested',
                timestamp: doc.ingested_at || doc.created_at,
                actor: 'system',
                details: {
                    source: doc.source_provider || doc.source || 'manual_upload'
                },
                narrative: this.generateNarrative('ingested', {
                    filename: doc.filename,
                    source: doc.source_provider || doc.source || 'manual upload'
                })
            });

            // 2. Parsing event (if parsed)
            if (doc.parser_status === 'completed' && doc.parsed_at) {
                const extractedFields = [];
                if (meta.invoice_number) extractedFields.push('invoice_number');
                if (meta.supplier_name) extractedFields.push('supplier');
                if (meta.total_amount) extractedFields.push('amount');
                if (meta.asins?.length) extractedFields.push(`${meta.asins.length} ASINs`);
                if (meta.skus?.length) extractedFields.push(`${meta.skus.length} SKUs`);
                if (meta.line_items?.length) extractedFields.push(`${meta.line_items.length} line items`);

                events.push({
                    id: `parsed-${doc.id}`,
                    documentId: doc.id,
                    eventType: 'parsed',
                    timestamp: doc.parsed_at,
                    actor: 'system',
                    details: {
                        parserVersion: doc.parser_version || undefined,
                        extractedFields,
                        confidence: meta.confidence || doc.match_confidence
                    },
                    narrative: this.generateNarrative('parsed', {
                        filename: doc.filename,
                        parserVersion: doc.parser_version || 'unknown',
                        fieldCount: extractedFields.length
                    })
                });
            } else if (doc.parser_status === 'failed') {
                events.push({
                    id: `parse-error-${doc.id}`,
                    documentId: doc.id,
                    eventType: 'error',
                    timestamp: doc.parsed_at || doc.updated_at,
                    actor: 'system',
                    details: {
                        reason: doc.parse_error || 'Parsing failed'
                    },
                    narrative: `Parsing failed: ${doc.parse_error || 'Unknown error'}`
                });
            }

            // 3. Get claim linking events from dispute_evidence_links
            let linksQuery = supabaseAdmin
                .from('dispute_evidence_links')
                .select(`
          id,
          dispute_case_id,
          created_at,
          matched_context,
          dispute_cases!inner(case_number, claim_number, dispute_type)
        `)
                .eq('evidence_document_id', documentId)
                .order('created_at', { ascending: true });

            if (tenantId) {
                linksQuery = linksQuery.eq('tenant_id', tenantId);
            }

            const { data: links } = await linksQuery;

            if (links && links.length > 0) {
                for (const link of links) {
                    const disputeCase = (link as any).dispute_cases;
                    const context = typeof link.matched_context === 'string'
                        ? JSON.parse(link.matched_context)
                        : link.matched_context || {};

                    events.push({
                        id: `linked-${link.id}`,
                        documentId: doc.id,
                        eventType: 'linked',
                        timestamp: link.created_at,
                        actor: context.linked_by || 'system',
                        details: {
                            claimId: link.dispute_case_id,
                            claimNumber: disputeCase?.case_number || disputeCase?.claim_number,
                            reason: context.match_type || 'auto-matched'
                        },
                        narrative: this.generateNarrative('linked', {
                            filename: doc.filename,
                            claimNumber: disputeCase?.case_number || disputeCase?.claim_number || link.dispute_case_id.slice(0, 8),
                            matchType: context.match_type || 'auto-matched'
                        })
                    });
                }
            }

            // 4. Check for audit_logs table entries
            try {
                let auditLogsQuery = supabaseAdmin
                    .from('audit_logs')
                    .select('*')
                    .eq('resource_id', documentId)
                    .eq('resource_type', 'evidence_document')
                    .order('created_at', { ascending: true });

                if (tenantId) {
                    auditLogsQuery = auditLogsQuery.eq('tenant_id', tenantId);
                }

                const { data: auditLogs } = await auditLogsQuery;

                if (auditLogs && auditLogs.length > 0) {
                    for (const log of auditLogs) {
                        const logMetadata = typeof log.metadata === 'string'
                            ? JSON.parse(log.metadata)
                            : log.metadata || {};
                        const legacyDetails = typeof log.details === 'string'
                            ? JSON.parse(log.details)
                            : log.details || {};
                        const payloadBefore = typeof log.payload_before === 'string'
                            ? JSON.parse(log.payload_before)
                            : log.payload_before || {};
                        const payloadAfter = typeof log.payload_after === 'string'
                            ? JSON.parse(log.payload_after)
                            : log.payload_after || {};
                        const fieldName = logMetadata.field || legacyDetails.field || Object.keys(payloadAfter)[0] || Object.keys(payloadBefore)[0];
                        const oldValue = payloadBefore[fieldName] ?? legacyDetails.old_value;
                        const newValue = payloadAfter[fieldName] ?? legacyDetails.new_value;

                        events.push({
                            id: `audit-${log.id}`,
                            documentId: doc.id,
                            eventType: this.mapAuditLogAction(log.action),
                            timestamp: log.created_at,
                            actor: log.actor_user_id || log.user_id || 'system',
                            details: {
                                fieldName,
                                oldValue: oldValue == null ? undefined : String(oldValue),
                                newValue: newValue == null ? undefined : String(newValue),
                                reason: logMetadata.reason || legacyDetails.reason
                            },
                            narrative: this.generateNarrative(log.action, {
                                filename: doc.filename,
                                field: fieldName,
                                old_value: oldValue,
                                new_value: newValue,
                                ...legacyDetails,
                                ...logMetadata
                            })
                        });
                    }
                }
            } catch (auditError) {
                // Audit logs table may not exist - that's OK
                logger.debug('[AUDIT] audit_logs table not available', { error: auditError });
            }

            // 5. Check for filing events
            let filingQuery = supabaseAdmin
                .from('dispute_cases')
                .select('id, case_number, status, filing_status, created_at, updated_at')
                .in('id', links?.map(l => l.dispute_case_id) || [])
                .eq('filing_status', 'filed');

            if (tenantId) {
                filingQuery = filingQuery.eq('tenant_id', tenantId);
            }

            const { data: filingEvents } = await filingQuery;

            if (filingEvents && filingEvents.length > 0) {
                for (const filing of filingEvents) {
                    events.push({
                        id: `filed-${filing.id}`,
                        documentId: doc.id,
                        eventType: 'filed',
                        timestamp: filing.updated_at || filing.created_at,
                        actor: 'system',
                        details: {
                            claimId: filing.id,
                            claimNumber: filing.case_number
                        },
                        narrative: this.generateNarrative('filed', {
                            filename: doc.filename,
                            claimNumber: filing.case_number
                        })
                    });
                }
            }

            // Sort events by timestamp
            events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            // Build summary
            const linkedClaims = links?.length || 0;
            const lastEvent = events[events.length - 1];

            return {
                documentId: doc.id,
                filename: doc.filename,
                events,
                summary: {
                    ingestedAt: doc.ingested_at || doc.created_at,
                    ingestedFrom: doc.source_provider || doc.source || 'manual_upload',
                    parsedAt: doc.parsed_at,
                    parserVersion: doc.parser_version || undefined,
                    linkedClaims,
                    lastActivity: lastEvent?.timestamp || doc.updated_at
                }
            };

        } catch (error: any) {
            logger.error('❌ [AUDIT] Failed to get audit trail', { documentId, error: error.message });
            return null;
        }
    }

    /**
     * Get audit trail for all documents linked to a claim
     */
    async getClaimEvidenceAuditTrail(claimId: string, tenantId: string): Promise<DocumentAuditTrail[]> {
        try {
            logger.info('📋 [AUDIT] Getting evidence audit trail for claim', { claimId, tenantId });

            // Get all linked documents
            const { data: links } = await supabaseAdmin
                .from('dispute_evidence_links')
                .select('evidence_document_id')
                .eq('dispute_case_id', claimId)
                .eq('tenant_id', tenantId);

            if (!links || links.length === 0) {
                // Try detection_results
                const { data: detection } = await supabaseAdmin
                    .from('detection_results')
                    .select('matched_document_ids')
                    .eq('id', claimId)
                    .eq('tenant_id', tenantId)
                    .maybeSingle();

                if (detection?.matched_document_ids) {
                    const docIds = Array.isArray(detection.matched_document_ids)
                        ? detection.matched_document_ids
                        : [];

                    const trails: DocumentAuditTrail[] = [];
                    for (const docId of docIds) {
                        const trail = await this.getDocumentAuditTrail(docId, tenantId);
                        if (trail) trails.push(trail);
                    }
                    return trails;
                }

                return [];
            }

            const trails: DocumentAuditTrail[] = [];
            for (const link of links) {
                const trail = await this.getDocumentAuditTrail(link.evidence_document_id, tenantId);
                if (trail) trails.push(trail);
            }

            return trails;

        } catch (error: any) {
            logger.error('❌ [AUDIT] Failed to get claim evidence audit trail', { claimId, error: error.message });
            return [];
        }
    }

    /**
     * Generate synthetic audit trail from claim timeline when no evidence documents exist
     */
    private generateSyntheticAuditTrail(claimId: string, claim: any): DocumentAuditTrail[] {
        const events: AuditEvent[] = [];
        const timeline = claim.timeline || [];

        // Add claim creation event
        events.push({
            id: `claim-created-${claimId}`,
            documentId: claimId,
            eventType: 'ingested',
            timestamp: claim.created_at || new Date().toISOString(),
            actor: 'system',
            details: {
                source: 'detection_agent'
            },
            narrative: `Claim ${claimId.slice(0, 8)} was detected by AI agent`
        });

        // Add timeline events
        for (const event of timeline) {
            events.push({
                id: event.id || `timeline-${Math.random().toString(36).slice(2)}`,
                documentId: claimId,
                eventType: this.mapTimelineAction(event.action),
                timestamp: event.date || new Date().toISOString(),
                actor: 'system',
                details: {
                    reason: event.description
                },
                narrative: event.description || `Claim ${event.action}`
            });
        }

        // If claim has a status, add a status event
        if (claim.status && events.length === 1) {
            events.push({
                id: `status-${claimId}`,
                documentId: claimId,
                eventType: 'verified',
                timestamp: claim.updated_at || claim.created_at || new Date().toISOString(),
                actor: 'system',
                details: {},
                narrative: `Claim status: ${claim.status}`
            });
        }

        // Sort by timestamp
        events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        return [{
            documentId: claimId,
            filename: `Claim ${claimId.slice(0, 8)}`,
            events,
            summary: {
                ingestedAt: claim.created_at,
                ingestedFrom: 'detection_agent',
                linkedClaims: 1,
                lastActivity: events[events.length - 1]?.timestamp || claim.created_at
            }
        }];
    }

    /**
     * Map timeline action to audit event type
     */
    private mapTimelineAction(action: string): AuditEvent['eventType'] {
        const mapping: Record<string, AuditEvent['eventType']> = {
            'filed': 'filed',
            'auto_submitted': 'filed',
            'approved': 'verified',
            'partially_approved': 'verified',
            'denied': 'error',
            'escalated': 'linked',
            'resolved': 'verified',
            'status_changed': 'edited'
        };
        return mapping[action] || 'edited';
    }

    /**
     * Log a manual edit event
     */
    async logManualEdit(
        documentId: string,
        tenantId: string,
        userId: string,
        fieldName: string,
        oldValue: string,
        newValue: string,
        reason?: string
    ): Promise<boolean> {
        try {
            const editedAt = new Date().toISOString();
            const { error } = await supabaseAdmin
                .from('audit_logs')
                .insert({
                    tenant_id: tenantId,
                    actor_user_id: convertUserIdToUuid(userId),
                    actor_type: 'user',
                    resource_id: documentId,
                    resource_type: 'evidence_document',
                    action: 'manual_edit',
                    payload_before: { [fieldName]: oldValue },
                    payload_after: { [fieldName]: newValue },
                    metadata: {
                        field: fieldName,
                        reason: reason || null,
                        edited_at: editedAt
                    },
                    created_at: editedAt
                });

            if (error) {
                logger.warn('⚠️ [AUDIT] Failed to log manual edit, trying provenance fallback', {
                    documentId,
                    tenantId,
                    error: error.message
                });
                return this.logEditToDocumentMetadata(documentId, tenantId, userId, fieldName, oldValue, newValue, reason);
            }

            return true;
        } catch (error: any) {
            logger.error('❌ [AUDIT] Failed to log manual edit', { documentId, tenantId, error: error.message });
            return false;
        }
    }

    /**
     * Fallback: store edit history in document metadata
     */
    private async logEditToDocumentMetadata(
        documentId: string,
        tenantId: string,
        userId: string,
        fieldName: string,
        oldValue: string,
        newValue: string,
        reason?: string
    ): Promise<boolean> {
        try {
            const { data: doc, error: docError } = await supabaseAdmin
                .from('evidence_documents')
                .select('metadata')
                .eq('id', documentId)
                .eq('tenant_id', tenantId)
                .single();

            if (docError || !doc) return false;

            const metadata = typeof doc.metadata === 'string'
                ? JSON.parse(doc.metadata)
                : doc.metadata || {};
            const editHistory = Array.isArray(metadata._audit_history) ? metadata._audit_history : [];
            editHistory.push({
                action: 'manual_edit',
                field: fieldName,
                old_value: oldValue,
                new_value: newValue,
                reason: reason || null,
                actor_user_id: convertUserIdToUuid(userId),
                actor_type: 'user',
                tenant_id: tenantId,
                edited_at: new Date().toISOString()
            });

            const { error: updateError } = await supabaseAdmin
                .from('evidence_documents')
                .update({
                    metadata: { ...metadata, _audit_history: editHistory },
                    updated_at: new Date().toISOString()
                })
                .eq('id', documentId)
                .eq('tenant_id', tenantId);

            return !updateError;
        } catch (error: any) {
            logger.error('❌ [AUDIT] Provenance fallback logging failed', { documentId, tenantId, error: error.message });
            return false;
        }
    }

    /**
     * Generate human-readable narrative for audit event
     */
    private generateNarrative(
        eventType: string,
        context: Record<string, any>
    ): string {
        const filename = context.filename || 'Document';

        switch (eventType) {
            case 'ingested':
                const source = context.source?.replace(/_/g, ' ') || 'unknown source';
                return `${filename} was ingested from ${source}`;

            case 'parsed':
                return `${filename} was parsed (v${context.parserVersion}) — extracted ${context.fieldCount || 0} fields`;

            case 'linked':
                return `${filename} was linked to Claim #${context.claimNumber} via ${context.matchType}`;

            case 'unlinked':
                return `${filename} was unlinked from Claim #${context.claimNumber}`;

            case 'filed':
                return `${filename} was used as evidence for Claim #${context.claimNumber} filing`;

            case 'manual_edit':
                return `Field "${context.field}" was manually edited: "${context.old_value}" → "${context.new_value}"`;

            case 'verified':
                return `${filename} was verified for compliance`;

            case 'error':
                return `Error: ${context.reason || 'Unknown error'}`;

            default:
                return `${filename}: ${eventType}`;
        }
    }

    /**
     * Map audit log action to event type
     */
    private mapAuditLogAction(action: string): AuditEvent['eventType'] {
        const mapping: Record<string, AuditEvent['eventType']> = {
            'manual_edit': 'edited',
            'edit': 'edited',
            'update': 'edited',
            'link': 'linked',
            'unlink': 'unlinked',
            'file': 'filed',
            'verify': 'verified'
        };
        return mapping[action] || 'edited';
    }
}

export const evidenceAuditService = new EvidenceAuditService();
export default evidenceAuditService;
