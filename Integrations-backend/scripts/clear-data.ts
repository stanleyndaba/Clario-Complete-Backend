/**
 * Clear all detection results for a fresh start
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function clearData() {
    console.log('\n=== CLEARING DATA FOR FRESH START ===\n');

    // 1. Clear detection_results
    console.log('1. Clearing detection_results...');
    const { error: detError, count: detCount } = await supabaseAdmin
        .from('detection_results')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all (workaround for Supabase)

    if (detError) {
        console.log('   Error:', detError.message);
    } else {
        console.log('   Deleted detection_results');
    }

    // 2. Clear dispute_cases
    console.log('2. Clearing dispute_cases...');
    const { error: dispError } = await supabaseAdmin
        .from('dispute_cases')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

    if (dispError) {
        console.log('   Error:', dispError.message);
    } else {
        console.log('   Deleted dispute_cases');
    }

    // 3. Clear dispute_evidence_links
    console.log('3. Clearing dispute_evidence_links...');
    const { error: linkError } = await supabaseAdmin
        .from('dispute_evidence_links')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

    if (linkError) {
        console.log('   Error:', linkError.message);
    } else {
        console.log('   Deleted dispute_evidence_links');
    }

    // 4. Reset claim_number sequence
    console.log('4. Resetting claim_number sequence...');
    const { error: seqError } = await supabaseAdmin.rpc('reset_claim_sequence');
    if (seqError) {
        console.log('   Note: Could not reset sequence (may need manual reset)');
    }

    // 5. Verify counts
    console.log('\n5. Verifying empty tables...');
    const { count: detRemain } = await supabaseAdmin
        .from('detection_results')
        .select('id', { count: 'exact', head: true });
    console.log('   detection_results:', detRemain || 0, 'remaining');

    console.log('\n=== DATA CLEARED - READY FOR FRESH SYNC ===\n');
}

clearData()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
