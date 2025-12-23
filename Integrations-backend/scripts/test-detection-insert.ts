#!/usr/bin/env ts-node
/**
 * Test direct insert to detection_results
 */
import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
    console.log('Testing detection_results insert...');
    console.log('SUPABASE_URL:', process.env.SUPABASE_URL?.substring(0, 40) + '...');
    console.log('SERVICE_KEY exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Check current count
    const { count, error: countError } = await supabase
        .from('detection_results')
        .select('*', { count: 'exact', head: true });

    console.log('\nCurrent row count:', count);
    if (countError) console.log('Count error:', countError);

    // Try insert
    console.log('\nAttempting insert...');
    const { data, error } = await supabase
        .from('detection_results')
        .insert({
            seller_id: 'direct-test-insert-' + Date.now(),
            sync_id: 'test-sync-' + Date.now(),
            anomaly_type: 'test_type',
            severity: 'medium',
            estimated_value: 25.00,
            currency: 'USD',
            confidence_score: 0.90,
            evidence: {},
            status: 'pending'
        })
        .select();

    if (error) {
        console.log('INSERT ERROR:', error.message);
        console.log('Error code:', error.code);
        console.log('Error details:', error.details);
        console.log('Error hint:', error.hint);
    } else {
        console.log('INSERT SUCCESS:', data);
    }

    // Check count again
    const { count: newCount } = await supabase
        .from('detection_results')
        .select('*', { count: 'exact', head: true });
    console.log('\nNew row count:', newCount);
}

test().catch(console.error);
