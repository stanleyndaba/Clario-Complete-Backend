/**
 * Commission Invoice Service
 * 
 * Generates commission invoices for sellers based on confirmed
 * reimbursement matches. Margin takes 20% of Amazon reimbursements
 * that were recovered through Margin-filed claims.
 * 
 * Also manages payment methods (card on file) for future auto-charge.
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';

// ── Types ──────────────────────────────────────────────────────────

export interface InvoiceLineItem {
    reimbursement_match_id: string;
    amazon_reimbursement_amount: number;
    commission_amount: number;
    description: string;
    reimbursement_date: string;
    amazon_case_id?: string;
    asin?: string;
}

export interface InvoiceSummary {
    id: string;
    invoice_number: string;
    status: string;
    period_start: string;
    period_end: string;
    total_reimbursements: number;
    commission_rate: number;
    commission_amount: number;
    due_date: string | null;
    line_items_count: number;
    created_at: string;
}

export interface RevenueMetrics {
    totalRecovered: number;          // Sum of all matched reimbursements
    totalCommissionEarned: number;   // Sum of all paid invoices
    totalCommissionPending: number;  // Sum of unpaid invoices
    invoiceCount: number;
    matchCount: number;
    unreviewedMatches: number;
    commissionRate: number;
}

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_COMMISSION_RATE = 0.20; // 20%
const DISPUTE_WINDOW_HOURS = 24;

// ── Service ────────────────────────────────────────────────────────

export class CommissionInvoiceService {

    // ─── 1. Generate Invoice ─────────────────────────────────────────

    async generateInvoice(
        sellerId: string,
        periodStart: string,
        periodEnd: string,
        options: { commissionRate?: number } = {}
    ): Promise<{ success: boolean; invoiceId?: string; invoice?: any; error?: string }> {
        try {
            const rate = options.commissionRate || DEFAULT_COMMISSION_RATE;

            logger.info('[INVOICE] Generating invoice', { sellerId, periodStart, periodEnd, rate });

            // Fetch confirmed, un-invoiced reimbursement matches in period
            const { data: matches, error: matchError } = await supabase
                .from('reimbursement_matches')
                .select('*')
                .eq('seller_id', sellerId)
                .eq('status', 'confirmed')
                .gte('reimbursement_date', periodStart)
                .lte('reimbursement_date', periodEnd)
                .order('reimbursement_date', { ascending: true });

            if (matchError) {
                return { success: false, error: matchError.message };
            }

            if (!matches || matches.length === 0) {
                return { success: false, error: 'No confirmed reimbursement matches found in this period' };
            }

            // Build line items
            const lineItems: InvoiceLineItem[] = matches.map(m => ({
                reimbursement_match_id: m.id,
                amazon_reimbursement_amount: Number(m.amazon_reimbursement_amount),
                commission_amount: Number((Number(m.amazon_reimbursement_amount) * rate).toFixed(2)),
                description: `Reimbursement ${m.amazon_case_id ? `Case #${m.amazon_case_id}` : m.asin ? `ASIN ${m.asin}` : `Match ${m.id.substring(0, 8)}`}`,
                reimbursement_date: m.reimbursement_date,
                amazon_case_id: m.amazon_case_id,
                asin: m.asin
            }));

            const totalReimbursements = lineItems.reduce((sum, li) => sum + li.amazon_reimbursement_amount, 0);
            const commissionAmount = Number((totalReimbursements * rate).toFixed(2));

            // Generate invoice number
            const invoiceNumber = await this.generateInvoiceNumber(sellerId);

            // Due date: 7 days from now
            const dueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
            // Dispute window: 24 hours
            const disputeWindowEnds = new Date(Date.now() + DISPUTE_WINDOW_HOURS * 3600 * 1000).toISOString();

            // Insert invoice
            const { data: invoice, error: invError } = await supabase
                .from('margin_invoices')
                .insert({
                    seller_id: sellerId,
                    invoice_number: invoiceNumber,
                    period_start: periodStart,
                    period_end: periodEnd,
                    total_reimbursements: totalReimbursements,
                    commission_rate: rate,
                    commission_amount: commissionAmount,
                    status: 'draft',
                    due_date: dueDate,
                    dispute_window_ends: disputeWindowEnds,
                    line_items: lineItems
                })
                .select()
                .single();

            if (invError) {
                return { success: false, error: invError.message };
            }

            // Mark reimbursement matches as invoiced
            const matchIds = matches.map(m => m.id);
            await supabase
                .from('reimbursement_matches')
                .update({ status: 'invoiced' })
                .in('id', matchIds);

            logger.info('[INVOICE] Invoice generated', {
                invoiceId: invoice.id,
                invoiceNumber,
                lineItems: lineItems.length,
                totalReimbursements,
                commissionAmount
            });

            return { success: true, invoiceId: invoice.id, invoice };
        } catch (error: any) {
            logger.error('[INVOICE] Error generating invoice', { error: error?.message, sellerId });
            return { success: false, error: error?.message || 'Unknown error' };
        }
    }

    // ─── 2. Get Invoices ────────────────────────────────────────────

    async getInvoicesForSeller(
        sellerId: string,
        options: { status?: string; limit?: number; offset?: number } = {}
    ): Promise<{ invoices: any[]; total: number }> {
        let query = supabase
            .from('margin_invoices')
            .select('*', { count: 'exact' })
            .eq('seller_id', sellerId)
            .order('created_at', { ascending: false });

        if (options.status) query = query.eq('status', options.status);

        query = query.range(
            options.offset || 0,
            (options.offset || 0) + (options.limit || 50) - 1
        );

        const { data, count, error } = await query;

        if (error) {
            logger.error('[INVOICE] Error fetching invoices', { error: error.message });
            return { invoices: [], total: 0 };
        }

        return { invoices: data || [], total: count || 0 };
    }

    // ─── 3. Get Single Invoice ──────────────────────────────────────

    async getInvoiceDetail(invoiceId: string, sellerId: string): Promise<any | null> {
        const { data, error } = await supabase
            .from('margin_invoices')
            .select('*')
            .eq('id', invoiceId)
            .eq('seller_id', sellerId)
            .single();

        if (error) return null;
        return data;
    }

    // ─── 4. Dispute a Line Item ─────────────────────────────────────

    async disputeLineItem(
        invoiceId: string,
        reimbursementMatchId: string,
        sellerId: string,
        reason: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Get invoice
            const invoice = await this.getInvoiceDetail(invoiceId, sellerId);
            if (!invoice) return { success: false, error: 'Invoice not found' };

            // Check if within dispute window
            if (invoice.dispute_window_ends && new Date(invoice.dispute_window_ends) < new Date()) {
                return { success: false, error: 'Dispute window has closed' };
            }

            // Mark the reimbursement match as disputed
            await supabase
                .from('reimbursement_matches')
                .update({ status: 'disputed' })
                .eq('id', reimbursementMatchId)
                .eq('seller_id', sellerId);

            // Update invoice line items (mark disputed one)
            const lineItems = invoice.line_items || [];
            const updatedLineItems = lineItems.map((li: any) => {
                if (li.reimbursement_match_id === reimbursementMatchId) {
                    return { ...li, disputed: true, dispute_reason: reason };
                }
                return li;
            });

            // Recalculate commission excluding disputed items
            const activeItems = updatedLineItems.filter((li: any) => !li.disputed);
            const newTotal = activeItems.reduce((s: number, li: any) => s + li.amazon_reimbursement_amount, 0);
            const newCommission = Number((newTotal * invoice.commission_rate).toFixed(2));

            await supabase
                .from('margin_invoices')
                .update({
                    line_items: updatedLineItems,
                    total_reimbursements: newTotal,
                    commission_amount: newCommission,
                    status: 'disputed'
                })
                .eq('id', invoiceId);

            logger.info('[INVOICE] Line item disputed', { invoiceId, reimbursementMatchId, reason });

            return { success: true };
        } catch (error: any) {
            return { success: false, error: error?.message };
        }
    }

    // ─── 5. Finalize Invoice ────────────────────────────────────────

    async finalizeInvoice(invoiceId: string, sellerId: string): Promise<{ success: boolean; error?: string }> {
        try {
            const invoice = await this.getInvoiceDetail(invoiceId, sellerId);
            if (!invoice) return { success: false, error: 'Invoice not found' };
            if (invoice.status !== 'draft') return { success: false, error: `Cannot finalize invoice in '${invoice.status}' status` };

            await supabase
                .from('margin_invoices')
                .update({
                    status: 'sent',
                    dispute_window_ends: new Date(Date.now() + DISPUTE_WINDOW_HOURS * 3600 * 1000).toISOString()
                })
                .eq('id', invoiceId);

            logger.info('[INVOICE] Invoice finalized', { invoiceId });
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error?.message };
        }
    }

    // ─── 6. Revenue Metrics ─────────────────────────────────────────

    async getRevenueMetrics(sellerId?: string): Promise<RevenueMetrics> {
        try {
            // Total recovered (sum of confirmed match amounts)
            let matchQuery = supabase
                .from('reimbursement_matches')
                .select('amazon_reimbursement_amount, status', { count: 'exact' });
            if (sellerId) matchQuery = matchQuery.eq('seller_id', sellerId);

            const { data: allMatches, count: matchCount } = await matchQuery;

            const totalRecovered = (allMatches || [])
                .filter(m => m.status === 'confirmed' || m.status === 'invoiced')
                .reduce((s, m) => s + Number(m.amazon_reimbursement_amount), 0);

            const unreviewedMatches = (allMatches || [])
                .filter(m => m.status === 'pending_review').length;

            // Invoice totals
            let invQuery = supabase
                .from('margin_invoices')
                .select('commission_amount, status');
            if (sellerId) invQuery = invQuery.eq('seller_id', sellerId);

            const { data: invoices } = await invQuery;

            const totalCommissionEarned = (invoices || [])
                .filter(i => i.status === 'paid')
                .reduce((s, i) => s + Number(i.commission_amount), 0);

            const totalCommissionPending = (invoices || [])
                .filter(i => ['draft', 'pending', 'sent'].includes(i.status))
                .reduce((s, i) => s + Number(i.commission_amount), 0);

            return {
                totalRecovered,
                totalCommissionEarned,
                totalCommissionPending,
                invoiceCount: (invoices || []).length,
                matchCount: matchCount || 0,
                unreviewedMatches,
                commissionRate: DEFAULT_COMMISSION_RATE
            };
        } catch (error: any) {
            logger.error('[INVOICE] Error computing metrics', { error: error?.message });
            return {
                totalRecovered: 0,
                totalCommissionEarned: 0,
                totalCommissionPending: 0,
                invoiceCount: 0,
                matchCount: 0,
                unreviewedMatches: 0,
                commissionRate: DEFAULT_COMMISSION_RATE
            };
        }
    }

    // ─── 7. Payment Methods ─────────────────────────────────────────

    async addPaymentMethod(sellerId: string, data: {
        cardBrand: string;
        cardLastFour: string;
        cardExpMonth: number;
        cardExpYear: number;
        cardholderName?: string;
        billingEmail?: string;
        setDefault?: boolean;
    }): Promise<{ success: boolean; paymentMethodId?: string; error?: string }> {
        try {
            // If setting as default, unset other defaults
            if (data.setDefault) {
                await supabase
                    .from('payment_methods')
                    .update({ is_default: false })
                    .eq('seller_id', sellerId);
            }

            const { data: pm, error } = await supabase
                .from('payment_methods')
                .insert({
                    seller_id: sellerId,
                    method_type: 'card',
                    card_brand: data.cardBrand.toLowerCase(),
                    card_last_four: data.cardLastFour,
                    card_exp_month: data.cardExpMonth,
                    card_exp_year: data.cardExpYear,
                    cardholder_name: data.cardholderName,
                    billing_email: data.billingEmail,
                    is_default: data.setDefault !== false,
                    gateway: 'manual', // No gateway integration yet
                    status: 'active'
                })
                .select('id')
                .single();

            if (error) return { success: false, error: error.message };

            logger.info('[PAYMENT] Payment method added', {
                sellerId,
                brand: data.cardBrand,
                lastFour: data.cardLastFour
            });

            return { success: true, paymentMethodId: pm?.id };
        } catch (error: any) {
            return { success: false, error: error?.message };
        }
    }

    async getPaymentMethods(sellerId: string): Promise<any[]> {
        const { data, error } = await supabase
            .from('payment_methods')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('status', 'active')
            .order('is_default', { ascending: false });

        if (error) {
            logger.error('[PAYMENT] Error fetching payment methods', { error: error.message });
            return [];
        }
        return data || [];
    }

    async removePaymentMethod(paymentMethodId: string, sellerId: string): Promise<{ success: boolean; error?: string }> {
        const { error } = await supabase
            .from('payment_methods')
            .update({ status: 'removed' })
            .eq('id', paymentMethodId)
            .eq('seller_id', sellerId);

        if (error) return { success: false, error: error.message };
        return { success: true };
    }

    async setDefaultPaymentMethod(paymentMethodId: string, sellerId: string): Promise<{ success: boolean; error?: string }> {
        // Unset all
        await supabase
            .from('payment_methods')
            .update({ is_default: false })
            .eq('seller_id', sellerId);

        // Set this one
        const { error } = await supabase
            .from('payment_methods')
            .update({ is_default: true })
            .eq('id', paymentMethodId)
            .eq('seller_id', sellerId);

        if (error) return { success: false, error: error.message };
        return { success: true };
    }

    // ─── Helper ─────────────────────────────────────────────────────

    private async generateInvoiceNumber(sellerId: string): Promise<string> {
        const year = new Date().getFullYear();
        const { count } = await supabase
            .from('margin_invoices')
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', sellerId);

        const seq = String((count || 0) + 1).padStart(4, '0');
        return `MRG-${year}-${seq}`;
    }
}

export const commissionInvoiceService = new CommissionInvoiceService();
