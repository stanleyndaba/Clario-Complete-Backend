import 'dotenv/config';
import { supabaseAdmin } from './src/database/supabaseClient';
async function main(){
 const userId='cf6d8078-e83a-472a-baf5-d241eb7ab36e';
 const tenantId='00000000-0000-0000-0000-000000000001';
 const settlements = await supabaseAdmin.from('settlements').select('id,settlement_id,transaction_type,amount,settlement_date,order_id,metadata,currency').eq('tenant_id',tenantId as any).eq('user_id',userId as any).order('settlement_date',{ascending:true});
 const shipments = await supabaseAdmin.from('shipments').select('*').eq('tenant_id',tenantId as any).eq('user_id',userId as any).order('shipped_date',{ascending:true});
 const detections = await supabaseAdmin.from('detection_results').select('id,seller_id,tenant_id,sync_id,anomaly_type,evidence,estimated_value,confidence_score,created_at').eq('tenant_id',tenantId as any).eq('seller_id',userId as any).order('created_at',{ascending:false}).limit(20);
 console.log(JSON.stringify({settlements:settlements.data, shipSample:(shipments.data||[]).slice(0,20), detectionResults:detections.data, detectErr:detections.error}, null, 2));
}
main().catch(err=>{console.error(err);process.exit(1);});
