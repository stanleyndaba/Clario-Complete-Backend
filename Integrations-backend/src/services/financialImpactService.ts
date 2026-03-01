/**
 * Financial Impact Ledger Service
 * 
 * Tracks financial impact across the entire recovery lifecycle:
 * - Per detection: estimated → filed → approved → paid → failed
 * - Per user: total_found, total_pending, total_collected, ROI
 * 
 * Emits real-time SSE events for live dashboard updates.
 */

import { supabaseAdmin } from '../database/supabaseClient';
import sseHub from '../utils/sseHub';
import logger from '../utils/logger';
import cacheService from './cacheService';

// Impact status lifecycle
export enum ImpactStatus {
    DETECTED = 'detected',      // Discrepancy found
    FILED = 'filed',            // Claim submitted
    APPROVED = 'approved',      // Amazon approved
    PAID = 'paid',              // Funds received
    FAILED = 'failed',          // Claim rejected/failed
    EXPIRED = 'expired'         // Window closed
}

// Financial impact event structure
export interface FinancialImpactEvent {
    userId: string;
    tenantId?: string;
    detectionId: string;
    claimId?: string;
    status: ImpactStatus;
    estimatedAmount: number;
    confirmedAmount?: number;
    currency: string;
    confidence: number;
    anomalyType: string;
    timestamp: string;
}

// User aggregate metrics
export interface UserFinancialMetrics {
    userId: string;
    totalFound: number;         // All detected discrepancies ($)
    totalPending: number;       // Filed, awaiting decision ($)
    totalApproved: number;      // Approved, awaiting payout ($)
    totalCollected: number;     // Actually paid ($)
    totalFailed: number;        // Rejected/failed ($)
    claimsDetected: number;     // Count
    claimsFiled: number;        // Count
    claimsApproved: number;     // Count
    claimsPaid: number;         // Count
    claimsFailed: number;       // Count
    avgConfidence: number;      // Average detection confidence
    roiMultiple: number;        // Collected / Platform Fee
    updatedAt: string;
}

// Dashboard-specific recovery metrics
export interface DashboardRecoveryMetrics {
    today: number;
    todayGrowth: number;
    thisWeek: number;
    thisWeekGrowth: number;
    thisMonth: number;
    thisMonthGrowth: number;
    currency: string;
    updatedAt: string;
}

class FinancialImpactService {
    private readonly CACHE_TTL = 30; // 30 seconds for real-time feel

    /**
     * Record a financial impact event and emit SSE update
     */
    async recordImpact(event: FinancialImpactEvent): Promise<void> {
        const startTime = Date.now();

        try {
            // 1. Store in database
            const { error } = await supabaseAdmin
                .from('financial_impact_events')
                .upsert({
                    detection_id: event.detectionId,
                    claim_id: event.claimId,
                    user_id: event.userId,
                    tenant_id: event.tenantId,
                    status: event.status,
                    estimated_amount: event.estimatedAmount,
                    confirmed_amount: event.confirmedAmount,
                    currency: event.currency,
                    confidence: event.confidence,
                    anomaly_type: event.anomalyType,
                    created_at: event.timestamp,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'detection_id'
                });

            if (error) {
                logger.warn('[IMPACT] Failed to store event (table may not exist)', {
                    error: error.message,
                    detectionId: event.detectionId
                });
                // Continue - we still want to emit SSE
            }

            // 2. Invalidate user cache
            await cacheService.invalidateUserCaches(event.userId, event.tenantId);
            await cacheService.del(`impact:dashboard:${event.tenantId || 'default'}:${event.userId}`);

            // 3. Emit real-time SSE event
            this.emitImpactEvent(event);

            // 4. Log for observability
            logger.info('[IMPACT] Financial event recorded', {
                userId: event.userId,
                status: event.status,
                amount: event.estimatedAmount,
                duration: Date.now() - startTime
            });

        } catch (error: any) {
            logger.error('[IMPACT] Failed to record impact', {
                error: error.message,
                detectionId: event.detectionId
            });
            // Still emit SSE even if DB fails
            this.emitImpactEvent(event);
        }
    }

    /**
     * Emit real-time SSE event for financial impact
     */
    private emitImpactEvent(event: FinancialImpactEvent): void {
        const ssePayload = {
            type: 'financial_impact',
            data: {
                detectionId: event.detectionId,
                status: event.status,
                amount: event.confirmedAmount || event.estimatedAmount,
                currency: event.currency,
                confidence: event.confidence,
                anomalyType: event.anomalyType,
                message: this.getStatusMessage(event)
            },
            timestamp: event.timestamp
        };

        sseHub.sendEvent(event.userId, 'impact', ssePayload);

        // Also send as generic message for backward compatibility
        sseHub.sendEvent(event.userId, 'message', ssePayload);
    }

    /**
     * Get user-friendly status message
     */
    private getStatusMessage(event: FinancialImpactEvent): string {
        const amount = this.formatCurrency(event.confirmedAmount || event.estimatedAmount, event.currency);

        switch (event.status) {
            case ImpactStatus.DETECTED:
                return `Detected ${amount} potential recovery opportunity`;
            case ImpactStatus.FILED:
                return `Filed claim for ${amount}`;
            case ImpactStatus.APPROVED:
                return `Amazon approved ${amount} claim`;
            case ImpactStatus.PAID:
                return `${amount} deposited to your account`;
            case ImpactStatus.FAILED:
                return `Claim for ${amount} was rejected`;
            case ImpactStatus.EXPIRED:
                return `Claim window expired for ${amount}`;
            default:
                return `Financial impact update: ${amount}`;
        }
    }

    /**
     * Format currency for display
     */
    private formatCurrency(amount: number, currency: string = 'USD'): string {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency
        }).format(amount);
    }

    /**
     * Get extended recovery metrics for the dashboard (Today, 7D, 30D + Growth)
     */
    async getRecoveryMetricsExtended(userId: string, tenantId?: string): Promise<DashboardRecoveryMetrics> {
        const cacheKey = `impact:dashboard:${tenantId || 'default'}:${userId}`;

        // Cache for 10 minutes for dashboard performance, but SSE will push updates
        const cached = await cacheService.get<DashboardRecoveryMetrics>(cacheKey);
        if (cached) return cached;

        try {
            // Get all resolved dispute cases for this user
            // We use resolution_date to determine when the recovery actually happened
            const { data: disputes } = await supabaseAdmin
                .from('dispute_cases')
                .select('claim_amount, resolution_amount, resolution_date, status')
                .eq('user_id', userId)
                .in('status', ['approved', 'paid', 'reconciled']);

            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

            const startOfThisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const startOfLastWeek = new Date(startOfThisWeek.getTime() - 7 * 24 * 60 * 60 * 1000);

            const startOfThisMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const startOfLastMonth = new Date(startOfThisMonth.getTime() - 30 * 24 * 60 * 60 * 1000);

            const metrics: DashboardRecoveryMetrics = {
                today: 0,
                todayGrowth: 0,
                thisWeek: 0,
                thisWeekGrowth: 0,
                thisMonth: 0,
                thisMonthGrowth: 0,
                currency: 'USD',
                updatedAt: now.toISOString()
            };

            let yesterdayAmount = 0;
            let lastWeekAmount = 0;
            let lastMonthAmount = 0;

            if (disputes && disputes.length > 0) {
                for (const d of disputes) {
                    const resDate = d.resolution_date ? new Date(d.resolution_date) : null;
                    if (!resDate) continue;

                    const amount = parseFloat(String(d.resolution_amount || d.claim_amount || 0));

                    // Today
                    if (resDate >= startOfToday) {
                        metrics.today += amount;
                    }
                    // Yesterday (for growth)
                    else if (resDate >= startOfYesterday && resDate < startOfToday) {
                        yesterdayAmount += amount;
                    }

                    // This Week
                    if (resDate >= startOfThisWeek) {
                        metrics.thisWeek += amount;
                    }
                    // Last Week (for growth)
                    else if (resDate >= startOfLastWeek && resDate < startOfThisWeek) {
                        lastWeekAmount += amount;
                    }

                    // This Month
                    if (resDate >= startOfThisMonth) {
                        metrics.thisMonth += amount;
                    }
                    // Last Month (for growth)
                    else if (resDate >= startOfLastMonth && resDate < startOfThisMonth) {
                        lastMonthAmount += amount;
                    }
                }
            }

            // Calculate growth percentages
            metrics.todayGrowth = yesterdayAmount > 0 ? ((metrics.today - yesterdayAmount) / yesterdayAmount) * 100 : 0;
            metrics.thisWeekGrowth = lastWeekAmount > 0 ? ((metrics.thisWeek - lastWeekAmount) / lastWeekAmount) * 100 : 0;
            metrics.thisMonthGrowth = lastMonthAmount > 0 ? ((metrics.thisMonth - lastMonthAmount) / lastMonthAmount) * 100 : 0;

            // Round to 1 decimal place
            metrics.todayGrowth = parseFloat(metrics.todayGrowth.toFixed(1));
            metrics.thisWeekGrowth = parseFloat(metrics.thisWeekGrowth.toFixed(1));
            metrics.thisMonthGrowth = parseFloat(metrics.thisMonthGrowth.toFixed(1));

            // Cache result
            await cacheService.set(cacheKey, metrics, 600); // 10 minutes

            return metrics;
        } catch (error: any) {
            logger.error('[IMPACT] Failed to calculate dashboard metrics', { userId, error: error.message });
            return {
                today: 0, todayGrowth: 0,
                thisWeek: 0, thisWeekGrowth: 0,
                thisMonth: 0, thisMonthGrowth: 0,
                currency: 'USD',
                updatedAt: new Date().toISOString()
            };
        }
    }

    /**
     * Get aggregated financial metrics for a user
     */
    async getUserMetrics(userId: string, tenantId?: string): Promise<UserFinancialMetrics> {
        const cacheKey = `impact:metrics:${tenantId || 'default'}:${userId}`;

        // Check cache first
        const cached = await cacheService.get<UserFinancialMetrics>(cacheKey);
        if (cached) {
            logger.debug('[IMPACT] Metrics cache HIT', { userId });
            return cached;
        }

        // Calculate from database
        try {
            // Get detection_results aggregates
            const { data: detections } = await supabaseAdmin
                .from('detection_results')
                .select('id, estimated_value, confidence_score, status')
                .eq('seller_id', userId);

            // Get dispute_cases aggregates  
            const { data: disputes } = await supabaseAdmin
                .from('dispute_cases')
                .select('id, claim_amount, actual_payout_amount, status')
                .eq('user_id', userId);

            const metrics: UserFinancialMetrics = {
                userId,
                totalFound: 0,
                totalPending: 0,
                totalApproved: 0,
                totalCollected: 0,
                totalFailed: 0,
                claimsDetected: 0,
                claimsFiled: 0,
                claimsApproved: 0,
                claimsPaid: 0,
                claimsFailed: 0,
                avgConfidence: 0,
                roiMultiple: 0,
                updatedAt: new Date().toISOString()
            };

            // Process detections
            if (detections && detections.length > 0) {
                metrics.claimsDetected = detections.length;
                metrics.totalFound = detections.reduce((sum, d) => sum + (d.estimated_value || 0), 0);
                metrics.avgConfidence = detections.reduce((sum, d) => sum + (d.confidence_score || 0), 0) / detections.length;
            }

            // Process disputes
            if (disputes && disputes.length > 0) {
                for (const d of disputes) {
                    const status = (d.status || '').toLowerCase();
                    const amount = d.claim_amount || 0;
                    const payout = d.actual_payout_amount || 0;

                    if (status === 'submitted' || status === 'pending' || status === 'filed') {
                        metrics.claimsFiled++;
                        metrics.totalPending += amount;
                    } else if (status === 'approved') {
                        metrics.claimsApproved++;
                        metrics.totalApproved += amount;
                    } else if (status === 'paid' || status === 'reconciled') {
                        metrics.claimsPaid++;
                        metrics.totalCollected += payout || amount;
                    } else if (status === 'rejected' || status === 'denied' || status === 'failed') {
                        metrics.claimsFailed++;
                        metrics.totalFailed += amount;
                    }
                }
            }

            // Calculate ROI multiple (collected / assumed 15% fee)
            const estimatedFee = metrics.totalCollected * 0.15;
            metrics.roiMultiple = estimatedFee > 0 ? metrics.totalCollected / estimatedFee : 0;

            // Cache result
            await cacheService.set(cacheKey, metrics, this.CACHE_TTL);

            logger.debug('[IMPACT] Metrics calculated', {
                userId,
                totalFound: metrics.totalFound,
                totalCollected: metrics.totalCollected
            });

            return metrics;

        } catch (error: any) {
            logger.error('[IMPACT] Failed to get user metrics', { userId, error: error.message });

            // Return empty metrics on error
            return {
                userId,
                totalFound: 0,
                totalPending: 0,
                totalApproved: 0,
                totalCollected: 0,
                totalFailed: 0,
                claimsDetected: 0,
                claimsFiled: 0,
                claimsApproved: 0,
                claimsPaid: 0,
                claimsFailed: 0,
                avgConfidence: 0,
                roiMultiple: 0,
                updatedAt: new Date().toISOString()
            };
        }
    }

    /**
     * Emit bulk metrics update (for dashboard hydration)
     */
    async emitMetricsUpdate(userId: string, tenantId?: string): Promise<void> {
        const metrics = await this.getUserMetrics(userId, tenantId);

        sseHub.sendEvent(userId, 'metrics', {
            type: 'financial_metrics',
            data: metrics,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Helper: Record detection event
     */
    async recordDetection(
        userId: string,
        detectionId: string,
        amount: number,
        confidence: number,
        anomalyType: string,
        tenantId?: string
    ): Promise<void> {
        await this.recordImpact({
            userId,
            tenantId,
            detectionId,
            status: ImpactStatus.DETECTED,
            estimatedAmount: amount,
            currency: 'USD',
            confidence,
            anomalyType,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Helper: Record claim filed
     */
    async recordClaimFiled(
        userId: string,
        detectionId: string,
        claimId: string,
        amount: number,
        tenantId?: string
    ): Promise<void> {
        await this.recordImpact({
            userId,
            tenantId,
            detectionId,
            claimId,
            status: ImpactStatus.FILED,
            estimatedAmount: amount,
            currency: 'USD',
            confidence: 1,
            anomalyType: 'claim_filed',
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Helper: Record funds received
     */
    async recordFundsReceived(
        userId: string,
        detectionId: string,
        claimId: string,
        amount: number,
        tenantId?: string
    ): Promise<void> {
        await this.recordImpact({
            userId,
            tenantId,
            detectionId,
            claimId,
            status: ImpactStatus.PAID,
            estimatedAmount: amount,
            confirmedAmount: amount,
            currency: 'USD',
            confidence: 1,
            anomalyType: 'funds_deposited',
            timestamp: new Date().toISOString()
        });
    }
}

// Export singleton
export const financialImpactService = new FinancialImpactService();
export default financialImpactService;
