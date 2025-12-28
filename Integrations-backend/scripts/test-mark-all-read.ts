
import { notificationService } from '../src/notifications/services/notification_service';
import { Notification } from '../src/notifications/models/notification';
import { supabase } from '../src/database/supabaseClient';
import { NotificationType, NotificationStatus } from '../src/notifications/models/notification';

async function testMarkAllAsRead() {
    const userId = 'user_2rhM1X2Z1X2Z1X2Z1X2Z1X2Z1X2'; // Test user ID

    console.log('--- Testing Mark All As Read (Debug) ---');

    // 1. Create a few unread notifications
    console.log('Creating test notifications...');
    for (let i = 0; i < 3; i++) {
        await Notification.create({
            user_id: userId,
            type: NotificationType.SYSTEM_ALERT,
            title: `Test Notification ${i}`,
            message: 'This is a test notification',
            payload: {}
        });
    }

    // 2. Check pending count
    const { data: pendingData, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('status', NotificationStatus.PENDING);

    if (error) {
        console.error('Error fetching pending:', error);
        process.exit(1);
    }

    const initialCount = pendingData?.length || 0;
    console.log(`Initial pending notifications (data.length): ${initialCount}`);
    if (pendingData && pendingData.length > 0) {
        console.log('Sample notification:', JSON.stringify(pendingData[0], null, 2));
    } else {
        console.log('No pending notifications found via select!');
    }

    // 2.5 Manual Update Test
    console.log('Attempting manual direct update in script...');
    const { count: manualCount } = await supabase
        .from('notifications')
        .update({ payload: { test: 'updated' } })
        .eq('user_id', userId)
        .select('id', { count: 'exact' });
    console.log(`Manual update count: ${manualCount}`);

    // 3. Mark all as read

    console.log('Calling markAllAsRead...');
    const markedCount = await notificationService.markAllAsRead(userId);
    console.log(`Marked as read count: ${markedCount}`);

    // 4. Check pending count again
    const { data: finalData } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('status', NotificationStatus.PENDING);

    const finalCount = finalData?.length || 0;

    console.log(`Final pending notifications (data.length): ${finalCount}`);

    if (finalCount === 0 && (markedCount || 0) >= 3) {
        console.log('✅ TEST PASSED: All notifications marked as read.');
    } else {
        console.error(`❌ TEST FAILED: finalCount=${finalCount}, markedCount=${markedCount}`);

        // Check if they are read?
        const { data: readData } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .eq('status', NotificationStatus.READ);
        console.log(`Read notifications count: ${readData?.length || 0}`);

        process.exit(1);
    }
}

testMarkAllAsRead().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
