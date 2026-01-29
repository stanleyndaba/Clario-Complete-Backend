import 'dotenv/config';
import { supabase } from '../src/database/supabaseClient';

async function verifyResults() {
    const userId = '549add91-df29-4fe5-9c1c-526a683a1ba1';
    console.log(`Verifying results for user: ${userId}`);

    const { data, error, count } = await supabase
        .from('detection_results')
        .select('*', { count: 'exact' })
        .eq('seller_id', userId);

    if (error) {
        console.error('Error fetching results:', error);
        return;
    }

    console.log(`Found ${count} detection results in database!`);
    if (data && data.length > 0) {
        console.log('Sample Result:', {
            type: data[0].anomaly_type,
            confidence: data[0].confidence_score,
            estimated_value: data[0].estimated_value,
            status: data[0].status
        });
    }
}

verifyResults();
