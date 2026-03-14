require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    try {
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('id, email, seller_id')
            .eq('email', 'demo@margin.com');

        if (userError) throw userError;
        if (!users || users.length === 0) {
            console.log('User not found');
            return;
        }

        const user = users[0];
        console.log('USER_ID: ' + user.id);
        console.log('SELLER_ID: ' + user.seller_id);

        const { data: cases, error: caseError } = await supabase
            .from('dispute_cases')
            .select('id, status, filing_status')
            .eq('seller_id', user.seller_id)
            .eq('filing_status', 'pending')
            .limit(1);

        if (caseError) throw caseError;
        if (cases && cases.length > 0) {
            console.log('CASE_ID: ' + cases[0].id);
        } else {
            console.log('No pending cases found for this user');
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}
run();
