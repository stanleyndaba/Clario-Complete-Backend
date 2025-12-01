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

async function checkIngestionStatus() {
    console.log('🔍 CHECKING EVIDENCE INGESTION STATUS\n');
    console.log('='.repeat(60));

    let realSources: any[] = [];

    // 1. Check connected sources (excluding simulated failures)
    const { data: sources, error: sourcesError } = await supabase
        .from('evidence_sources')
        .select('id, user_id, seller_id, provider, status, last_synced_at, metadata')
        .eq('status', 'connected');

    if (sourcesError) {
        console.error('❌ Error fetching sources:', sourcesError);
    } else {
        realSources = (sources || []).filter(s => !s.metadata?.simulate_failure);
        console.log(`\n🔌 CONNECTED SOURCES: ${sources?.length || 0} total`);
        console.log(`   - Real Users (no simulate_failure): ${realSources.length}`);

        if (realSources.length > 0) {
            console.log('\n✅ REAL USERS FOUND:');
            realSources.forEach(s => {
                console.log(`   - User: ${s.user_id || s.seller_id}`);
                console.log(`     Provider: ${s.provider}`);
                console.log(`     Last Sync: ${s.last_synced_at || 'Never'}`);
                console.log(`     Metadata: ${JSON.stringify(s.metadata || {})}`);
                console.log('---');
            });
        } else {
            console.log('\n⚠️  NO REAL USERS FOUND (All have simulate_failure flag)');
        }
    }

    // 2. Check ingested documents
    const { data: docs, error: docsError } = await supabase
        .from('evidence_documents')
        .select('id, user_id, provider, filename, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

    if (docsError) {
        console.error('❌ Error fetching documents:', docsError);
    } else {
        console.log(`\n📄 INGESTED DOCUMENTS: ${docs?.length || 0} (showing last 20)`);
        if (docs && docs.length > 0) {
            docs.forEach(d => {
                console.log(`   - [${d.provider}] ${d.filename} (${new Date(d.created_at).toLocaleString()})`);
            });
        } else {
            console.log('   No documents found.');
        }
    }

    // 3. Check ingestion errors for REAL users
    if (realSources.length > 0) {
        const realUserIds = realSources.map(s => s.user_id || s.seller_id);
        const { data: errors, error: errorsError } = await supabase
            .from('evidence_ingestion_errors')
            .select('*')
            .in('user_id', realUserIds)
            .order('created_at', { ascending: false })
            .limit(10);

        if (errorsError) {
            console.error('❌ Error fetching errors:', errorsError);
        } else {
            console.log(`\n⚠️  ERRORS FOR REAL USERS: ${errors?.length || 0}`);
            if (errors && errors.length > 0) {
                errors.forEach(e => {
                    console.log(`   - [${e.provider}] ${e.error_message} (${new Date(e.created_at).toLocaleString()})`);
                });
            } else {
                console.log('   No errors found for real users.');
            }
        }
    }
}

checkIngestionStatus();
