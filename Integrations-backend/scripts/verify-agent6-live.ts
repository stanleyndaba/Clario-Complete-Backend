/**
 * Verify Agent 6 "In Action"
 * 
 * This script performs a live end-to-end test of Agent 6:
 * 1. Creates a mock Claim (Agent 1 output)
 * 2. Creates a mock Parsed Document (Agent 5 output) that matches the claim
 * 3. Triggers Agent 6 (Evidence Matching) manually
 * 4. Verifies that a match was found and recorded
 */

import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import evidenceMatchingWorker from '../src/workers/evidenceMatchingWorker';
import logger from '../src/utils/logger';
import { v4 as uuidv4 } from 'uuid';

async function verifyAgent6Live() {
    logger.info('🚀 Starting Agent 6 Live Verification...');

    const sellerId = 'verify-agent6-user-' + Date.now();
    const claimId = uuidv4();
    const documentId = uuidv4();
    const invoiceNumber = 'INV-' + Date.now();
    const orderId = '111-' + Date.now() + '-111';
    const amount = 150.00;

    try {
        // 1. Create Mock Claim (Agent 1)
        logger.info('1️⃣ Creating Mock Claim (Agent 1 Output)...');
        const { error: claimError } = await supabaseAdmin
            .from('detection_results')
            .insert({
                id: claimId,
                seller_id: sellerId,
                sync_id: uuidv4(), // Required field
                anomaly_type: 'missing_unit', // Changed from claim_type to match schema
                severity: 'medium',
                estimated_value: amount, // Correct column name
                currency: 'USD',
                status: 'pending',
                evidence: { order_id: orderId }, // Store order_id in evidence JSONB as per schema
                confidence_score: 0.95
            });

        if (claimError) throw new Error(`Failed to create claim: ${claimError.message}`);
        logger.info('✅ Claim created', { claimId, orderId, amount });

        // 2. Create Mock Parsed Document (Agent 5)
        logger.info('2️⃣ Creating Mock Parsed Document (Agent 5 Output)...');
        const { error: docError } = await supabaseAdmin
            .from('evidence_documents')
            .insert({
                id: documentId,
                seller_id: sellerId,
                filename: `invoice_${invoiceNumber}.pdf`,
                content_type: 'application/pdf',
                doc_type: 'invoice', // Required field
                parser_status: 'completed', // Important: Agent 6 looks for 'completed'
                parser_confidence: 0.99,
                parsed_metadata: {
                    invoice_number: invoiceNumber,
                    order_id: orderId, // MATCHING FIELD!
                    total_amount: amount, // MATCHING FIELD!
                    invoice_date: new Date().toISOString(),
                    supplier_name: 'Test Supplier',
                    line_items: [
                        { description: 'Item X', quantity: 10, unit_price: 15.00, total: 150.00 }
                    ]
                }
            });

        if (docError) throw new Error(`Failed to create document: ${docError.message}`);
        logger.info('✅ Document created', { documentId, invoiceNumber, orderId });

        // 3. Trigger Agent 6 (Evidence Matching)
        logger.info('3️⃣ Triggering Agent 6 (Evidence Matching)...');

        // We use the manual trigger method which does the same thing as the scheduled job
        // but for a specific user
        const result = await evidenceMatchingWorker.triggerManualMatching(sellerId);

        logger.info('✅ Matching run completed', result);

        // 4. Verify Match Result
        logger.info('4️⃣ Verifying Match Result in Database...');

        // Check detection_results status (should be 'disputed' or 'reviewed' based on confidence)
        const { data: updatedClaim, error: checkError } = await supabaseAdmin
            .from('detection_results')
            .select('status, match_confidence')
            .eq('id', claimId)
            .single();

        if (checkError) throw new Error(`Failed to fetch updated claim: ${checkError.message}`);

        // Check dispute_evidence_links
        const { data: links, error: linkError } = await supabaseAdmin
            .from('dispute_evidence_links')
            .select('*')
            .eq('dispute_id', claimId)
            .eq('document_id', documentId);

        if (linkError) throw new Error(`Failed to fetch links: ${linkError.message}`);

        // 5. Report Results
        logger.info('\n📊 Verification Results:');
        logger.info('='.repeat(50));

        const isMatchFound = links && links.length > 0;
        const isStatusUpdated = updatedClaim.status !== 'pending';
        const hasConfidence = updatedClaim.match_confidence > 0;

        logger.info(`Match Found in DB:   ${isMatchFound ? '✅ YES' : '❌ NO'}`);
        logger.info(`Claim Status Updated: ${isStatusUpdated ? '✅ YES' : '❌ NO'} (${updatedClaim.status})`);
        logger.info(`Confidence Score:    ${hasConfidence ? '✅ YES' : '❌ NO'} (${updatedClaim.match_confidence})`);

        if (isMatchFound) {
            logger.info('\n🎉 SUCCESS! Agent 6 successfully matched the evidence to the claim.');
            logger.info('   This proves the "In Action" functionality works end-to-end.');
        } else {
            logger.error('\n❌ FAILURE! Agent 6 did not link the evidence.');
            logger.info('   Check logs for matching engine errors.');
        }

        // Cleanup (Optional - comment out to keep data for inspection)
        logger.info('\n🧹 Cleaning up test data...');
        await supabaseAdmin.from('detection_results').delete().eq('seller_id', sellerId);
        await supabaseAdmin.from('evidence_documents').delete().eq('seller_id', sellerId);
        await supabaseAdmin.from('tokens').delete().eq('user_id', sellerId); // If any tokens created
        logger.info('✅ Cleanup complete');

    } catch (error: any) {
        logger.error('❌ Verification Failed:', error);
        process.exit(1);
    }
}

verifyAgent6Live();
