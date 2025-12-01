
import { createClient } from '@supabase/supabase-js';

// Credentials from User's Render Env Vars (Step 361)
const supabaseUrl = 'https://uuuqpujtnubusmigbkvw.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dXFwdWp0bnVidXNtaWdia3Z3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzM5NjgzOSwiZXhwIjoyMDY4OTcyODM5fQ.Z_1TUlk3WgtCggP80UYPGj8gK-JKdgjPf3rNkHxIrBE';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanRenderTokens() {
    console.log('🔌 Connecting to RENDER Database...');
    console.log(`URL: ${supabaseUrl}`);

    // 1. Check count before
    const { count: countBefore, error: countError } = await supabase
        .from('tokens')
        .select('*', { count: 'exact', head: true })
        .eq('provider', 'gmail');

    if (countError) {
        console.error('❌ Error connecting/counting:', countError);
        return;
    }

    console.log(`\nFound ${countBefore} Gmail tokens in Render DB.`);

    if (countBefore === 0) {
        console.log('✅ No tokens to delete.');
        return;
    }

    // 2. Delete tokens
    console.log('🗑️ Deleting all Gmail tokens...');
    const { error: deleteError } = await supabase
        .from('tokens')
        .delete()
        .eq('provider', 'gmail');

    if (deleteError) {
        console.error('❌ Error deleting tokens:', deleteError);
    } else {
        console.log('✅ Successfully deleted all Gmail tokens from Render DB.');
        console.log('   Now the backend is clean and ready for a fresh connection.');
    }
}

cleanRenderTokens().catch(console.error);
