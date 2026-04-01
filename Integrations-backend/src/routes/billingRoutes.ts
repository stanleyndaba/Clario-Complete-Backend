import { Router } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import { invoicePdfService } from '../services/invoicePdfService';
import recoveryFinancialTruthService from '../services/recoveryFinancialTruthService';

const router = Router();

async function resolveBillingScope(req: any) {
    const userId = (req.query.userId as string) || req.userId;
    const tenantSlug = ((req.query.tenantSlug as string) || (req.query.tenant_slug as string) || '').trim();
    const headerTenantId = ((req.headers['x-tenant-id'] as string) || '').trim();

    if (!userId) {
        throw new Error('User ID required');
    }

    let tenantId = headerTenantId;

    if (!tenantId && tenantSlug) {
        const { data: tenantData, error: tenantError } = await supabaseAdmin
            .from('tenants')
            .select('id')
            .eq('slug', tenantSlug)
            .is('deleted_at', null)
            .maybeSingle();

        if (tenantError) {
            throw new Error('Failed to resolve tenant context');
        }

        if (!tenantData?.id) {
            throw new Error('Tenant not found');
        }

        tenantId = tenantData.id;
    }

    if (!tenantId) {
        throw new Error('Tenant context required');
    }

    return { userId, tenantId };
}

type BillingProof = {
    settlement_id: string | null;
    payout_batch_id: string | null;
    reference_ids: string[];
    event_ids: string[];
};

function toOptionalMoney(cents: unknown): number | null {
    const parsed = Number(cents);
    return Number.isFinite(parsed) ? Number((parsed / 100).toFixed(2)) : null;
}

function normalizeBillingStatus(value: unknown): string | null {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || null;
}

function deriveChargedAmount(status: unknown, amountDueCents: unknown): number | null {
    const normalizedStatus = normalizeBillingStatus(status);
    if (normalizedStatus === 'charged' || normalizedStatus === 'refunded') {
        return toOptionalMoney(amountDueCents);
    }
    if (normalizedStatus === 'credited') {
        return 0;
    }
    return null;
}

async function buildBillingProofMap(rows: Array<{ id: string; dispute_id?: string | null; recovery_id?: string | null }>, tenantId: string): Promise<Map<string, BillingProof>> {
    const proofByRowId = new Map<string, BillingProof>();
    const directDisputeIds = new Set<string>();
    const recoveryIds: string[] = [];
    const disputeIdByRowId = new Map<string, string>();

    rows.forEach((row) => {
        const disputeId = String(row.dispute_id || '').trim();
        const recoveryId = String(row.recovery_id || '').trim();
        if (disputeId) {
            directDisputeIds.add(disputeId);
            disputeIdByRowId.set(row.id, disputeId);
        } else if (recoveryId) {
            recoveryIds.push(recoveryId);
        }
    });

    let recoveryRows: Array<{ id: string; dispute_id: string | null }> = [];
    if (recoveryIds.length > 0) {
        const { data } = await supabaseAdmin
            .from('recoveries')
            .select('id, dispute_id')
            .eq('tenant_id', tenantId)
            .in('id', Array.from(new Set(recoveryIds)));
        recoveryRows = data || [];
    }

    const recoveryDisputeById = new Map<string, string>();
    recoveryRows.forEach((row) => {
        const disputeId = String(row.dispute_id || '').trim();
        if (disputeId) {
            recoveryDisputeById.set(row.id, disputeId);
            directDisputeIds.add(disputeId);
        }
    });

    rows.forEach((row) => {
        if (disputeIdByRowId.has(row.id)) return;
        const recoveryId = String(row.recovery_id || '').trim();
        const disputeId = recoveryDisputeById.get(recoveryId);
        if (disputeId) {
            disputeIdByRowId.set(row.id, disputeId);
        }
    });

    const disputeIds = Array.from(directDisputeIds);
    if (disputeIds.length === 0) {
        return proofByRowId;
    }

    const truth = await recoveryFinancialTruthService.getFinancialTruth({ tenantId, caseIds: disputeIds });
    const proofByDisputeId = new Map<string, BillingProof>();

    disputeIds.forEach((disputeId) => {
        const events = truth.eventsByInputId[disputeId] || [];
        const settlementIds = Array.from(new Set(events.map((event) => String(event.settlement_id || '').trim()).filter(Boolean)));
        const payoutBatchIds = Array.from(new Set(events.map((event) => String(event.payout_batch_id || '').trim()).filter(Boolean)));
        const referenceIds = Array.from(new Set(events.map((event) => String(event.reference_id || '').trim()).filter(Boolean)));
        const eventIds = Array.from(new Set(events.map((event) => String(event.event_id || '').trim()).filter(Boolean)));

        proofByDisputeId.set(disputeId, {
            settlement_id: settlementIds[0] || null,
            payout_batch_id: payoutBatchIds[0] || null,
            reference_ids: referenceIds,
            event_ids: eventIds,
        });
    });

    rows.forEach((row) => {
        const disputeId = disputeIdByRowId.get(row.id);
        if (!disputeId) return;
        proofByRowId.set(row.id, proofByDisputeId.get(disputeId) || {
            settlement_id: null,
            payout_batch_id: null,
            reference_ids: [],
            event_ids: [],
        });
    });

    return proofByRowId;
}

// Get raw billing transactions
router.get('/transactions', async (req, res) => {
    try {
        const { userId, tenantId } = await resolveBillingScope(req);
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const { data, error, count } = await supabaseAdmin
            .from('billing_transactions')
            .select('*', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const rows = data || [];
        const proofMap = await buildBillingProofMap(rows, tenantId);

        const transactions = rows.map(tx => ({
            id: tx.id,
            recovery_id: tx.recovery_id,
            amount: toOptionalMoney(tx.amount_recovered_cents),
            confirmed_recovered_amount: toOptionalMoney(tx.amount_recovered_cents),
            platform_fee: toOptionalMoney(tx.platform_fee_cents),
            credit_applied: toOptionalMoney(tx.credit_applied_cents),
            amount_due: toOptionalMoney(tx.amount_due_cents),
            credit_balance_remaining: toOptionalMoney(tx.credit_balance_after_cents),
            seller_payout: toOptionalMoney(tx.seller_payout_cents),
            status: normalizeBillingStatus(tx.billing_status),
            paypal_invoice_id: tx.paypal_invoice_id || tx.metadata?.paypal_invoice_id || null,
            created_at: tx.created_at,
            settlement_id: proofMap.get(tx.id)?.settlement_id || null,
            payout_batch_id: proofMap.get(tx.id)?.payout_batch_id || null,
            reference_ids: proofMap.get(tx.id)?.reference_ids || [],
            event_ids: proofMap.get(tx.id)?.event_ids || []
        }));

        res.json({
            success: true,
            transactions,
            total: count
        });
    } catch (error: any) {
        logger.error('Failed to fetch billing transactions', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get billing transactions (invoices)
router.get('/invoices', async (req, res) => {
    try {
        const { userId, tenantId } = await resolveBillingScope(req);
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const { data, error, count } = await supabaseAdmin
            .from('billing_transactions')
            .select('*', { count: 'exact' })
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const rows = data || [];
        const proofMap = await buildBillingProofMap(rows, tenantId);

        // Map transactions to "invoices" format expected by frontend
        const invoices = rows.map(tx => ({
            id: tx.id,
            invoice_id: tx.id, // Use transaction ID as invoice ID
            period_start: null,
            period_end: null,
            total_amount: toOptionalMoney(tx.amount_recovered_cents),
            confirmed_recovered_amount: toOptionalMoney(tx.amount_recovered_cents),
            platform_fee: toOptionalMoney(tx.platform_fee_cents),
            credit_applied: toOptionalMoney(tx.credit_applied_cents),
            commission: toOptionalMoney(tx.platform_fee_cents),
            amount_due: toOptionalMoney(tx.amount_due_cents),
            amount_charged: deriveChargedAmount(tx.billing_status, tx.amount_due_cents),
            available_credit_balance: toOptionalMoney(tx.credit_balance_after_cents),
            status: normalizeBillingStatus(tx.billing_status),
            created_at: tx.created_at,
            recovery_claim_ids: tx.recovery_id ? [tx.recovery_id] : [],
            paypal_invoice_id: tx.paypal_invoice_id || tx.metadata?.paypal_invoice_id || null,
            settlement_id: proofMap.get(tx.id)?.settlement_id || null,
            payout_batch_id: proofMap.get(tx.id)?.payout_batch_id || null,
            reference_ids: proofMap.get(tx.id)?.reference_ids || [],
            event_ids: proofMap.get(tx.id)?.event_ids || []
        }));

        res.json({
            success: true,
            invoices,
            total: count
        });
    } catch (error: any) {
        logger.error('Failed to fetch billing invoices', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get billing status summary
router.get('/status', async (req, res) => {
    try {
        const { userId, tenantId } = await resolveBillingScope(req);

        // Calculate totals
        const { data, error } = await supabaseAdmin
            .from('billing_transactions')
            .select('amount_recovered_cents, platform_fee_cents, credit_applied_cents, amount_due_cents, credit_balance_after_cents, billing_status, created_at')
            .eq('tenant_id', tenantId)
            .eq('user_id', userId);

        if (error) throw error;

        const rows = data || [];
        const totalRecovered = Number((rows.reduce((sum, tx) => sum + Number(tx.amount_recovered_cents || 0), 0) / 100).toFixed(2));
        const totalFees = Number((rows.reduce((sum, tx) => sum + Number(tx.platform_fee_cents || 0), 0) / 100).toFixed(2));
        const totalCreditApplied = Number((rows.reduce((sum, tx) => sum + Number(tx.credit_applied_cents || 0), 0) / 100).toFixed(2));
        const outstandingStatuses = ['pending', 'sent', 'due', 'overdue'];
        const totalAmountDue = Number((rows
            .filter(tx => outstandingStatuses.includes(String(tx.billing_status || '').toLowerCase()))
            .reduce((sum, tx) => sum + Number(tx.amount_due_cents || 0), 0) / 100).toFixed(2));
        const pendingBilling = Number((rows
            .filter(tx => outstandingStatuses.includes(String(tx.billing_status || '').toLowerCase()))
            .reduce((sum, tx) => sum + Number(tx.amount_due_cents || 0), 0) / 100).toFixed(2));
        const { data: creditLedger } = await supabaseAdmin
            .from('billing_credit_ledger')
            .select('transaction_type, amount_cents')
            .eq('tenant_id', tenantId)
            .or(`user_id.eq.${userId},seller_id.eq.${userId}`);

        const { data: currentCycle } = await supabaseAdmin
            .from('recovery_cycles')
            .select('id, cycle_type, created_at')
            .eq('tenant_id', tenantId)
            .or(`user_id.eq.${userId},seller_id.eq.${userId}`)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const availableCreditBalance = ((creditLedger || []).reduce((balance, row) => {
            if (row.transaction_type === 'credit_added') return balance + (row.amount_cents || 0);
            if (row.transaction_type === 'credit_applied') return Math.max(0, balance - (row.amount_cents || 0));
            return balance;
        }, 0)) / 100;
        const lastBillingDate = rows
            .map(tx => tx.created_at)
            .filter(Boolean)
            .sort()
            .reverse()[0];

        res.json({
            success: true,
            status: {
                total_recovered: totalRecovered,
                total_fees: totalFees,
                total_credit_applied: totalCreditApplied,
                total_amount_due: totalAmountDue,
                pending_billing: pendingBilling,
                available_credit_balance: availableCreditBalance,
                last_billing_date: lastBillingDate,
                last_payout_date: null,
                payout_count: null,
                current_recovery_cycle_id: currentCycle?.id || null,
                current_recovery_cycle_type: currentCycle?.cycle_type || null,
                current_recovery_cycle_started_at: currentCycle?.created_at || null
            }
        });

    } catch (error: any) {
        logger.error('Failed to fetch billing status', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Download invoice as PDF
router.get('/invoices/:invoiceId/pdf', async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { userId, tenantId } = await resolveBillingScope(req);

        if (!invoiceId) {
            return res.status(400).json({ success: false, error: 'Invoice ID required' });
        }

        logger.info('[BILLING] Generating PDF invoice', { invoiceId, userId });

        const pdfBuffer = await invoicePdfService.generateInvoicePdf(invoiceId, userId, tenantId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);

    } catch (error: any) {
        logger.error('Failed to generate invoice PDF', { error: error.message, invoiceId: req.params.invoiceId });
        res.status(500).json({ success: false, error: 'Failed to generate invoice PDF' });
    }
});

export default router;
