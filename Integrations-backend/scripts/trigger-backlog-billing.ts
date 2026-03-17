import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import billingService from '../src/services/billingService';
import logger from '../src/utils/logger';

async function triggerBacklog() {
    console.log('🚀 Starting Backlog Billing Trigger (PayPal Only)...');
    
    // 1. Fetch approved but uninvoiced cases with their recoveries
    const { data: backlog, error } = await supabaseAdmin
        .from('dispute_cases')
        .select(`
            id,
            seller_id,
            billing_status,
            status,
            currency,
            recoveries (
                id,
                actual_amount
            )
        `)
        .eq('status', 'approved')
        .neq('billing_status', 'charged')
        .limit(5); // Process a small batch for verification

    if (error) {
        console.error('❌ Error fetching backlog:', error);
        return;
    }

    console.log(`📊 Processing ${backlog?.length || 0} cases...`);

    for (const caseObj of backlog || []) {
        try {
            // Find recovery with amount > 0
            const recovery = caseObj.recoveries?.find((r: any) => (r.actual_amount || 0) > 0);
            
            if (!recovery) {
                console.warn(`⚠️ Case ${caseObj.id} has no recovery amount. Skipping.`);
                continue;
            }

            console.log(`💰 Charging case ${caseObj.id} | Amount: ${recovery.actual_amount} ${caseObj.currency}`);

            const result = await billingService.chargeCommission({
                disputeId: caseObj.id,
                recoveryId: recovery.id,
                userId: caseObj.seller_id,
                amountRecoveredCents: Math.round(recovery.actual_amount * 100),
                currency: caseObj.currency || 'USD'
            });

            if (result.success) {
                console.log(`✅ Success for Case ${caseObj.id}. Invoice: ${result.paypalInvoiceId}`);
                
                // 1. Create a transaction record in the database
                const { data: txRecord, error: txError } = await supabaseAdmin
                    .from('billing_transactions')
                    .insert({
                        dispute_id: caseObj.id,
                        recovery_id: recovery.id,
                        user_id: caseObj.seller_id,
                        amount_recovered_cents: Math.round(recovery.actual_amount * 100),
                        platform_fee_cents: result.platformFeeCents,
                        seller_payout_cents: result.sellerPayoutCents,
                        currency: caseObj.currency || 'USD',
                        billing_status: 'charged',
                        metadata: { 
                            paypal_invoice_id: result.paypalInvoiceId,
                            source: 'backlog_trigger_script'
                        }
                    })
                    .select()
                    .single();

                if (txError) {
                    console.error(`❌ Failed to create transaction record for Case ${caseObj.id}:`, txError.message);
                }

                // 2. Update billing status in DB
                const { error: updateError } = await supabaseAdmin
                    .from('dispute_cases')
                    .update({ 
                        billing_status: 'charged',
                        billing_transaction_id: txRecord?.id,
                        platform_fee_cents: result.platformFeeCents,
                        seller_payout_cents: result.sellerPayoutCents,
                        billed_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', caseObj.id);
                
                if (updateError) {
                    console.error(`❌ Failed to update DB status for Case ${caseObj.id}:`, updateError.message);
                }
            } else {
                console.error(`❌ Failed for Case ${caseObj.id}: ${result.error}`);
            }

        } catch (err: any) {
            console.error(`❌ Unexpected error for Case ${caseObj.id}:`, err.message);
        }
    }

    console.log('🏁 Batch processing complete.');
}

triggerBacklog().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
