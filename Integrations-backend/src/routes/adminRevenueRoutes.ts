import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';

const router = Router();

interface RevenueMetrics {
  currentMrr: number;
  previousMrr: number;
  mrrGrowth: number;
  activeCustomers: number;
  avgRevenuePerCustomer: number;
  paidInvoiceRevenue: number;
  pendingInvoiceRevenue: number;
  invoiceCount: number;
  paidInvoiceCount: number;
  pendingInvoiceCount: number;
  planMix: { plan_tier: string; count: number; monthlyEquivalent: number }[];
  revenueByMonth: { month: string; revenue: number; invoices: number }[];
  legacyRecoveryFeeRevenue: number;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenant?.tenantId;

    let subscriptionQuery = supabaseAdmin
      .from('tenant_billing_subscriptions')
      .select('tenant_id, plan_tier, monthly_price_cents, annual_monthly_equivalent_price_cents, subscription_status');
    let invoiceQuery = supabaseAdmin
      .from('billing_invoices')
      .select('billing_amount_cents, amount_charged_cents, status, invoice_date, invoice_model');
    let legacyQuery = supabaseAdmin
      .from('billing_transactions')
      .select('amount_due_cents');

    if (tenantId) {
      subscriptionQuery = subscriptionQuery.eq('tenant_id', tenantId);
      invoiceQuery = invoiceQuery.eq('tenant_id', tenantId);
      legacyQuery = legacyQuery.eq('tenant_id', tenantId);
    }

    const [{ data: subscriptions, error: subscriptionError }, { data: invoices, error: invoiceError }, { data: legacyRows, error: legacyError }] = await Promise.all([
      subscriptionQuery,
      invoiceQuery,
      legacyQuery,
    ]);

    if (subscriptionError) throw subscriptionError;
    if (invoiceError) throw invoiceError;
    if (legacyError) throw legacyError;

    const subscriptionRows = subscriptions || [];
    const invoiceRows = invoices || [];
    const activeStatuses = new Set(['active', 'trialing', 'past_due']);
    const pendingStatuses = new Set(['draft', 'scheduled', 'pending_payment_method', 'sent']);
    const paidStatuses = new Set(['paid']);

    const activeSubscriptions = subscriptionRows.filter((row: any) => activeStatuses.has(String(row.subscription_status || '').toLowerCase()));
    const currentMrr = activeSubscriptions.reduce((sum: number, row: any) => {
      const amount = row.plan_tier && String(row.plan_tier) === 'enterprise'
        ? Number(row.monthly_price_cents || 0)
        : Number(row.annual_monthly_equivalent_price_cents || row.monthly_price_cents || 0);
      return sum + (amount / 100);
    }, 0);

    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const previousMonthKey = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`;

    const monthlyRevenueMap = new Map<string, { revenue: number; invoices: number }>();
    for (const row of invoiceRows) {
      if (row.invoice_model !== 'subscription' || !row.invoice_date) continue;
      const month = String(row.invoice_date).slice(0, 7);
      const current = monthlyRevenueMap.get(month) || { revenue: 0, invoices: 0 };
      const revenue = paidStatuses.has(String(row.status || '').toLowerCase())
        ? Number(row.amount_charged_cents || 0) / 100
        : Number(row.billing_amount_cents || 0) / 100;
      current.revenue += revenue;
      current.invoices += 1;
      monthlyRevenueMap.set(month, current);
    }

    const revenueByMonth = Array.from(monthlyRevenueMap.entries())
      .map(([month, data]) => ({ month, revenue: Number(data.revenue.toFixed(2)), invoices: data.invoices }))
      .sort((left, right) => right.month.localeCompare(left.month))
      .slice(0, 12);

    const currentMonthRevenue = revenueByMonth.find((row) => row.month === currentMonthKey)?.revenue || 0;
    const previousMonthRevenue = revenueByMonth.find((row) => row.month === previousMonthKey)?.revenue || 0;
    const mrrGrowth = previousMonthRevenue > 0
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
      : 0;

    const planMap = new Map<string, { count: number; monthlyEquivalent: number }>();
    activeSubscriptions.forEach((row: any) => {
      const key = String(row.plan_tier || 'unknown');
      const current = planMap.get(key) || { count: 0, monthlyEquivalent: 0 };
      current.count += 1;
      current.monthlyEquivalent += Number(row.annual_monthly_equivalent_price_cents || row.monthly_price_cents || 0) / 100;
      planMap.set(key, current);
    });

    const paidInvoiceRevenue = invoiceRows
      .filter((row: any) => row.invoice_model === 'subscription' && paidStatuses.has(String(row.status || '').toLowerCase()))
      .reduce((sum: number, row: any) => sum + Number(row.amount_charged_cents || 0), 0) / 100;
    const pendingInvoiceRevenue = invoiceRows
      .filter((row: any) => row.invoice_model === 'subscription' && pendingStatuses.has(String(row.status || '').toLowerCase()))
      .reduce((sum: number, row: any) => sum + Number(row.billing_amount_cents || 0), 0) / 100;
    const invoiceCount = invoiceRows.filter((row: any) => row.invoice_model === 'subscription').length;
    const paidInvoiceCount = invoiceRows.filter((row: any) => row.invoice_model === 'subscription' && paidStatuses.has(String(row.status || '').toLowerCase())).length;
    const pendingInvoiceCount = invoiceRows.filter((row: any) => row.invoice_model === 'subscription' && pendingStatuses.has(String(row.status || '').toLowerCase())).length;
    const legacyRecoveryFeeRevenue = (legacyRows || []).reduce((sum: number, row: any) => sum + Number(row.amount_due_cents || 0), 0) / 100;

    const metrics: RevenueMetrics = {
      currentMrr: Number(currentMrr.toFixed(2)),
      previousMrr: Number(previousMonthRevenue.toFixed(2)),
      mrrGrowth: Number(mrrGrowth.toFixed(2)),
      activeCustomers: activeSubscriptions.length,
      avgRevenuePerCustomer: activeSubscriptions.length > 0 ? Number((currentMrr / activeSubscriptions.length).toFixed(2)) : 0,
      paidInvoiceRevenue: Number(paidInvoiceRevenue.toFixed(2)),
      pendingInvoiceRevenue: Number(pendingInvoiceRevenue.toFixed(2)),
      invoiceCount,
      paidInvoiceCount,
      pendingInvoiceCount,
      planMix: Array.from(planMap.entries()).map(([plan_tier, data]) => ({
        plan_tier,
        count: data.count,
        monthlyEquivalent: Number(data.monthlyEquivalent.toFixed(2)),
      })),
      revenueByMonth,
      legacyRecoveryFeeRevenue: Number(legacyRecoveryFeeRevenue.toFixed(2)),
    };

    res.json({
      ok: true,
      data: metrics,
      billing_model: 'flat_subscription',
      note: 'Revenue metrics now reflect subscription billing. Legacy recovery-fee totals are shown separately for historical reference only.',
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to fetch revenue metrics',
    });
  }
});

export default router;
