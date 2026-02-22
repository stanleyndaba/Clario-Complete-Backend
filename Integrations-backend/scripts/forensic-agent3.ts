import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function forensicAnalysis() {
    const userId = '549add91-df29-4fe5-9c1c-526a683a1ba1';
    console.log(`Forensic analysis of detection results for user: ${userId}`);

    const { data, error } = await supabaseAdmin
        .from('detection_results')
        .select('*')
        .eq('seller_id', userId)
        .limit(5);

    if (error) {
        console.error('Error fetching results:', error);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No results found for this user.');
        return;
    }

    data.forEach((r, i) => {
        console.log(`\n--- Result ${i + 1} ---`);
        console.log('ID:', r.id);
        console.log('Type:', r.anomaly_type);
        console.log('Value:', r.estimated_value);
        console.log('Confidence:', r.confidence_score);
        console.log('Evidence:', JSON.stringify(r.evidence, null, 2));
    });
}

forensicAnalysis();
