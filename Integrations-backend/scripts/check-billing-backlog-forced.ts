
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function checkBacklog() {
    console.log('🔍 Checking database for approved but unbilled cases (FORCED CONNECTION)...');
    
    const { data: approvedCases, error } = await supabaseAdmin
        .from('dispute_cases')
        .select(`
            id,
            status,
            billing_status,
            seller_id
        `)
        .eq('status', 'approved')
        .neq('billing_status', 'invoiced');

    if (error) {
        console.error('❌ Error fetching backlog:', error);
        return;
    }

    console.log(`📊 Found ${approvedCases?.length || 0} approved cases that are not yet invoiced.`);
    
    if (approvedCases && approvedCases.length > 0) {
        approvedCases.forEach(c => {
            console.log(` - Case ${c.id}: Status=${c.status}, Billing=${c.billing_status}`);
        });
    }
}

checkBacklog().then(() => process.exit(0));
