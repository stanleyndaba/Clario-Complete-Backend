import axios from 'axios';
import logger from '../utils/logger';
import { convertUserIdToUuid, supabaseAdmin } from '../database/supabaseClient';
import gmailService, { GmailEmail, GmailMessageResponse } from './gmailService';
import notificationHelper from './notificationHelper';
import { NotificationChannel, NotificationPriority, NotificationType } from '../notifications/models/notification';
import { normalizeAgent10EventPayload } from '../utils/agent10Event';

type CaseThreadState = 'unlinked' | 'pending' | 'needs_evidence' | 'approved' | 'rejected' | 'paid';

type GmailThreadAttachmentInput = {
  filename: string;
  contentType?: string | null;
  size?: number | null;
  evidenceDocumentId?: string | null;
  fileUrl?: string | null;
  storagePath?: string | null;
};

type GmailReplyAttachment = {
  filename: string;
  contentType: string;
  data: Buffer;
};

type StoredCaseMessage = {
  id: string;
  dispute_case_id: string;
  amazon_case_id: string;
  provider: string;
  provider_message_id: string;
  provider_thread_id: string | null;
  message_identifier: string | null;
  in_reply_to: string | null;
  reference_headers: any;
  direction: 'inbound' | 'outbound';
  subject: string;
  body_text: string | null;
  body_html: string | null;
  attachments: any;
  sender: string | null;
  recipients: any;
  received_at: string | null;
  sent_at: string | null;
  state_signal: CaseThreadState | null;
  metadata: any;
  created_at: string;
  updated_at: string;
};

type StoredUnmatchedCaseMessage = {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  amazon_case_id: string | null;
  provider: string;
  provider_message_id: string;
  provider_thread_id: string | null;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  attachments: any;
  sender: string | null;
  recipients: any;
  received_at: string | null;
  failure_reason: string;
  metadata: any;
  link_status: 'unmatched' | 'linked_existing_case' | 'linked_placeholder_case';
  linked_dispute_case_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_metadata: any;
  created_at: string;
};

const AMAZON_CASE_ID_PATTERNS = [
  /\[(?:case(?:\s+id)?)[\s:]*([0-9]{6,})\]/i,
  /\bcase(?:\s+id)?[\s:#]*([0-9]{6,})\b/i,
  /\bre:\s*\[case[\s:]*([0-9]{6,})\]/i
];

const AMAZON_SUPPORT_DOMAIN_PATTERNS = [
  /@amazon\.[a-z.]+/i,
  /amazon selling partner support/i,
  /amazon seller support/i,
  /seller\.service/i
];

const NEEDS_EVIDENCE_PATTERNS = [
  /your help needed/i,
  /please provide/i,
  /additional information/i,
  /we need additional information/i,
  /supporting documentation/i,
  /we will keep your case open/i
];

const REIMBURSEMENT_PATTERNS = [
  /issued reimbursement/i,
  /reimbursement has been issued/i,
  /we have issued reimbursement/i,
  /reimbursed/i,
  /reimbursement/i,
  /credit has been issued/i
];

const DENIAL_PATTERNS = [
  /cannot provide reimbursement/i,
  /no reimbursement/i,
  /not eligible/i,
  /claim has been denied/i,
  /request has been denied/i,
  /unable to reimburse/i,
  /cannot reimburse/i,
  /denied/i
];

const CASE_RESOLVED_PATTERNS = [
  /case resolved/i,
  /resolution for case/i,
  /your case resolved/i
];

const CASE_CLOSED_WITHOUT_RESPONSE_PATTERNS = [
  /closed this case/i,
  /we haven['’]t received a response from you/i,
  /assume that your issue is resolved/i,
  /not able to obtain enough information/i
];

function trimOrNull(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => trimOrNull(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => trimOrNull(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  return [];
}

function titleCaseToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildNotificationIdentifier(disputeCase: any, amazonCaseId: string): string {
  return trimOrNull(disputeCase?.case_number) || amazonCaseId || trimOrNull(disputeCase?.id) || 'Case';
}

function extractRequestedDocuments(subject: string, bodyText: string | null): string[] {
  const haystack = `${subject || ''}\n${bodyText || ''}`.toLowerCase();
  const candidates: Array<{ label: string; pattern: RegExp }> = [
    { label: 'invoice', pattern: /\binvoice\b|\bcommercial invoice\b|\btax invoice\b/ },
    { label: 'proof of delivery', pattern: /\bproof of delivery\b|\bdelivery confirmation\b|\bpod\b/ },
    { label: 'bill of lading', pattern: /\bbill of lading\b|\bbol\b/ },
    { label: 'packing slip', pattern: /\bpacking slip\b/ },
    { label: 'purchase order', pattern: /\bpurchase order\b|\bpo\b/ },
    { label: 'shipment record', pattern: /\bshipment\b|\btracking\b|\bcarrier\b/ },
    { label: 'photos', pattern: /\bphotos?\b|\bpictures?\b|\bimages?\b/ },
    { label: 'return record', pattern: /\breturn\b|\brma\b/ }
  ];

  return candidates
    .filter((candidate) => candidate.pattern.test(haystack))
    .map((candidate) => candidate.label);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => trimOrNull(value)).filter((value): value is string => Boolean(value))));
}

function decodeBase64UrlToUtf8(data?: string | null): string | null {
  const normalized = trimOrNull(data);
  if (!normalized) return null;
  const base64 = normalized.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function stripHtml(html?: string | null): string | null {
  const normalized = trimOrNull(html);
  if (!normalized) return null;
  const text = normalized
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function parseEmailAddress(value?: string | null): string | null {
  const normalized = trimOrNull(value);
  if (!normalized) return null;
  const angleMatch = normalized.match(/<([^>]+)>/);
  if (angleMatch?.[1]) {
    return trimOrNull(angleMatch[1]);
  }
  const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? trimOrNull(emailMatch[0]) : normalized;
}

function splitReferenceHeader(value?: string | null): string[] {
  return uniqueStrings(
    String(value || '')
      .split(/\s+/)
      .map((entry) => entry.replace(/[<>]/g, '').trim())
  );
}

function normalizeRecipients(...values: Array<string | string[] | null | undefined>): string[] {
  return Array.from(new Set(
    values.flatMap((value) => asStringArray(value))
      .map((entry) => parseEmailAddress(entry) || entry)
      .filter(Boolean) as string[]
  ));
}

function normalizeAttachmentRows(
  attachments: Array<Record<string, any>>
): Array<Record<string, any>> {
  const seen = new Set<string>();
  const normalized: Array<Record<string, any>> = [];
  for (const attachment of attachments) {
    const filename = trimOrNull(attachment.filename);
    const evidenceDocumentId = trimOrNull(attachment.evidence_document_id);
    const storagePath = trimOrNull(attachment.storage_path);
    const dedupeKey = `${filename || 'unknown'}::${evidenceDocumentId || storagePath || 'inline'}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push({
      filename: filename || 'attachment',
      content_type: trimOrNull(attachment.content_type),
      size_bytes: Number.isFinite(Number(attachment.size_bytes)) ? Number(attachment.size_bytes) : null,
      evidence_document_id: evidenceDocumentId,
      file_url: trimOrNull(attachment.file_url),
      storage_path: storagePath
    });
  }
  return normalized;
}

function toIsoTimestamp(value?: string | null): string {
  const normalized = trimOrNull(value);
  if (!normalized) return new Date().toISOString();
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function extractPrimaryThreadBody(bodyText?: string | null): string {
  const normalized = trimOrNull(bodyText);
  if (!normalized) return '';

  const splitMarkers = [
    /\n--\s*Original Message\s*--/i,
    /\nOn .+ wrote:/i,
    /\nFrom:\s/i
  ];

  for (const marker of splitMarkers) {
    const parts = normalized.split(marker);
    if (parts[0]) {
      return parts[0].trim();
    }
  }

  return normalized;
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, any>) }
    : {};
}

function buildThreadBackfillCaseNumber(tenantId: string, amazonCaseId: string): string {
  const tenantSuffix = tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'tenant';
  return `AMZ-THREAD-${amazonCaseId}-${tenantSuffix}`.slice(0, 120);
}

class AmazonCaseThreadService {
  private caseStateRank(state?: string | null): number {
    switch (String(state || '').trim().toLowerCase()) {
      case 'paid':
        return 5;
      case 'approved':
        return 4;
      case 'rejected':
        return 3;
      case 'needs_evidence':
        return 2;
      case 'pending':
        return 1;
      default:
        return 0;
    }
  }

  extractAmazonCaseId(...values: Array<string | null | undefined>): string | null {
    for (const value of values) {
      const normalized = trimOrNull(value);
      if (!normalized) continue;
      for (const pattern of AMAZON_CASE_ID_PATTERNS) {
        const match = normalized.match(pattern);
        if (match?.[1]) {
          return match[1];
        }
      }
    }
    return null;
  }

  isAmazonSupportSender(sender?: string | null): boolean {
    const normalized = trimOrNull(sender);
    if (!normalized) return false;
    return AMAZON_SUPPORT_DOMAIN_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  private getHeaderValue(message: GmailMessageResponse, name: string): string | null {
    const headers = Array.isArray(message.payload?.headers) ? message.payload.headers : [];
    const header = headers.find((entry: any) => String(entry?.name || '').toLowerCase() === name.toLowerCase());
    return trimOrNull(header?.value);
  }

  private extractBodiesAndAttachments(message: GmailMessageResponse): {
    bodyText: string | null;
    bodyHtml: string | null;
    attachments: Array<Record<string, any>>;
  } {
    const textParts: string[] = [];
    const htmlParts: string[] = [];
    const attachments: Array<Record<string, any>> = [];

    const visitPart = (part: any) => {
      if (!part) return;

      const mimeType = String(part.mimeType || '').toLowerCase();
      const filename = trimOrNull(part.filename);
      const bodyData = decodeBase64UrlToUtf8(part.body?.data);

      if (mimeType.startsWith('text/plain') && bodyData) {
        textParts.push(bodyData);
      }
      if (mimeType.startsWith('text/html') && bodyData) {
        htmlParts.push(bodyData);
      }

      if (filename) {
        attachments.push({
          filename,
          content_type: trimOrNull(part.mimeType),
          size_bytes: Number.isFinite(Number(part.body?.size)) ? Number(part.body.size) : null,
          attachment_id: trimOrNull(part.body?.attachmentId)
        });
      }

      if (Array.isArray(part.parts)) {
        part.parts.forEach((nestedPart: any) => visitPart(nestedPart));
      }
    };

    if (message.payload) {
      visitPart(message.payload);
    }

    const bodyText = trimOrNull(textParts.join('\n\n')) || stripHtml(htmlParts.join('\n\n'));
    const bodyHtml = trimOrNull(htmlParts.join('\n\n'));

    return {
      bodyText,
      bodyHtml,
      attachments: normalizeAttachmentRows(attachments)
    };
  }

  private deriveStateSignal(subject: string, bodyText: string | null): {
    caseState: Exclude<CaseThreadState, 'unlinked'>;
    evidence: string;
  } {
    const primaryBody = extractPrimaryThreadBody(bodyText);
    const primaryCombined = `${subject}\n${primaryBody}`;
    const fullCombined = `${subject}\n${bodyText || ''}`;
    const subjectImpliesResolved = CASE_RESOLVED_PATTERNS.some((pattern) => pattern.test(subject));
    const resolvedInPrimary = CASE_RESOLVED_PATTERNS.some((pattern) => pattern.test(primaryCombined));
    const reimbursementInPrimary = REIMBURSEMENT_PATTERNS.some((pattern) => pattern.test(primaryCombined));
    const denialInPrimary = DENIAL_PATTERNS.some((pattern) => pattern.test(primaryCombined));
    const closedWithoutResponse = CASE_CLOSED_WITHOUT_RESPONSE_PATTERNS.some((pattern) => pattern.test(primaryCombined));

    if (reimbursementInPrimary && /issued reimbursement/i.test(primaryCombined)) {
      return {
        caseState: 'paid',
        evidence: 'amazon_reimbursement_issued_email'
      };
    }

    if ((subjectImpliesResolved || resolvedInPrimary) && (denialInPrimary || closedWithoutResponse)) {
      return {
        caseState: 'rejected',
        evidence: closedWithoutResponse
          ? 'amazon_case_resolved_closed_without_response'
          : 'amazon_case_resolved_denial_email'
      };
    }

    if ((subjectImpliesResolved || resolvedInPrimary) && reimbursementInPrimary) {
      return {
        caseState: 'approved',
        evidence: 'amazon_case_resolved_reimbursement_email'
      };
    }

    if (NEEDS_EVIDENCE_PATTERNS.some((pattern) => pattern.test(primaryCombined))) {
      return {
        caseState: 'needs_evidence',
        evidence: 'amazon_help_needed_email'
      };
    }

    if ((subjectImpliesResolved || resolvedInPrimary) && DENIAL_PATTERNS.some((pattern) => pattern.test(fullCombined))) {
      return {
        caseState: 'rejected',
        evidence: 'amazon_case_resolved_denial_email'
      };
    }

    return {
      caseState: 'pending',
      evidence: 'amazon_thread_activity_detected'
    };
  }

  private async resolveDisputeCaseByAmazonCaseId(
    tenantId: string,
    amazonCaseId: string
  ): Promise<any | null> {
    const { data: directCase, error: directError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, tenant_id, seller_id, amazon_case_id, case_state, status, case_number, case_type, evidence_attachments, filing_status, block_reasons, case_origin, origin_metadata, thread_backfilled_at, resolution_date, rejected_at, rejection_reason')
      .eq('tenant_id', tenantId)
      .eq('amazon_case_id', amazonCaseId)
      .maybeSingle();

    if (directError) {
      throw directError;
    }

    if (directCase) {
      return directCase;
    }

    const { data: submissionMatches, error: submissionError } = await supabaseAdmin
      .from('dispute_submissions')
      .select('dispute_id')
      .eq('tenant_id', tenantId)
      .eq('amazon_case_id', amazonCaseId)
      .limit(2);

    if (submissionError) {
      throw submissionError;
    }

    if (!submissionMatches || submissionMatches.length !== 1 || !submissionMatches[0]?.dispute_id) {
      return null;
    }

    const { data: linkedCase, error: linkedCaseError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, tenant_id, seller_id, amazon_case_id, case_state, status, case_number, case_type, evidence_attachments, filing_status, block_reasons, case_origin, origin_metadata, thread_backfilled_at, resolution_date, rejected_at, rejection_reason')
      .eq('tenant_id', tenantId)
      .eq('id', submissionMatches[0].dispute_id)
      .maybeSingle();

    if (linkedCaseError) {
      throw linkedCaseError;
    }

    if (!linkedCase) {
      return null;
    }

    if (!trimOrNull(linkedCase.amazon_case_id)) {
      await supabaseAdmin
        .from('dispute_cases')
        .update({
          amazon_case_id: amazonCaseId,
          case_state: linkedCase.case_state === 'unlinked' || !linkedCase.case_state ? 'pending' : linkedCase.case_state,
          updated_at: new Date().toISOString()
        })
        .eq('id', linkedCase.id)
        .eq('tenant_id', tenantId);

      linkedCase.amazon_case_id = amazonCaseId;
      linkedCase.case_state = linkedCase.case_state === 'unlinked' || !linkedCase.case_state ? 'pending' : linkedCase.case_state;
    }

    return linkedCase;
  }

  private async logUnmatchedInboundMessage(params: {
    tenantId: string;
    userId: string;
    amazonCaseId: string | null;
    message: GmailMessageResponse;
    subject: string;
    bodyText: string | null;
    bodyHtml: string | null;
    sender: string | null;
    recipients: string[];
    attachments: Array<Record<string, any>>;
    failureReason: string;
  }): Promise<void> {
    const receivedAt = toIsoTimestamp(this.getHeaderValue(params.message, 'Date') || new Date(Number(params.message.internalDate || Date.now())).toISOString());
    const messageIdentifier = trimOrNull(this.getHeaderValue(params.message, 'Message-ID'))?.replace(/[<>]/g, '') || null;
    const inReplyTo = trimOrNull(this.getHeaderValue(params.message, 'In-Reply-To'))?.replace(/[<>]/g, '') || null;
    const referenceHeaders = uniqueStrings([
      ...splitReferenceHeader(this.getHeaderValue(params.message, 'References')),
      inReplyTo
    ]);

    await supabaseAdmin
      .from('unmatched_case_messages')
      .upsert({
        tenant_id: params.tenantId,
        user_id: convertUserIdToUuid(params.userId),
        amazon_case_id: params.amazonCaseId,
        provider: 'gmail',
        provider_message_id: params.message.id,
        provider_thread_id: trimOrNull(params.message.threadId),
        subject: params.subject,
        body_text: params.bodyText,
        body_html: params.bodyHtml,
        attachments: params.attachments,
        sender: params.sender,
        recipients: params.recipients,
        received_at: receivedAt,
        failure_reason: params.failureReason,
        metadata: {
          gmail_labels: params.message.labelIds || [],
          message_identifier: messageIdentifier,
          in_reply_to: inReplyTo,
          reference_headers: referenceHeaders,
          snippet: trimOrNull(params.message.snippet)
        }
      }, {
        onConflict: 'tenant_id,provider,provider_message_id'
      });
  }

  private async applyInboundCaseState(params: {
    tenantId: string;
    disputeCase: any;
    amazonCaseId: string;
    stateSignal: ReturnType<AmazonCaseThreadService['deriveStateSignal']>;
    bodyText: string | null;
    subject: string;
    timestamp: string;
  }): Promise<CaseThreadState> {
    const nextState = this.caseStateRank(params.stateSignal.caseState) >= this.caseStateRank(params.disputeCase?.case_state)
      ? params.stateSignal.caseState
      : params.disputeCase.case_state;
    const updates: Record<string, any> = {
      amazon_case_id: params.amazonCaseId,
      case_state: nextState,
      updated_at: params.timestamp
    };

    if (nextState === 'approved') {
      updates.status = 'approved';
      updates.resolution_date = params.timestamp;
    } else if (nextState === 'rejected') {
      updates.status = 'rejected';
      updates.rejected_at = params.timestamp;
      updates.resolution_date = params.timestamp;
      if (!trimOrNull(params.disputeCase?.rejection_reason)) {
        updates.rejection_reason = trimOrNull(params.bodyText) || params.subject;
      }
    } else if (nextState === 'paid') {
      updates.status = 'approved';
      updates.resolution_date = params.timestamp;
    }

    await supabaseAdmin
      .from('dispute_cases')
      .update(updates)
      .eq('id', params.disputeCase.id)
      .eq('tenant_id', params.tenantId);

    return nextState as CaseThreadState;
  }

  private async emitCaseStateNotification(params: {
    tenantId: string;
    disputeCase: any;
    amazonCaseId: string;
    providerMessageId: string;
    nextState: CaseThreadState;
    subject: string;
    bodyText: string | null;
  }): Promise<void> {
    const targetId = trimOrNull(params.disputeCase?.seller_id);
    if (!targetId) {
      logger.warn('[AGENT 7 THREAD] Skipping notification for case state update without seller_id', {
        disputeCaseId: params.disputeCase?.id,
        amazonCaseId: params.amazonCaseId,
        nextState: params.nextState
      });
      return;
    }

    const notificationMap: Record<string, {
      type: NotificationType;
      title: string;
      message: string;
      priority: NotificationPriority;
    }> = {
      needs_evidence: {
        type: NotificationType.NEEDS_EVIDENCE,
        title: 'Amazon Needs More Evidence',
        message: `Amazon requested additional information for Case ${params.amazonCaseId}. Margin linked the thread and is ready for your next response.`,
        priority: NotificationPriority.URGENT
      },
      approved: {
        type: NotificationType.APPROVED,
        title: 'Amazon Approved Your Case',
        message: `Amazon resolved Case ${params.amazonCaseId} in your favor.`,
        priority: NotificationPriority.HIGH
      },
      rejected: {
        type: NotificationType.REJECTED,
        title: 'Amazon Rejected Your Case',
        message: `Amazon resolved Case ${params.amazonCaseId} without reimbursement. Review the thread for the denial details.`,
        priority: NotificationPriority.HIGH
      },
      paid: {
        type: NotificationType.PAID,
        title: 'Amazon Issued Reimbursement',
        message: `Amazon confirmed reimbursement on Case ${params.amazonCaseId}.`,
        priority: NotificationPriority.URGENT
      }
    };

    const descriptor = notificationMap[params.nextState];
    if (!descriptor) {
      return;
    }

    const requestedDocuments = params.nextState === 'needs_evidence'
      ? extractRequestedDocuments(params.subject, params.bodyText)
      : [];
    const requestType = requestedDocuments[0] || (params.nextState === 'needs_evidence' ? 'additional evidence' : null);
    const identifier = buildNotificationIdentifier(params.disputeCase, params.amazonCaseId);
    const title = params.nextState === 'needs_evidence'
      ? `(${titleCaseToken(requestType || 'additional evidence')}) Amazon requested`
      : params.nextState === 'approved'
        ? `(${identifier}) Approved`
        : params.nextState === 'rejected'
          ? `(${identifier}) Rejected`
          : `(${identifier}) Payout issued`;
    const message = params.nextState === 'needs_evidence'
      ? `Amazon requested ${requestType || 'additional evidence'} for ${identifier}. Margin linked the thread and is keeping the response trail ready.`
      : descriptor.message;

    await notificationHelper.notifyUser(
      targetId,
      descriptor.type,
      title,
      message,
      descriptor.priority,
      NotificationChannel.BOTH,
      normalizeAgent10EventPayload(descriptor.type, {
        disputeId: params.disputeCase.id,
        amazon_case_id: params.amazonCaseId,
        case_number: trimOrNull(params.disputeCase?.case_number),
        case_state: params.nextState,
        provider_message_id: params.providerMessageId,
        subject: params.subject,
        body_preview: trimOrNull(params.bodyText)?.slice(0, 500) || null,
        request_type: requestType,
        requested_documents: requestedDocuments
      }, {
        tenantId: params.tenantId,
        entityType: 'dispute_case',
        entityId: params.disputeCase.id
      }),
      params.tenantId
    );
  }

  async ingestInboundGmailMessage(params: {
    tenantId: string;
    userId: string;
    email: GmailEmail;
    message: GmailMessageResponse;
    storedAttachments?: GmailThreadAttachmentInput[];
  }): Promise<{
    handled: boolean;
    linked: boolean;
    amazonCaseId: string | null;
    disputeCaseId: string | null;
    stateSignal: Exclude<CaseThreadState, 'unlinked'> | null;
    reason?: string;
  }> {
    const subject = trimOrNull(params.email.subject) || this.getHeaderValue(params.message, 'Subject') || 'Amazon support update';
    const sender = trimOrNull(params.email.from) || this.getHeaderValue(params.message, 'From');

    if (!this.isAmazonSupportSender(sender)) {
      return {
        handled: false,
        linked: false,
        amazonCaseId: null,
        disputeCaseId: null,
        stateSignal: null,
        reason: 'sender_not_amazon_support'
      };
    }

    const parsedMessage = this.extractBodiesAndAttachments(params.message);
    const amazonCaseId = this.extractAmazonCaseId(subject, parsedMessage.bodyText, parsedMessage.bodyHtml);
    const recipients = normalizeRecipients(
      params.email.to,
      this.getHeaderValue(params.message, 'To'),
      this.getHeaderValue(params.message, 'Cc')
    );
    const attachments = normalizeAttachmentRows([
      ...parsedMessage.attachments,
      ...(params.storedAttachments || []).map((attachment) => ({
        filename: attachment.filename,
        content_type: attachment.contentType,
        size_bytes: attachment.size ?? null,
        evidence_document_id: attachment.evidenceDocumentId ?? null,
        file_url: attachment.fileUrl ?? null,
        storage_path: attachment.storagePath ?? null
      }))
    ]);

    if (!amazonCaseId) {
      await this.logUnmatchedInboundMessage({
        tenantId: params.tenantId,
        userId: params.userId,
        amazonCaseId: null,
        message: params.message,
        subject,
        bodyText: parsedMessage.bodyText,
        bodyHtml: parsedMessage.bodyHtml,
        sender,
        recipients,
        attachments,
        failureReason: 'amazon_case_id_missing'
      });

      return {
        handled: false,
        linked: false,
        amazonCaseId: null,
        disputeCaseId: null,
        stateSignal: null,
        reason: 'amazon_case_id_missing'
      };
    }

    const disputeCase = await this.resolveDisputeCaseByAmazonCaseId(params.tenantId, amazonCaseId);
    if (!disputeCase) {
      await this.logUnmatchedInboundMessage({
        tenantId: params.tenantId,
        userId: params.userId,
        amazonCaseId,
        message: params.message,
        subject,
        bodyText: parsedMessage.bodyText,
        bodyHtml: parsedMessage.bodyHtml,
        sender,
        recipients,
        attachments,
        failureReason: 'no_matching_dispute_case'
      });

      logger.warn('[AGENT 7 THREAD] Unmatched Amazon inbound email logged', {
        tenantId: params.tenantId,
        amazonCaseId,
        messageId: params.message.id
      });

      return {
        handled: true,
        linked: false,
        amazonCaseId,
        disputeCaseId: null,
        stateSignal: null,
        reason: 'no_matching_dispute_case'
      };
    }

    const timestamp = toIsoTimestamp(this.getHeaderValue(params.message, 'Date') || params.email.date);
    const stateSignal = this.deriveStateSignal(subject, parsedMessage.bodyText);
    const messageIdentifier = trimOrNull(this.getHeaderValue(params.message, 'Message-ID'))?.replace(/[<>]/g, '') || null;
    const inReplyTo = trimOrNull(this.getHeaderValue(params.message, 'In-Reply-To'))?.replace(/[<>]/g, '') || null;
    const references = uniqueStrings([
      ...splitReferenceHeader(this.getHeaderValue(params.message, 'References')),
      inReplyTo
    ]);

    await supabaseAdmin
      .from('case_messages')
      .upsert({
        tenant_id: params.tenantId,
        dispute_case_id: disputeCase.id,
        amazon_case_id: amazonCaseId,
        provider: 'gmail',
        provider_message_id: params.message.id,
        provider_thread_id: trimOrNull(params.message.threadId || params.email.threadId),
        message_identifier: messageIdentifier,
        in_reply_to: inReplyTo,
        reference_headers: references,
        direction: 'inbound',
        subject,
        body_text: parsedMessage.bodyText,
        body_html: parsedMessage.bodyHtml,
        attachments,
        sender,
        recipients,
        received_at: timestamp,
        state_signal: stateSignal.caseState,
        metadata: {
          gmail_labels: params.message.labelIds || params.email.labels || [],
          snippet: params.email.snippet || null,
          state_signal_evidence: stateSignal.evidence
        }
      }, {
        onConflict: 'tenant_id,provider,provider_message_id'
      });

    const nextState = await this.applyInboundCaseState({
      tenantId: params.tenantId,
      disputeCase,
      amazonCaseId,
      stateSignal,
      bodyText: parsedMessage.bodyText,
      subject,
      timestamp
    });

    await this.emitCaseStateNotification({
      tenantId: params.tenantId,
      disputeCase,
      amazonCaseId,
      providerMessageId: params.message.id,
      nextState,
      subject,
      bodyText: parsedMessage.bodyText
    });

    return {
      handled: true,
      linked: true,
      amazonCaseId,
      disputeCaseId: disputeCase.id,
      stateSignal: nextState === 'unlinked' ? null : nextState
    };
  }

  private async getUnmatchedCaseMessage(tenantId: string, unmatchedMessageId: string): Promise<StoredUnmatchedCaseMessage | null> {
    const { data, error } = await supabaseAdmin
      .from('unmatched_case_messages')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', unmatchedMessageId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as StoredUnmatchedCaseMessage | null) || null;
  }

  private async getDisputeCaseById(tenantId: string, disputeCaseId: string): Promise<any | null> {
    const { data, error } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, tenant_id, seller_id, amazon_case_id, case_state, status, case_number, case_type, evidence_attachments, filing_status, block_reasons, case_origin, origin_metadata, thread_backfilled_at, resolution_date, rejected_at, rejection_reason')
      .eq('tenant_id', tenantId)
      .eq('id', disputeCaseId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data || null;
  }

  private async resolvePlaceholderOwner(params: {
    tenantId: string;
    preferredUserId: string;
  }): Promise<{
    userId: string;
    sellerId: string;
  }> {
    const safeUserId = convertUserIdToUuid(params.preferredUserId);
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', params.tenantId)
      .eq('user_id', safeUserId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership) {
      throw new Error('Target user does not belong to this tenant');
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, amazon_seller_id')
      .eq('id', safeUserId)
      .maybeSingle();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error('Target user not found');
    }

    return {
      userId: String(user.id),
      sellerId: trimOrNull(user.amazon_seller_id) || safeUserId
    };
  }

  private async ensureThreadLinkedDisputeCase(params: {
    tenantId: string;
    disputeCase: any;
    amazonCaseId: string;
    timestamp: string;
    resolutionSource: 'linked_existing_case' | 'linked_placeholder_case';
    unmatchedMessageId: string;
    providerMessageId: string;
  }): Promise<any> {
    const existingAmazonCaseId = trimOrNull(params.disputeCase?.amazon_case_id);
    const existingOriginMetadata = asObject(params.disputeCase?.origin_metadata);
    const threadBackfillEntries = Array.isArray(existingOriginMetadata.thread_backfill_events)
      ? existingOriginMetadata.thread_backfill_events
      : [];

    const nextOriginMetadata = {
      ...existingOriginMetadata,
      latest_thread_backfill: {
        unmatched_case_message_id: params.unmatchedMessageId,
        provider_message_id: params.providerMessageId,
        linked_at: params.timestamp,
        link_status: params.resolutionSource
      },
      thread_backfill_events: threadBackfillEntries.some((entry: any) => String(entry?.provider_message_id || '') === params.providerMessageId)
        ? threadBackfillEntries
        : [
            ...threadBackfillEntries,
            {
              unmatched_case_message_id: params.unmatchedMessageId,
              provider_message_id: params.providerMessageId,
              linked_at: params.timestamp,
              link_status: params.resolutionSource
            }
          ]
    };

    const updates: Record<string, any> = {
      updated_at: params.timestamp,
      thread_backfilled_at: params.disputeCase?.thread_backfilled_at || params.timestamp,
      origin_metadata: nextOriginMetadata
    };

    if (!existingAmazonCaseId) {
      updates.amazon_case_id = params.amazonCaseId;
      if (params.disputeCase?.case_state === 'unlinked' || !trimOrNull(params.disputeCase?.case_state)) {
        updates.case_state = 'pending';
      }
    }

    const { data, error } = await supabaseAdmin
      .from('dispute_cases')
      .update(updates)
      .eq('tenant_id', params.tenantId)
      .eq('id', params.disputeCase.id)
      .select('id, tenant_id, seller_id, amazon_case_id, case_state, status, case_number, case_type, evidence_attachments, filing_status, block_reasons, case_origin, origin_metadata, thread_backfilled_at, resolution_date, rejected_at, rejection_reason')
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  private async createPlaceholderDisputeCase(params: {
    tenantId: string;
    unmatchedMessage: StoredUnmatchedCaseMessage;
    amazonCaseId: string;
    ownerUserId: string;
    actorUserId: string;
    timestamp: string;
  }): Promise<{
    disputeCase: any;
    created: boolean;
  }> {
    const existingCase = await this.resolveDisputeCaseByAmazonCaseId(params.tenantId, params.amazonCaseId);
    if (existingCase) {
      return {
        disputeCase: existingCase,
        created: false
      };
    }

    const owner = await this.resolvePlaceholderOwner({
      tenantId: params.tenantId,
      preferredUserId: params.ownerUserId
    });

    const { data, error } = await supabaseAdmin
      .from('dispute_cases')
      .insert({
        tenant_id: params.tenantId,
        seller_id: owner.sellerId,
        detection_result_id: null,
        case_number: buildThreadBackfillCaseNumber(params.tenantId, params.amazonCaseId),
        status: 'pending',
        claim_amount: 0,
        currency: 'USD',
        case_type: 'amazon_fba',
        provider: 'amazon',
        amazon_case_id: params.amazonCaseId,
        case_state: 'pending',
        filing_status: 'blocked',
        eligible_to_file: false,
        block_reasons: ['amazon_thread_backfill_placeholder'],
        case_origin: 'amazon_thread_backfill',
        origin_metadata: {
          source: 'amazon_thread_backfill',
          margin_filed_originally: false,
          claim_amount_unknown: true,
          backfilled_from_unmatched_message_id: params.unmatchedMessage.id,
          provider_message_id: params.unmatchedMessage.provider_message_id,
          actor_user_id: params.actorUserId,
          linked_user_id: owner.userId,
          placeholder_created_at: params.timestamp,
          initial_failure_reason: params.unmatchedMessage.failure_reason
        },
        evidence_attachments: {
          source: 'amazon_thread_backfill',
          margin_filed_originally: false
        },
        thread_backfilled_at: params.timestamp,
        updated_at: params.timestamp
      })
      .select('id, tenant_id, seller_id, amazon_case_id, case_state, status, case_number, case_type, evidence_attachments, filing_status, block_reasons, case_origin, origin_metadata, thread_backfilled_at, resolution_date, rejected_at, rejection_reason')
      .single();

    if (error) {
      throw error;
    }

    return {
      disputeCase: data,
      created: true
    };
  }

  private async upsertLinkedCaseMessageFromUnmatched(params: {
    tenantId: string;
    disputeCaseId: string;
    amazonCaseId: string;
    unmatchedMessage: StoredUnmatchedCaseMessage;
    stateSignal: ReturnType<AmazonCaseThreadService['deriveStateSignal']>;
  }): Promise<string> {
    const { data: existingMessage, error: existingMessageError } = await supabaseAdmin
      .from('case_messages')
      .select('id, dispute_case_id')
      .eq('tenant_id', params.tenantId)
      .eq('provider', params.unmatchedMessage.provider)
      .eq('provider_message_id', params.unmatchedMessage.provider_message_id)
      .maybeSingle();

    if (existingMessageError) {
      throw existingMessageError;
    }

    if (existingMessage && existingMessage.dispute_case_id !== params.disputeCaseId) {
      throw new Error('Amazon email is already linked to a different dispute case');
    }

    const metadata = asObject(params.unmatchedMessage.metadata);
    const referenceHeaders = Array.isArray(metadata.reference_headers)
      ? metadata.reference_headers.map((entry: any) => String(entry || '').trim()).filter(Boolean)
      : [];
    const { data, error } = await supabaseAdmin
      .from('case_messages')
      .upsert({
        tenant_id: params.tenantId,
        dispute_case_id: params.disputeCaseId,
        amazon_case_id: params.amazonCaseId,
        provider: params.unmatchedMessage.provider,
        provider_message_id: params.unmatchedMessage.provider_message_id,
        provider_thread_id: trimOrNull(params.unmatchedMessage.provider_thread_id),
        message_identifier: trimOrNull(metadata.message_identifier),
        in_reply_to: trimOrNull(metadata.in_reply_to),
        reference_headers: referenceHeaders,
        direction: 'inbound',
        subject: trimOrNull(params.unmatchedMessage.subject) || 'Amazon support update',
        body_text: params.unmatchedMessage.body_text,
        body_html: params.unmatchedMessage.body_html,
        attachments: Array.isArray(params.unmatchedMessage.attachments) ? params.unmatchedMessage.attachments : [],
        sender: params.unmatchedMessage.sender,
        recipients: Array.isArray(params.unmatchedMessage.recipients) ? params.unmatchedMessage.recipients : [],
        received_at: params.unmatchedMessage.received_at,
        state_signal: params.stateSignal.caseState,
        metadata: {
          ...metadata,
          linked_from_unmatched_case_message_id: params.unmatchedMessage.id,
          original_failure_reason: params.unmatchedMessage.failure_reason,
          original_link_status: params.unmatchedMessage.link_status
        }
      }, {
        onConflict: 'tenant_id,provider,provider_message_id'
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error || new Error('Failed to create case message from unmatched Amazon email');
    }

    return data.id;
  }

  private async markUnmatchedMessageLinked(params: {
    tenantId: string;
    unmatchedMessage: StoredUnmatchedCaseMessage;
    disputeCaseId: string;
    actorUserId: string;
    linkStatus: StoredUnmatchedCaseMessage['link_status'];
    caseMessageId: string;
    placeholderCreated: boolean;
    stateSignal: CaseThreadState;
    timestamp: string;
  }): Promise<void> {
    const existingResolutionMetadata = asObject(params.unmatchedMessage.resolution_metadata);
    const actorUserUuid = convertUserIdToUuid(params.actorUserId);

    await supabaseAdmin
      .from('unmatched_case_messages')
      .update({
        linked_dispute_case_id: params.disputeCaseId,
        link_status: params.linkStatus,
        resolved_at: params.timestamp,
        resolved_by: actorUserUuid,
        resolution_metadata: {
          ...existingResolutionMetadata,
          linked_case_message_id: params.caseMessageId,
          placeholder_created: params.placeholderCreated,
          linked_case_state: params.stateSignal,
          linked_at: params.timestamp
        }
      })
      .eq('tenant_id', params.tenantId)
      .eq('id', params.unmatchedMessage.id);
  }

  async backfillAmazonThreadLink(params: {
    tenantId: string;
    actorUserId: string;
    unmatchedCaseMessageId: string;
    targetDisputeCaseId?: string | null;
    createPlaceholder?: boolean;
    targetUserId?: string | null;
  }): Promise<{
    disputeCaseId: string;
    caseMessageId: string;
    amazonCaseId: string;
    placeholderCreated: boolean;
    linkStatus: StoredUnmatchedCaseMessage['link_status'];
    caseState: CaseThreadState;
  }> {
    const unmatchedMessage = await this.getUnmatchedCaseMessage(params.tenantId, params.unmatchedCaseMessageId);
    if (!unmatchedMessage) {
      throw new Error('Unmatched Amazon email not found');
    }

    const amazonCaseId = trimOrNull(unmatchedMessage.amazon_case_id);
    if (!amazonCaseId) {
      throw new Error('Unmatched Amazon email does not contain a usable amazon_case_id');
    }

    const targetDisputeCaseId = trimOrNull(params.targetDisputeCaseId);
    const createPlaceholder = params.createPlaceholder === true;
    if (!targetDisputeCaseId && !createPlaceholder) {
      throw new Error('Provide a target dispute case or request placeholder creation');
    }
    if (targetDisputeCaseId && createPlaceholder) {
      throw new Error('Choose either target dispute case linking or placeholder creation, not both');
    }
    if (trimOrNull(unmatchedMessage.linked_dispute_case_id) && trimOrNull(unmatchedMessage.linked_dispute_case_id) !== targetDisputeCaseId && !createPlaceholder) {
      throw new Error('This Amazon email is already linked to another dispute case');
    }

    const timestamp = toIsoTimestamp(unmatchedMessage.received_at || unmatchedMessage.created_at);
    const stateSignal = this.deriveStateSignal(
      trimOrNull(unmatchedMessage.subject) || 'Amazon support update',
      unmatchedMessage.body_text
    );

    let disputeCase: any | null = null;
    let placeholderCreated = false;
    let linkStatus: StoredUnmatchedCaseMessage['link_status'] = 'linked_existing_case';

    if (targetDisputeCaseId) {
      disputeCase = await this.getDisputeCaseById(params.tenantId, targetDisputeCaseId);
      if (!disputeCase) {
        throw new Error('Target dispute case not found');
      }

      const targetAmazonCaseId = trimOrNull(disputeCase.amazon_case_id);
      if (targetAmazonCaseId && targetAmazonCaseId !== amazonCaseId) {
        throw new Error('Target dispute case is already bound to a different amazon_case_id');
      }
    } else {
      const preferredOwnerUserId = trimOrNull(params.targetUserId) || trimOrNull(unmatchedMessage.user_id);
      if (!preferredOwnerUserId) {
        throw new Error('Placeholder creation requires a tenant user to own the backfilled thread');
      }

      const placeholderCase = await this.createPlaceholderDisputeCase({
        tenantId: params.tenantId,
        unmatchedMessage,
        amazonCaseId,
        ownerUserId: preferredOwnerUserId,
        actorUserId: params.actorUserId,
        timestamp
      });
      disputeCase = placeholderCase.disputeCase;
      placeholderCreated = placeholderCase.created;
      linkStatus = disputeCase.case_origin === 'amazon_thread_backfill'
        ? 'linked_placeholder_case'
        : 'linked_existing_case';
    }

    disputeCase = await this.ensureThreadLinkedDisputeCase({
      tenantId: params.tenantId,
      disputeCase,
      amazonCaseId,
      timestamp,
      resolutionSource: linkStatus,
      unmatchedMessageId: unmatchedMessage.id,
      providerMessageId: unmatchedMessage.provider_message_id
    });

    const caseMessageId = await this.upsertLinkedCaseMessageFromUnmatched({
      tenantId: params.tenantId,
      disputeCaseId: disputeCase.id,
      amazonCaseId,
      unmatchedMessage,
      stateSignal
    });

    const nextState = await this.applyInboundCaseState({
      tenantId: params.tenantId,
      disputeCase,
      amazonCaseId,
      stateSignal,
      bodyText: unmatchedMessage.body_text,
      subject: trimOrNull(unmatchedMessage.subject) || 'Amazon support update',
      timestamp
    });

    try {
      await this.emitCaseStateNotification({
        tenantId: params.tenantId,
        disputeCase,
        amazonCaseId,
        providerMessageId: unmatchedMessage.provider_message_id,
        nextState,
        subject: trimOrNull(unmatchedMessage.subject) || 'Amazon support update',
        bodyText: unmatchedMessage.body_text
      });
    } catch (error: any) {
      logger.error('[AGENT 7 THREAD] Failed to emit notification after unmatched backfill link', {
        tenantId: params.tenantId,
        disputeCaseId: disputeCase.id,
        amazonCaseId,
        unmatchedCaseMessageId: unmatchedMessage.id,
        error: error?.message || error
      });
    }

    await this.markUnmatchedMessageLinked({
      tenantId: params.tenantId,
      unmatchedMessage,
      disputeCaseId: disputeCase.id,
      actorUserId: params.actorUserId,
      linkStatus,
      caseMessageId,
      placeholderCreated,
      stateSignal: nextState,
      timestamp
    });

    return {
      disputeCaseId: disputeCase.id,
      caseMessageId,
      amazonCaseId,
      placeholderCreated,
      linkStatus,
      caseState: nextState
    };
  }

  private async downloadEvidenceBytes(document: any): Promise<Buffer> {
    if (trimOrNull(document.storage_path)) {
      const { data, error } = await supabaseAdmin
        .storage
        .from('evidence-documents')
        .download(document.storage_path);

      if (error || !data) {
        throw new Error(`Failed to download evidence attachment ${document.id}: ${error?.message || 'missing file'}`);
      }

      return Buffer.from(await data.arrayBuffer());
    }

    if (trimOrNull(document.file_url)) {
      const response = await axios.get(document.file_url, {
        responseType: 'arraybuffer',
        timeout: 60000
      });
      return Buffer.from(response.data);
    }

    throw new Error(`Evidence attachment ${document.id} has no storage_path or file_url`);
  }

  private async loadReplyAttachments(params: {
    tenantId: string;
    disputeCase: any;
    selectedDocumentIds: string[];
  }): Promise<{
    sendableAttachments: GmailReplyAttachment[];
    persistedAttachments: Array<Record<string, any>>;
  }> {
    if (!params.selectedDocumentIds.length) {
      return {
        sendableAttachments: [],
        persistedAttachments: []
      };
    }

    const { data: links, error: linkError } = await supabaseAdmin
      .from('dispute_evidence_links')
      .select('evidence_document_id')
      .eq('tenant_id', params.tenantId)
      .eq('dispute_case_id', params.disputeCase.id);

    if (linkError) {
      throw linkError;
    }

    const allowedDocumentIds = new Set<string>(
      (links || []).map((row: any) => trimOrNull(row.evidence_document_id)).filter((value): value is string => Boolean(value))
    );

    const embeddedDocumentId = trimOrNull(params.disputeCase?.evidence_attachments?.document_id);
    if (embeddedDocumentId) {
      allowedDocumentIds.add(embeddedDocumentId);
    }

    const requestedDocumentIds = Array.from(new Set(params.selectedDocumentIds.map((id) => trimOrNull(id)).filter((id): id is string => Boolean(id))));
    const disallowedIds = requestedDocumentIds.filter((id) => !allowedDocumentIds.has(id));
    if (disallowedIds.length) {
      throw new Error('Reply attachments must be linked to the dispute case');
    }

    const { data: documents, error: documentError } = await supabaseAdmin
      .from('evidence_documents')
      .select('id, tenant_id, filename, content_type, size_bytes, file_url, storage_path')
      .eq('tenant_id', params.tenantId)
      .in('id', requestedDocumentIds);

    if (documentError) {
      throw documentError;
    }

    const resolvedDocuments = documents || [];
    if (resolvedDocuments.length !== requestedDocumentIds.length) {
      throw new Error('One or more selected attachments could not be resolved');
    }

    const sendableAttachments: GmailReplyAttachment[] = [];
    const persistedAttachments: Array<Record<string, any>> = [];

    for (const document of resolvedDocuments) {
      const data = await this.downloadEvidenceBytes(document);
      sendableAttachments.push({
        filename: document.filename || `${document.id}.bin`,
        contentType: trimOrNull(document.content_type) || 'application/octet-stream',
        data
      });
      persistedAttachments.push({
        filename: document.filename || `${document.id}.bin`,
        content_type: trimOrNull(document.content_type),
        size_bytes: Number.isFinite(Number(document.size_bytes)) ? Number(document.size_bytes) : data.length,
        evidence_document_id: document.id,
        file_url: trimOrNull(document.file_url),
        storage_path: trimOrNull(document.storage_path)
      });
    }

    return {
      sendableAttachments,
      persistedAttachments
    };
  }

  private buildReplySubject(amazonCaseId: string, priorSubject?: string | null, caseLabel?: string | null): string {
    const normalizedPrior = trimOrNull(priorSubject);
    if (normalizedPrior && normalizedPrior.toLowerCase().includes(amazonCaseId.toLowerCase())) {
      return normalizedPrior.startsWith('RE:') ? normalizedPrior : `RE:${normalizedPrior}`;
    }

    const suffix = trimOrNull(caseLabel) || 'Amazon support case';
    return `RE:[CASE ${amazonCaseId}] ${suffix}`;
  }

  private async resolveReplySender(tenantId: string, userId: string): Promise<string | null> {
    const dbUserId = convertUserIdToUuid(userId);
    const { data: source, error } = await supabaseAdmin
      .from('evidence_sources')
      .select('account_email')
      .eq('tenant_id', tenantId)
      .eq('user_id', dbUserId)
      .eq('provider', 'gmail')
      .eq('status', 'connected')
      .maybeSingle();

    if (error) {
      throw error;
    }

    return trimOrNull(source?.account_email);
  }

  async listCaseMessages(tenantId: string, disputeCaseId: string): Promise<any[]> {
    const { data, error } = await supabaseAdmin
      .from('case_messages')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('dispute_case_id', disputeCaseId)
      .order('received_at', { ascending: true, nullsFirst: false })
      .order('sent_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data || []).map((row: StoredCaseMessage) => ({
      id: row.id,
      dispute_case_id: row.dispute_case_id,
      amazon_case_id: row.amazon_case_id,
      direction: row.direction,
      subject: row.subject,
      body_text: row.body_text,
      body_html: row.body_html,
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      sender: row.sender,
      recipients: Array.isArray(row.recipients) ? row.recipients : [],
      received_at: row.received_at,
      sent_at: row.sent_at,
      created_at: row.created_at,
      state_signal: row.state_signal,
      provider: row.provider,
      provider_thread_id: row.provider_thread_id,
      message_identifier: row.message_identifier,
      in_reply_to: row.in_reply_to,
      reference_headers: Array.isArray(row.reference_headers) ? row.reference_headers : [],
      metadata: row.metadata || {}
    }));
  }

  async sendCaseReply(params: {
    tenantId: string;
    userId: string;
    disputeCaseId: string;
    message: string;
    attachmentDocumentIds?: string[];
  }): Promise<{
    messageId: string;
    threadId: string | null;
    caseMessageId: string;
  }> {
    const replyBody = trimOrNull(params.message);
    if (!replyBody) {
      throw new Error('Reply message is required');
    }

    const { data: disputeCase, error: disputeError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, tenant_id, amazon_case_id, case_state, case_number, case_type, evidence_attachments')
      .eq('tenant_id', params.tenantId)
      .eq('id', params.disputeCaseId)
      .maybeSingle();

    if (disputeError) {
      throw disputeError;
    }

    if (!disputeCase) {
      throw new Error('Dispute case not found');
    }

    const amazonCaseId = trimOrNull(disputeCase.amazon_case_id);
    if (!amazonCaseId || disputeCase.case_state === 'unlinked') {
      throw new Error('Amazon thread not yet linked');
    }

    const { data: messageRows, error: messageError } = await supabaseAdmin
      .from('case_messages')
      .select('*')
      .eq('tenant_id', params.tenantId)
      .eq('dispute_case_id', params.disputeCaseId)
      .order('created_at', { ascending: false })
      .limit(25);

    if (messageError) {
      throw messageError;
    }

    const threadMessages = (messageRows || []) as StoredCaseMessage[];
    const latestThreadMessage = threadMessages.find((row) => trimOrNull(row.provider_thread_id) || trimOrNull(row.message_identifier));
    const latestInboundMessage = threadMessages.find((row) => row.direction === 'inbound' && trimOrNull(row.sender));

    if (!latestThreadMessage || !latestInboundMessage) {
      throw new Error('Reply requires an existing Amazon thread message');
    }

    const replyToAddress = parseEmailAddress(latestInboundMessage.sender);
    if (!replyToAddress) {
      throw new Error('Amazon reply address could not be resolved');
    }

    const { sendableAttachments, persistedAttachments } = await this.loadReplyAttachments({
      tenantId: params.tenantId,
      disputeCase,
      selectedDocumentIds: params.attachmentDocumentIds || []
    });

    const replySubject = this.buildReplySubject(
      amazonCaseId,
      latestInboundMessage.subject,
      disputeCase.case_number || disputeCase.case_type || null
    );
    const referenceHeaders = uniqueStrings([
      ...(Array.isArray(latestThreadMessage.reference_headers) ? latestThreadMessage.reference_headers : []),
      trimOrNull(latestThreadMessage.message_identifier)
    ]);

    const sent = await gmailService.sendReply(params.userId, {
      to: [replyToAddress],
      subject: replySubject,
      bodyText: replyBody,
      threadId: trimOrNull(latestThreadMessage.provider_thread_id),
      inReplyTo: trimOrNull(latestThreadMessage.message_identifier),
      references: referenceHeaders,
      attachments: sendableAttachments
    });

    const sentMessage = await gmailService.fetchMessage(params.userId, sent.id, 'full');
    const senderIdentity = await this.resolveReplySender(params.tenantId, params.userId);
    const sentTimestamp = new Date(Number(sentMessage.internalDate || Date.now())).toISOString();
    const providerMessageIdentifier = trimOrNull(this.getHeaderValue(sentMessage, 'Message-ID'))?.replace(/[<>]/g, '') || null;
    const inReplyTo = trimOrNull(this.getHeaderValue(sentMessage, 'In-Reply-To'))?.replace(/[<>]/g, '') || trimOrNull(latestThreadMessage.message_identifier);
    const references = uniqueStrings([
      ...splitReferenceHeader(this.getHeaderValue(sentMessage, 'References')),
      ...referenceHeaders,
      inReplyTo
    ]);

    const { data: insertedMessage, error: insertError } = await supabaseAdmin
      .from('case_messages')
      .insert({
        tenant_id: params.tenantId,
        dispute_case_id: params.disputeCaseId,
        amazon_case_id: amazonCaseId,
        provider: 'gmail',
        provider_message_id: sent.id,
        provider_thread_id: trimOrNull(sent.threadId),
        message_identifier: providerMessageIdentifier,
        in_reply_to: inReplyTo,
        reference_headers: references,
        direction: 'outbound',
        subject: replySubject,
        body_text: replyBody,
        body_html: null,
        attachments: persistedAttachments,
        sender: senderIdentity,
        recipients: [replyToAddress],
        sent_at: sentTimestamp,
        state_signal: null,
        metadata: {
          sent_via: 'gmail_api',
          attachment_count: persistedAttachments.length
        }
      })
      .select('id')
      .single();

    if (insertError || !insertedMessage) {
      throw insertError || new Error('Failed to persist outbound case reply');
    }

    return {
      messageId: sent.id,
      threadId: trimOrNull(sent.threadId),
      caseMessageId: insertedMessage.id
    };
  }
}

export const amazonCaseThreadService = new AmazonCaseThreadService();
export default amazonCaseThreadService;
