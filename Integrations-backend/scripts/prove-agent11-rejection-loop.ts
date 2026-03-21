import 'dotenv/config';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../src/database/supabaseClient';
import refundFilingWorker from '../src/workers/refundFilingWorker';

async function proveAgent11RejectionLoop(): Promise<void> {
  const anomalyType = `agent11_rejection_loop_${Date.now()}`;

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, tenant_id, email')
    .limit(1)
    .maybeSingle();

  if (userError || !user) {
    throw new Error(`Unable to load test user: ${userError?.message || 'no users found'}`);
  }

  const sellerId = user.id;
  const tenantId = user.tenant_id || '00000000-0000-0000-0000-000000000001';
  const firstDetectionId = randomUUID();
  const firstDisputeId = randomUUID();
  const secondDetectionId = randomUUID();
  const secondDisputeId = randomUUID();
  const evidenceDocumentId = randomUUID();

  try {
    await supabaseAdmin
      .from('dispute_cases')
      .update({
        status: 'closed',
        filing_status: 'failed',
        updated_at: new Date().toISOString()
      })
      .like('case_number', 'AG11-REJECT-CASE-1-%')
      .eq('seller_id', sellerId)
      .eq('tenant_id', tenantId)
      .eq('filing_status', 'filed');

    const { error: firstDetectionError } = await supabaseAdmin.from('detection_results').insert({
      id: firstDetectionId,
      tenant_id: tenantId,
      seller_id: sellerId,
      sync_id: `agent11-rejection-proof-1-${Date.now()}`,
      anomaly_type: anomalyType,
      severity: 'medium',
      estimated_value: 99,
      currency: 'USD',
      confidence_score: 0.86,
      evidence: { order_id: `AG11-REJECT-ORDER-1-${Date.now()}` },
      status: 'filed'
    });
    if (firstDetectionError) {
      throw new Error(`Failed to create first detection: ${firstDetectionError.message}`);
    }

    const { error: firstDisputeError } = await supabaseAdmin.from('dispute_cases').insert({
      id: firstDisputeId,
      tenant_id: tenantId,
      seller_id: sellerId,
      detection_result_id: firstDetectionId,
      case_number: `AG11-REJECT-CASE-1-${Date.now()}`,
      case_type: 'amazon_fba',
      provider: 'amazon',
      claim_amount: 99,
      currency: 'USD',
      filing_status: 'filed',
      status: 'submitted'
    });
    if (firstDisputeError) {
      throw new Error(`Failed to create first dispute: ${firstDisputeError.message}`);
    }

    await (refundFilingWorker as any).updateCaseStatus(firstDisputeId, {
      status: 'denied',
      amazon_case_id: `AMZ-REJ-${Date.now()}`,
      error: 'Please provide invoice proof before we can review this claim'
    });

    const { data: firstCaseAfterRejection, error: rejectionError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, detection_result_id, status, filing_status, evidence_attachments, updated_at')
      .eq('id', firstDisputeId)
      .single();

    if (rejectionError) {
      throw new Error(`Failed to load rejection memory: ${rejectionError.message}`);
    }

    const { error: secondDetectionError } = await supabaseAdmin.from('detection_results').insert({
      id: secondDetectionId,
      tenant_id: tenantId,
      seller_id: sellerId,
      sync_id: `agent11-rejection-proof-2-${Date.now()}`,
      anomaly_type: anomalyType,
      severity: 'medium',
      estimated_value: 88,
      currency: 'USD',
      confidence_score: 0.87,
      evidence: { order_id: `AG11-REJECT-ORDER-2-${Date.now()}` },
      status: 'pending'
    });
    if (secondDetectionError) {
      throw new Error(`Failed to create second detection: ${secondDetectionError.message}`);
    }

    const { error: secondDisputeError } = await supabaseAdmin.from('dispute_cases').insert({
      id: secondDisputeId,
      tenant_id: tenantId,
      seller_id: sellerId,
      detection_result_id: secondDetectionId,
      case_number: `AG11-REJECT-CASE-2-${Date.now()}`,
      case_type: 'amazon_fba',
      provider: 'amazon',
      claim_amount: 88,
      currency: 'USD',
      filing_status: 'pending',
      status: 'pending'
    });
    if (secondDisputeError) {
      throw new Error(`Failed to create second dispute: ${secondDisputeError.message}`);
    }

    const { error: evidenceError } = await supabaseAdmin.from('evidence_documents').insert({
      id: evidenceDocumentId,
      seller_id: sellerId,
      user_id: sellerId,
      tenant_id: tenantId,
      external_id: `ag11-reject-doc-${Date.now()}`,
      filename: 'packing_list_only.txt',
      doc_type: 'other',
      provider: 'gmail',
      processing_status: 'completed',
      parser_status: 'completed',
      parser_confidence: 0.81,
      extracted: {},
      parsed_metadata: {},
      raw_text: 'Packing list only. No invoice or proof attached.',
      ingested_at: new Date().toISOString(),
      size_bytes: 512,
      content_type: 'text/plain'
    });
    if (evidenceError) {
      throw new Error(`Failed to create evidence document: ${evidenceError.message}`);
    }

    const { error: linkError } = await supabaseAdmin.from('dispute_evidence_links').insert({
      tenant_id: tenantId,
      dispute_case_id: secondDisputeId,
      evidence_document_id: evidenceDocumentId
    });
    if (linkError) {
      throw new Error(`Failed to create dispute evidence link: ${linkError.message}`);
    }

    process.env.SINGLE_CASE_MODE = secondDisputeId;
    const filingStats = await refundFilingWorker.runFilingForTenant(tenantId);
    delete process.env.SINGLE_CASE_MODE;

    const { data: secondCase, error: secondCaseError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, filing_status, status, evidence_attachments, updated_at')
      .eq('id', secondDisputeId)
      .single();

    if (secondCaseError) {
      throw new Error(`Failed to load second case: ${secondCaseError.message}`);
    }

    console.log(JSON.stringify({
      anomalyType,
      firstAttempt: {
        detectionId: firstDetectionId,
        disputeId: firstDisputeId,
        storedRejection: firstCaseAfterRejection || null
      },
      secondAttempt: {
        detectionId: secondDetectionId,
        disputeId: secondDisputeId,
        filingStats,
        finalCaseState: secondCase
      },
      changedBehavior: Boolean(
        firstCaseAfterRejection?.evidence_attachments?.rejection_category === 'MISSING_DOCUMENT' &&
        secondCase?.filing_status === 'pending_approval'
      )
    }, null, 2));
  } finally {
    delete process.env.SINGLE_CASE_MODE;
  }
}

proveAgent11RejectionLoop().catch((error) => {
  console.error(error);
  process.exit(1);
});
