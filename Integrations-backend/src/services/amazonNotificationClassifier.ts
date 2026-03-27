export type AmazonNotificationClassification =
  | 'financial_report_ready'
  | 'settlement_ready'
  | 'inventory_changed'
  | 'refund_signal'
  | 'return_signal'
  | 'order_data_changed'
  | 'inbound_status_changed'
  | 'feed_processed'
  | 'listing_issue_changed'
  | 'transport_subscription_confirmation'
  | 'transport_unsubscribe_confirmation'
  | 'unhandled_notification_type';

export type NotificationSupportLevel = 'full' | 'partial' | 'ignored';

export interface NormalizedAmazonNotification {
  deliveryType: 'sns_notification' | 'sns_subscription_confirmation' | 'sns_unsubscribe_confirmation' | 'replay';
  notificationType: string;
  notificationSubtype?: string | null;
  reportType?: string | null;
  feedType?: string | null;
  payload: Record<string, any>;
}

export interface NotificationClassificationResult {
  classification: AmazonNotificationClassification;
  supportLevel: NotificationSupportLevel;
  reason: string;
  requestedDomains: string[];
}

function normalize(value?: string | null): string {
  return String(value || '').trim().toUpperCase();
}

export function classifyAmazonNotification(
  notification: NormalizedAmazonNotification
): NotificationClassificationResult {
  const notificationType = normalize(notification.notificationType);
  const reportType = normalize(notification.reportType);
  const feedType = normalize(notification.feedType);

  if (notification.deliveryType === 'sns_subscription_confirmation') {
    return {
      classification: 'transport_subscription_confirmation',
      supportLevel: 'full',
      reason: 'SNS subscription confirmation control message',
      requestedDomains: []
    };
  }

  if (notification.deliveryType === 'sns_unsubscribe_confirmation') {
    return {
      classification: 'transport_unsubscribe_confirmation',
      supportLevel: 'partial',
      reason: 'SNS unsubscribe confirmation control message',
      requestedDomains: []
    };
  }

  if (notificationType === 'REPORT_PROCESSING_FINISHED') {
    if (/SETTLEMENT|FINANC|LEDGER|REIMBURSE/i.test(reportType)) {
      return {
        classification: reportType.includes('SETTLEMENT') ? 'settlement_ready' : 'financial_report_ready',
        supportLevel: 'full',
        reason: `Amazon report ready: ${reportType}`,
        requestedDomains: ['settlements', 'financial_events']
      };
    }

    if (/INVENTORY/i.test(reportType)) {
      return {
        classification: 'inventory_changed',
        supportLevel: 'full',
        reason: `Inventory-related report ready: ${reportType}`,
        requestedDomains: ['inventory_items', 'inventory_ledger_events']
      };
    }

    if (/RETURN|REFUND/i.test(reportType)) {
      return {
        classification: reportType.includes('REFUND') ? 'refund_signal' : 'return_signal',
        supportLevel: 'full',
        reason: `Returns/refunds report ready: ${reportType}`,
        requestedDomains: ['returns', 'financial_events']
      };
    }

    if (/ORDER|SHIPMENT|FULFILL/i.test(reportType)) {
      return {
        classification: 'order_data_changed',
        supportLevel: 'full',
        reason: `Order/shipment report ready: ${reportType}`,
        requestedDomains: ['orders', 'shipments']
      };
    }
  }

  if (['FBA_INVENTORY_AVAILABILITY_CHANGES', 'ITEM_INVENTORY_EVENT_CHANGE', 'ANY_OFFER_CHANGED'].includes(notificationType)) {
    return {
      classification: 'inventory_changed',
      supportLevel: 'full',
      reason: `Inventory change signal: ${notificationType}`,
      requestedDomains: ['inventory_items', 'inventory_ledger_events']
    };
  }

  if (notificationType.includes('REFUND')) {
    return {
      classification: 'refund_signal',
      supportLevel: 'full',
      reason: `Refund-related notification: ${notificationType}`,
      requestedDomains: ['returns', 'financial_events']
    };
  }

  if (notificationType.includes('RETURN')) {
    return {
      classification: 'return_signal',
      supportLevel: 'full',
      reason: `Return-related notification: ${notificationType}`,
      requestedDomains: ['returns', 'financial_events']
    };
  }

  if (['ORDER_CHANGE', 'ORDER_STATUS_CHANGE', 'FULFILLMENT_ORDER_STATUS', 'FULFILLMENT_ORDER_STATUS_CHANGE'].includes(notificationType)) {
    return {
      classification: 'order_data_changed',
      supportLevel: 'full',
      reason: `Order state changed: ${notificationType}`,
      requestedDomains: ['orders', 'shipments']
    };
  }

  if (['FBA_INBOUND_OPERATION_STATUS', 'INBOUND_SHIPMENT_STATUS', 'FULFILLMENT_INBOUND_SHIPMENT_STATUS'].includes(notificationType)) {
    return {
      classification: 'inbound_status_changed',
      supportLevel: 'partial',
      reason: `Inbound shipment status signal: ${notificationType}`,
      requestedDomains: ['shipments', 'inventory_ledger_events']
    };
  }

  if (notificationType === 'FEED_PROCESSING_FINISHED' || !!feedType) {
    return {
      classification: 'feed_processed',
      supportLevel: 'partial',
      reason: `Feed processing completed${feedType ? `: ${feedType}` : ''}`,
      requestedDomains: ['orders', 'shipments', 'inventory_items']
    };
  }

  if (['LISTINGS_ITEM_ISSUES_CHANGE', 'LISTINGS_ITEM_STATUS_CHANGE'].includes(notificationType)) {
    return {
      classification: 'listing_issue_changed',
      supportLevel: 'partial',
      reason: `Listing issue/state change: ${notificationType}`,
      requestedDomains: []
    };
  }

  return {
    classification: 'unhandled_notification_type',
    supportLevel: 'ignored',
    reason: `Unhandled Amazon notification type: ${notificationType || 'unknown'}`,
    requestedDomains: []
  };
}

export const AMAZON_NOTIFICATION_SUPPORT_MATRIX: Record<AmazonNotificationClassification, NotificationSupportLevel> = {
  financial_report_ready: 'full',
  settlement_ready: 'full',
  inventory_changed: 'full',
  refund_signal: 'full',
  return_signal: 'full',
  order_data_changed: 'full',
  inbound_status_changed: 'partial',
  feed_processed: 'partial',
  listing_issue_changed: 'partial',
  transport_subscription_confirmation: 'full',
  transport_unsubscribe_confirmation: 'partial',
  unhandled_notification_type: 'ignored'
};
