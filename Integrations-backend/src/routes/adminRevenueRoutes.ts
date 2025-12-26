import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';

const router = Router();

// Opside fee percentage (configurable)
const OPSIDE_FEE_PERCENTAGE = 0.20; // 20%

interface RevenueMetrics {
  totalRecovered: number;
  opsideRevenue: number;
  totalClaims: number;
  approvedClaims: number;
  pendingClaims: number;
  deniedClaims: number;
  approvalRate: number;
  averageClaimValue: number;
  revenueByMonth: { month: string; revenue: number; recovered: number; claims: number }[];
  revenueByCustomer: { seller_id: string; email?: string; revenue: number; recovered: number; claims: number }[];
  revenueByClaimType: { type: string; revenue: number; recovered: number; claims: number }[];
  last30Days: {
    revenue: number;
    recovered: number;
    claims: number;
    approvedClaims: number;
  };
  // Investor metrics
  mrrGrowth: number; // Month-over-month growth %
  currentMrr: number;
  previousMrr: number;
  activeCustomers: number;
  avgRevenuePerCustomer: number;
}

/**
 * GET /api/admin/revenue
 * Get comprehensive revenue metrics for Opside
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    console.log('[AdminRevenue] Fetching revenue metrics...');

    // Fetch all dispute cases
    const { data: allCases, error: allError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, status, claim_amount, seller_id, created_at');

    if (allError) {
      throw allError;
    }

    const cases = allCases || [];

    // Calculate overall metrics
    const approvedStatuses = ['approved', 'paid', 'reconciled'];
    const pendingStatuses = ['pending', 'submitted', 'in_progress', 'filing'];
    const deniedStatuses = ['denied', 'rejected', 'failed'];

    const totalClaims = cases.length;
    const approvedCases = cases.filter(c => approvedStatuses.includes((c.status || '').toLowerCase()));
    const pendingCases = cases.filter(c => pendingStatuses.includes((c.status || '').toLowerCase()));
    const deniedCases = cases.filter(c => deniedStatuses.includes((c.status || '').toLowerCase()));

    const approvedClaims = approvedCases.length;
    const pendingClaims = pendingCases.length;
    const deniedClaimsCount = deniedCases.length;

    const totalRecovered = approvedCases.reduce((sum, c) => sum + (c.claim_amount || 0), 0);
    const opsideRevenue = totalRecovered * OPSIDE_FEE_PERCENTAGE;
    const approvalRate = totalClaims > 0 ? (approvedClaims / totalClaims) * 100 : 0;
    const averageClaimValue = approvedClaims > 0 ? totalRecovered / approvedClaims : 0;

    // Calculate revenue by month
    const monthlyMap = new Map<string, { claims: number; recovered: number }>();
    for (const c of cases) {
      if (!c.created_at) continue;
      const month = c.created_at.substring(0, 7); // YYYY-MM
      const existing = monthlyMap.get(month) || { claims: 0, recovered: 0 };
      existing.claims++;
      if (approvedStatuses.includes((c.status || '').toLowerCase())) {
        existing.recovered += c.claim_amount || 0;
      }
      monthlyMap.set(month, existing);
    }
    const revenueByMonth = Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        revenue: data.recovered * OPSIDE_FEE_PERCENTAGE,
        recovered: data.recovered,
        claims: data.claims
      }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 12);

    // Calculate MRR growth (compare current month to previous month)
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

    const currentMrr = revenueByMonth.find(m => m.month === currentMonth)?.revenue || 0;
    const previousMrr = revenueByMonth.find(m => m.month === previousMonthStr)?.revenue || 0;
    const mrrGrowth = previousMrr > 0 ? ((currentMrr - previousMrr) / previousMrr) * 100 : 0;

    // Calculate revenue by customer
    const customerMap = new Map<string, { claims: number; recovered: number }>();
    for (const c of cases) {
      if (!c.seller_id) continue;
      const existing = customerMap.get(c.seller_id) || { claims: 0, recovered: 0 };
      existing.claims++;
      if (approvedStatuses.includes((c.status || '').toLowerCase())) {
        existing.recovered += c.claim_amount || 0;
      }
      customerMap.set(c.seller_id, existing);
    }

    const activeCustomers = customerMap.size;
    const avgRevenuePerCustomer = activeCustomers > 0 ? opsideRevenue / activeCustomers : 0;

    const revenueByCustomer = Array.from(customerMap.entries())
      .map(([seller_id, data]) => ({
        seller_id,
        revenue: data.recovered * OPSIDE_FEE_PERCENTAGE,
        recovered: data.recovered,
        claims: data.claims
      }))
      .sort((a, b) => b.recovered - a.recovered)
      .slice(0, 20);

    // Calculate last 30 days metrics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const last30Cases = cases.filter(c => c.created_at && new Date(c.created_at) >= thirtyDaysAgo);
    const last30Approved = last30Cases.filter(c => approvedStatuses.includes((c.status || '').toLowerCase()));
    const last30Recovered = last30Approved.reduce((sum, c) => sum + (c.claim_amount || 0), 0);

    const metrics: RevenueMetrics = {
      totalRecovered,
      opsideRevenue,
      totalClaims,
      approvedClaims,
      pendingClaims,
      deniedClaims: deniedClaimsCount,
      approvalRate,
      averageClaimValue,
      revenueByMonth,
      revenueByCustomer,
      revenueByClaimType: [],
      last30Days: {
        revenue: last30Recovered * OPSIDE_FEE_PERCENTAGE,
        recovered: last30Recovered,
        claims: last30Cases.length,
        approvedClaims: last30Approved.length
      },
      // Investor metrics
      mrrGrowth,
      currentMrr,
      previousMrr,
      activeCustomers,
      avgRevenuePerCustomer
    };

    console.log('[AdminRevenue] Metrics calculated:', {
      totalRecovered,
      opsideRevenue,
      totalClaims,
      approvedClaims,
      mrrGrowth,
      activeCustomers
    });

    res.json({
      ok: true,
      data: metrics,
      feePercentage: OPSIDE_FEE_PERCENTAGE * 100
    });
  } catch (error: any) {
    console.error('[AdminRevenue] Error:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to fetch revenue metrics'
    });
  }
});

export default router;
