/**
 * Policy Window Manager
 * 
 * Tracks Amazon's claim deadline windows with precision.
 * 
 * Key Windows:
 * - Standard claims: 60 days from discovery
 * - Inbound shipments: 9 months from delivery
 * - Removal orders: 90 days from shipment
 * - A-to-Z claims: 7-30 days response window
 * 
 * Features:
 * - Precise deadline calculation
 * - Business day awareness
 * - Grace period handling
 * - Expiration alerts
 * - Safe filing window detection
 */

import { supabaseAdmin } from '../../database/supabaseClient';
import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type ClaimType =
    | 'lost_inventory'
    | 'damaged_inventory'
    | 'inbound_shipment'
    | 'fee_overcharge'
    | 'customer_return'
    | 'removal_order'
    | 'atoz_claim'
    | 'chargeback'
    | 'general';

export interface PolicyWindow {
    claim_type: ClaimType;
    discovery_date: Date;
    deadline_date: Date;
    days_remaining: number;
    business_days_remaining: number;
    is_expired: boolean;
    is_urgent: boolean;      // < 7 days remaining
    is_safe: boolean;        // > 14 days remaining
    grace_period_days: number;
    filing_recommendation: 'file_now' | 'file_soon' | 'safe_to_wait' | 'expired';
}

export interface WindowConfig {
    standard_days: number;
    grace_period_days: number;
    business_days_only: boolean;
    urgent_threshold_days: number;
    safe_threshold_days: number;
}

export interface ClaimWindowStatus {
    claim_id: string;
    seller_id: string;
    claim_type: ClaimType;
    window: PolicyWindow;
    can_file: boolean;
    should_file_by: Date;
    alert_level: 'none' | 'info' | 'warning' | 'critical';
    alert_message?: string;
}

// ============================================================================
// Policy Configuration by Claim Type
// ============================================================================

const POLICY_WINDOWS: Record<ClaimType, WindowConfig> = {
    'lost_inventory': {
        standard_days: 60,
        grace_period_days: 3,
        business_days_only: false,
        urgent_threshold_days: 7,
        safe_threshold_days: 14
    },
    'damaged_inventory': {
        standard_days: 60,
        grace_period_days: 3,
        business_days_only: false,
        urgent_threshold_days: 7,
        safe_threshold_days: 14
    },
    'inbound_shipment': {
        standard_days: 270, // 9 months
        grace_period_days: 7,
        business_days_only: false,
        urgent_threshold_days: 14,
        safe_threshold_days: 30
    },
    'fee_overcharge': {
        standard_days: 90,
        grace_period_days: 5,
        business_days_only: false,
        urgent_threshold_days: 10,
        safe_threshold_days: 21
    },
    'customer_return': {
        standard_days: 45,
        grace_period_days: 2,
        business_days_only: false,
        urgent_threshold_days: 5,
        safe_threshold_days: 10
    },
    'removal_order': {
        standard_days: 90,
        grace_period_days: 5,
        business_days_only: false,
        urgent_threshold_days: 10,
        safe_threshold_days: 21
    },
    'atoz_claim': {
        standard_days: 7, // Initial response window
        grace_period_days: 0,
        business_days_only: true,
        urgent_threshold_days: 2,
        safe_threshold_days: 3
    },
    'chargeback': {
        standard_days: 15,
        grace_period_days: 1,
        business_days_only: true,
        urgent_threshold_days: 3,
        safe_threshold_days: 7
    },
    'general': {
        standard_days: 60,
        grace_period_days: 3,
        business_days_only: false,
        urgent_threshold_days: 7,
        safe_threshold_days: 14
    }
};

// ============================================================================
// Business Day Calculations
// ============================================================================

/**
 * US Federal Holidays (approximate - should be maintained)
 */
const US_HOLIDAYS_2025 = [
    '2025-01-01', // New Year's Day
    '2025-01-20', // MLK Day
    '2025-02-17', // Presidents Day
    '2025-05-26', // Memorial Day
    '2025-06-19', // Juneteenth
    '2025-07-04', // Independence Day
    '2025-09-01', // Labor Day
    '2025-10-13', // Columbus Day
    '2025-11-11', // Veterans Day
    '2025-11-27', // Thanksgiving
    '2025-12-25', // Christmas
];

function isBusinessDay(date: Date): boolean {
    const day = date.getDay();
    if (day === 0 || day === 6) return false; // Weekend

    const dateStr = date.toISOString().substring(0, 10);
    return !US_HOLIDAYS_2025.includes(dateStr);
}

function addBusinessDays(startDate: Date, days: number): Date {
    const result = new Date(startDate);
    let added = 0;

    while (added < days) {
        result.setDate(result.getDate() + 1);
        if (isBusinessDay(result)) {
            added++;
        }
    }

    return result;
}

function countBusinessDays(startDate: Date, endDate: Date): number {
    let count = 0;
    const current = new Date(startDate);

    while (current < endDate) {
        current.setDate(current.getDate() + 1);
        if (isBusinessDay(current)) {
            count++;
        }
    }

    return count;
}

// ============================================================================
// Window Calculation
// ============================================================================

/**
 * Calculate the policy window for a claim
 */
export function calculatePolicyWindow(
    claimType: ClaimType,
    discoveryDate: Date | string
): PolicyWindow {
    const discovery = typeof discoveryDate === 'string' ? new Date(discoveryDate) : discoveryDate;
    const config = POLICY_WINDOWS[claimType] || POLICY_WINDOWS.general;

    // Calculate deadline
    let deadline: Date;
    if (config.business_days_only) {
        deadline = addBusinessDays(discovery, config.standard_days);
    } else {
        deadline = new Date(discovery);
        deadline.setDate(deadline.getDate() + config.standard_days);
    }

    // Calculate days remaining
    const now = new Date();
    const calendarDaysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const businessDaysRemaining = countBusinessDays(now, deadline);

    const isExpired = calendarDaysRemaining < 0;
    const isUrgent = !isExpired && calendarDaysRemaining <= config.urgent_threshold_days;
    const isSafe = !isExpired && calendarDaysRemaining > config.safe_threshold_days;

    let recommendation: 'file_now' | 'file_soon' | 'safe_to_wait' | 'expired';
    if (isExpired) {
        recommendation = 'expired';
    } else if (isUrgent) {
        recommendation = 'file_now';
    } else if (!isSafe) {
        recommendation = 'file_soon';
    } else {
        recommendation = 'safe_to_wait';
    }

    return {
        claim_type: claimType,
        discovery_date: discovery,
        deadline_date: deadline,
        days_remaining: Math.max(0, calendarDaysRemaining),
        business_days_remaining: Math.max(0, businessDaysRemaining),
        is_expired: isExpired,
        is_urgent: isUrgent,
        is_safe: isSafe,
        grace_period_days: config.grace_period_days,
        filing_recommendation: recommendation
    };
}

/**
 * Get claim window status with alerts
 */
export function getClaimWindowStatus(
    claimId: string,
    sellerId: string,
    claimType: ClaimType,
    discoveryDate: Date | string
): ClaimWindowStatus {
    const window = calculatePolicyWindow(claimType, discoveryDate);

    let alertLevel: 'none' | 'info' | 'warning' | 'critical' = 'none';
    let alertMessage: string | undefined;

    if (window.is_expired) {
        alertLevel = 'critical';
        alertMessage = `Claim expired ${Math.abs(window.days_remaining)} days ago. Filing may hurt account trust.`;
    } else if (window.is_urgent) {
        alertLevel = 'critical';
        alertMessage = `Only ${window.days_remaining} days remaining! File immediately.`;
    } else if (!window.is_safe) {
        alertLevel = 'warning';
        alertMessage = `${window.days_remaining} days until deadline. Prioritize this claim.`;
    } else if (window.days_remaining <= 30) {
        alertLevel = 'info';
        alertMessage = `${window.days_remaining} days remaining. Safe to file when ready.`;
    }

    const shouldFileBy = new Date(window.deadline_date);
    shouldFileBy.setDate(shouldFileBy.getDate() - (window.is_safe ? 7 : 3)); // Safety buffer

    return {
        claim_id: claimId,
        seller_id: sellerId,
        claim_type: claimType,
        window,
        can_file: !window.is_expired,
        should_file_by: shouldFileBy,
        alert_level: alertLevel,
        alert_message: alertMessage
    };
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Check expiration status for all pending claims
 */
export async function checkExpiringClaims(sellerId: string): Promise<{
    urgent: ClaimWindowStatus[];
    expiring_soon: ClaimWindowStatus[];
    expired: ClaimWindowStatus[];
    safe: ClaimWindowStatus[];
}> {
    const results = {
        urgent: [] as ClaimWindowStatus[],
        expiring_soon: [] as ClaimWindowStatus[],
        expired: [] as ClaimWindowStatus[],
        safe: [] as ClaimWindowStatus[]
    };

    try {
        // Get all pending detection results
        const { data: claims, error } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('status', 'pending')
            .limit(1000);

        if (error || !claims?.length) {
            return results;
        }

        for (const claim of claims) {
            const claimType = mapAnomalyToClaimType(claim.anomaly_type);
            const discoveryDate = claim.discovery_date || claim.created_at;

            const status = getClaimWindowStatus(
                claim.id,
                sellerId,
                claimType,
                discoveryDate
            );

            if (status.window.is_expired) {
                results.expired.push(status);
            } else if (status.window.is_urgent) {
                results.urgent.push(status);
            } else if (!status.window.is_safe) {
                results.expiring_soon.push(status);
            } else {
                results.safe.push(status);
            }
        }

        // Sort by urgency
        results.urgent.sort((a, b) => a.window.days_remaining - b.window.days_remaining);
        results.expiring_soon.sort((a, b) => a.window.days_remaining - b.window.days_remaining);

        logger.info('[POLICY WINDOW] Expiration check complete', {
            sellerId,
            urgent: results.urgent.length,
            expiring_soon: results.expiring_soon.length,
            expired: results.expired.length,
            safe: results.safe.length
        });

    } catch (error: any) {
        logger.error('[POLICY WINDOW] Error checking expirations', { sellerId, error: error.message });
    }

    return results;
}

/**
 * Map anomaly type to claim type for window calculation
 */
function mapAnomalyToClaimType(anomalyType: string): ClaimType {
    const mapping: Record<string, ClaimType> = {
        'lost_warehouse': 'lost_inventory',
        'lost_inbound': 'inbound_shipment',
        'missing_unit': 'lost_inventory',
        'damaged_warehouse': 'damaged_inventory',
        'damaged_inbound': 'inbound_shipment',
        'damaged_stock': 'damaged_inventory',
        'weight_fee_overcharge': 'fee_overcharge',
        'fulfillment_fee_error': 'fee_overcharge',
        'storage_overcharge': 'fee_overcharge',
        'commission_overcharge': 'fee_overcharge',
        'refund_no_return': 'customer_return',
        'return_not_restocked': 'customer_return',
        'customer_return': 'customer_return',
        'removal_fee_error': 'removal_order',
        'atoz_claim': 'atoz_claim',
        'chargeback': 'chargeback',
    };

    return mapping[anomalyType] || 'general';
}

/**
 * Send expiration alerts for claims approaching deadline
 */
export async function sendExpirationAlerts(sellerId: string): Promise<number> {
    const expirationStatus = await checkExpiringClaims(sellerId);
    let alertsSent = 0;

    // Mark urgent claims with expiration alert
    for (const claim of [...expirationStatus.urgent, ...expirationStatus.expiring_soon]) {
        try {
            await supabaseAdmin
                .from('detection_results')
                .update({
                    expiration_alert_sent: true,
                    days_remaining: claim.window.days_remaining,
                    deadline_date: claim.window.deadline_date.toISOString()
                })
                .eq('id', claim.claim_id);

            alertsSent++;
        } catch (error: any) {
            logger.warn('[POLICY WINDOW] Failed to update claim alert', { claimId: claim.claim_id });
        }
    }

    // Mark expired claims
    for (const claim of expirationStatus.expired) {
        try {
            await supabaseAdmin
                .from('detection_results')
                .update({
                    expired: true,
                    status: 'expired'
                })
                .eq('id', claim.claim_id);
        } catch (error: any) {
            logger.warn('[POLICY WINDOW] Failed to mark claim expired', { claimId: claim.claim_id });
        }
    }

    logger.info('[POLICY WINDOW] Alerts sent', { sellerId, alertsSent, expired: expirationStatus.expired.length });
    return alertsSent;
}

export default {
    calculatePolicyWindow,
    getClaimWindowStatus,
    checkExpiringClaims,
    sendExpirationAlerts,
    isBusinessDay,
    addBusinessDays,
    countBusinessDays
};
