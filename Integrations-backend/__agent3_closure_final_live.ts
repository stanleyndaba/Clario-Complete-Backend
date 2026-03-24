import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { csvIngestionService } from './src/services/csvIngestionService';
import { fetchInboundShipmentItems, runInboundDetection, fetchInboundReimbursements } from './src/services/detection/core/detectors/inboundAlgorithms';
import { runRefundWithoutReturnDetection, fetchRefundEvents } from './src/services/detection/core/detectors/refundAlgorithms';
import { runDamagedInventoryDetection } from './src/services/detection/core/detectors/damagedAlgorithms';
import { runLostInventoryDetection } from './src/services/detection/core/detectors/inventoryAlgorithms';
import { runTransferLossDetection } from './src/services/detection/core/detectors/warehouseTransferLossAlgorithm';
import { runFeeOverchargeDetection } from './src/services/detection/core/detectors/feeAlgorithms';
import { runSentinelDetection } from './src/services/detection/core/detectors/duplicateMissedReimbursementAlgorithm';
import { supabaseAdmin } from './src/database/supabaseClient';

function sample(results:any[]){return results.slice(0,2).map(r=>({anomaly_type:r.anomaly_type,estimated_value:r.estimated_value,confidence_score:r.confidence_score,severity:r.severity,order_id:r.order_id,shipment_id:r.shipment_id,transfer_id:r.transfer_id,sku:r.sku,fnsku:r.fnsku}))}

async function main(){
 const userId='cf6d8078-e83a-472a-baf5-d241eb7ab36e';
 const tenantId='00000000-0000-0000-0000-000000000001';
 const src=path.join(process.cwd(),'shipments1.csv');
 const copy='__shipments_recent_patch.csv';
 fs.writeFileSync(path.join(process.cwd(),copy), '# shipment repatch\n'+fs.readFileSync(src,'utf-8'), 'utf-8');
 const upload = await csvIngestionService.ingestFiles(userId,[{buffer:fs.readFileSync(path.join(process.cwd(),copy)),originalname:copy,mimetype:'text/csv'}],{explicitType:'shipments',triggerDetection:false,tenantId});

 const inboundVisible = await fetchInboundShipmentItems(userId);
 const inboundReimbs = await fetchInboundReimbursements(userId);
 const refundsVisible = await fetchRefundEvents(userId,{startDate:'2025-01-01T00:00:00Z'});
 const syncId=`agent3-closure-final-${Date.now()}`;
 const whale=await runLostInventoryDetection(userId,syncId);
 const transfer=await runTransferLossDetection(userId,syncId);
 const inbound=await runInboundDetection(userId,syncId);
 const broken=await runDamagedInventoryDetection(userId,syncId);
 const refundTrap=await runRefundWithoutReturnDetection(userId,syncId);
 const fee=await runFeeOverchargeDetection(userId,syncId);
 const sentinel=await runSentinelDetection(userId,syncId);
 const persistedBroken=await supabaseAdmin.from('detection_results').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId as any).eq('seller_id',userId as any).eq('sync_id',syncId as any).eq('anomaly_type','damaged_warehouse');
 const all=[...whale,...transfer,...inbound,...broken,...refundTrap,...fee,...sentinel];
 console.log(JSON.stringify({
   upload,
   inboundVisible: inboundVisible.filter((r:any)=>(r.quantity_shipped||0)>(r.quantity_received||0)).map((r:any)=>({shipment_id:r.shipment_id,sku:r.sku,fnsku:r.fnsku,status:r.shipment_status,shipped:r.quantity_shipped,received:r.quantity_received,created:r.shipment_created_date})),
   inboundReimbs,
   refundsVisible: refundsVisible.length,
   outputs:{
     whaleHunter:{count:whale.length,total:whale.reduce((s,r)=>s+(r.estimated_value||0),0),sample:sample(whale)},
     transferLoss:{count:transfer.length,total:transfer.reduce((s,r)=>s+(r.estimated_value||0),0),sample:sample(transfer)},
     inboundInspector:{count:inbound.length,total:inbound.reduce((s,r)=>s+(r.estimated_value||0),0),sample:sample(inbound)},
     brokenGoodsHunter:{count:broken.length,total:broken.reduce((s,r)=>s+(r.estimated_value||0),0),sample:sample(broken)},
     refundTrap:{count:refundTrap.length,total:refundTrap.reduce((s,r)=>s+(r.estimated_value||0),0),sample:sample(refundTrap)},
     feePhantom:{count:fee.length,total:fee.reduce((s,r)=>s+(r.estimated_value||0),0),sample:sample(fee)},
     sentinel:{count:sentinel.length,total:sentinel.reduce((s,r)=>s+(r.estimated_value||0),0),sample:sample(sentinel)}
   },
   persistedBrokenCount:persistedBroken.count||0,
   totals:{detections:all.length,estimatedValue:all.reduce((s,r)=>s+(r.estimated_value||0),0)},
   trust:{
     structural: all.every(r=>r.anomaly_type && typeof r.estimated_value==='number' && typeof r.confidence_score==='number' && r.seller_id && r.sync_id),
     financial: all.every(r=>(r.estimated_value||0)>0 && (r.estimated_value||0)<100000),
     confidence: all.every(r=>typeof r.confidence_score==='number' && r.confidence_score>=0 && r.confidence_score<=1)
   }
 },null,2));
}
main().catch(err=>{console.error(err);process.exit(1)});
