import 'dotenv/config';
import { supabaseAdmin } from './src/database/supabaseClient';
import { getAgent3AlgorithmStatuses } from './src/services/detection/core/productionConnectionStatus';
import { fetchRefundEvents, runRefundWithoutReturnDetection } from './src/services/detection/core/detectors/refundAlgorithms';
import { fetchInboundShipmentItems, runInboundDetection } from './src/services/detection/core/detectors/inboundAlgorithms';
import { fetchDamagedEvents, runDamagedInventoryDetection } from './src/services/detection/core/detectors/damagedAlgorithms';
import { runLostInventoryDetection } from './src/services/detection/core/detectors/inventoryAlgorithms';
import { runTransferLossDetection } from './src/services/detection/core/detectors/warehouseTransferLossAlgorithm';
import { runFeeOverchargeDetection } from './src/services/detection/core/detectors/feeAlgorithms';
import { runSentinelDetection } from './src/services/detection/core/detectors/duplicateMissedReimbursementAlgorithm';

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
  }));
}

async function main() {
  const userId = 'cf6d8078-e83a-472a-baf5-d241eb7ab36e';
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const syncId = `agent3-closure-${Date.now()}`;

  const refundsVisible = await fetchRefundEvents(userId, { startDate: '2025-01-01T00:00:00Z' });
  const inboundVisible = await fetchInboundShipmentItems(userId);
  const damagedVisible = await fetchDamagedEvents(userId, { startDate: '2025-01-01T00:00:00Z' });

  const whale = await runLostInventoryDetection(userId, syncId);
  const transfer = await runTransferLossDetection(userId, syncId);
  const inbound = await runInboundDetection(userId, syncId);
  const broken = await runDamagedInventoryDetection(userId, syncId);
  const refundTrap = await runRefundWithoutReturnDetection(userId, syncId);
  const fee = await runFeeOverchargeDetection(userId, syncId);
  const sentinel = await runSentinelDetection(userId, syncId);

  const persistedBroken = await supabaseAdmin
    .from('detection_results')
    .select('id,anomaly_type,sync_id,evidence,related_event_ids,estimated_value,confidence_score')
    .eq('tenant_id', tenantId as any)
    .eq('seller_id', userId as any)
    .eq('sync_id', syncId as any)
    .eq('anomaly_type', 'damaged_warehouse');

  const rerunBroken = await runDamagedInventoryDetection(userId, syncId);
  const persistedBrokenAfterRerun = await supabaseAdmin
    .from('detection_results')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as any)
    .eq('seller_id', userId as any)
    .eq('sync_id', syncId as any)
    .eq('anomaly_type', 'damaged_warehouse');

  const all = [...whale, ...transfer, ...inbound, ...broken, ...refundTrap, ...fee, ...sentinel];
  const statuses = await getAgent3AlgorithmStatuses(userId);

  console.log(JSON.stringify({
    syncId,
    refundsVisible: refundsVisible.length,
    inboundVisible: inboundVisible.filter((r:any)=> (r.quantity_shipped||0) > (r.quantity_received||0)).map((r:any)=>({shipment_id:r.shipment_id, status:r.shipment_status, shipped:r.quantity_shipped, received:r.quantity_received, created:r.shipment_created_date, closed:r.shipment_closed_date})),
    damagedVisible: damagedVisible.length,
    outputs: {
      whaleHunter: { count: whale.length, total: whale.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(whale) },
      transferLoss: { count: transfer.length, total: transfer.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(transfer) },
      inboundInspector: { count: inbound.length, total: inbound.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(inbound) },
      brokenGoodsHunter: { count: broken.length, total: broken.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(broken) },
      refundTrap: { count: refundTrap.length, total: refundTrap.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(refundTrap) },
      feePhantom: { count: fee.length, total: fee.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(fee) },
      sentinel: { count: sentinel.length, total: sentinel.reduce((s,r)=>s+(r.estimated_value||0),0), sample: sample(sentinel) },
    },
    persistedBrokenCount: persistedBroken.data?.length || 0,
    persistedBrokenSample: (persistedBroken.data || []).slice(0,2),
    rerunBrokenCount: rerunBroken.length,
    persistedBrokenAfterRerun: persistedBrokenAfterRerun.count || 0,
    statuses,
    totals: { detections: all.length, estimatedValue: all.reduce((s,r)=>s+(r.estimated_value||0),0) },
    trust: {
      structural: all.every(r => r.anomaly_type && typeof r.estimated_value === 'number' && typeof r.confidence_score === 'number' && r.seller_id && r.sync_id),
      financial: all.every(r => (r.estimated_value || 0) > 0 && (r.estimated_value || 0) < 100000),
      confidence: all.every(r => typeof r.confidence_score === 'number' && r.confidence_score >= 0 && r.confidence_score <= 1),
    }
  }, null, 2));
}
main().catch(err=>{console.error(err);process.exit(1);});
