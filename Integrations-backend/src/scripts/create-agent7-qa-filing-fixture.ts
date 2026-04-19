import path from 'path';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

function loadEnv() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
}

function requireFlag(name: string) {
  if (String(process.env[name] || '').trim().toLowerCase() !== 'true') {
    throw new Error(`${name}=true is required. This script creates a clearly labeled QA-only filing fixture.`);
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function suffix() {
  return Date.now().toString(36).toUpperCase().slice(-6);
}

function parseMissingColumn(message: string): string | null {
  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column "([^"]+)" of relation/i,
    /record "([^"]+)" has no field/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

async function insertWithColumnFallback(
  supabaseAdmin: any,
  table: string,
  row: Record<string, any>,
  select = '*'
) {
  const payload = { ...row };
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select(select)
      .single();

    if (!error) {
      return { data, removedColumns };
    }

    const missingColumn = parseMissingColumn(String(error.message || ''));
    if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      delete payload[missingColumn];
      removedColumns.push(missingColumn);
      continue;
    }

    throw new Error(`Failed to insert ${table}: ${error.message || JSON.stringify(error)}`);
  }

  throw new Error(`Failed to insert ${table}: too many schema fallback attempts`);
}

async function updateWithColumnFallback(
  supabaseAdmin: any,
  table: string,
  id: string,
  tenantId: string,
  patch: Record<string, any>
) {
  const payload = { ...patch };
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (!error) {
      return { removedColumns };
    }

    const missingColumn = parseMissingColumn(String(error.message || ''));
    if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      delete payload[missingColumn];
      removedColumns.push(missingColumn);
      continue;
    }

    throw new Error(`Failed to update ${table}: ${error.message || JSON.stringify(error)}`);
  }

  throw new Error(`Failed to update ${table}: too many schema fallback attempts`);
}

async function resolveTenantAndUser(supabaseAdmin: any) {
  const requestedTenantId = String(process.env.AGENT7_QA_TENANT_ID || '').trim();
  const requestedTenantSlug = String(process.env.AGENT7_QA_TENANT_SLUG || '').trim();
  const requestedUserId = String(process.env.AGENT7_QA_USER_ID || '').trim();
  const requestedUserEmail = String(process.env.AGENT7_QA_USER_EMAIL || '').trim();

  let user: any = null;
  if (requestedUserId) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, tenant_id, amazon_seller_id, is_paid_beta, billing_status')
      .eq('id', requestedUserId)
      .maybeSingle();
    if (error) throw new Error(`Failed to resolve user by id: ${error.message}`);
    user = data;
  } else if (requestedUserEmail) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, tenant_id, amazon_seller_id, is_paid_beta, billing_status')
      .eq('email', requestedUserEmail)
      .maybeSingle();
    if (error) throw new Error(`Failed to resolve user by email: ${error.message}`);
    user = data;
  }

  let tenant: any = null;
  if (requestedTenantId) {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, slug, name')
      .eq('id', requestedTenantId)
      .maybeSingle();
    if (error) throw new Error(`Failed to resolve tenant by id: ${error.message}`);
    tenant = data;
  } else if (requestedTenantSlug) {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, slug, name')
      .eq('slug', requestedTenantSlug)
      .maybeSingle();
    if (error) throw new Error(`Failed to resolve tenant by slug: ${error.message}`);
    tenant = data;
  } else if (user?.tenant_id) {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id, slug, name')
      .eq('id', user.tenant_id)
      .maybeSingle();
    if (error) throw new Error(`Failed to resolve tenant from user: ${error.message}`);
    tenant = data;
  }

  const tenantId = required(tenant?.id || requestedTenantId || user?.tenant_id, 'tenant id');
  const userId = required(user?.id || requestedUserId, 'user id');
  const amazonSellerId = required(
    process.env.AGENT7_QA_AMAZON_SELLER_ID || user?.amazon_seller_id,
    'Amazon seller id'
  );

  return {
    tenantId,
    tenantSlug: tenant?.slug || requestedTenantSlug || null,
    userId,
    userEmail: user?.email || requestedUserEmail || null,
    amazonSellerId
  };
}

async function uploadQaEvidenceObject(
  supabaseAdmin: any,
  params: {
    caseNumber: string;
    sku: string;
    asin: string;
    fnsku?: string | null;
    shipmentId: string;
    quantity: number;
    unitCost: number;
    eventDate: string;
  }
) {
  const storagePath = `agent7-qa-fixtures/${params.caseNumber}/margin-cost-support.pdf`;
  const body = Buffer.from(
    [
      'Margin Agent 7 QA-only support packet',
      `Case number: ${params.caseNumber}`,
      `SKU: ${params.sku}`,
      `ASIN: ${params.asin}`,
      ...(params.fnsku ? [`FNSKU: ${params.fnsku}`] : []),
      `Shipment ID: ${params.shipmentId}`,
      `Quantity affected: ${params.quantity}`,
      `Supported unit cost: ${params.unitCost.toFixed(2)} USD`,
      `Event date: ${params.eventDate}`,
      'Purpose: local QA proof-contract validation only. Not a seller-facing Amazon filing artifact.'
    ].join('\n'),
    'utf8'
  );

  const { error } = await supabaseAdmin.storage
    .from('evidence-documents')
    .upload(storagePath, body, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) {
    throw new Error(`Failed to upload QA evidence object: ${error.message}`);
  }

  return {
    storagePath,
    sizeBytes: body.length
  };
}

async function main() {
  loadEnv();
  requireFlag('ALLOW_AGENT7_QA_FIXTURE');

  const { supabaseAdmin, isRealDatabaseConfigured } = await import('../database/supabaseClient');
  const { evaluateAndPersistCaseEligibility } = await import('../services/agent7EligibilityService');
  const refundFilingService = (await import('../services/refundFilingService')).default;

  if (!isRealDatabaseConfigured) {
    throw new Error('Real Supabase configuration is required for this QA fixture script.');
  }

  const scope = await resolveTenantAndUser(supabaseAdmin);
  const idSuffix = suffix();
  const caseNumber = `QA-AGENT7-${idSuffix}`;
  const sku = `MARGN${idSuffix}`;
  const asin = `B0M${idSuffix.padEnd(7, '9')}`.slice(0, 10);
  // Use one Amazon product identifier path only. Agent 7 correctly treats
  // multiple product identifiers that disagree as unsafe for filing.
  const fnsku = '';
  const shipmentId = `FBA${idSuffix}M9`;
  const quantity = 2;
  const unitCost = 15;
  const amount = quantity * unitCost;
  const eventDate = isoDaysAgo(12);
  const now = new Date().toISOString();
  const syncId = `qa_agent7_${Date.now()}`;

  const evidence = {
    qa_only: true,
    qa_fixture: 'agent7_filing_proof_contract',
    review_tier: 'claim_candidate',
    claim_readiness: 'claim_ready',
    recommended_action: 'file_claim',
    value_label: 'estimated_recovery',
    sku,
    asin,
    shipment_id: shipmentId,
    fba_shipment_id: shipmentId,
    quantity,
    units: quantity,
    units_lost: quantity,
    unit_cost: unitCost,
    value_gap: amount,
    event_date: eventDate,
    report_date: eventDate,
    discovered_at: now,
    policy_basis: 'QA-only warehouse damage filing proof-contract validation'
  };

  const detectionInsert = await insertWithColumnFallback(
    supabaseAdmin,
    'detection_results',
    {
      tenant_id: scope.tenantId,
      seller_id: scope.amazonSellerId,
      user_id: scope.userId,
      sync_id: syncId,
      source_type: 'unknown',
      anomaly_type: 'damaged_stock',
      severity: 'high',
      estimated_value: amount,
      currency: 'USD',
      confidence_score: 0.99,
      match_confidence: 0.99,
      evidence,
      status: 'pending',
      source: 'agent7_qa_fixture',
      claim_number: caseNumber,
      description: 'QA-only warehouse damage claim candidate with verified product, quantity, cost, and timing evidence.',
      discovery_date: now,
      deadline_date: isoDaysAgo(-48),
      days_remaining: 48,
      related_event_ids: []
    },
    'id'
  );
  const detectionId = detectionInsert.data.id;

  const storage = await uploadQaEvidenceObject(supabaseAdmin, {
    caseNumber,
    sku,
    asin,
    shipmentId,
    quantity,
    unitCost,
    eventDate
  });

  const docExtract = {
    sku,
    asin,
    shipment_id: shipmentId,
    fba_shipment_id: shipmentId,
    document_date: eventDate,
    currency: 'USD',
    total_amount: amount,
    items: [
      {
        sku,
        asin,
        shipment_id: shipmentId,
        quantity,
        unit_cost: unitCost,
        cost: unitCost,
        description: 'Margin support item'
      }
    ]
  };

  const evidenceDocumentInsert = await insertWithColumnFallback(
    supabaseAdmin,
    'evidence_documents',
    {
      tenant_id: scope.tenantId,
      seller_id: scope.amazonSellerId,
      external_id: `agent7-qa-${idSuffix}`,
      filename: 'Margin Cost Support.pdf',
      content_type: 'application/pdf',
      size_bytes: storage.sizeBytes,
      storage_path: storage.storagePath,
      doc_type: 'invoice',
      supplier_name: 'Margin QA Supplier',
      invoice_number: `INV-${idSuffix}`,
      document_date: eventDate,
      currency: 'USD',
      total_amount: amount,
      raw_text: [
        'Margin Agent 7 QA-only support packet.',
        `SKU ${sku}, ASIN ${asin}.`,
        `Shipment ${shipmentId}. Quantity ${quantity}. Unit cost ${unitCost.toFixed(2)} USD.`,
        'This object validates the filing proof contract and must not be submitted as real seller evidence.'
      ].join(' '),
      extracted: docExtract,
      parsed_metadata: docExtract,
      parser_status: 'completed',
      match_confidence: 0.99,
      provider: 'test_generator',
      source_provider: 'qa_fixture',
      metadata: {
        qa_only: true,
        qa_fixture: 'agent7_filing_proof_contract',
        generated_by: 'create-agent7-qa-filing-fixture'
      }
    },
    'id'
  );
  const evidenceDocumentId = evidenceDocumentInsert.data.id;

  const caseEvidenceAttachments = {
    qa_only: true,
    qa_fixture: 'agent7_filing_proof_contract',
    sku,
    asin,
    shipment_id: shipmentId,
    fba_shipment_id: shipmentId,
    quantity,
    units: quantity,
    unit_count: quantity,
    unit_cost: unitCost,
    value_gap: amount,
    report_date: eventDate,
    discovery_date: eventDate,
    match_confidence: 0.99,
    summary: 'QA-only filing proof fixture with verified identifiers, quantity, unit cost, and source document.',
    claim_context: 'Warehouse damage claim candidate created only to validate Agent 7 filing proof gates.'
  };

  const disputeInsert = await insertWithColumnFallback(
    supabaseAdmin,
    'dispute_cases',
    {
      tenant_id: scope.tenantId,
      seller_id: scope.amazonSellerId,
      user_id: scope.userId,
      detection_result_id: detectionId,
      case_number: caseNumber,
      status: 'pending',
      filing_status: 'pending',
      eligibility_status: 'INSUFFICIENT_DATA',
      eligible_to_file: false,
      block_reasons: [],
      claim_amount: amount,
      estimated_recovery_amount: amount,
      currency: 'USD',
      case_type: 'damaged_warehouse',
      provider: 'amazon',
      sku,
      asin,
      shipment_id: shipmentId,
      fba_shipment_id: shipmentId,
      quantity,
      units_lost: quantity,
      evidence_attachments: caseEvidenceAttachments,
      description: 'QA-only warehouse damage claim candidate. Margin has a product identifier, shipment reference, affected quantity, supported unit cost, and a linked support document for proof-contract validation.',
      details: 'This record is intentionally marked QA-only and exists to validate Agent 7 filing readiness without fabricating a real Amazon seller claim.',
      last_error: null,
      created_at: now,
      updated_at: now
    },
    'id, case_number'
  );
  const disputeId = disputeInsert.data.id;

  await insertWithColumnFallback(
    supabaseAdmin,
    'dispute_evidence_links',
    {
      tenant_id: scope.tenantId,
      dispute_case_id: disputeId,
      evidence_document_id: evidenceDocumentId,
      relevance_score: 0.99,
      match_confidence: 0.99,
      link_type: 'qa_fixture',
      matched_context: {
        qa_only: true,
        sku,
        asin,
        shipment_id: shipmentId,
        quantity,
        unit_cost: unitCost,
        reason: 'QA-only proof-contract validation packet matches case identifiers.'
      },
      created_at: now
    },
    'id'
  );

  const eligibility = await evaluateAndPersistCaseEligibility(disputeId, scope.tenantId);
  const { data: updatedCase } = await supabaseAdmin
    .from('dispute_cases')
    .select('id, case_number, filing_status, eligibility_status, eligible_to_file, block_reasons, last_error')
    .eq('id', disputeId)
    .eq('tenant_id', scope.tenantId)
    .single();

  let dryRunResult: any = null;
  if (
    eligibility.eligible &&
    String(process.env.AGENT7_QA_CAPTURE_DRY_RUN || '').trim().toLowerCase() === 'true'
  ) {
    process.env.NODE_ENV = 'development';
    process.env.DRY_RUN = 'true';

    dryRunResult = await refundFilingService.fileDispute({
      dispute_id: disputeId,
      user_id: scope.userId,
      seller_id: scope.amazonSellerId,
      tenant_id: scope.tenantId,
      order_id: '',
      shipment_id: shipmentId,
      asin,
      sku,
      fnsku: undefined,
      claim_type: 'damaged_warehouse',
      amount_claimed: amount,
      currency: 'USD',
      evidence_document_ids: [evidenceDocumentId],
      confidence_score: 0.99,
      metadata: {
        qa_only: true,
        idempotency_key: `qa-${uuidv4()}`,
        quantity,
        proof_snapshot: eligibility.proofSnapshot || null,
        explanation_payload: eligibility.proofSnapshot?.explanationPayload || null,
        filing_strategy: eligibility.proofSnapshot?.filingStrategy || 'AUTO'
      }
    });

    await updateWithColumnFallback(
      supabaseAdmin,
      'dispute_cases',
      disputeId,
      scope.tenantId,
      {
        filing_status: 'blocked',
        eligibility_status: 'SAFETY_HOLD',
        eligible_to_file: false,
        block_reasons: ['qa_fixture_do_not_file'],
        last_error: 'QA-only fixture captured a dry-run filing payload and was blocked to prevent real Amazon submission.',
        updated_at: new Date().toISOString()
      }
    );
  }

  const { data: finalCase } = await supabaseAdmin
    .from('dispute_cases')
    .select('id, case_number, filing_status, eligibility_status, eligible_to_file, block_reasons, last_error')
    .eq('id', disputeId)
    .eq('tenant_id', scope.tenantId)
    .single();

  console.log(JSON.stringify({
    ok: true,
    qa_only: true,
    message: 'Agent 7 QA-only filing fixture created. No real Amazon submission was performed.',
    tenant: {
      id: scope.tenantId,
      slug: scope.tenantSlug
    },
    user: {
      id: scope.userId,
      email: scope.userEmail
    },
    seller_id: scope.amazonSellerId,
    case: {
      id: disputeId,
      case_number: caseNumber,
      filing_status: finalCase?.filing_status || updatedCase?.filing_status || null,
      eligibility_status: finalCase?.eligibility_status || updatedCase?.eligibility_status || null,
      eligible_to_file: finalCase?.eligible_to_file ?? updatedCase?.eligible_to_file ?? null,
      block_reasons: finalCase?.block_reasons || updatedCase?.block_reasons || [],
      safety_note: finalCase?.last_error || null
    },
    detection_result_id: detectionId,
    evidence_document_id: evidenceDocumentId,
    storage_path: storage.storagePath,
    eligibility: {
      eligible: eligibility.eligible,
      eligibility_status: eligibility.eligibilityStatus,
      reasons: eligibility.reasons,
      filing_strategy: eligibility.proofSnapshot?.filingStrategy || null,
      filing_recommendation: eligibility.proofSnapshot?.filingRecommendation || null,
      required_requirements: eligibility.proofSnapshot?.requiredRequirements || [],
      missing_requirements: eligibility.proofSnapshot?.missingRequirements || []
    },
    dry_run_capture: dryRunResult ? {
      success: dryRunResult.success,
      status: dryRunResult.status,
      error_message: dryRunResult.error_message,
      expected: 'DRY_RUN returns failure after writing payload; this is not a real Amazon filing.'
    } : null,
    schema_fallbacks: {
      detection_results_removed_columns: detectionInsert.removedColumns,
      evidence_documents_removed_columns: evidenceDocumentInsert.removedColumns,
      dispute_cases_removed_columns: disputeInsert.removedColumns
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error)
  }, null, 2));
  process.exit(1);
});
