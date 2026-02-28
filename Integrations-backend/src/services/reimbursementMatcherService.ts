/**
 * Reimbursement Matcher Service
 * 
 * Scans Gmail for Amazon reimbursement notification emails,
 * extracts reimbursement data, and matches them to Margin-filed
 * dispute cases (claims we opened on behalf of the seller).
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { GmailService } from './gmailService';
import { v4 as uuidv4 } from 'uuid';

// ── Types ──────────────────────────────────────────────────────────

export interface ReimbursementData {
    amount: number;
    currency: string;
    date: string;
    caseId?: string;
    orderId?: string;
    asin?: string;
    sku?: string;
    source: 'gmail_email' | 'csv_upload' | 'manual' | 'api';
    sourceMetadata: Record<string, any>;
}

export interface MatchResult {
    reimbursement: ReimbursementData;
    disputeCaseId: string | null;
    detectionResultId: string | null;
    confidence: number;
    matchReason: string;
}

export interface ScanResult {
    success: boolean;
    emailsScanned: number;
    reimbursementsFound: number;
    matchesCreated: number;
    errors: string[];
}

// ── Email patterns Amazon uses for reimbursement notifications ────

const REIMBURSEMENT_SUBJECT_PATTERNS = [
    'reimbursement has been issued',
    'we have initiated a reimbursement',
    'reimbursement for case',
    'your reimbursement',
    'fba reimbursement',
    'reimbursement notification',
    'reimbursement processed',
    'reimbursement approved',
    'inventory reimbursement',
    'case.*reimburs',
];

const REIMBURSEMENT_SENDER_PATTERNS = [
    'no-reply@amazon.com',
    'seller-notification@amazon.com',
    'noreply@amazon.com',
    'fba-reimbursement@amazon.com',
    'payments@amazon.com',
];

// ── Regex patterns for extracting data from email body ────────────

const AMOUNT_REGEX = /\$\s?([\d,]+\.?\d{0,2})/g;
const CASE_ID_REGEX = /(?:case\s*(?:id|#|number)?[:\s]*)([\d]{6,12})/gi;
const ORDER_ID_REGEX = /(\d{3}-\d{7}-\d{7})/g;
const ASIN_REGEX = /([A-Z0-9]{10})/g;
const DATE_REGEX = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g;
const REIMBURSEMENT_ID_REGEX = /(?:reimbursement\s*(?:id|#)?[:\s]*)([\d]+)/gi;

// ── Service ────────────────────────────────────────────────────────

export class ReimbursementMatcherService {
    private gmailService: GmailService;

    constructor() {
        this.gmailService = new GmailService();
    }

    // ─── 1. Scan Gmail for Reimbursement Emails ─────────────────────

    async scanGmailForReimbursements(userId: string, options: {
        maxResults?: number;
        afterDate?: string;   // ISO date
    } = {}): Promise<ScanResult> {
        const errors: string[] = [];
        let emailsScanned = 0;
        let reimbursementsFound = 0;
        let matchesCreated = 0;

        try {
            logger.info('[REIMB MATCHER] Starting Gmail scan for reimbursement emails', { userId });

            // Build Gmail query targeting reimbursement emails
            const subjectParts = REIMBURSEMENT_SUBJECT_PATTERNS
                .slice(0, 6)
                .map(p => `subject:"${p}"`)
                .join(' OR ');

            const senderParts = REIMBURSEMENT_SENDER_PATTERNS
                .map(s => `from:${s}`)
                .join(' OR ');

            let query = `(${senderParts}) (${subjectParts})`;

            if (options.afterDate) {
                const dateStr = options.afterDate.split('T')[0].replace(/-/g, '/');
                query += ` after:${dateStr}`;
            }

            logger.info('[REIMB MATCHER] Gmail query', { query: query.substring(0, 200) });

            // Fetch emails
            const emails = await this.gmailService.fetchEmails(
                userId,
                query,
                options.maxResults || 100
            );

            emailsScanned = emails.length;
            logger.info(`[REIMB MATCHER] Fetched ${emails.length} potential reimbursement emails`);

            // Process each email
            for (const email of emails) {
                try {
                    // Get full message
                    const message = await this.gmailService.fetchMessage(userId, email.id, 'full');
                    const body = this.extractEmailBody(message);
                    const subject = email.subject || '';

                    // Check if already processed
                    const { data: existing } = await supabase
                        .from('reimbursement_matches')
                        .select('id')
                        .eq('seller_id', userId)
                        .contains('source_metadata', { email_id: email.id })
                        .maybeSingle();

                    if (existing) {
                        logger.debug('[REIMB MATCHER] Email already processed, skipping', { emailId: email.id });
                        continue;
                    }

                    // Extract reimbursement data from email
                    const reimbursementData = this.extractReimbursementData(subject, body, email);

                    if (!reimbursementData) {
                        logger.debug('[REIMB MATCHER] No reimbursement data found in email', {
                            emailId: email.id,
                            subject
                        });
                        continue;
                    }

                    reimbursementsFound++;
                    logger.info('[REIMB MATCHER] Extracted reimbursement data', {
                        emailId: email.id,
                        amount: reimbursementData.amount,
                        caseId: reimbursementData.caseId,
                        date: reimbursementData.date
                    });

                    // Match to Margin-filed case
                    const matchResult = await this.matchToMarginCases(reimbursementData, userId);

                    // Store match
                    const matchId = await this.createReimbursementMatch(userId, reimbursementData, matchResult);

                    if (matchId) {
                        matchesCreated++;
                    }
                } catch (error: any) {
                    errors.push(`Email ${email.id}: ${error?.message || String(error)}`);
                    logger.warn('[REIMB MATCHER] Error processing email', {
                        emailId: email.id,
                        error: error?.message
                    });
                }
            }

            logger.info('[REIMB MATCHER] Scan complete', {
                emailsScanned,
                reimbursementsFound,
                matchesCreated,
                errors: errors.length
            });

            return {
                success: errors.length === 0,
                emailsScanned,
                reimbursementsFound,
                matchesCreated,
                errors
            };
        } catch (error: any) {
            logger.error('[REIMB MATCHER] Critical error during scan', {
                error: error?.message,
                userId
            });
            return {
                success: false,
                emailsScanned,
                reimbursementsFound,
                matchesCreated,
                errors: [error?.message || String(error)]
            };
        }
    }

    // ─── 2. Extract Reimbursement Data from Email ───────────────────

    extractReimbursementData(
        subject: string,
        body: string,
        email: any
    ): ReimbursementData | null {
        const combined = `${subject} ${body}`;

        // Must contain a reimbursement-related keyword
        const hasReimbursementKeyword = REIMBURSEMENT_SUBJECT_PATTERNS
            .some(pattern => {
                const regex = new RegExp(pattern, 'i');
                return regex.test(combined);
            });

        if (!hasReimbursementKeyword) return null;

        // Extract amount (take the largest amount — likely the reimbursement)
        const amounts: number[] = [];
        let amountMatch;
        const amountRegex = /\$\s?([\d,]+\.?\d{0,2})/g;
        while ((amountMatch = amountRegex.exec(combined)) !== null) {
            const val = parseFloat(amountMatch[1].replace(/,/g, ''));
            if (!isNaN(val) && val > 0) amounts.push(val);
        }

        if (amounts.length === 0) return null; // No monetary value found

        const amount = Math.max(...amounts);

        // Extract case ID
        let caseId: string | undefined;
        const caseMatch = CASE_ID_REGEX.exec(combined);
        if (caseMatch) caseId = caseMatch[1];
        CASE_ID_REGEX.lastIndex = 0;

        // Extract order ID
        let orderId: string | undefined;
        const orderMatch = ORDER_ID_REGEX.exec(combined);
        if (orderMatch) orderId = orderMatch[1];
        ORDER_ID_REGEX.lastIndex = 0;

        // Extract ASIN (only if looks like a real ASIN — starts with B0)
        let asin: string | undefined;
        const asinRegex = /\b(B0[A-Z0-9]{8})\b/g;
        const asinMatch = asinRegex.exec(combined);
        if (asinMatch) asin = asinMatch[1];

        // Extract date from email or body
        const emailDate = email.date || email.internalDate
            ? new Date(parseInt(email.internalDate || '0')).toISOString()
            : new Date().toISOString();

        return {
            amount,
            currency: 'USD',
            date: emailDate,
            caseId,
            orderId,
            asin,
            source: 'gmail_email',
            sourceMetadata: {
                email_id: email.id,
                email_subject: subject,
                email_from: email.from,
                email_date: emailDate,
                body_snippet: body.substring(0, 500),
                amounts_found: amounts,
            }
        };
    }

    // ─── 3. Match to Margin-Filed Cases ─────────────────────────────

    async matchToMarginCases(
        data: ReimbursementData,
        sellerId: string
    ): Promise<MatchResult> {
        const result: MatchResult = {
            reimbursement: data,
            disputeCaseId: null,
            detectionResultId: null,
            confidence: 0,
            matchReason: 'no_match'
        };

        try {
            // Strategy 1: Match by Amazon case ID (highest confidence)
            if (data.caseId) {
                const { data: caseByRef } = await supabase
                    .from('dispute_cases')
                    .select('id, detection_result_id, claim_amount')
                    .eq('seller_id', sellerId)
                    .eq('provider_case_id', data.caseId)
                    .maybeSingle();

                if (caseByRef) {
                    result.disputeCaseId = caseByRef.id;
                    result.detectionResultId = caseByRef.detection_result_id;
                    result.confidence = 0.95;
                    result.matchReason = 'case_id_exact_match';
                    logger.info('[REIMB MATCHER] Matched by case ID', { caseId: data.caseId, confidence: 0.95 });
                    return result;
                }

                // Try matching case_number field
                const { data: caseByNumber } = await supabase
                    .from('dispute_cases')
                    .select('id, detection_result_id, claim_amount')
                    .eq('seller_id', sellerId)
                    .eq('case_number', data.caseId)
                    .maybeSingle();

                if (caseByNumber) {
                    result.disputeCaseId = caseByNumber.id;
                    result.detectionResultId = caseByNumber.detection_result_id;
                    result.confidence = 0.90;
                    result.matchReason = 'case_number_match';
                    return result;
                }
            }

            // Strategy 2: Match by order ID + approximate amount
            if (data.orderId) {
                const { data: casesByOrder } = await supabase
                    .from('dispute_cases')
                    .select('id, detection_result_id, claim_amount, evidence_attachments')
                    .eq('seller_id', sellerId)
                    .in('status', ['submitted', 'approved', 'pending']);

                if (casesByOrder) {
                    for (const dc of casesByOrder) {
                        const evidence = dc.evidence_attachments || {};
                        const evidenceStr = JSON.stringify(evidence).toLowerCase();
                        if (evidenceStr.includes(data.orderId!.toLowerCase())) {
                            const amountDiff = Math.abs(Number(dc.claim_amount) - data.amount);
                            const amountRatio = amountDiff / Math.max(data.amount, 1);

                            if (amountRatio < 0.25) { // Within 25%
                                result.disputeCaseId = dc.id;
                                result.detectionResultId = dc.detection_result_id;
                                result.confidence = 0.80;
                                result.matchReason = 'order_id_amount_match';
                                return result;
                            }
                        }
                    }
                }
            }

            // Strategy 3: Amount + date proximity (within 30 days, ±10% amount)
            const { data: recentCases } = await supabase
                .from('dispute_cases')
                .select('id, detection_result_id, claim_amount, submission_date')
                .eq('seller_id', sellerId)
                .in('status', ['submitted', 'approved', 'pending'])
                .gte('submission_date', new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString())
                .order('submission_date', { ascending: false })
                .limit(50);

            if (recentCases && recentCases.length > 0) {
                for (const dc of recentCases) {
                    const claimAmount = Number(dc.claim_amount);
                    const amountDiff = Math.abs(claimAmount - data.amount);
                    const amountRatio = amountDiff / Math.max(data.amount, 1);

                    if (amountRatio < 0.10) { // Within 10%
                        result.disputeCaseId = dc.id;
                        result.detectionResultId = dc.detection_result_id;
                        result.confidence = 0.60;
                        result.matchReason = 'amount_date_proximity';
                        return result;
                    }
                }
            }

            // No match found — still store it as unmatched (manual review)
            result.confidence = 0;
            result.matchReason = 'no_match_found';
            return result;

        } catch (error: any) {
            logger.error('[REIMB MATCHER] Error matching to cases', { error: error?.message });
            result.matchReason = 'match_error';
            return result;
        }
    }

    // ─── 4. Store Match ─────────────────────────────────────────────

    async createReimbursementMatch(
        sellerId: string,
        data: ReimbursementData,
        match: MatchResult
    ): Promise<string | null> {
        try {
            const { data: inserted, error } = await supabase
                .from('reimbursement_matches')
                .insert({
                    seller_id: sellerId,
                    dispute_case_id: match.disputeCaseId,
                    detection_result_id: match.detectionResultId,
                    amazon_reimbursement_amount: data.amount,
                    currency: data.currency,
                    reimbursement_date: data.date,
                    match_source: data.source,
                    match_confidence: match.confidence,
                    source_metadata: {
                        ...data.sourceMetadata,
                        match_reason: match.matchReason
                    },
                    status: match.confidence >= 0.85 ? 'confirmed' : 'pending_review',
                    amazon_case_id: data.caseId,
                    amazon_order_id: data.orderId,
                    asin: data.asin,
                    sku: data.sku
                })
                .select('id')
                .single();

            if (error) {
                logger.error('[REIMB MATCHER] Failed to insert match', { error: error.message });
                return null;
            }

            // If high confidence, update the dispute case status
            if (match.disputeCaseId && match.confidence >= 0.85) {
                await supabase
                    .from('dispute_cases')
                    .update({
                        status: 'approved',
                        resolution_amount: data.amount,
                        resolution_date: data.date,
                        resolution_notes: `Reimbursement confirmed via ${data.source} (confidence: ${(match.confidence * 100).toFixed(0)}%)`
                    })
                    .eq('id', match.disputeCaseId);
            }

            logger.info('[REIMB MATCHER] Match created', {
                matchId: inserted?.id,
                confidence: match.confidence,
                reason: match.matchReason,
                amount: data.amount
            });

            return inserted?.id || null;
        } catch (error: any) {
            logger.error('[REIMB MATCHER] Error creating match', { error: error?.message });
            return null;
        }
    }

    // ─── 5. Manual Match Entry (for CSV / manual input) ─────────────

    async createManualMatch(
        sellerId: string,
        data: {
            amount: number;
            currency?: string;
            reimbursementDate: string;
            caseId?: string;
            orderId?: string;
            asin?: string;
            notes?: string;
        }
    ): Promise<string | null> {
        const reimbData: ReimbursementData = {
            amount: data.amount,
            currency: data.currency || 'USD',
            date: data.reimbursementDate,
            caseId: data.caseId,
            orderId: data.orderId,
            asin: data.asin,
            source: 'manual',
            sourceMetadata: { notes: data.notes || 'Manual entry' }
        };

        const match = await this.matchToMarginCases(reimbData, sellerId);
        return this.createReimbursementMatch(sellerId, reimbData, match);
    }

    // ─── 6. Get Matches for Seller ──────────────────────────────────

    async getMatchesForSeller(sellerId: string, options: {
        status?: string;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ matches: any[]; total: number }> {
        let query = supabase
            .from('reimbursement_matches')
            .select('*', { count: 'exact' })
            .eq('seller_id', sellerId)
            .order('reimbursement_date', { ascending: false });

        if (options.status) {
            query = query.eq('status', options.status);
        }

        query = query.range(
            options.offset || 0,
            (options.offset || 0) + (options.limit || 50) - 1
        );

        const { data, count, error } = await query;

        if (error) {
            logger.error('[REIMB MATCHER] Error fetching matches', { error: error.message });
            return { matches: [], total: 0 };
        }

        return { matches: data || [], total: count || 0 };
    }

    // ─── Helpers ────────────────────────────────────────────────────

    private extractEmailBody(message: any): string {
        try {
            const parts = message.payload?.parts || [];

            // Look for text/plain part
            for (const part of parts) {
                if (part.mimeType === 'text/plain' && part.body?.data) {
                    return Buffer.from(part.body.data, 'base64').toString('utf-8');
                }
            }

            // Fallback to text/html part (strip tags)
            for (const part of parts) {
                if (part.mimeType === 'text/html' && part.body?.data) {
                    const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
                    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                }
            }

            // Single-part message
            if (message.payload?.body?.data) {
                return Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
            }

            return '';
        } catch {
            return '';
        }
    }
}

export const reimbursementMatcherService = new ReimbursementMatcherService();
