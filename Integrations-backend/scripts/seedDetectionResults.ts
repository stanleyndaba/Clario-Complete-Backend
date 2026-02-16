/**
 * Seed Detection Results — Populate the `detection_results` table with realistic mock data
 * so the Audits tab on the Dashboard renders content.
 *
 * Usage: npx ts-node scripts/seedDetectionResults.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Realistic Amazon FBA anomaly types used by the detection engine
const ANOMALY_TYPES = [
    'lost_warehouse',
    'damaged_warehouse',
    'lost_inbound',
    'weight_fee_overcharge',
    'refund_no_return',
    'storage_overcharge',
    'customer_return',
    'fulfillment_fee_error',
    'commission_overcharge',
    'reimbursement_reversal',
    'duplicate_charge',
    'incorrect_fee',
    'lts_overcharge',
    'return_not_restocked',
] as const;

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

function randomBetween(min: number, max: number) {
    return Math.random() * (max - min) + min;
}

function randomChoice<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
}

async function seed() {
    console.log('🔍 Looking up user for seeding...');

    // Find an existing user to attach the detections to
    const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, tenant_id, email')
        .limit(1);

    if (usersError || !users || users.length === 0) {
        console.error('❌ No users found in the database. Cannot seed detection results.');
        process.exit(1);
    }

    const user = users[0];
    const sellerId = user.id;
    const tenantId = user.tenant_id || sellerId;
    const syncId = `seed_sync_${Date.now()}`;

    console.log(`✅ Using user: ${user.email} (${sellerId})`);
    console.log(`   Tenant: ${tenantId}`);
    console.log(`   Sync ID: ${syncId}`);

    // Generate 12 realistic mock detection results
    const mockResults = Array.from({ length: 12 }, (_, i) => {
        const anomalyType = ANOMALY_TYPES[i % ANOMALY_TYPES.length];
        const severity = randomChoice(SEVERITIES);
        const discoveryDaysAgo = Math.floor(randomBetween(1, 45));
        const discoveryDate = daysAgo(discoveryDaysAgo);
        const deadlineDate = new Date(discoveryDate);
        deadlineDate.setDate(deadlineDate.getDate() + 60);
        const daysRemaining = Math.max(0, 60 - discoveryDaysAgo);

        // Realistic value ranges by severity
        const valueRanges: Record<string, [number, number]> = {
            low: [5, 50],
            medium: [50, 250],
            high: [250, 1200],
            critical: [1200, 4500],
        };
        const [minVal, maxVal] = valueRanges[severity];
        const estimatedValue = parseFloat(randomBetween(minVal, maxVal).toFixed(2));

        // Confidence score weighted toward higher values for realism
        const confidence = parseFloat(randomBetween(0.55, 0.98).toFixed(4));

        return {
            tenant_id: tenantId,
            seller_id: sellerId,
            sync_id: syncId,
            anomaly_type: anomalyType,
            severity,
            estimated_value: estimatedValue,
            currency: 'USD',
            confidence_score: confidence,
            evidence: {
                source: 'seed_script',
                order_id: `111-${(1000000 + i * 13579).toString()}-${(2000000 + i * 97531).toString()}`,
                description: `Auto-detected ${anomalyType.replace(/_/g, ' ')} anomaly`,
                detected_by: 'Agent 3 — Claim Detector',
            },
            related_event_ids: [],
            discovery_date: discoveryDate,
            deadline_date: deadlineDate.toISOString(),
            days_remaining: daysRemaining,
            expired: daysRemaining === 0,
            expiration_alert_sent: false,
            status: i < 8 ? 'pending' : (i === 8 ? 'reviewed' : (i === 9 ? 'disputed' : 'resolved')),
        };
    });

    console.log(`\n📦 Inserting ${mockResults.length} mock detection results...`);

    const { data, error } = await supabase
        .from('detection_results')
        .insert(mockResults)
        .select('id, anomaly_type, severity, estimated_value, confidence_score, status');

    if (error) {
        console.error('❌ Failed to insert detection results:', error.message);
        console.error('   Details:', JSON.stringify(error, null, 2));
        process.exit(1);
    }

    console.log(`\n✅ Successfully seeded ${data.length} detection results:\n`);

    // Pretty-print a summary table
    console.log('  #  | Type                       | Severity | Value      | Confidence | Status');
    console.log('  ---+----------------------------+----------+------------+------------+--------');
    data.forEach((row: any, idx: number) => {
        const type = (row.anomaly_type || '').padEnd(26);
        const sev = (row.severity || '').padEnd(8);
        const val = `$${row.estimated_value.toFixed(2)}`.padStart(10);
        const conf = `${(row.confidence_score * 100).toFixed(1)}%`.padStart(10);
        const status = row.status || 'detected';
        console.log(`  ${(idx + 1).toString().padStart(2)} | ${type} | ${sev} | ${val} | ${conf} | ${status}`);
    });

    const totalValue = data.reduce((sum: number, r: any) => sum + r.estimated_value, 0);
    console.log(`\n  Total estimated recovery: $${totalValue.toFixed(2)}`);
    console.log('\n🎉 Done! The Audits tab on the Dashboard should now display data.');
}

seed().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
