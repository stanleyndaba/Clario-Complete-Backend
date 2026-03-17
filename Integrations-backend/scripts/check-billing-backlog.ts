
import { supabaseAdmin } from '../src/database/supabaseClient';

async function checkBacklog() {
    console.log('🔍 Checking database for approved but unbilled cases...');
    
    // Join dispute_cases and recoveries (or just recoveries if that's where billing happens)
    // Based on billingService.ts, it takes disputeId and recoveryId
    
    const { data: approvedCases, error } = await supabaseAdmin
        .from('dispute_cases')
        .select(`
            id,
            status,
            billing_status,
            seller_id,
            recoveries (
                id,
                reconciled_amount,
                currency
            )
        `)
        .eq('status', 'approved')
        .neq('billing_status', 'invoiced');

    if (error) {
        console.error('❌ Error fetching backlog:', error);
        return;
    }

    console.log(`📊 Found ${approvedCases?.length || 0} approved cases that are not yet invoiced.`);
    
    if (approvedCases && approvedCases.length > 0) {
        approvedCases.slice(0, 5).forEach(c => {
            console.log(` - Case ${c.id}: Status=${c.status}, Billing=${c.billing_status}, Recoveries=${c.recoveries?.length || 0}`);
        });
    }
}

checkBacklog().then(() => process.exit(0));
