import 'dotenv/config';

import { supabaseAdmin, isRealDatabaseConfigured } from '../database/supabaseClient';
import enhancedDetectionService from '../services/enhancedDetectionService';
import { runLostInventoryDetection } from '../services/detection/core/detectors/inventoryAlgorithms';
import { runTransferLossDetection } from '../services/detection/core/detectors/warehouseTransferLossAlgorithm';
import { runInboundDetection } from '../services/detection/core/detectors/inboundAlgorithms';
import { runDamagedInventoryDetection } from '../services/detection/core/detectors/damagedAlgorithms';
import { runRefundWithoutReturnDetection } from '../services/detection/core/detectors/refundAlgorithms';
import { runFeeOverchargeDetection } from '../services/detection/core/detectors/feeAlgorithms';
import { runSentinelDetection } from '../services/detection/core/detectors/duplicateMissedReimbursementAlgorithm';
import { getAgent3AlgorithmStatuses } from '../services/detection/core/productionConnectionStatus';

type Membership = {
  tenant_id: string;
  user_id: string;
  tenants?: { slug?: string | null } | null;
};

type InputTableSummary = {
  table: string;
  count: number;
  keyFieldsPresent: string[];
  sampleKeys: string[];
  error?: string | null;
};

type DetectionLike = {
  seller_id?: string;
  sync_id?: string;
  anomaly_type?: string;
  estimated_value?: number;
  confidence_score?: number;
  severity?: string;
  currency?: string;
  evidence?: any;
  related_event_ids?: string[];
  order_id?: string;
  shipment_id?: string;
  sku?: string;
  fnsku?: string;
  asin?: string;
  product_name?: string;
  loss_type?: string;
  detection_type?: string;
  transfer_id?: string;
};

type AlgorithmSummary = {
  name: string;
  detections: number;
  estimatedValue: number;
  samples: Array<{
    anomaly_type?: string;
    estimated_value?: number;
    confidence_score?: number;
    severity?: string;
    key_identity?: Record<string, any>;
    evidence_excerpt?: Record<string, any>;
    related_event_ids?: string[];
  }>;
  notes: string[];
  rawResults: DetectionLike[];
};

const INPUT_TABLES: Array<{ table: string; sellerField: string; expectedFields: string[] }> = [
  { table: 'orders', sellerField: 'user_id', expectedFields: ['tenant_id', 'user_id', 'order_id', 'purchase_date', 'order_status'] },
  { table: 'shipments', sellerField: 'user_id', expectedFields: ['tenant_id', 'user_id', 'shipment_id', 'status', 'quantity_shipped', 'quantity_received'] },
  { table: 'returns', sellerField: 'user_id', expectedFields: ['tenant_id', 'user_id', 'return_id', 'order_id', 'returned_date', 'status'] },
  { table: 'settlements', sellerField: 'user_id', expectedFields: ['tenant_id', 'user_id', 'settlement_id', 'transaction_type', 'settlement_date', 'amount'] },
  { table: 'inventory_items', sellerField: 'user_id', expectedFields: ['tenant_id', 'user_id', 'sku', 'asin', 'fnsku', 'quantity'] },
  { table: 'inventory_ledger_events', sellerField: 'user_id', expectedFields: ['tenant_id', 'user_id', 'fnsku', 'event_type', 'event_date', 'quantity'] },
  { table: 'financial_events', sellerField: 'seller_id', expectedFields: ['tenant_id', 'seller_id', 'event_type', 'posted_date', 'amount', 'amazon_order_id'] },
  { table: 'fee_events', sellerField: 'seller_id', expectedFields: ['tenant_id', 'seller_id', 'fee_type', 'fee_amount', 'fee_date'] },
  { table: 'product_catalog', sellerField: 'seller_id', expectedFields: ['seller_id', 'sku', 'weight_oz', 'length_in', 'width_in', 'height_in'] },
  { table: 'inventory_transfers', sellerField: 'seller_id', expectedFields: ['seller_id', 'transfer_id', 'quantity_sent', 'quantity_received', 'transfer_date'] },
  { table: 'inventory_ledger', sellerField: 'user_id', expectedFields: ['tenant_id', 'user_id', 'fnsku', 'event_date', 'quantity', 'adjustment_type'] },
];

function pickSample(result: DetectionLike) {
  return {
    anomaly_type: result.anomaly_type,
    estimated_value: result.estimated_value,
    confidence_score: result.confidence_score,
    severity: result.severity,
    key_identity: {
      order_id: result.order_id,
      shipment_id: result.shipment_id,
      transfer_id: result.transfer_id,
      sku: result.sku,
      fnsku: result.fnsku,
      asin: result.asin,
      product_name: result.product_name,
      detection_type: result.detection_type,
      loss_type: result.loss_type,
    },
    evidence_excerpt: result.evidence
      ? Object.fromEntries(
          Object.entries(result.evidence).slice(0, 8)
        )
      : {},
    related_event_ids: result.related_event_ids || [],
  };
}

async function chooseTenantWithData(): Promise<{ tenantId: string; userId: string; slug: string | null }> {
  const explicitUserId = process.env.AGENT3_USER_ID;
  const explicitTenantId = process.env.AGENT3_TENANT_ID;

  if (explicitUserId) {
    let query = supabaseAdmin
      .from('tenant_memberships')
      .select('tenant_id,user_id,tenants(slug)')
      .eq('user_id', explicitUserId)
      .limit(1);

    if (explicitTenantId) {
      query = query.eq('tenant_id', explicitTenantId);
    }

    const explicit = await query.maybeSingle();
    if (explicit.error || !explicit.data) {
      throw new Error(
        `Unable to resolve explicit tenant membership for ${explicitUserId}: ${explicit.error?.message || 'not found'}`
      );
    }

    return {
      tenantId: explicit.data.tenant_id,
      userId: explicit.data.user_id,
      slug: explicit.data.tenants?.slug || null,
    };
  }

  const { data, error } = await supabaseAdmin
    .from('tenant_memberships')
    .select('tenant_id,user_id,tenants(slug)')
    .limit(25);

  if (error || !data?.length) {
    throw new Error(`Unable to resolve tenant membership: ${error?.message || 'no memberships found'}`);
  }

  let best: { tenantId: string; userId: string; slug: string | null; score: number } | null = null;

  for (const membership of data as Membership[]) {
    let score = 0;
    for (const source of [
      { table: 'orders', sellerField: 'user_id' },
      { table: 'shipments', sellerField: 'user_id' },
      { table: 'returns', sellerField: 'user_id' },
      { table: 'settlements', sellerField: 'user_id' },
      { table: 'inventory_items', sellerField: 'user_id' },
      { table: 'financial_events', sellerField: 'seller_id' },
    ]) {
      const { count } = await supabaseAdmin
        .from(source.table)
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', membership.tenant_id as any)
        .eq(source.sellerField as any, membership.user_id as any);
      score += count || 0;
    }

    if (!best || score > best.score) {
      best = {
        tenantId: membership.tenant_id,
        userId: membership.user_id,
        slug: membership.tenants?.slug || null,
        score,
      };
    }
  }

  if (!best) {
    throw new Error('No tenant with data could be selected');
  }

  return { tenantId: best.tenantId, userId: best.userId, slug: best.slug };
}

async function summarizeInputTable(
  table: string,
  sellerField: string,
  tenantId: string,
  userId: string,
  expectedFields: string[]
): Promise<InputTableSummary> {
  const countQuery = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as any)
    .eq(sellerField as any, userId as any);

  if (countQuery.error) {
    return {
      table,
      count: 0,
      keyFieldsPresent: [],
      sampleKeys: [],
      error: countQuery.error.message,
    };
  }

  const sampleQuery = await supabaseAdmin
    .from(table)
    .select('*')
    .eq('tenant_id', tenantId as any)
    .eq(sellerField as any, userId as any)
    .limit(1)
    .maybeSingle();

  const sample = sampleQuery.data || {};
  const sampleKeys = Object.keys(sample);

  return {
    table,
    count: countQuery.count || 0,
    keyFieldsPresent: expectedFields.filter((field) => sampleKeys.includes(field)),
    sampleKeys,
    error: sampleQuery.error?.message || null,
  };
}

function validateResults(results: DetectionLike[]) {
  const issues: string[] = [];

  for (const [index, result] of results.entries()) {
    if (!result.anomaly_type) issues.push(`result ${index} missing anomaly_type`);
    if (typeof result.estimated_value !== 'number' || Number.isNaN(result.estimated_value)) {
      issues.push(`result ${index} missing numeric estimated_value`);
    }
    if (typeof result.confidence_score !== 'number' || Number.isNaN(result.confidence_score)) {
      issues.push(`result ${index} missing numeric confidence_score`);
    }
    if (!result.evidence) issues.push(`result ${index} missing evidence`);
    if (!result.seller_id) issues.push(`result ${index} missing seller_id`);
    if (!result.sync_id) issues.push(`result ${index} missing sync_id`);
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}

function assessFinancialSanity(results: DetectionLike[]) {
  const issues: string[] = [];

  for (const [index, result] of results.entries()) {
    const value = result.estimated_value || 0;
    if (value <= 0) {
      issues.push(`result ${index} has non-positive estimated_value ${value}`);
    }
    if (value > 100000) {
      issues.push(`result ${index} has extreme estimated_value ${value}`);
    }
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}

function assessConfidence(results: DetectionLike[]) {
  const invalid = results.filter((result) => {
    const score = result.confidence_score;
    return typeof score !== 'number' || score < 0 || score > 1;
  });

  const uniqueScores = new Set(results.map((result) => result.confidence_score));

  return {
    valid: invalid.length === 0 && (results.length === 0 || uniqueScores.size >= 1),
    invalidCount: invalid.length,
    uniqueScoreCount: uniqueScores.size,
  };
}

async function main() {
  if (!isRealDatabaseConfigured) {
    throw new Error('Real Supabase configuration is required for Agent 3 production assessment');
  }

  const tenant = await chooseTenantWithData();
  const inputTables: InputTableSummary[] = [];

  for (const source of INPUT_TABLES) {
    inputTables.push(
      await summarizeInputTable(source.table, source.sellerField, tenant.tenantId, tenant.userId, source.expectedFields)
    );
  }

  const syncId = new Date().toISOString();
  const statuses = await getAgent3AlgorithmStatuses(tenant.userId);

  const whaleHunter = await runLostInventoryDetection(tenant.userId, syncId);
  const transferLoss = await runTransferLossDetection(tenant.userId, syncId);
  const inboundInspector = await runInboundDetection(tenant.userId, syncId);
  const brokenGoods = await runDamagedInventoryDetection(tenant.userId, syncId);
  const refundTrap = await runRefundWithoutReturnDetection(tenant.userId, syncId);
  const feePhantom = await runFeeOverchargeDetection(tenant.userId, syncId);
  const sentinel = await runSentinelDetection(tenant.userId, syncId);

  const pipeline = await enhancedDetectionService.triggerDetectionPipeline(
    tenant.userId,
    syncId,
    'manual',
    { tenantId: tenant.tenantId, source: 'agent3-production-assessment' }
  );

  const algorithmResults: AlgorithmSummary[] = [
    {
      name: 'Whale Hunter',
      detections: whaleHunter.length,
      estimatedValue: whaleHunter.reduce((sum, item) => sum + (item.estimated_value || 0), 0),
      samples: whaleHunter.slice(0, 2).map(pickSample),
      notes: whaleHunter.length === 0 ? ['No detections returned'] : [],
      rawResults: whaleHunter,
    },
    {
      name: 'Transfer Loss',
      detections: transferLoss.length,
      estimatedValue: transferLoss.reduce((sum, item) => sum + (item.estimated_value || 0), 0),
      samples: transferLoss.slice(0, 2).map(pickSample),
      notes: transferLoss.length === 0 ? ['No detections returned'] : [],
      rawResults: transferLoss,
    },
    {
      name: 'Inbound Inspector',
      detections: inboundInspector.length,
      estimatedValue: inboundInspector.reduce((sum, item) => sum + (item.estimated_value || 0), 0),
      samples: inboundInspector.slice(0, 2).map(pickSample),
      notes: inboundInspector.length === 0 ? ['No detections returned'] : [],
      rawResults: inboundInspector,
    },
    {
      name: 'Broken Goods Hunter',
      detections: brokenGoods.length,
      estimatedValue: brokenGoods.reduce((sum, item) => sum + (item.estimated_value || 0), 0),
      samples: brokenGoods.slice(0, 2).map(pickSample),
      notes: brokenGoods.length === 0 ? ['No detections returned'] : [],
      rawResults: brokenGoods,
    },
    {
      name: 'Refund Trap',
      detections: refundTrap.length,
      estimatedValue: refundTrap.reduce((sum, item) => sum + (item.estimated_value || 0), 0),
      samples: refundTrap.slice(0, 2).map(pickSample),
      notes: refundTrap.length === 0 ? ['No detections returned'] : [],
      rawResults: refundTrap,
    },
    {
      name: 'Fee Phantom',
      detections: feePhantom.length,
      estimatedValue: feePhantom.reduce((sum, item) => sum + (item.estimated_value || 0), 0),
      samples: feePhantom.slice(0, 2).map(pickSample),
      notes: feePhantom.length === 0 ? ['No detections returned'] : [],
      rawResults: feePhantom,
    },
    {
      name: 'Sentinel',
      detections: sentinel.length,
      estimatedValue: sentinel.reduce((sum, item) => sum + (item.estimated_value || 0), 0),
      samples: sentinel.slice(0, 2).map(pickSample),
      notes: sentinel.length === 0 ? ['No detections returned'] : [],
      rawResults: sentinel,
    },
  ];

  const allResults = algorithmResults.flatMap((algorithm) => algorithm.rawResults);
  const structural = validateResults(allResults);
  const financial = assessFinancialSanity(allResults);
  const confidence = assessConfidence(allResults);

  const storedResults = await supabaseAdmin
    .from('detection_results')
    .select('id,sync_id,anomaly_type,estimated_value,confidence_score,evidence,created_at')
    .eq('seller_id', tenant.userId)
    .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(50);

  console.log(
    JSON.stringify(
      {
        tenant,
        syncId,
        inputTables,
        statuses,
        pipeline,
        algorithmResults: algorithmResults.map(({ rawResults, ...rest }) => rest),
        structural,
        financial,
        confidence,
        storedResults: storedResults.data || [],
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
