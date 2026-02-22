import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function analyzeAgent3() {
    const userId = '00000000-0000-0000-0000-000000000001';
    console.log(`Analyzing Agent 3 results for user: ${userId}`);

    const { data, error } = await supabaseAdmin
        .from('detection_results')
        .select('*')
        .eq('seller_id', userId);

    if (error) {
        console.error('Error fetching results:', error);
        return;
    }

    const typeBreakdown: Record<string, number> = {};
    const agent3Types = [
        'shipment_missing', 'shipment_shortage', 'receiving_error',
        'carrier_damage', 'case_break_error', 'prep_fee_error',
        'lost_inbound', 'damaged_inbound'
    ];

    data.forEach(r => {
        typeBreakdown[r.anomaly_type] = (typeBreakdown[r.anomaly_type] || 0) + 1;
    });

    console.log('\n--- Anomaly Type Breakdown ---');
    Object.entries(typeBreakdown).forEach(([type, count]) => {
        const isAgent3 = agent3Types.includes(type) ? '(Agent 3)' : '';
        console.log(`${type}: ${count} ${isAgent3}`);
    });

    const agent3Results = data.filter(r => agent3Types.includes(r.anomaly_type));
    console.log(`\nTotal Agent 3 Results: ${agent3Results.length}`);

    if (agent3Results.length > 0) {
        console.log('\n--- Agent 3 Sample Detail ---');
        const sample = agent3Results[0];
        console.log('ID:', sample.id);
        console.log('Type:', sample.anomaly_type);
        console.log('Value:', sample.estimated_value);
        console.log('Status:', sample.status);
        console.log('Evidence Summary:', sample.evidence?.summary || 'No summary');
        console.log('Shipment ID:', sample.shipment_id);
    }
}

analyzeAgent3();
