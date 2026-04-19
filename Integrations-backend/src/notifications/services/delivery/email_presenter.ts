import Notification, { NotificationType } from '../../models/notification';

export interface NotificationEmailDetailLine {
  label: string;
  value: string;
}

export interface NotificationEmailViewModel {
  email_subject: string;
  email_heading: string;
  email_summary: string;
  what_changed_lines?: string[] | null;
  detail_heading?: string | null;
  email_detail_lines: NotificationEmailDetailLine[];
  why_this_matters?: string | null;
  amazon_said_preview?: string | null;
  trust_line?: string | null;
  what_to_do_next?: string | null;
  seller_action_text?: string | null;
  disclaimer_text?: string | null;
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

function truncateText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
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

function pickFirstNumber(...values: any[]): number | null {
  for (const value of values) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function pickFirstBoolean(...values: any[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
  }

  return null;
}

function pickFirstStringList(...values: any[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      const cleaned = value
        .map((item) => normalizeSentence(String(item || '')))
        .filter((item): item is string => Boolean(item));

      if (cleaned.length) {
        return cleaned;
      }
    }

    if (typeof value === 'string' && value.trim()) {
      const cleaned = value
        .split(/[,\n;]/)
        .map((item) => normalizeSentence(item))
        .filter((item): item is string => Boolean(item));

      if (cleaned.length) {
        return cleaned;
      }
    }
  }

  return [];
}

function formatMoney(value: number | null, currency?: string | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const normalizedCurrency = pickFirstString(currency) || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency.toUpperCase()
    }).format(value);
  } catch {
    return `${normalizedCurrency.toUpperCase()} ${value.toFixed(2)}`;
  }
}

function formatCountLabel(value: number | null, singular: string, plural: string): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${value} ${value === 1 ? singular : plural}`;
}

function isQaPreview(payload: FlattenedPayload): boolean {
  return payload.qa_preview === true || payload.qaPreview === true;
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

function buildProductUpdateActionUrl(frontendUrl: string, payload: FlattenedPayload): string {
  const baseUrl = frontendUrl.replace(/\/+$/, '');
  const tenantSlug = sanitizeTenantSlug(pickFirstString(payload.tenant_slug, payload.tenantSlug));
  const slug = sanitizeEntityId(pickFirstString(payload.slug, payload.product_update_slug, payload.productUpdateSlug));
  const anchor = slug ? `#${encodeURIComponent(slug)}` : '';

  if (tenantSlug) {
    return `${baseUrl}/app/${encodeURIComponent(tenantSlug)}/whats-new${anchor}`;
  }

  return `${baseUrl}/whats-new${anchor}`;
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

function buildFiledCaseViewModel(
  notification: Notification,
  payload: FlattenedPayload,
  frontendUrl: string
): NotificationEmailViewModel {
  const action_url = buildActionUrl(frontendUrl, payload);
  const amazonCaseId = pickFirstString(payload.amazon_case_id, payload.amazonCaseId);
  const caseNumber = pickFirstString(payload.case_number, payload.caseNumber);
  const caseReference = amazonCaseId || caseNumber;
  const submittedAt = formatTimestamp(
    pickFirstString(payload.submitted_at, payload.submittedAt, payload.timestamp, payload.created_at, String(notification.created_at))
  );
  const submissionChannel = pickFirstString(payload.submission_channel, payload.submissionChannel, payload.channel);
  const evidenceCount = pickFirstNumber(payload.evidence_count, payload.evidenceCount, payload.attachment_count, payload.attachmentCount);
  const amountSubmitted = formatMoney(
    pickFirstNumber(payload.claim_amount, payload.claimAmount, payload.amount, payload.estimated_value, payload.estimatedValue),
    pickFirstString(payload.currency)
  );
  const isQaPreview = payload.qa_preview === true || payload.qaPreview === true;
  const detailLines: NotificationEmailDetailLine[] = [
    { label: 'Status', value: 'Filed' }
  ];

  if (caseReference) {
    detailLines.push({ label: 'Amazon case reference', value: caseReference });
  }

  if (submittedAt) {
    detailLines.push({ label: 'Submitted', value: submittedAt });
  }

  if (submissionChannel) {
    detailLines.push({ label: 'Submission channel', value: submissionChannel });
  }

  const evidenceLabel = formatCountLabel(evidenceCount, 'document', 'documents');
  if (evidenceLabel) {
    detailLines.push({ label: 'Evidence attached', value: evidenceLabel });
  }

  if (amountSubmitted) {
    detailLines.push({ label: 'Amount submitted', value: amountSubmitted });
  }

  return {
    email_subject: normalizeSentence(notification.title) || `${caseReference ? `(${caseReference}) ` : ''}Filed`.trim(),
    email_heading: normalizeSentence(notification.title) || `${caseReference ? `(${caseReference}) ` : ''}Filed`.trim(),
    email_summary: isQaPreview
      ? 'QA preview only: this shows how a filed-case email looks. No live Amazon submission was made.'
      : 'Margin submitted this case after the required proof was complete.',
    email_detail_lines: detailLines,
    why_this_matters:
      'This case has moved from preparation into Amazon review. Margin is now tracking the next response and payout movement.',
    trust_line:
      'Margin treats submission proof as the source of truth; a case is only called filed when submission proof is recorded.',
    what_to_do_next:
      'Margin is now watching for Amazon response, requests for more information, approval or rejection, and payout movement.',
    action_label: 'View Case',
    action_url
  };
}

function buildApprovedCaseViewModel(
  notification: Notification,
  payload: FlattenedPayload,
  frontendUrl: string
): NotificationEmailViewModel {
  const action_url = buildActionUrl(frontendUrl, payload);
  const amazonCaseId = pickFirstString(payload.amazon_case_id, payload.amazonCaseId);
  const caseNumber = pickFirstString(payload.case_number, payload.caseNumber);
  const caseReference = amazonCaseId || caseNumber;
  const ownedCaseLabel = buildOwnedCaseLabel(caseReference);
  const approvedAt = formatTimestamp(
    pickFirstString(payload.approved_at, payload.approvedAt, payload.timestamp, payload.created_at, String(notification.created_at))
  );
  const approvedAmount = formatMoney(
    pickFirstNumber(payload.approved_amount, payload.approvedAmount, payload.amount, payload.claim_amount, payload.claimAmount),
    pickFirstString(payload.currency)
  );
  const explicitPayoutState = pickFirstString(
    payload.payout_state,
    payload.payoutState,
    payload.payout_status,
    payload.payoutStatus,
    payload.payout_proof_status,
    payload.payoutProofStatus
  );
  const payoutState = payload.has_payout === true || pickFirstNumber(payload.actual_payout_amount, payload.paid_amount, payload.paidAmount) !== null
    ? 'Payout detected'
    : humanizeCaseState(explicitPayoutState) || 'Awaiting payout confirmation';
  const isQaPreview = payload.qa_preview === true || payload.qaPreview === true;
  const detailLines: NotificationEmailDetailLine[] = [
    { label: 'Status', value: 'Approved' }
  ];

  if (caseReference) {
    detailLines.push({ label: 'Amazon case reference', value: caseReference });
  }

  if (approvedAt) {
    detailLines.push({ label: 'Approved at', value: approvedAt });
  }

  if (approvedAmount) {
    detailLines.push({ label: 'Approved amount', value: approvedAmount });
  }

  detailLines.push({ label: 'Payout state', value: payoutState });

  return {
    email_subject: isQaPreview
      ? normalizeSentence(notification.title) || `${caseReference ? `(${caseReference}) ` : ''}Approved`.trim()
      : `Amazon approved ${ownedCaseLabel}`,
    email_heading: isQaPreview
      ? normalizeSentence(notification.title) || `${caseReference ? `(${caseReference}) ` : ''}Approved`.trim()
      : `Amazon approved ${ownedCaseLabel}`,
    email_summary: isQaPreview
      ? 'QA preview only: this shows how an approved-case email looks. No live Amazon action or outcome was created.'
      : 'Amazon approved this case. Margin is now tracking the settlement record until payout is confirmed.',
    email_detail_lines: detailLines,
    why_this_matters:
      'Approval means Amazon accepted the case, but it is not the same as payout received. Margin keeps tracking until a settlement or payout record confirms payment.',
    trust_line:
      'Margin keeps approval and payout as separate states so a case is not treated as paid until payout proof is confirmed.',
    what_to_do_next:
      'Margin is tracking the settlement trail. When payout is confirmed, the recovery can be marked paid and reconciled.',
    action_label: 'View Case',
    action_url
  };
}

function buildRejectedCaseViewModel(
  notification: Notification,
  payload: FlattenedPayload,
  frontendUrl: string
): NotificationEmailViewModel {
  const action_url = buildActionUrl(frontendUrl, payload);
  const amazonCaseId = pickFirstString(payload.amazon_case_id, payload.amazonCaseId);
  const caseNumber = pickFirstString(payload.case_number, payload.caseNumber);
  const caseReference = amazonCaseId || caseNumber;
  const ownedCaseLabel = buildOwnedCaseLabel(caseReference);
  const rejectedAt = formatTimestamp(
    pickFirstString(payload.rejected_at, payload.rejectedAt, payload.timestamp, payload.created_at, String(notification.created_at))
  );
  const claimValue = formatMoney(
    pickFirstNumber(payload.claim_value, payload.claimValue, payload.amount, payload.claim_amount, payload.claimAmount, payload.estimated_value, payload.estimatedValue),
    pickFirstString(payload.currency)
  );
  const amazonReason = normalizeSentence(
    pickFirstString(
      payload.rejection_reason,
      payload.rejectionReason,
      payload.denial_reason,
      payload.denialReason,
      payload.reason,
      payload.resolution,
      payload.body_preview,
      payload.bodyPreview
    )
  );
  const isQaPreview = payload.qa_preview === true || payload.qaPreview === true;
  const detailLines: NotificationEmailDetailLine[] = [
    { label: 'Status', value: 'Rejected' }
  ];

  if (caseReference) {
    detailLines.push({ label: 'Amazon case reference', value: caseReference });
  }

  if (rejectedAt) {
    detailLines.push({ label: 'Rejection recorded', value: rejectedAt });
  }

  if (claimValue) {
    detailLines.push({ label: 'Claim value', value: claimValue });
  }

  detailLines.push({
    label: "Amazon's reason",
    value: amazonReason || 'Reason not available yet'
  });

  return {
    email_subject: isQaPreview
      ? normalizeSentence(notification.title) || `${caseReference ? `(${caseReference}) ` : ''}Rejected`.trim()
      : `Amazon rejected ${ownedCaseLabel}`,
    email_heading: isQaPreview
      ? normalizeSentence(notification.title) || `${caseReference ? `(${caseReference}) ` : ''}Rejected`.trim()
      : `Amazon rejected ${ownedCaseLabel}`,
    email_summary: isQaPreview
      ? 'QA preview only: this shows how a rejected-case email looks. No live Amazon action or outcome was created.'
      : 'Amazon did not approve this case. Margin keeps the clearest available reason visible so you can decide whether stronger proof exists.',
    email_detail_lines: detailLines,
    why_this_matters:
      'A rejection is not automatically a dead end, but it should only be reopened or resubmitted if the supporting evidence is materially stronger.',
    amazon_said_preview: amazonReason,
    trust_line:
      'Margin keeps rejected, reopenable, and resubmittable states separate so the case is not retried without a stronger proof basis.',
    what_to_do_next:
      'Review Amazon\'s reason, check whether stronger evidence is available, and reopen or resubmit only if the proof materially improves the case.',
    action_label: 'View Case',
    action_url
  };
}

function buildResubmittedWhatChangedLines(
  payload: FlattenedPayload,
  evidenceLabel: string | null
): string[] {
  const issueCorrected = normalizeSentence(
    pickFirstString(
      payload.issue_corrected_summary,
      payload.issueCorrectedSummary,
      payload.corrected_issue,
      payload.correctedIssue
    )
  );
  const updatedEvidence = normalizeSentence(
    pickFirstString(
      payload.updated_evidence_summary,
      payload.updatedEvidenceSummary,
      payload.evidence_update_summary,
      payload.evidenceUpdateSummary
    )
  );
  const caseSupport = normalizeSentence(
    pickFirstString(
      payload.case_support_summary,
      payload.caseSupportSummary,
      payload.claim_reason_clarified_summary,
      payload.claimReasonClarifiedSummary,
      payload.narrative_update_summary,
      payload.narrativeUpdateSummary
    )
  );
  const updatedEvidenceTypes = pickFirstStringList(
    payload.updated_evidence_types,
    payload.updatedEvidenceTypes,
    payload.document_types,
    payload.documentTypes
  );
  const changedLines: string[] = [];

  if (issueCorrected) {
    changedLines.push(`Corrected issue: ${issueCorrected}`);
  }

  if (updatedEvidence) {
    changedLines.push(`Updated evidence: ${updatedEvidence}`);
  } else if (evidenceLabel) {
    changedLines.push(`Evidence package: ${evidenceLabel} attached to the new submission.`);
  }

  if (caseSupport) {
    changedLines.push(`Case support: ${caseSupport}`);
  }

  if (updatedEvidenceTypes.length) {
    changedLines.push(`Evidence types updated: ${updatedEvidenceTypes.slice(0, 4).join(', ')}`);
  }

  if (changedLines.length) {
    return changedLines.slice(0, 4);
  }

  return [
    'Corrected filing details before re-submission.',
    'Updated supporting evidence was included where available.',
    'Case support was refined before the new filing attempt.'
  ];
}

function buildResubmittedCaseViewModel(
  notification: Notification,
  payload: FlattenedPayload,
  frontendUrl: string
): NotificationEmailViewModel {
  const action_url = buildActionUrl(frontendUrl, payload);
  const amazonCaseId = pickFirstString(payload.amazon_case_id, payload.amazonCaseId);
  const caseNumber = pickFirstString(payload.case_number, payload.caseNumber);
  const caseReference = amazonCaseId || caseNumber;
  const resubmittedAt = formatTimestamp(
    pickFirstString(
      payload.resubmitted_at,
      payload.resubmittedAt,
      payload.submitted_at,
      payload.submittedAt,
      payload.timestamp,
      payload.created_at,
      String(notification.created_at)
    )
  );
  const previousAttemptAt = formatTimestamp(
    pickFirstString(payload.previous_attempt_at, payload.previousAttemptAt, payload.previous_submitted_at, payload.previousSubmittedAt)
  );
  const submissionChannel = pickFirstString(
    payload.filing_channel_label,
    payload.filingChannelLabel,
    payload.submission_channel,
    payload.submissionChannel,
    payload.channel
  );
  const evidenceCount = pickFirstNumber(
    payload.updated_evidence_count,
    payload.updatedEvidenceCount,
    payload.evidence_count,
    payload.evidenceCount,
    payload.attachment_count,
    payload.attachmentCount
  );
  const evidenceLabel = formatCountLabel(evidenceCount, 'document', 'documents');
  const trackedValue = formatMoney(
    pickFirstNumber(payload.tracked_value, payload.trackedValue, payload.claim_amount, payload.claimAmount, payload.amount, payload.estimated_value, payload.estimatedValue),
    pickFirstString(payload.currency)
  );
  const previousOutcome = humanizeCaseState(
    pickFirstString(payload.previous_outcome, payload.previousOutcome, payload.previous_status, payload.previousStatus)
  );
  const resubmissionReason = normalizeSentence(
    pickFirstString(
      payload.resubmission_reason,
      payload.resubmissionReason,
      payload.retry_reason,
      payload.retryReason,
      payload.reason
    )
  );
  const qaPreview = isQaPreview(payload);
  const sellerActionRequired = pickFirstBoolean(payload.seller_action_required, payload.sellerActionRequired);
  const sellerActionText = normalizeSentence(pickFirstString(payload.seller_action_text, payload.sellerActionText));
  const monitoringNextSteps = normalizeSentence(
    pickFirstString(payload.monitoring_next_steps, payload.monitoringNextSteps, payload.next_steps_text, payload.nextStepsText)
  );
  const detailLines: NotificationEmailDetailLine[] = [
    { label: 'Current status', value: 'Re-Submitted' }
  ];

  if (caseReference) {
    detailLines.push({ label: 'Amazon case reference', value: caseReference });
  }

  detailLines.push({ label: 'Re-submitted at', value: resubmittedAt || 'Not Available' });
  detailLines.push({ label: 'Filing channel', value: submissionChannel || 'Not Available' });
  detailLines.push({ label: 'Evidence attached', value: evidenceLabel || 'Not Available' });

  if (trackedValue) {
    detailLines.push({ label: 'Tracked value', value: trackedValue });
  }

  if (previousOutcome) {
    detailLines.push({ label: 'Prior outcome', value: previousOutcome });
  }

  if (resubmissionReason) {
    detailLines.push({ label: 'Re-submission reason', value: resubmissionReason });
  }

  if (previousAttemptAt) {
    detailLines.push({ label: 'Previous attempt', value: previousAttemptAt });
  }

  return {
    email_subject: qaPreview
      ? '[QA Preview] Case Re-Submitted with Updated Support'
      : `${caseReference ? `(${caseReference}) ` : ''}Case Re-Submitted with Updated Support`.trim(),
    email_heading: 'Case Re-Submitted with Updated Support',
    email_summary:
      'After the earlier submission did not move forward as expected, Margin corrected the filing package and re-submitted the case with updated support.',
    what_changed_lines: buildResubmittedWhatChangedLines(payload, evidenceLabel),
    detail_heading: 'Case details',
    email_detail_lines: detailLines,
    why_this_matters:
      resubmissionReason
        ? `This case was re-submitted because ${resubmissionReason}. Margin only uses this state when the filing package has been updated for a new attempt.`
        : 'This case was not abandoned after the earlier issue. Margin updated the filing package before sending it forward again.',
    trust_line:
      'Margin does not treat a stalled, blocked, or rejected filing as complete. Re-submission only happens after the case support is corrected or strengthened.',
    what_to_do_next:
      monitoringNextSteps ||
      'Margin is monitoring Amazon\'s response and will track requests for more evidence, approval, rejection, or payout movement.',
    seller_action_text:
      sellerActionRequired === true
        ? sellerActionText || 'Action is required before Margin can continue. Open Margin to review the request.'
        : sellerActionText || 'No action is needed right now. Margin will ask if Amazon requests something specific.',
    disclaimer_text: qaPreview
      ? 'QA preview only: this shows how a re-submitted case email looks. No live Amazon action or outcome was created.'
      : null,
    action_label: 'View Case',
    action_url
  };
}

function buildProductUpdateViewModel(
  notification: Notification,
  payload: FlattenedPayload,
  frontendUrl: string
): NotificationEmailViewModel {
  const title = normalizeSentence(pickFirstString(payload.title, notification.title)) || 'Product update';
  const summary = normalizeSentence(pickFirstString(payload.summary, notification.message)) ||
    'A new Margin product update is available.';
  const highlights = pickFirstStringList(payload.highlights).slice(0, 5);
  const publishedAt = formatTimestamp(pickFirstString(payload.published_at, payload.publishedAt, payload.timestamp, payload.created_at));
  const tag = normalizeSentence(pickFirstString(payload.tag, payload.category));
  const detailLines: NotificationEmailDetailLine[] = [
    { label: 'Status', value: 'Published' }
  ];

  if (publishedAt) {
    detailLines.push({ label: 'Shipped', value: publishedAt });
  }

  if (tag) {
    detailLines.push({ label: 'Category', value: tag });
  }

  return {
    email_subject: `New in Margin: ${title}`,
    email_heading: title,
    email_summary: summary,
    what_changed_lines: highlights.length ? highlights : null,
    detail_heading: 'Rollout details',
    email_detail_lines: detailLines,
    why_this_matters: truncateText(
      normalizeSentence(pickFirstString(payload.why_this_matters, payload.whyThisMatters, payload.body)),
      280
    ),
    trust_line:
      'Margin sends product update emails only after a rollout is published as a real Latest Changes record.',
    what_to_do_next:
      'Open the product update to review what changed and where it affects your workspace.',
    action_label: 'View Product Update',
    action_url: buildProductUpdateActionUrl(frontendUrl, payload)
  };
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
      return buildApprovedCaseViewModel(notification, payload, frontendUrl);
    case NotificationType.REJECTED:
      return buildRejectedCaseViewModel(notification, payload, frontendUrl);
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
    case NotificationType.PRODUCT_UPDATE:
      return buildProductUpdateViewModel(notification, payload, frontendUrl);
    case NotificationType.CASE_FILED:
      if (['resubmitted', 're_submitted', 're-submitted', 'refiled', 're_filed', 're-filed'].includes(String(payload.status || '').trim().toLowerCase())) {
        return buildResubmittedCaseViewModel(notification, payload, frontendUrl);
      }

      if (String(payload.status || '').trim().toLowerCase() === 'filed') {
        return buildFiledCaseViewModel(notification, payload, frontendUrl);
      }

      return buildFallbackEmailViewModel(notification, payload, frontendUrl);
    case NotificationType.NEEDS_EVIDENCE:
    case NotificationType.APPROVED:
    case NotificationType.REJECTED:
    case NotificationType.PAID:
      return buildAmazonThreadViewModel(notification, payload, frontendUrl);
    default:
      return buildFallbackEmailViewModel(notification, payload, frontendUrl);
  }
}
