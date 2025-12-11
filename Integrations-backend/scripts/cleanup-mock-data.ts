/**
 * Cleanup Mock Data Script
 * Removes all mock documents and mock evidence sources from the database
 * Run after deploying to clean up any fake data created by mock mode
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupMockData() {
    console.log('🧹 Starting mock data cleanup...\n');

    let totalDocumentsDeleted = 0;
    let totalSourcesDeleted = 0;
    let totalSourcesUpdated = 0;

    // Step 1: Delete documents that came from mock emails
    console.log('📝 Step 1: Deleting documents from mock emails...');
    try {
        // Delete documents where email_id starts with 'mock-'
        const { data: mockDocs, error: listError } = await supabase
            .from('evidence_documents')
            .select('id, filename, email_id, metadata')
            .or('email_id.like.mock-%,metadata->>email_id.like.mock-%')
            .limit(1000);

        if (!listError && mockDocs && mockDocs.length > 0) {
            console.log(`   Found ${mockDocs.length} mock documents to delete`);

            for (const doc of mockDocs) {
                const { error: deleteError } = await supabase
                    .from('evidence_documents')
                    .delete()
                    .eq('id', doc.id);

                if (!deleteError) {
                    totalDocumentsDeleted++;
                    console.log(`   ✅ Deleted: ${doc.filename || doc.id}`);
                } else {
                    console.log(`   ⚠️ Failed to delete ${doc.id}: ${deleteError.message}`);
                }
            }
        } else {
            console.log('   No mock documents found by email_id');
        }
    } catch (e: any) {
        console.log(`   ⚠️ Error checking for mock documents: ${e.message}`);
    }

    // Step 2: Delete documents with mock-related filenames
    console.log('\n📝 Step 2: Deleting documents with mock-related filenames...');
    try {
        const { data: mockNameDocs, error: nameError } = await supabase
            .from('evidence_documents')
            .select('id, filename')
            .or('filename.ilike.%mock%,filename.ilike.%fake%,filename.ilike.%test-invoice%')
            .limit(1000);

        if (!nameError && mockNameDocs && mockNameDocs.length > 0) {
            console.log(`   Found ${mockNameDocs.length} documents with mock filenames to delete`);

            for (const doc of mockNameDocs) {
                const { error: deleteError } = await supabase
                    .from('evidence_documents')
                    .delete()
                    .eq('id', doc.id);

                if (!deleteError) {
                    totalDocumentsDeleted++;
                    console.log(`   ✅ Deleted: ${doc.filename}`);
                } else {
                    console.log(`   ⚠️ Failed to delete ${doc.id}: ${deleteError.message}`);
                }
            }
        } else {
            console.log('   No documents with mock filenames found');
        }
    } catch (e: any) {
        console.log(`   ⚠️ Error checking mock filenames: ${e.message}`);
    }

    // Step 3: Disconnect mock evidence sources (sources with mock tokens)
    console.log('\n📝 Step 3: Disconnecting mock evidence sources...');
    try {
        const { data: mockSources, error: sourceError } = await supabase
            .from('evidence_sources')
            .select('id, provider, account_email, metadata')
            .or('encrypted_access_token.like.mock-%,encrypted_refresh_token.like.mock-%')
            .limit(100);

        if (!sourceError && mockSources && mockSources.length > 0) {
            console.log(`   Found ${mockSources.length} mock sources to delete`);

            for (const source of mockSources) {
                // Delete the mock source entirely (NOT NULL constraint prevents disconnecting)
                const { error: deleteError } = await supabase
                    .from('evidence_sources')
                    .delete()
                    .eq('id', source.id);

                if (!deleteError) {
                    totalSourcesDeleted++;
                    console.log(`   ✅ Deleted: ${source.provider} (${source.account_email || source.id})`);
                } else {
                    console.log(`   ⚠️ Failed to delete ${source.id}: ${deleteError.message}`);
                }
            }
        } else {
            console.log('   No mock sources found');
        }
    } catch (e: any) {
        console.log(`   ⚠️ Error checking mock sources: ${e.message}`);
    }

    // Step 4: Delete mock tokens from tokens table
    console.log('\n📝 Step 4: Deleting mock tokens...');
    try {
        const { data: mockTokens, error: tokenListError } = await supabase
            .from('tokens')
            .select('id, provider')
            .or('access_token_data.like.mock-%,access_token_iv.eq.mock-iv')
            .limit(100);

        if (!tokenListError && mockTokens && mockTokens.length > 0) {
            console.log(`   Found ${mockTokens.length} mock tokens to delete`);

            for (const token of mockTokens) {
                const { error: deleteError } = await supabase
                    .from('tokens')
                    .delete()
                    .eq('id', token.id);

                if (!deleteError) {
                    console.log(`   ✅ Deleted token: ${token.provider} (${token.id})`);
                } else {
                    console.log(`   ⚠️ Failed to delete token ${token.id}: ${deleteError.message}`);
                }
            }
        } else {
            console.log('   No mock tokens found (or tokens table does not exist)');
        }
    } catch (e: any) {
        console.log(`   ⚠️ Error checking mock tokens: ${e.message}`);
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('✅ CLEANUP COMPLETE!');
    console.log('='.repeat(50));
    console.log(`   Documents deleted: ${totalDocumentsDeleted}`);
    console.log(`   Sources deleted: ${totalSourcesDeleted}`);
    console.log('\nNote: Only real documents from actual Gmail/Outlook/Drive/Dropbox');
    console.log('integrations will now appear in the Evidence Locker.');
}

cleanupMockData().catch(console.error);
