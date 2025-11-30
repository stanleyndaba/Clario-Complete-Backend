
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkClaims() {
    console.log('Checking latest detection_results...');

    // Get latest 100 claims
    const { data: claims, error } = await supabase
        .from('detection_results')
        .select('estimated_value, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error fetching claims:', error);
        return;
    }

    console.log(`Fetched ${claims.length} latest claims.`);

    if (claims.length > 0) {
        console.log(`Latest claim created at: ${claims[0].created_at}`);
        console.log(`Oldest of batch created at: ${claims[claims.length - 1].created_at}`);
    }

    const totalValue = claims.reduce((sum: number, claim: any) => sum + (claim.estimated_value || 0), 0);
    console.log(`Total value of latest ${claims.length} claims: $${totalValue.toFixed(2)}`);
}

checkClaims();
