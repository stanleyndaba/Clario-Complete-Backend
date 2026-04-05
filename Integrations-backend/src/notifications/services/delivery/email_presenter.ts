import Notification, { NotificationType } from '../../models/notification';

export interface NotificationEmailDetailLine {
  label: string;
  value: string;
}

export interface NotificationEmailViewModel {
  email_subject: string;
  email_heading: string;
  email_summary: string;
  email_detail_lines: NotificationEmailDetailLine[];
  why_this_matters?: string | null;
  amazon_said_preview?: string | null;
  trust_line?: string | null;
  what_to_do_next?: string | null;
  action_label: string;
  action_url: string;
}

const CASE_CLOSED_WITHOUT_RESPONSE_PATTERNS = [
  /closed this case/i,
  /we haven['’]t received a response from you/i,
  /assume that your issue is resolved/i,
  /not able to obtain enough information/i
];

type FlattenedPayload = Record<string, any>;
const DEFAULT_TRUST_LINE = 'Margin has linked this case and is tracking it for you.';

function pickFirstString(...values: any[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function flattenPayload(payload?: Record<string, any>): FlattenedPayload {
  const flattened: FlattenedPayload = {};
  let current: any = payload && typeof payload === 'object' ? payload : null;
  let depth = 0;

  while (current && typeof current === 'object' && depth < 5) {
    for (const [key, value] of Object.entries(current)) {
      if (key === 'payload') continue;

      if (
        !Object.prototype.hasOwnProperty.call(flattened, key) ||
        flattened[key] === null ||
        flattened[key] === undefined ||
        flattened[key] === ''
      ) {
        flattened[key] = value;
      }
    }

    current = current.payload && typeof current.payload === 'object' ? current.payload : null;
    depth += 1;
  }

  return flattened;
}

function humanizeCaseState(value?: string | null): string | null {
  const normalized = pickFirstString(value);
  if (!normalized) return null;
  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeSentence(value?: string | null): string | null {
  const normalized = pickFirstString(value);
  if (!normalized) return null;
  return normalized.replace(/\s+/g, ' ').trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAmazonSaidPreview(payload: FlattenedPayload): string | null {
  const rawPreview = pickFirstString(payload.body_preview, payload.bodyPreview);
  if (!rawPreview) return null;

  const cleanedPreview = stripHtml(rawPreview);
  if (!cleanedPreview) return null;

  if (cleanedPreview.length <= 220) {
    return cleanedPreview;
  }

  return `${cleanedPreview.slice(0, 217).trimEnd()}...`;
}

function formatTimestamp(value?: string | null): string | null {
  const normalized = pickFirstString(value);
  if (!normalized) return null;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(date);
}

function buildCaseLabel(amazonCaseId?: string | null): string {
  const normalized = pickFirstString(amazonCaseId);
  return normalized ? `Case ${normalized}` : 'your case';
}

function buildOwnedCaseLabel(amazonCaseId?: string | null): string {
  const normalized = pickFirstString(amazonCaseId);
  return normalized ? `your case (${normalized})` : 'your case';
}

function isClosedWithoutResponse(payload: FlattenedPayload): boolean {
  const combined = [
    pickFirstString(payload.subject),
    normalizeSentence(payload.body_preview),
    normalizeSentence(payload.bodyPreview)
  ]
    .filter(Boolean)
    .join('\n');

  return CASE_CLOSED_WITHOUT_RESPONSE_PATTERNS.some((pattern) => pattern.test(combined));
}

function sanitizeTenantSlug(value?: string | null): string | null {
  const normalized = pickFirstString(value);
  if (!normalized) return null;
  return /^[a-z0-9-]{1,80}$/i.test(normalized) ? normalized : null;
}

function sanitizeEntityId(value?: string | null): string | null {
  const normalized = pickFirstString(value);
  if (!normalized) return null;
  return /^[a-z0-9-]{6,120}$/i.test(normalized) ? normalized : null;
}

function buildCaseTargetPath(payload: FlattenedPayload): string | null {
  const disputeCaseId = sanitizeEntityId(
    pickFirstString(payload.dispute_case_id, payload.disputeCaseId, payload.disputeId)
  );

  return disputeCaseId ? `/cases/${disputeCaseId}` : null;
}

function buildActionUrl(frontendUrl: string, payload: FlattenedPayload): string {
  const baseUrl = frontendUrl.replace(/\/+$/, '');
  const tenantSlug = sanitizeTenantSlug(pickFirstString(payload.tenant_slug, payload.tenantSlug));
  const caseTargetPath = buildCaseTargetPath(payload);

  if (tenantSlug && caseTargetPath) {
    return `${baseUrl}/app/redirect?target=${encodeURIComponent(caseTargetPath)}&tenant=${encodeURIComponent(tenantSlug)}`;
  }

  if (tenantSlug) {
    return `${baseUrl}/app/${tenantSlug}/notifications`;
  }

  return `${baseUrl}/notifications`;
}

function buildCommonDetailLines(payload: FlattenedPayload, statusLabel: string): NotificationEmailDetailLine[] {
  const detailLines: NotificationEmailDetailLine[] = [];
  const amazonCaseId = pickFirstString(payload.amazon_case_id, payload.amazonCaseId);
  const updatedAt = formatTimestamp(pickFirstString(payload.timestamp, payload.created_at));

  if (amazonCaseId) {
    detailLines.push({ label: 'Amazon case', value: amazonCaseId });
  }

  detailLines.push({ label: 'Status', value: statusLabel });

  if (updatedAt) {
    detailLines.push({ label: 'Updated', value: updatedAt });
  }

  return detailLines;
}

function buildAmazonThreadViewModel(
  notification: Notification,
  payload: FlattenedPayload,
  frontendUrl: string
): NotificationEmailViewModel {
  const amazonCaseId = pickFirstString(payload.amazon_case_id, payload.amazonCaseId);
  const caseLabel = buildCaseLabel(amazonCaseId);
  const ownedCaseLabel = buildOwnedCaseLabel(amazonCaseId);
  const action_url = buildActionUrl(frontendUrl, payload);
  const amazon_said_preview = buildAmazonSaidPreview(payload);

  switch (notification.type) {
    case NotificationType.NEEDS_EVIDENCE: {
      if (isClosedWithoutResponse(payload)) {
        return {
          email_subject: `Amazon closed ${ownedCaseLabel} pending more information`,
          email_heading: `Amazon closed ${ownedCaseLabel} pending more information`,
          email_summary:
            'Amazon closed this case after not receiving the requested response. Review the thread in Margin before deciding whether to reopen it.',
          email_detail_lines: buildCommonDetailLines(payload, 'Closed - no response received'),
          why_this_matters:
            'If this stays unresolved, Amazon may keep this case closed and the reimbursement will not move forward.',
          amazon_said_preview,
          trust_line: DEFAULT_TRUST_LINE,
          what_to_do_next:
            'Open the case in Margin, review Amazon’s last request, and reopen only if you can provide the missing information.',
          action_label: 'View in App',
          action_url
        };
      }

      return {
        email_subject: `Amazon needs more information for ${ownedCaseLabel}`,
        email_heading: `Amazon needs more information for ${ownedCaseLabel}`,
        email_summary:
          'Amazon asked for additional information before it can continue reviewing this case.',
        email_detail_lines: buildCommonDetailLines(payload, 'Action required'),
        why_this_matters:
          'If no action is taken, Amazon may close this case before reimbursement can be approved.',
        amazon_said_preview,
        trust_line: DEFAULT_TRUST_LINE,
        what_to_do_next:
          'Open the case in Margin to review Amazon’s request and respond with the required details or evidence.',
        action_label: 'View in App',
        action_url
      };
    }
    case NotificationType.APPROVED:
      return {
        email_subject: `Amazon approved ${ownedCaseLabel}`,
        email_heading: `Amazon approved ${ownedCaseLabel}`,
        email_summary: 'Amazon resolved this case in your favor.',
        email_detail_lines: buildCommonDetailLines(payload, 'Approved'),
        why_this_matters:
          'This case has moved out of review and into payout tracking.',
        trust_line: DEFAULT_TRUST_LINE,
        what_to_do_next: 'Open the case in Margin to review the resolution and next steps.',
        action_label: 'View in App',
        action_url
      };
    case NotificationType.REJECTED:
      return {
        email_subject: `Amazon rejected ${ownedCaseLabel}`,
        email_heading: `Amazon rejected ${ownedCaseLabel}`,
        email_summary: 'Amazon closed this case without reimbursement.',
        email_detail_lines: buildCommonDetailLines(payload, 'Rejected'),
        why_this_matters:
          'If stronger evidence exists, you may still decide whether to reopen or appeal.',
        trust_line: DEFAULT_TRUST_LINE,
        what_to_do_next:
          'Open the case in Margin to review the denial details and next steps, including whether more evidence is available.',
        action_label: 'View in App',
        action_url
      };
    case NotificationType.PAID:
      return {
        email_subject: `Amazon confirmed payment for ${ownedCaseLabel}`,
        email_heading: `Amazon confirmed payment for ${ownedCaseLabel}`,
        email_summary: 'Amazon confirmed reimbursement for this case.',
        email_detail_lines: buildCommonDetailLines(payload, 'Paid'),
        why_this_matters:
          'This reimbursement should now be ready to reconcile against your records.',
        trust_line: DEFAULT_TRUST_LINE,
        what_to_do_next: 'Open Margin to review the payout details and reconcile the reimbursement with your records.',
        action_label: 'View in App',
        action_url
      };
    default:
      return buildFallbackEmailViewModel(notification, payload, frontendUrl);
  }
}

function buildFallbackEmailViewModel(
  notification: Notification,
  payload: FlattenedPayload,
  frontendUrl: string
): NotificationEmailViewModel {
  const action_url = buildActionUrl(frontendUrl, payload);
  const detailLines: NotificationEmailDetailLine[] = [];
  const amazonCaseId = pickFirstString(payload.amazon_case_id, payload.amazonCaseId);
  const updatedAt = formatTimestamp(pickFirstString(payload.timestamp, payload.created_at, String(notification.created_at)));

  if (amazonCaseId) {
    detailLines.push({ label: 'Amazon case', value: amazonCaseId });
  }

  if (updatedAt) {
    detailLines.push({ label: 'Updated', value: updatedAt });
  }

  return {
    email_subject: normalizeSentence(notification.title) || 'Margin notification',
    email_heading: normalizeSentence(notification.title) || 'Margin notification',
    email_summary: normalizeSentence(notification.message) || 'Margin has an update for you.',
    email_detail_lines: detailLines,
    why_this_matters: null,
    amazon_said_preview: null,
    trust_line: null,
    what_to_do_next: null,
    action_label: 'View in App',
    action_url
  };
}

export function buildNotificationEmailViewModel(
  notification: Notification,
  options?: { frontendUrl?: string }
): NotificationEmailViewModel {
  const payload = flattenPayload(notification.payload || {});
  const frontendUrl = options?.frontendUrl || 'https://app.margin-finance.com';

  switch (notification.type) {
    case NotificationType.NEEDS_EVIDENCE:
    case NotificationType.APPROVED:
    case NotificationType.REJECTED:
    case NotificationType.PAID:
      return buildAmazonThreadViewModel(notification, payload, frontendUrl);
    default:
      return buildFallbackEmailViewModel(notification, payload, frontendUrl);
  }
}
