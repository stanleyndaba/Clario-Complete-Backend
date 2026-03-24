import 'dotenv/config';
import { supabaseAdmin, isRealDatabaseConfigured } from './src/database/supabaseClient';
import { getAgent3AlgorithmStatuses } from './src/services/detection/core/productionConnectionStatus';
import { fetchInventoryLedger, runLostInventoryDetection } from './src/services/detection/core/detectors/inventoryAlgorithms';
import { fetchTransferRecords, runTransferLossDetection } from './src/services/detection/core/detectors/warehouseTransferLossAlgorithm';
import { fetchInboundShipmentItems, fetchInboundReimbursements, runInboundDetection } from './src/services/detection/core/detectors/inboundAlgorithms';
import { fetchDamagedEvents, fetchReimbursementsForDamage, runDamagedInventoryDetection } from './src/services/detection/core/detectors/damagedAlgorithms';
import { fetchRefundEvents, fetchReturnEvents, fetchReimbursementEvents, runRefundWithoutReturnDetection } from './src/services/detection/core/detectors/refundAlgorithms';
import { fetchFeeEvents, fetchProductCatalog, runFeeOverchargeDetection } from './src/services/detection/core/detectors/feeAlgorithms';
import { fetchLossEvents, fetchReimbursementEventsForSentinel, runSentinelDetection } from './src/services/detection/core/detectors/duplicateMissedReimbursementAlgorithm';

function sample(results: any[]) {
  return results.slice(0, 2).map((r) => ({
    anomaly_type: r.anomaly_type,
    estimated_value: r.estimated_value,
    confidence_score: r.confidence_score,
    severity: r.severity,
    order_id: r.order_id,
    shipment_id: r.shipment_id,
    transfer_id: r.transfer_id,
    sku: r.sku,
    fnsku: r.fnsku,
    detection_type: r.detection_type,
    loss_type: r.loss_type,
  }));
}

function structural(results: any[]) {
  const issues: string[] = [];
  results.forEach((r, i) => {
    if (!r.anomaly_type) issues.push(`missing anomaly_type ${i}`);
    if (typeof r.estimated_value !== 'number' || Number.isNaN(r.estimated_value)) issues.push(`missing estimated_value ${i}`);
    if (typeof r.confidence_score !== 'number' || Number.isNaN(r.confidence_score)) issues.push(`missing confidence ${i}`);
    if (!r.seller_id) issues.push(`missing seller ${i}`);
    if (!r.sync_id) issues.push(`missing sync ${i}`);
  });
  return { pass: issues.length === 0, issues };
}

function sanity(results: any[]) {
  const issues: string[] = [];
  results.forEach((r, i) => {
    const v = r.estimated_value || 0;
    if (v <= 0) issues.push(`non-positive ${i}:${v}`);
    if (v > 100000) issues.push(`extreme ${i}:${v}`);
  });
  return { pass: issues.length === 0, issues };
}

async function count(table: string, tenantId: string, sellerField: string, userId: string) {
  const { count, error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId as any).eq(sellerField as any, userId as any);
  return { count: count || 0, error: error?.message || null };
}

async function main() {
  if (!isRealDatabaseConfigured) throw new Error('Real DB required');
  const userId = process.env.AGENT3_USER_ID || process.env.CSV_TEST_USER_ID || 'cf6d8078-e83a-472a-baf5-d241eb7ab36e';
  const tenantId = process.env.AGENT3_TENANT_ID || process.env.CSV_TEST_TENANT_ID || '00000000-0000-0000-0000-000000000001';
  const syncId = `agent3-final-${Date.now()}`;

  const dataCounts = {
    orders: await count('orders', tenantId, 'user_id', userId),
    shipments: await count('shipments', tenantId, 'user_id', userId),
    returns: await count('returns', tenantId, 'user_id', userId),
    settlements: await count('settlements', tenantId, 'user_id', userId),
    financial_events: await count('financial_events', tenantId, 'seller_id', userId),
    inventory_ledger_events: await count('inventory_ledger_events', tenantId, 'user_id', userId),
    inventory_transfers: await count('inventory_transfers', tenantId, 'seller_id', userId),
    inventory_ledger: await count('inventory_ledger', tenantId, 'user_id', userId),
  };

  const statuses = await getAgent3AlgorithmStatuses(userId);

  const whaleInput = await fetchInventoryLedger(userId, syncId);
  const transferInput = await fetchTransferRecords(userId);
  const inboundItems = await fetchInboundShipmentItems(userId);
  const inboundReimbs = await fetchInboundReimbursements(userId);
  const damagedEvents = await fetchDamagedEvents(userId);
  const damagedReimbs = await fetchReimbursementsForDamage(userId);
  const refunds = await fetchRefundEvents(userId);
  const returns = await fetchReturnEvents(userId);
  const refundReimbs = await fetchReimbursementEvents(userId);
  const feeEvents = await fetchFeeEvents(userId, { startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() });
  const productCatalog = await fetchProductCatalog(userId);
  const sentinelLoss = await fetchLossEvents(userId, { lookbackDays: 180 });
  const sentinelReimbs = await fetchReimbursementEventsForSentinel(userId, { lookbackDays: 180 });

  const whale = await runLostInventoryDetection(userId, syncId);
  const transfer = await runTransferLossDetection(userId, syncId);
  const inbound = await runInboundDetection(userId, syncId);
  const broken = await runDamagedInventoryDetection(userId, syncId);
  const refundTrap = await runRefundWithoutReturnDetection(userId, syncId);
  const fee = await runFeeOverchargeDetection(userId, syncId);
  const sentinel = await runSentinelDetection(userId, syncId);

  const all = [...whale, ...transfer, ...inbound, ...broken, ...refundTrap, ...fee, ...sentinel];

  console.log(JSON.stringify({
    tenantId,
    userId,
    syncId,
    dataCounts,
    statuses,
    visibleInputs: {
      whaleHunter: whaleInput.inventory_ledger.length,
      transferLoss: transferInput.length,
      inboundInspector: { shipments: inboundItems.length, reimbursements: inboundReimbs.length },
      brokenGoodsHunter: { damagedEvents: damagedEvents.length, reimbursements: damagedReimbs.length },
      refundTrap: { refunds: refunds.length, returns: returns.length, reimbursements: refundReimbs.length },
      feePhantom: { feeEvents: feeEvents.length, productCatalog: productCatalog.length },
      sentinel: { lossEvents: sentinelLoss.length, reimbursements: sentinelReimbs.length },
    },
    outputs: {
      whaleHunter: { count: whale.length, total: whale.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(whale) },
      transferLoss: { count: transfer.length, total: transfer.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(transfer) },
      inboundInspector: { count: inbound.length, total: inbound.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(inbound) },
      brokenGoodsHunter: { count: broken.length, total: broken.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(broken) },
      refundTrap: { count: refundTrap.length, total: refundTrap.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(refundTrap) },
      feePhantom: { count: fee.length, total: fee.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(fee) },
      sentinel: { count: sentinel.length, total: sentinel.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(sentinel) },
    },
    trust: {
      structural: structural(all),
      financial: sanity(all),
      confidence: { valid: all.every(r => typeof r.confidence_score === 'number' && r.confidence_score >= 0 && r.confidence_score <= 1) },
    },
    totals: {
      detections: all.length,
      estimatedValue: all.reduce((s,r)=>s+(r.estimated_value||0),0),
    }
  }, null, 2));
}
main().catch(err => { console.error(err); process.exit(1); });
