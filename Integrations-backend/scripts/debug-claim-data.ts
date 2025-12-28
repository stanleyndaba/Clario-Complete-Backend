#!/usr/bin/env ts-node
/**
 * Debug script to check what's in detection_results and financial_events
 */

import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    console.log('\n=== CHECKING DETECTION RESULTS ===\n');

    const { data: detections, error: detErr } = await supabase
        .from('detection_results')
        .select('id, anomaly_type, evidence')
        .limit(5);

    if (detErr) {
        console.error('Error fetching detections:', detErr.message);
    } else {
        console.log(`Found ${detections?.length || 0} detection results\n`);
        detections?.forEach((d, i) => {
            console.log(`[${i + 1}] Type: ${d.anomaly_type}`);
            console.log(`    evidence.sku: ${d.evidence?.sku || 'MISSING'}`);
            console.log(`    evidence.asin: ${d.evidence?.asin || 'MISSING'}`);
            console.log(`    evidence.fnsku: ${d.evidence?.fnsku || 'MISSING'}`);
            console.log(`    evidence keys: ${Object.keys(d.evidence || {}).join(', ')}`);
            console.log('');
        });
    }

    console.log('\n=== CHECKING FINANCIAL EVENTS ===\n');

    const { data: events, error: evtErr } = await supabase
        .from('financial_events')
        .select('id, event_type, amazon_sku, raw_payload')
        .limit(5);

    if (evtErr) {
        console.error('Error fetching events:', evtErr.message);
    } else {
        console.log(`Found ${events?.length || 0} financial events\n`);
        events?.forEach((e, i) => {
            const rp = e.raw_payload || {};
            console.log(`[${i + 1}] Type: ${e.event_type}`);
            console.log(`    amazon_sku column: ${e.amazon_sku || 'MISSING'}`);
            console.log(`    raw_payload.ASIN: ${rp.ASIN || 'MISSING'}`);
            console.log(`    raw_payload.SellerSKU: ${rp.SellerSKU || 'MISSING'}`);
            console.log(`    raw_payload.asin: ${rp.asin || 'MISSING'}`);
            console.log(`    raw_payload keys: ${Object.keys(rp).slice(0, 10).join(', ')}...`);
            console.log('');
        });
    }
}

checkData().catch(console.error);
