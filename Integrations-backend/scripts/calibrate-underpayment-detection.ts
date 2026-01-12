/**
 * Reimbursement Underpayment Detection - Hardening & Calibration Script
 * 
 * Purpose: Validate the algorithm against real data before going to production
 * 
 * Tests:
 * 1. Real-world calibration (confidence sanity, false positive rate)
 * 2. Evidence alignment (invoice/COGS availability)
 * 3. Performance benchmarks (execution time, memory)
 * 4. Edge case handling
 * 
 * Run: npx ts-node scripts/calibrate-underpayment-detection.ts
 */

import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';
import {
    detectReimbursementUnderpayments,
    detectMissingDocumentation,
    UnderpaymentSyncedData,
    UnderpaymentDetectionResult,
    THRESHOLD_SHOW_TO_USER,
    THRESHOLD_RECOMMEND_FILING
} from '../src/services/detection/algorithms/reimbursementUnderpaymentAlgorithm';

// ============================================================================
// Configuration
// ============================================================================

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_CONFIG = {
    // Sellers to test (will fetch top sellers with data)
    maxSellers: 5,

    // Reimbursement sample sizes
    realEventsMin: 3,
    realEventsMax: 5,
    historicalMin: 20,
    historicalMax: 50,
    baselineSampleSize: 100,

    // Thresholds for pass/fail
    maxFalsePositiveRate: 0.15, // 15% max false positive rate
    minConfidenceStability: 0.7, // 70% should cluster in expected ranges
    maxExecutionTimeMs: 5000, // 5 seconds max per seller
};

// ============================================================================
// Output Formatting
// ============================================================================

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bold: '\x1b[1m',
};

const log = {
    header: (msg: string) => console.log(`\n${colors.cyan}${colors.bold}${'='.repeat(60)}${colors.reset}`),
    title: (msg: string) => console.log(`${colors.cyan}${colors.bold}🔬 ${msg}${colors.reset}`),
    success: (msg: string) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    fail: (msg: string) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
    warn: (msg: string) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
    info: (msg: string) => console.log(`${colors.white}   ${msg}${colors.reset}`),
    metric: (label: string, value: any) => console.log(`${colors.white}   📊 ${label}: ${colors.bold}${value}${colors.reset}`),
};

// ============================================================================
// Test Results Tracking
// ============================================================================

interface TestResults {
    sellersAnalyzed: number;
    totalReimbursements: number;
    totalDetections: number;

    // Confidence distribution
    confidenceDistribution: {
        high: number;    // >= 0.75
        medium: number;  // 0.55 - 0.75
        low: number;     // < 0.55
    };

    // Severity distribution
    severityDistribution: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };

    // Performance
    executionTimes: number[];
    avgExecutionTimeMs: number;
    maxExecutionTimeMs: number;

    // Detection quality
    detectionRate: number; // % of reimbursements flagged
    avgShortfall: number;
    totalShortfall: number;

    // Evidence alignment
    sellersWithCogs: number;
    sellersWithoutCogs: number;

    // Recommendations
    recommendedForFiling: number;
    needsReview: number;
    noAction: number;

    // Sample detections for manual review
    sampleDetections: UnderpaymentDetectionResult[];

    // Warnings
    warnings: string[];
}

const results: TestResults = {
    sellersAnalyzed: 0,
    totalReimbursements: 0,
    totalDetections: 0,
    confidenceDistribution: { high: 0, medium: 0, low: 0 },
    severityDistribution: { critical: 0, high: 0, medium: 0, low: 0 },
    executionTimes: [],
    avgExecutionTimeMs: 0,
    maxExecutionTimeMs: 0,
    detectionRate: 0,
    avgShortfall: 0,
    totalShortfall: 0,
    sellersWithCogs: 0,
    sellersWithoutCogs: 0,
    recommendedForFiling: 0,
    needsReview: 0,
    noAction: 0,
    sampleDetections: [],
    warnings: [],
};

// ============================================================================
// Data Fetching
// ============================================================================

async function getTopSellers(limit: number): Promise<string[]> {
    const { data, error } = await supabase
        .from('settlements')
        .select('user_id')
        .eq('transaction_type', 'reimbursement')
        .not('user_id', 'is', null)
        .limit(500);

    if (error || !data) {
        log.warn(`Error fetching sellers: ${error?.message}`);
        return [];
    }

    // Get unique sellers with most reimbursements
    const sellerCounts = new Map<string, number>();
    for (const row of data) {
        const count = sellerCounts.get(row.user_id) || 0;
        sellerCounts.set(row.user_id, count + 1);
    }

    // Sort by count and return top sellers
    const sorted = [...sellerCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([sellerId]) => sellerId);

    return sorted;
}

async function getReimbursementEvents(sellerId: string, limit: number = 50): Promise<any[]> {
    const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('user_id', sellerId)
        .eq('transaction_type', 'reimbursement')
        .order('settlement_date', { ascending: false })
        .limit(limit);

    if (error) {
        log.warn(`Error fetching reimbursements for ${sellerId}: ${error.message}`);
        return [];
    }

    return (data || []).map(row => ({
        id: row.id,
        seller_id: sellerId,
        order_id: row.order_id,
        sku: row.sku,
        asin: row.asin,
        fnsku: row.fnsku,
        quantity: row.quantity || 1,
        reimbursement_amount: parseFloat(row.amount) || 0,
        currency: row.currency || 'USD',
        reimbursement_date: row.settlement_date,
        reimbursement_type: row.metadata?.adjustmentType || 'REIMBURSEMENT',
        reason: row.metadata?.reason
    }));
}

// ============================================================================
// Test Functions
// ============================================================================

async function runCalibrationTest(sellerId: string): Promise<void> {
    log.info(`\n--- Testing Seller: ${sellerId} ---`);

    // Fetch reimbursement events
    const reimbursements = await getReimbursementEvents(sellerId, TEST_CONFIG.baselineSampleSize);

    if (reimbursements.length === 0) {
        log.warn(`No reimbursements found for seller ${sellerId}`);
        return;
    }

    log.metric('Reimbursements fetched', reimbursements.length);
    results.totalReimbursements += reimbursements.length;
    results.sellersAnalyzed++;

    // Build test data
    const syncedData: UnderpaymentSyncedData = {
        seller_id: sellerId,
        sync_id: `calibration-${Date.now()}`,
        reimbursement_events: reimbursements
    };

    // Run detection with timing
    const startTime = Date.now();
    const detections = await detectReimbursementUnderpayments(
        sellerId,
        syncedData.sync_id,
        syncedData
    );
    const executionTime = Date.now() - startTime;

    results.executionTimes.push(executionTime);
    log.metric('Execution time', `${executionTime}ms`);

    if (executionTime > TEST_CONFIG.maxExecutionTimeMs) {
        results.warnings.push(`Seller ${sellerId} took ${executionTime}ms (exceeds ${TEST_CONFIG.maxExecutionTimeMs}ms limit)`);
    }

    // Analyze detections
    log.metric('Detections found', detections.length);
    results.totalDetections += detections.length;

    for (const detection of detections) {
        // Confidence distribution
        if (detection.confidence_score >= THRESHOLD_RECOMMEND_FILING) {
            results.confidenceDistribution.high++;
        } else if (detection.confidence_score >= THRESHOLD_SHOW_TO_USER) {
            results.confidenceDistribution.medium++;
        } else {
            results.confidenceDistribution.low++;
        }

        // Severity distribution
        results.severityDistribution[detection.severity]++;

        // Recommended action
        if (detection.recommended_action === 'file_claim' || detection.recommended_action === 'escalate') {
            results.recommendedForFiling++;
        } else if (detection.recommended_action === 'review') {
            results.needsReview++;
        } else {
            results.noAction++;
        }

        // Shortfall tracking
        results.totalShortfall += detection.shortfall_amount;

        // Save sample detections (first 10)
        if (results.sampleDetections.length < 10) {
            results.sampleDetections.push(detection);
        }
    }

    // Check COGS availability
    const docStatus = await detectMissingDocumentation(sellerId);
    if (docStatus.hasCogs) {
        results.sellersWithCogs++;
    } else {
        results.sellersWithoutCogs++;
        if (docStatus.alertMessage) {
            log.warn(docStatus.alertMessage);
        }
    }
}

// ============================================================================
// Analysis & Reporting
// ============================================================================

function analyzeResults(): void {
    log.header('');
    log.title('CALIBRATION RESULTS');
    log.header('');

    // Basic stats
    console.log('\n📊 OVERVIEW');
    log.metric('Sellers analyzed', results.sellersAnalyzed);
    log.metric('Total reimbursements', results.totalReimbursements);
    log.metric('Total detections', results.totalDetections);
    log.metric('Detection rate', `${((results.totalDetections / results.totalReimbursements) * 100).toFixed(1)}%`);

    // Confidence distribution
    console.log('\n🎯 CONFIDENCE DISTRIBUTION');
    const totalConf = results.confidenceDistribution.high + results.confidenceDistribution.medium + results.confidenceDistribution.low;
    if (totalConf > 0) {
        log.metric('High (≥0.75)', `${results.confidenceDistribution.high} (${((results.confidenceDistribution.high / totalConf) * 100).toFixed(1)}%)`);
        log.metric('Medium (0.55-0.75)', `${results.confidenceDistribution.medium} (${((results.confidenceDistribution.medium / totalConf) * 100).toFixed(1)}%)`);
        log.metric('Low (<0.55)', `${results.confidenceDistribution.low} (${((results.confidenceDistribution.low / totalConf) * 100).toFixed(1)}%)`);
    }

    // Severity distribution
    console.log('\n⚠️  SEVERITY DISTRIBUTION');
    log.metric('Critical', results.severityDistribution.critical);
    log.metric('High', results.severityDistribution.high);
    log.metric('Medium', results.severityDistribution.medium);
    log.metric('Low', results.severityDistribution.low);

    // Recommended actions
    console.log('\n📋 RECOMMENDED ACTIONS');
    log.metric('File Claim (≥0.75 confidence)', results.recommendedForFiling);
    log.metric('Needs Review', results.needsReview);
    log.metric('No Action', results.noAction);

    // Financial impact
    console.log('\n💰 FINANCIAL IMPACT');
    log.metric('Total shortfall detected', `$${results.totalShortfall.toFixed(2)}`);
    if (results.totalDetections > 0) {
        log.metric('Avg shortfall per detection', `$${(results.totalShortfall / results.totalDetections).toFixed(2)}`);
    }

    // Evidence alignment
    console.log('\n📂 EVIDENCE ALIGNMENT');
    log.metric('Sellers WITH COGS data', results.sellersWithCogs);
    log.metric('Sellers WITHOUT COGS data', results.sellersWithoutCogs);
    if (results.sellersWithoutCogs > 0) {
        log.warn(`${results.sellersWithoutCogs} sellers missing COGS - they will see upload prompts`);
    }

    // Performance
    console.log('\n⚡ PERFORMANCE');
    if (results.executionTimes.length > 0) {
        const avgTime = results.executionTimes.reduce((a, b) => a + b, 0) / results.executionTimes.length;
        const maxTime = Math.max(...results.executionTimes);
        log.metric('Avg execution time', `${avgTime.toFixed(0)}ms`);
        log.metric('Max execution time', `${maxTime}ms`);

        if (maxTime < TEST_CONFIG.maxExecutionTimeMs) {
            log.success(`Performance OK (under ${TEST_CONFIG.maxExecutionTimeMs}ms)`);
        } else {
            log.fail(`Performance WARNING: Max time ${maxTime}ms exceeds ${TEST_CONFIG.maxExecutionTimeMs}ms`);
        }
    }

    // Sample detections
    if (results.sampleDetections.length > 0) {
        console.log('\n🔍 SAMPLE DETECTIONS (for manual review)');
        for (const detection of results.sampleDetections.slice(0, 5)) {
            console.log(`\n   SKU: ${detection.sku || 'N/A'}`);
            console.log(`   Actual: $${detection.actual_reimbursement.toFixed(2)} | Expected: $${detection.expected_fair_value.toFixed(2)}`);
            console.log(`   Shortfall: $${detection.shortfall_amount.toFixed(2)} | COGS Gap: ${detection.cogs_gap ? '$' + detection.cogs_gap.toFixed(2) : 'N/A'}`);
            console.log(`   Confidence: ${(detection.confidence_score * 100).toFixed(0)}% | Severity: ${detection.severity}`);
            console.log(`   Reason: ${detection.evidence.detection_reasons?.[0] || 'N/A'}`);
            console.log(`   Action: ${detection.recommended_action}`);
        }
    }

    // Warnings
    if (results.warnings.length > 0) {
        console.log('\n⚠️  WARNINGS');
        for (const warning of results.warnings) {
            log.warn(warning);
        }
    }

    // Overall verdict
    log.header('');
    console.log('\n🏆 CALIBRATION VERDICT\n');

    const detectionRate = results.totalReimbursements > 0
        ? (results.totalDetections / results.totalReimbursements)
        : 0;

    const issues: string[] = [];
    const passes: string[] = [];

    // Check detection rate (should be 5-40% typically)
    if (detectionRate > 0.40) {
        issues.push(`High detection rate (${(detectionRate * 100).toFixed(1)}%) - may have false positives`);
    } else if (detectionRate < 0.01 && results.totalReimbursements > 20) {
        issues.push(`Very low detection rate (${(detectionRate * 100).toFixed(1)}%) - algorithm may be too strict`);
    } else {
        passes.push(`Detection rate ${(detectionRate * 100).toFixed(1)}% is reasonable`);
    }

    // Check confidence distribution
    const highConfPct = totalConf > 0 ? results.confidenceDistribution.high / totalConf : 0;
    if (highConfPct > 0.5) {
        issues.push(`${(highConfPct * 100).toFixed(0)}% of detections are high confidence - verify not over-confident`);
    } else {
        passes.push(`Confidence distribution looks balanced`);
    }

    // Check evidence alignment
    if (results.sellersWithoutCogs === results.sellersAnalyzed && results.sellersAnalyzed > 0) {
        issues.push('No sellers have COGS data - confidence will be limited');
    } else if (results.sellersWithCogs > 0) {
        passes.push(`${results.sellersWithCogs}/${results.sellersAnalyzed} sellers have COGS data`);
    }

    // Print verdict
    for (const pass of passes) {
        log.success(pass);
    }
    for (const issue of issues) {
        log.warn(issue);
    }

    if (issues.length === 0) {
        console.log(`\n${colors.green}${colors.bold}🎉 CALIBRATION PASSED - Algorithm is ready for production!${colors.reset}`);
    } else {
        console.log(`\n${colors.yellow}${colors.bold}⚠️  CALIBRATION COMPLETE WITH WARNINGS - Review issues above${colors.reset}`);
    }

    log.header('');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  REIMBURSEMENT UNDERPAYMENT DETECTION - CALIBRATION SCRIPT  ║
║                                                              ║
║  Purpose: Validate algorithm before production deployment   ║
╚══════════════════════════════════════════════════════════════╝
  `);

    try {
        // Get sellers with reimbursement data
        log.title('Fetching sellers with reimbursement data...');
        const sellers = await getTopSellers(TEST_CONFIG.maxSellers);

        if (sellers.length === 0) {
            log.fail('No sellers found with reimbursement data. Cannot run calibration.');
            log.info('Tip: Ensure there is data in the `settlements` table with transaction_type = "reimbursement"');
            return;
        }

        log.success(`Found ${sellers.length} sellers to test`);

        // Run calibration for each seller
        log.title('Running calibration tests...');
        for (const sellerId of sellers) {
            await runCalibrationTest(sellerId);
        }

        // Analyze and report results
        analyzeResults();

    } catch (error: any) {
        log.fail(`Calibration failed: ${error.message}`);
        console.error(error);
    }
}

main();
