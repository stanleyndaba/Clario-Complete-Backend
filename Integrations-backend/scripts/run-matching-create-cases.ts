/**
 * Run matching for a user and create dispute cases
 */
require('dotenv').config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runMatchingForUser(userId: string) {
    console.log('=== Running Matching with Dispute Case Creation ===');
    console.log('User:', userId);

    // Import the matching service
    const { evidenceMatchingService } = await import('../src/services/evidenceMatchingService');

    try {
        // Run matching with retry (includes processMatchingResults which creates dispute cases)
        console.log('\nStep 1: Running matching...');
        const result = await evidenceMatchingService.runMatchingWithRetry(userId);

        console.log('\nMatching Results:');
        console.log('  Matches found:', result.matches);
        console.log('  Auto-submits:', result.auto_submits);
        console.log('  Smart prompts:', result.smart_prompts);

        // Verify dispute cases
        console.log('\nStep 2: Checking dispute cases...');
        const { data: cases, error } = await supabase
            .from('dispute_cases')
            .select('case_number, status, filing_status, claim_amount')
            .eq('seller_id', userId);

        if (error) {
            console.log('Error fetching dispute cases:', error.message);
        } else {
            console.log('Dispute cases for user:', cases?.length || 0);
            cases?.forEach(c => {
                console.log(`  - ${c.case_number}: ${c.status} (filing: ${c.filing_status}) $${c.claim_amount}`);
            });
        }

    } catch (err: any) {
        console.error('Error running matching:', err.message);
    }
}

// Run for the specified user
const userId = process.argv[2] || '07b4f03d-352e-473f-a316-af97d9017d69';
runMatchingForUser(userId);
