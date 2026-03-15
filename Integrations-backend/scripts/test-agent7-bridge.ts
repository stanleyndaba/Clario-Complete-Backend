
import axios from 'axios';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import * as dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PORT = process.env.PORT || 3001;
const API_URL = `http://localhost:${PORT}`;

// Initialize Supabase Admin (Bypass RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runLiveFireTest() {
    console.log('🔥 [AGENT 7] STARTING LIVE FIRE INTEGRATION TEST');
    console.log('Context: Testing E2E Bridge from API -> BullMQ -> Worker');

    // Use dynamic IDs to avoid constraint violations
    const sessionSuffix = Date.now().toString().slice(-8);
    const testUserId = '00000000-0000-0000-0000-000000000001';
    
    const testCaseId = `e3333333-3333-4333-b333-${sessionSuffix.padStart(12, '0')}`;
    const testDetectionId = `d4444444-4444-4444-b444-${sessionSuffix.padStart(12, '0')}`;
    const testEvidenceId = `c5555555-5555-4555-b555-${sessionSuffix.padStart(12, '0')}`;
    
    const testSellerId = 'DEMO_SELLER_001';
    const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

    try {
        // 1. Verify/Inject Identity & User State
        console.log(`[TEST] Using demo@margin.com user ${testUserId}...`);
        
        // Ensure identity mapping exists (Crucial for enforcePaywall)
        console.log(`[TEST] Overwriting identity map: ${testSellerId} -> ${testUserId}`);
        await supabase.from('v1_seller_identity_map').upsert({
            merchant_token: testSellerId,
            user_id: testUserId
        });

        const { data: verifiedUser, error: userError } = await supabase.from('users').select('is_paid_beta').eq('id', testUserId).single();
        if (userError) throw new Error(`Supabase User Lookup Failed: ${userError.message}`);
        
        if (!verifiedUser?.is_paid_beta) {
            console.log(`[TEST] Force-setting is_paid_beta = true for user ${testUserId}...`);
            await supabase.from('users').update({ is_paid_beta: true }).eq('id', testUserId);
        }

        console.log(`[TEST] Injecting mock detection result ${testDetectionId}...`);
        const { error: detError } = await supabase.from('detection_results').upsert({
            id: testDetectionId,
            seller_id: testSellerId,
            tenant_id: DEFAULT_TENANT_ID,
            sync_id: 'sync-test-' + sessionSuffix,
            anomaly_type: 'missing_unit',
            severity: 'high',
            estimated_value: 126.41,
            confidence_score: 0.95,
            evidence: { reason: 'Test anomaly' },
            status: 'pending',
            updated_at: new Date().toISOString()
        });

        if (detError) throw new Error(`Supabase Detection Upsert Failed: ${detError.message}`);

        console.log(`[TEST] Injecting mock evidence document ${testEvidenceId}...`);
        const { error: evidenceError } = await supabase.from('evidence_documents').upsert({
            id: testEvidenceId,
            tenant_id: DEFAULT_TENANT_ID,
            seller_id: testSellerId,
            doc_type: 'invoice',
            provider: 'gmail',
            external_id: 'ext-mock-' + sessionSuffix,
            file_url: 'mock/path/invoice.pdf',
            size_bytes: 1024,
            content_type: 'application/pdf',
            metadata: { test: true }
        });

        if (evidenceError) throw new Error(`Supabase Evidence Upsert Failed: ${evidenceError.message}`);

        console.log(`[TEST] Injecting mock dispute case ${testCaseId}...`);
        const { error: caseError } = await supabase.from('dispute_cases').upsert({
            id: testCaseId,
            case_number: 'AMZ-AGENT7-' + sessionSuffix,
            seller_id: testSellerId,
            tenant_id: DEFAULT_TENANT_ID,
            detection_result_id: testDetectionId,
            claim_amount: 126.41,
            currency: 'USD',
            case_type: 'amazon_fba',
            provider: 'amazon',
            filing_status: 'pending', // Must be 'pending' for Atomic Lock to catch it
            updated_at: new Date().toISOString()
        });

        if (caseError) throw new Error(`Supabase Case Upsert Failed: ${caseError.message}`);

        console.log(`[TEST] Linking evidence to case...`);
        const { error: linkError } = await supabase.from('dispute_evidence_links').upsert({
            dispute_case_id: testCaseId,
            evidence_document_id: testEvidenceId,
            tenant_id: DEFAULT_TENANT_ID
        });

        if (linkError) throw new Error(`Supabase Evidence Link Failed: ${linkError.message}`);

        // 2. Redis Telemetry Setup
        console.log('[TEST] Connecting to Redis Telemetry...');
        const redisOptions = REDIS_URL.startsWith('rediss://') 
            ? { tls: { rejectUnauthorized: false }, maxRetriesPerRequest: null }
            : { maxRetriesPerRequest: null };
            
        const connection = new IORedis(REDIS_URL, redisOptions);
        const queueEvents = new QueueEvents('sp-api-submissions', { connection });

        // Listen for internal worker signals
        queueEvents.on('completed', ({ jobId, returnvalue }) => {
            if (jobId !== response.data.jobId) return; // Ignore stale jobs
            
            console.log(`✅ [TEST] Job ${jobId} Completed Successfully!`);
            console.log(`Result:`, JSON.stringify(returnvalue, null, 2));
            connection.disconnect();
            if (returnvalue) {
                console.log('🎯 [TEST] SUCCESS: Case filed on Amazon!');
                process.exit(0);
            } else {
                console.error('❌ [TEST] FAILURE: Job returned null result despite success signal.');
                process.exit(1);
            }
        });

        queueEvents.on('failed', ({ jobId, failedReason }) => {
            if (jobId !== response.data.jobId) return; // Ignore stale jobs
            
            console.error(`❌ [TEST] Job ${jobId} Failed!`);
            console.error(`Reason: ${failedReason}`);
            connection.disconnect();
            process.exit(1);
        });

        // 3. Trigger API (The Bridge)
        console.log(`[TEST] Transmitting payload to ${API_URL}/api/disputes/file-now...`);
        const response = await axios.post(`${API_URL}/api/disputes/file-now`, {
            dispute_id: testCaseId
        }, {
            headers: {
                'x-user-id': testUserId,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ [TEST] API Accepted Payload: ${response.status} ${response.statusText}`);
        console.log(`[TEST] Tracking Job ID: ${response.data.jobId}`);

        if (!response.data.jobId) {
            console.error('❌ [TEST] FAILURE: API did not return jobId');
            process.exit(1);
        }

        // 4. Wait for Worker Signal
        console.log('[TEST] Waiting for Worker to emit [AGENT 7] forensic log...');
        
        setTimeout(() => {
            console.error('❌ [TEST] TIMEOUT: Worker failed to process job in time.');
            connection.disconnect();
            process.exit(1);
        }, 60000);

    } catch (error: any) {
        if (error.response) {
            console.error('❌ [TEST] API ERROR:', error.response.status, error.response.data);
        } else if (error.request) {
            console.error('❌ [TEST] NO RESPONSE FROM API:', error.message);
        } else {
            console.error('❌ [TEST] FATAL ERROR:', error);
        }
        process.exit(1);
    }
}

runLiveFireTest();
