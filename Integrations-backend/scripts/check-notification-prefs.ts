import { supabaseAdmin } from '../src/database/supabaseClient';

async function checkNotificationPrefs() {
    console.log('Querying user_notification_preferences table...\n');

    const { data, error } = await supabaseAdmin
        .from('user_notification_preferences')
        .select('*')
        .limit(10);

    if (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }

    console.log(`Records found: ${data?.length || 0}\n`);

    if (data && data.length > 0) {
        data.forEach((row, i) => {
            console.log(`--- Record ${i + 1} ---`);
            console.log(`User ID: ${row.user_id}`);
            console.log(`Created: ${row.created_at}`);
            console.log(`Updated: ${row.updated_at}`);
            console.log(`Preferences:`, JSON.stringify(row.preferences, null, 2));
            console.log('');
        });
    } else {
        console.log('No preferences saved yet. Toggle some switches on the Notification Hub page to test!');
    }

    process.exit(0);
}

checkNotificationPrefs();
