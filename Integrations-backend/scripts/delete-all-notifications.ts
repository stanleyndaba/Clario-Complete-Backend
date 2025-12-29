/**
 * Script to delete all notifications from the database
 */
import { supabase } from '../src/database/supabaseClient';

async function deleteAllNotifications() {
    console.log('🗑️ Deleting all notifications...');

    try {
        const { error, count } = await supabase
            .from('notifications')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Match all rows (dummy condition)

        if (error) {
            console.error('Error deleting notifications:', error);
            process.exit(1);
        }

        console.log(`✅ Successfully deleted all notifications`);
        process.exit(0);
    } catch (err) {
        console.error('Unhandled error:', err);
        process.exit(1);
    }
}

deleteAllNotifications();
