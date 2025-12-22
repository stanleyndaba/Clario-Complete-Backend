/**
 * Check which users have recovery data
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin, supabase } from '../src/database/supabaseClient';

async function checkRecoveryData() {
    const dbClient = supabaseAdmin || supabase;

    console.log('🔍 Checking which users have recovery data...\n');

    // Check recoveries table
    console.log('1. Recoveries table:');
    const { data: recoveries, error: recoveriesError } = await dbClient
        .from('recoveries')
        .select('user_id, expected_amount, actual_amount')
        .limit(20);

    if (recoveriesError) {
        console.log(`   Error: ${recoveriesError.message}`);
    } else if (recoveries && recoveries.length > 0) {
        console.log(`   Found ${recoveries.length} rows`);
        recoveries.forEach((r: any) => {
            console.log(`   - user_id: ${r.user_id}, amount: $${r.actual_amount || r.expected_amount}`);
        });
    } else {
        console.log('   No rows found');
    }

    // Check dispute_cases table
    console.log('\n2. Dispute cases table:');
    const { data: disputes, error: disputesError } = await dbClient
        .from('dispute_cases')
        .select('seller_id, claim_amount, status')
        .limit(20);

    if (disputesError) {
        console.log(`   Error: ${disputesError.message}`);
    } else if (disputes && disputes.length > 0) {
        console.log(`   Found ${disputes.length} rows`);
        disputes.forEach((d: any) => {
            console.log(`   - seller_id: ${d.seller_id}, amount: $${d.claim_amount}, status: ${d.status}`);
        });
    } else {
        console.log('   No rows found');
    }

    // Check claims table (try seller_id)
    console.log('\n3. Claims table (seller_id):');
    const { data: claims, error: claimsError } = await dbClient
        .from('claims')
        .select('seller_id, amount, status')
        .limit(20);

    if (claimsError) {
        console.log(`   Error: ${claimsError.message}`);
    } else if (claims && claims.length > 0) {
        console.log(`   Found ${claims.length} rows`);
        claims.forEach((c: any) => {
            console.log(`   - seller_id: ${c.seller_id}, amount: $${c.amount}, status: ${c.status}`);
        });
    } else {
        console.log('   No rows found');
    }

    // Check detection_results table
    console.log('\n4. Detection results table:');
    const { data: detections, error: detectionsError } = await dbClient
        .from('detection_results')
        .select('seller_id, estimated_value, status')
        .limit(20);

    if (detectionsError) {
        console.log(`   Error: ${detectionsError.message}`);
    } else if (detections && detections.length > 0) {
        console.log(`   Found ${detections.length} rows`);
        detections.forEach((d: any) => {
            console.log(`   - seller_id: ${d.seller_id}, value: $${d.estimated_value}, status: ${d.status}`);
        });
    } else {
        console.log('   No rows found');
    }

    console.log('\n✅ Check complete');
}

checkRecoveryData()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Check failed:', err);
        process.exit(1);
    });
