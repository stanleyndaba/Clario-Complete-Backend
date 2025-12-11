/**
 * Debug the matching flow step-by-step
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function debugMatchingFlow() {
    console.log('=== DEBUG: Evidence Matching Flow ===\n');

    const userId = '07b4f03d-352e-473f-a316-af97d9017d69'; // From verification

    // Step 1: Check if claims are being fetched
    console.log('Step 1: Fetching claims from detection_results...');
    const { data: detections, error: detError } = await supabase
        .from('detection_results')
        .select('id, seller_id, anomaly_type, estimated_value, evidence, claim_number')
        .or(`seller_id.eq.${userId},user_id.eq.${userId}`)
        .not('evidence', 'is', null);

    if (detError) {
        console.log('  ❌ Error fetching detection_results:', detError.message);
    } else {
        console.log(`  ✅ Found ${detections?.length || 0} detection_results`);
        (detections || []).forEach((d: any) => {
            const ev = typeof d.evidence === 'string' ? JSON.parse(d.evidence) : d.evidence;
            console.log(`     - ${d.claim_number}: ASIN=${ev?.asin}, Amount=$${d.estimated_value}`);
        });
    }

    // Step 2: Check Python API URL
    console.log('\nStep 2: Python API configuration...');
    const pythonApiUrl = process.env.PYTHON_API_URL || 'https://clario-complete-backend-7tgl.onrender.com';
    console.log('  Python API URL:', pythonApiUrl);

    // Step 3: Check what the Python matching endpoint expects
    console.log('\nStep 3: Testing Python matching endpoint...');
    try {
        const axios = require('axios');
        const response = await axios.post(
            `${pythonApiUrl}/api/internal/evidence/matching/run`,
            {
                user_id: userId,
                claims: (detections || []).map((d: any) => {
                    const ev = typeof d.evidence === 'string' ? JSON.parse(d.evidence) : d.evidence;
                    return {
                        claim_id: d.id,
                        claim_type: d.anomaly_type,
                        amount: d.estimated_value,
                        asin: ev?.asin,
                        sku: ev?.sku,
                        order_id: ev?.order_id
                    };
                })
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Service-Auth': 'evidence-matching:run'
                },
                timeout: 30000
            }
        );
        console.log('  ✅ Python API responded:', response.status);
        console.log('  Response:', JSON.stringify(response.data, null, 2));
    } catch (err: any) {
        console.log('  ❌ Python API error:', err.message);
        if (err.response) {
            console.log('  Status:', err.response.status);
            console.log('  Data:', JSON.stringify(err.response.data, null, 2));
        }
    }

    // Step 4: Check parsed documents
    console.log('\nStep 4: Checking parsed documents...');
    const { data: docs } = await supabase
        .from('evidence_documents')
        .select('id, filename, parsed_metadata, parser_status')
        .eq('seller_id', userId)
        .eq('parser_status', 'completed')
        .limit(5);

    console.log(`  Found ${docs?.length || 0} parsed documents`);
    (docs || []).forEach((d: any) => {
        const asins = d.parsed_metadata?.asins || [];
        console.log(`    - ${d.filename}: ${asins.length} ASINs`);
    });
}

debugMatchingFlow().catch(console.error);
