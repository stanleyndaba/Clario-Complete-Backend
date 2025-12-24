/**
 * User Data Audit Script
 * 
 * Checks which users have data across all 4 tables needed for detection
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin } from '../database/supabaseClient';

async function auditUserData() {
    console.log('🔍 User Data Audit - Finding users with complete data\n');
    console.log('='.repeat(60));

    // Get unique user_ids from each table
    const tables = ['orders', 'returns', 'settlements', 'shipments'];
    const usersByTable: Record<string, Set<string>> = {};

    for (const table of tables) {
        const { data, error } = await supabaseAdmin
            .from(table)
            .select('user_id')
            .limit(1000);

        if (error) {
            console.log(`❌ Error fetching ${table}: ${error.message}`);
            usersByTable[table] = new Set<string>();
        } else {
            const users = new Set<string>(data?.map(r => r.user_id).filter(Boolean) || []);
            usersByTable[table] = users;
            console.log(`📊 ${table}: ${users.size} unique users`);
        }
    }

    // Find users that appear in all tables
    const allUsers = new Set<string>();
    Object.values(usersByTable).forEach(users => users.forEach(u => allUsers.add(u)));

    console.log(`\n📋 Total unique users across all tables: ${allUsers.size}\n`);

    // Check each user's data coverage
    const userCoverage: Array<{ userId: string; tables: string[]; count: number }> = [];

    for (const userId of allUsers) {
        const tablesWithData: string[] = [];
        for (const table of tables) {
            if (usersByTable[table].has(userId)) {
                tablesWithData.push(table);
            }
        }
        userCoverage.push({ userId, tables: tablesWithData, count: tablesWithData.length });
    }

    // Sort by coverage (most tables first)
    userCoverage.sort((a, b) => b.count - a.count);

    console.log('='.repeat(60));
    console.log('👥 USER COVERAGE REPORT:\n');

    // Show top 10 users with most data
    const top10 = userCoverage.slice(0, 10);
    for (const user of top10) {
        const status = user.count === 4 ? '✅ COMPLETE' : `⚠️ ${user.count}/4`;
        console.log(`${status} | ${user.userId}`);
        console.log(`         Has: ${user.tables.join(', ')}`);
        console.log('');
    }

    // Find users with complete data (all 4 tables)
    const completeUsers = userCoverage.filter(u => u.count === 4);
    console.log('='.repeat(60));
    console.log(`\n🎯 USERS WITH COMPLETE DATA (all 4 tables): ${completeUsers.length}\n`);

    if (completeUsers.length > 0) {
        for (const user of completeUsers) {
            console.log(`   ✅ ${user.userId}`);
        }
        console.log(`\n💡 USE THIS USER ID FOR TESTING: ${completeUsers[0].userId}`);
    } else {
        console.log('   ⚠️ NO users have data in all 4 tables');
        console.log('\n   Recommendation: Run Agent 2 sync to populate missing tables');
    }

    // Show table-by-table breakdown
    console.log('\n' + '='.repeat(60));
    console.log('📊 TABLE BREAKDOWN:\n');

    for (const table of tables) {
        const { count, error } = await supabaseAdmin
            .from(table)
            .select('*', { count: 'exact', head: true });
        console.log(`   ${table}: ${count || 0} total rows, ${usersByTable[table].size} unique users`);
    }

    console.log('\n' + '='.repeat(60));
    return { userCoverage, completeUsers };
}

auditUserData()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
