import { NotificationType } from './models/notification';

export interface NotificationPreferenceChannels {
  email: boolean;
  inApp: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Record<string, NotificationPreferenceChannels> = {
  [NotificationType.CASE_FILED]: { email: true, inApp: true },
  [NotificationType.NEEDS_EVIDENCE]: { email: true, inApp: true },
  [NotificationType.APPROVED]: { email: true, inApp: true },
  [NotificationType.REJECTED]: { email: true, inApp: true },
  [NotificationType.PAID]: { email: true, inApp: true },
  [NotificationType.CLAIM_DETECTED]: { email: true, inApp: true },
  [NotificationType.EVIDENCE_FOUND]: { email: false, inApp: true },
  [NotificationType.AMAZON_CHALLENGE]: { email: true, inApp: true },
  [NotificationType.FUNDS_DEPOSITED]: { email: true, inApp: true },
  [NotificationType.WEEKLY_SUMMARY]: { email: true, inApp: false },
  [NotificationType.SYNC_STARTED]: { email: false, inApp: true },
  [NotificationType.SYNC_COMPLETED]: { email: false, inApp: true },
  [NotificationType.SYNC_FAILED]: { email: true, inApp: true },
  [NotificationType.USER_ACTION_REQUIRED]: { email: true, inApp: true },
  [NotificationType.REFUND_APPROVED]: { email: true, inApp: true },
  [NotificationType.CLAIM_DENIED]: { email: true, inApp: true },
  [NotificationType.CLAIM_EXPIRING]: { email: true, inApp: true },
  [NotificationType.LEARNING_INSIGHT]: { email: false, inApp: true },
  [NotificationType.INTEGRATION_COMPLETED]: { email: false, inApp: true },
  [NotificationType.PAYMENT_PROCESSED]: { email: true, inApp: true },
  [NotificationType.DISCREPANCY_FOUND]: { email: true, inApp: true },
  [NotificationType.SYSTEM_ALERT]: { email: true, inApp: true }
};

const LEGACY_PREFERENCE_ALIASES: Record<string, string[]> = {
  'recovery-guaranteed': [
    NotificationType.CASE_FILED,
    NotificationType.REFUND_APPROVED,
    NotificationType.APPROVED,
    NotificationType.REJECTED,
    NotificationType.PAID
  ],
  'payout-confirmed': [
    NotificationType.FUNDS_DEPOSITED,
    NotificationType.PAYMENT_PROCESSED
  ],
  'invoice-issued': [
    NotificationType.PAYMENT_PROCESSED
  ],
  'document-processed': [
    NotificationType.EVIDENCE_FOUND
  ],
  'weekly-summary': [
    NotificationType.WEEKLY_SUMMARY
  ],
  'monthly-summary': [
    NotificationType.WEEKLY_SUMMARY
  ],
  'product-updates': [
    NotificationType.LEARNING_INSIGHT
  ]
};

function normalizeChannels(value: any): NotificationPreferenceChannels | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    email: value.email !== false,
    inApp: value.inApp !== false
  };
}

export function normalizeNotificationPreferences(
  preferences?: Record<string, any> | null
): Record<string, NotificationPreferenceChannels> {
  const normalized = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const source = preferences && typeof preferences === 'object' ? preferences : {};

  for (const [key, rawValue] of Object.entries(source)) {
    const channels = normalizeChannels(rawValue);
    if (!channels) continue;

    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      normalized[key] = channels;
      continue;
    }

    const aliases = LEGACY_PREFERENCE_ALIASES[key] || [];
    for (const alias of aliases) {
      if (!Object.prototype.hasOwnProperty.call(source, alias)) {
        normalized[alias] = channels;
      }
    }
  }

  return normalized;
}
