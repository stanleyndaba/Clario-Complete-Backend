import 'dotenv/config';
import { fetchInboundShipmentItems, fetchInboundReimbursements } from './src/services/detection/core/detectors/inboundAlgorithms';
import { detectShipmentShortage } from './src/services/detection/core/detectors/inboundAlgorithms';

async function main(){
 const seller='cf6d8078-e83a-472a-baf5-d241eb7ab36e';
 const items=await fetchInboundShipmentItems(seller);
 const reimbs=await fetchInboundReimbursements(seller);
 const shortageCandidates=items.filter(i => i.quantity_shipped > i.quantity_received);
 const results=detectShipmentShortage(seller,'debug-sync',{seller_id:seller,sync_id:'debug-sync',inbound_shipment_items:items,reimbursement_events:reimbs});
 console.log(JSON.stringify({
   shortageCandidates,
   reimbursements: reimbs,
   results
 }, null, 2));
}
main().catch(err=>{console.error(err);process.exit(1);});
