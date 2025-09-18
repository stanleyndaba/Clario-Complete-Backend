/**
 * Integration Examples for the Notifications System
 * 
 * This file demonstrates how to integrate the notification system
 * with other backend services like claim detector, integrations, and Stripe payments.
 * 
 * Copy and adapt these examples to your actual service files.
 */

import { 
  notificationService, 
  NotificationType, 
  NotificationPriority, 
  NotificationChannel 
} from '../index';

// ============================================================================
// EXAMPLE 1: Claim Detector Integration
// ============================================================================

/**
 * Example: Trigger notification when a new claim is detected
 * This would typically be called from your claim_detector.ts service
 */
export async function notifyClaimDetected(userId: string, claimData: {
  claimId: string;
  amount: number;
  source: string;
  evidence: string[];
}): Promise<void> {
  try {
    await notificationService.createNotification({
      type: NotificationType.CLAIM_DETECTED,
      user_id: userId,
      title: 'New Reimbursement Claim Detected!',
      message: `We've identified a potential reimbursement claim for $${claimData.amount} from ${claimData.source}.`,
      priority: NotificationPriority.HIGH,
      channel: NotificationChannel.BOTH, // Send both in-app and email
      payload: {
        claim_id: claimData.claimId,
        amount: claimData.amount,
        source: claimData.source,
        evidence_count: claimData.evidence.length,
        action_required: 'review_claim',
        estimated_value: claimData.amount * 1.2 // 20% higher than competitors
      },
      immediate: true // Send immediately for high-priority claims
    });

    console.log(`Claim notification sent to user ${userId} for claim ${claimData.claimId}`);
  } catch (error) {
    console.error('Failed to send claim notification:', error);
    // Don't throw - notification failure shouldn't break claim detection
  }
}

/**
 * Example: Notify when claim processing is complete
 */
export async function notifyClaimProcessed(userId: string, claimData: {
  claimId: string;
  status: 'approved' | 'rejected' | 'pending_review';
  amount: number;
  reason?: string;
}): Promise<void> {
  const statusMessages = {
    approved: 'Your reimbursement claim has been approved!',
    rejected: 'Your reimbursement claim requires attention.',
    pending_review: 'Your reimbursement claim is under review.'
  };

  const priority = claimData.status === 'approved' ? NotificationPriority.HIGH : NotificationPriority.NORMAL;

  await notificationService.createNotification({
    type: NotificationType.CLAIM_DETECTED,
    user_id: userId,
    title: `Claim ${claimData.status.toUpperCase()}: ${claimData.claimId}`,
    message: statusMessages[claimData.status],
    priority,
    channel: NotificationChannel.BOTH,
    payload: {
      claim_id: claimData.claimId,
      status: claimData.status,
      amount: claimData.amount,
      reason: claimData.reason,
      next_steps: claimData.status === 'approved' ? 'payment_processing' : 'review_required'
    }
  });
}

// ============================================================================
// EXAMPLE 2: Integration Service Integration
// ============================================================================

/**
 * Example: Notify when Amazon integration is completed
 * This would typically be called from your integrations.ts service
 */
export async function notifyIntegrationCompleted(userId: string, integrationData: {
  provider: 'amazon' | 'stripe' | 'gmail';
  status: 'completed' | 'failed' | 'partial';
  details: Record<string, any>;
}): Promise<void> {
  const providerNames = {
    amazon: 'Amazon SP-API',
    stripe: 'Stripe',
    gmail: 'Gmail'
  };

  const statusMessages = {
    completed: `Your ${providerNames[integrationData.provider]} integration has been completed successfully!`,
    failed: `Your ${providerNames[integrationData.provider]} integration encountered an issue.`,
    partial: `Your ${providerNames[integrationData.provider]} integration completed with some limitations.`
  };

  const priority = integrationData.status === 'completed' ? NotificationPriority.NORMAL : NotificationPriority.HIGH;

  await notificationService.createNotification({
    type: NotificationType.INTEGRATION_COMPLETED,
    user_id: userId,
    title: `${providerNames[integrationData.provider]} Integration ${integrationData.status.toUpperCase()}`,
    message: statusMessages[integrationData.status],
    priority,
    channel: NotificationChannel.IN_APP,
    payload: {
      provider: integrationData.provider,
      status: integrationData.status,
      details: integrationData.details,
      next_steps: integrationData.status === 'completed' ? 'start_sync' : 'check_credentials'
    }
  });
}

/**
 * Example: Notify when sync process starts/completes
 */
export async function notifySyncStatus(userId: string, syncData: {
  syncId: string;
  status: 'started' | 'completed' | 'failed';
  itemsProcessed?: number;
  discrepanciesFound?: number;
  error?: string;
}): Promise<void> {
  const statusMessages = {
    started: 'Your data synchronization has started. This may take a few minutes.',
    completed: `Your data synchronization has completed successfully! Processed ${syncData.itemsProcessed} items.`,
    failed: `Your data synchronization failed: ${syncData.error}`
  };

  const priority = syncData.status === 'failed' ? NotificationPriority.HIGH : NotificationPriority.NORMAL;

  await notificationService.createNotification({
    type: NotificationType.SYNC_COMPLETED,
    user_id: userId,
    title: `Data Sync ${syncData.status.toUpperCase()}`,
    message: statusMessages[syncData.status],
    priority,
    channel: NotificationChannel.IN_APP,
    payload: {
      sync_id: syncData.syncId,
      status: syncData.status,
      items_processed: syncData.itemsProcessed,
      discrepancies_found: syncData.discrepanciesFound,
      error: syncData.error,
      timestamp: new Date().toISOString()
    }
  });
}

// ============================================================================
// EXAMPLE 3: Stripe Payments Integration
// ============================================================================

/**
 * Example: Notify when payment is processed
 * This would typically be called from your stripe_payments.ts service
 */
export async function notifyPaymentProcessed(userId: string, paymentData: {
  paymentId: string;
  amount: number;
  currency: string;
  status: 'succeeded' | 'failed' | 'pending';
  description: string;
}): Promise<void> {
  const statusMessages = {
    succeeded: `Payment of ${paymentData.currency} ${paymentData.amount} has been processed successfully.`,
    failed: `Payment of ${paymentData.currency} ${paymentData.amount} has failed.`,
    pending: `Payment of ${paymentData.currency} ${paymentData.amount} is being processed.`
  };

  const priority = paymentData.status === 'succeeded' ? NotificationPriority.NORMAL : NotificationPriority.HIGH;

  await notificationService.createNotification({
    type: NotificationType.PAYMENT_PROCESSED,
    user_id: userId,
    title: `Payment ${paymentData.status.toUpperCase()}`,
    message: statusMessages[paymentData.status],
    priority,
    channel: NotificationChannel.BOTH,
    payload: {
      payment_id: paymentData.paymentId,
      amount: paymentData.amount,
      currency: paymentData.currency,
      status: paymentData.status,
      description: paymentData.description,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Example: Notify when account balance is low
 */
export async function notifyLowBalance(userId: string, balanceData: {
  currentBalance: number;
  threshold: number;
  currency: string;
}): Promise<void> {
  await notificationService.createNotification({
    type: NotificationType.SYSTEM_ALERT,
    user_id: userId,
    title: 'Low Account Balance Alert',
    message: `Your account balance is ${balanceData.currency} ${balanceData.currentBalance}, which is below the recommended threshold of ${balanceData.currency} ${balanceData.threshold}.`,
    priority: NotificationPriority.HIGH,
    channel: NotificationChannel.BOTH,
    payload: {
      current_balance: balanceData.currentBalance,
      threshold: balanceData.threshold,
      currency: balanceData.currency,
      action_required: 'add_funds',
      urgency: 'high'
    },
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // Expire in 24 hours
  });
}

// ============================================================================
// EXAMPLE 4: Discrepancy Detection Integration
// ============================================================================

/**
 * Example: Notify when inventory discrepancies are found
 */
export async function notifyDiscrepanciesFound(userId: string, discrepancyData: {
  count: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  items: Array<{
    sku: string;
    expected: number;
    actual: number;
    location: string;
  }>;
}): Promise<void> {
  const severityMessages = {
    low: 'Minor inventory discrepancies detected',
    medium: 'Inventory discrepancies require attention',
    high: 'Significant inventory discrepancies detected',
    critical: 'Critical inventory discrepancies require immediate action'
  };

  const priority = {
    low: NotificationPriority.LOW,
    medium: NotificationPriority.NORMAL,
    high: NotificationPriority.HIGH,
    critical: NotificationPriority.URGENT
  }[discrepancyData.severity];

  await notificationService.createNotification({
    type: NotificationType.DISCREPANCY_FOUND,
    user_id: userId,
    title: `${discrepancyData.count} Inventory Discrepancies Found`,
    message: `${severityMessages[discrepancyData.severity]}. Review and reconcile these items to maintain accurate inventory levels.`,
    priority,
    channel: NotificationChannel.BOTH,
    payload: {
      discrepancy_count: discrepancyData.count,
      severity: discrepancyData.severity,
      items: discrepancyData.items,
      action_required: 'reconcile_inventory',
      estimated_impact: 'inventory_accuracy'
    }
  });
}

// ============================================================================
// EXAMPLE 5: Batch Notifications
// ============================================================================

/**
 * Example: Send multiple notifications at once (e.g., for bulk operations)
 */
export async function notifyBulkOperationComplete(userId: string, operationData: {
  operationType: string;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  details: Record<string, any>;
}): Promise<void> {
  const successRate = (operationData.successfulItems / operationData.totalItems) * 100;
  
  if (successRate === 100) {
    // All items processed successfully
    await notificationService.createNotification({
      type: NotificationType.SYNC_COMPLETED,
      user_id: userId,
      title: 'Bulk Operation Completed Successfully',
      message: `All ${operationData.totalItems} items were processed successfully.`,
      priority: NotificationPriority.NORMAL,
      channel: NotificationChannel.IN_APP,
      payload: {
        operation_type: operationData.operationType,
        total_items: operationData.totalItems,
        successful_items: operationData.successfulItems,
        failed_items: operationData.failedItems,
        success_rate: successRate,
        details: operationData.details
      }
    });
  } else if (successRate >= 80) {
    // Most items processed successfully
    await notificationService.createNotification({
      type: NotificationType.SYNC_COMPLETED,
      user_id: userId,
      title: 'Bulk Operation Completed with Warnings',
      message: `${operationData.successfulItems} of ${operationData.totalItems} items were processed successfully. ${operationData.failedItems} items failed.`,
      priority: NotificationPriority.NORMAL,
      channel: NotificationChannel.IN_APP,
      payload: {
        operation_type: operationData.operationType,
        total_items: operationData.totalItems,
        successful_items: operationData.successfulItems,
        failed_items: operationData.failedItems,
        success_rate: successRate,
        details: operationData.details,
        action_required: 'review_failed_items'
      }
    });
  } else {
    // Many items failed
    await notificationService.createNotification({
      type: NotificationType.SYSTEM_ALERT,
      user_id: userId,
      title: 'Bulk Operation Completed with Errors',
      message: `${operationData.failedItems} of ${operationData.totalItems} items failed to process. Please review the errors.`,
      priority: NotificationPriority.HIGH,
      channel: NotificationChannel.BOTH,
      payload: {
        operation_type: operationData.operationType,
        total_items: operationData.totalItems,
        successful_items: operationData.successfulItems,
        failed_items: operationData.failedItems,
        success_rate: successRate,
        details: operationData.details,
        action_required: 'investigate_errors'
      }
    });
  }
}

// ============================================================================
// EXAMPLE 6: System Maintenance Notifications
// ============================================================================

/**
 * Example: Notify users about system maintenance
 */
export async function notifySystemMaintenance(userIds: string[], maintenanceData: {
  startTime: Date;
  endTime: Date;
  description: string;
  impact: 'low' | 'medium' | 'high';
}): Promise<void> {
  const impactMessages = {
    low: 'Minimal service disruption expected',
    medium: 'Some service disruption expected',
    high: 'Significant service disruption expected'
  };

  const priority = {
    low: NotificationPriority.LOW,
    medium: NotificationPriority.NORMAL,
    high: NotificationPriority.HIGH
  }[maintenanceData.impact];

  const notifications = userIds.map(userId => ({
    type: NotificationType.SYSTEM_ALERT,
    user_id: userId,
    title: 'Scheduled System Maintenance',
    message: `System maintenance is scheduled from ${maintenanceData.startTime.toLocaleString()} to ${maintenanceData.endTime.toLocaleString()}. ${impactMessages[maintenanceData.impact]}.`,
    priority,
    channel: NotificationChannel.BOTH,
    payload: {
      start_time: maintenanceData.startTime.toISOString(),
      end_time: maintenanceData.endTime.toISOString(),
      description: maintenanceData.description,
      impact: maintenanceData.impact,
      action_required: 'plan_accordingly'
    },
    expires_at: maintenanceData.endTime
  }));

  await notificationService.createBatchNotifications(notifications);
}

// ============================================================================
// USAGE INSTRUCTIONS
// ============================================================================

/*
 * To use these examples in your actual service files:
 * 
 * 1. Import the notification service:
 *    import { notificationService, NotificationType, NotificationPriority, NotificationChannel } from '../notifications';
 * 
 * 2. Call the appropriate notification function:
 *    await notifyClaimDetected(userId, { claimId: 'CLM-001', amount: 25.50, source: 'amazon', evidence: [] });
 * 
 * 3. Or create notifications directly:
 *    await notificationService.createNotification({
 *      type: NotificationType.CLAIM_DETECTED,
 *      user_id: userId,
 *      title: 'Custom Title',
 *      message: 'Custom message',
 *      priority: NotificationPriority.HIGH,
 *      channel: NotificationChannel.BOTH
 *    });
 * 
 * 4. For immediate delivery (bypassing the queue):
 *    await notificationService.createNotification({
 *      ...notificationData,
 *      immediate: true
 *    });
 */

