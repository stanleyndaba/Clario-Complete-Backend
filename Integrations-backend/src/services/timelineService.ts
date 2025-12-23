/**
 * Timeline Service - Manages claim event history
 * Logs events like: filed, status_changed, escalated, resolved, etc.
 */

import { supabaseAdmin } from '../database/supabaseClient';
import { v4 as uuidv4 } from 'uuid';

// Timeline event types matching frontend ClaimNegotiationTimeline
export type TimelineAction =
    | 'filed'
    | 'approved'
    | 'partially_approved'
    | 'denied'
    | 'escalated'
    | 'adjusted'
    | 'resolved'
    | 'auto_submitted'
    | 'status_changed'
    | 'evidence_attached'
    | 'note_added';

export interface TimelineEvent {
    id: string;
    date: string;
    action: TimelineAction;
    description: string;
    amount?: number;
    rejectionReason?: string;
    escalationRound?: number;
    metadata?: Record<string, any>;
}

export interface AddTimelineEventParams {
    claimId: string;
    action: TimelineAction;
    description: string;
    amount?: number;
    rejectionReason?: string;
    escalationRound?: number;
    metadata?: Record<string, any>;
    table?: 'detection_results' | 'claims';
}

class TimelineService {
    /**
     * Add a timeline event to a claim/detection
     */
    async addEvent(params: AddTimelineEventParams): Promise<TimelineEvent | null> {
        const { claimId, action, description, amount, rejectionReason, escalationRound, metadata, table = 'detection_results' } = params;

        const event: TimelineEvent = {
            id: uuidv4(),
            date: new Date().toISOString(),
            action,
            description,
            ...(amount !== undefined && { amount }),
            ...(rejectionReason && { rejectionReason }),
            ...(escalationRound !== undefined && { escalationRound }),
            ...(metadata && { metadata }),
        };

        try {
            // Get current timeline
            const { data: record, error: fetchError } = await supabaseAdmin
                .from(table)
                .select('timeline')
                .eq('id', claimId)
                .single();

            if (fetchError) {
                console.error(`[TimelineService] Failed to fetch ${table} for timeline:`, fetchError.message);
                return null;
            }

            // Append new event
            const currentTimeline: TimelineEvent[] = record?.timeline || [];
            const updatedTimeline = [...currentTimeline, event];

            // Update with new timeline
            const { error: updateError } = await supabaseAdmin
                .from(table)
                .update({ timeline: updatedTimeline, updated_at: new Date().toISOString() })
                .eq('id', claimId);

            if (updateError) {
                console.error(`[TimelineService] Failed to update timeline:`, updateError.message);
                return null;
            }

            console.log(`[TimelineService] Added event to ${table}:`, { claimId, action });
            return event;
        } catch (error: any) {
            console.error(`[TimelineService] Error adding event:`, error.message);
            return null;
        }
    }

    /**
     * Get timeline for a claim/detection
     */
    async getTimeline(claimId: string, table: 'detection_results' | 'claims' = 'detection_results'): Promise<TimelineEvent[]> {
        try {
            const { data, error } = await supabaseAdmin
                .from(table)
                .select('timeline')
                .eq('id', claimId)
                .single();

            if (error) {
                console.error(`[TimelineService] Failed to get timeline:`, error.message);
                return [];
            }

            return data?.timeline || [];
        } catch (error: any) {
            console.error(`[TimelineService] Error getting timeline:`, error.message);
            return [];
        }
    }

    /**
     * Log initial "filed" event when claim is created
     */
    async logClaimCreated(claimId: string, amount?: number, table: 'detection_results' | 'claims' = 'detection_results'): Promise<void> {
        await this.addEvent({
            claimId,
            action: 'filed',
            description: 'Claim detected and filed automatically by AI agent',
            amount,
            table,
        });
    }

    /**
     * Log status change event
     */
    async logStatusChange(claimId: string, oldStatus: string, newStatus: string, notes?: string, table: 'detection_results' | 'claims' = 'detection_results'): Promise<void> {
        // Map status to appropriate action
        let action: TimelineAction = 'status_changed';
        let description = `Status changed from ${oldStatus} to ${newStatus}`;

        if (newStatus === 'submitted' || newStatus === 'filed') {
            action = 'auto_submitted';
            description = 'Evidence package submitted to Amazon';
        } else if (newStatus === 'approved' || newStatus === 'paid') {
            action = 'approved';
            description = 'Claim approved by Amazon';
        } else if (newStatus === 'denied' || newStatus === 'rejected') {
            action = 'denied';
            description = 'Claim denied by Amazon';
        } else if (newStatus === 'resolved') {
            action = 'resolved';
            description = 'Claim marked as resolved';
        }

        if (notes) {
            description += `. Notes: ${notes}`;
        }

        await this.addEvent({
            claimId,
            action,
            description,
            table,
        });
    }

    /**
     * Log escalation event
     */
    async logEscalation(claimId: string, escalationRound: number, reason?: string, table: 'detection_results' | 'claims' = 'detection_results'): Promise<void> {
        await this.addEvent({
            claimId,
            action: 'escalated',
            description: `Escalation round ${escalationRound} initiated${reason ? `: ${reason}` : ''}`,
            escalationRound,
            table,
        });
    }

    /**
     * Log resolution event
     */
    async logResolution(claimId: string, amount?: number, notes?: string, table: 'detection_results' | 'claims' = 'detection_results'): Promise<void> {
        await this.addEvent({
            claimId,
            action: 'resolved',
            description: notes || 'Claim resolved successfully',
            amount,
            table,
        });
    }

    /**
     * Log evidence attachment
     */
    async logEvidenceAttached(claimId: string, documentCount: number, table: 'detection_results' | 'claims' = 'detection_results'): Promise<void> {
        await this.addEvent({
            claimId,
            action: 'evidence_attached',
            description: `${documentCount} evidence document(s) attached to claim`,
            table,
        });
    }
}

export const timelineService = new TimelineService();
export default timelineService;
