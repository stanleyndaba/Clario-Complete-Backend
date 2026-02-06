import { supabaseAdmin } from './src/database/supabaseClient';
import logger from './src/utils/logger';

async function verifyWaitlistTable() {
    console.log('Verifying waitlist table...');
    try {
        const { data, error } = await supabaseAdmin
            .from('waitlist')
            .select('count', { count: 'exact', head: true });

        if (error) {
            console.error('Error checking waitlist table:', error);
            process.exit(1);
        }

        console.log('✅ Waitlist table exists and is accessible.');
        console.log(`Current signups: ${data || 0}`);
        process.exit(0);
    } catch (err) {
        console.error('Unexpected error:', err);
        process.exit(1);
    }
}

verifyWaitlistTable();
