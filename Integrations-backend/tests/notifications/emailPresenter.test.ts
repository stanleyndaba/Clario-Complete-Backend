import { describe, expect, it } from '@jest/globals';
import { NotificationChannel, NotificationPriority, NotificationType } from '../../src/notifications/models/notification';
import { buildNotificationEmailViewModel } from '../../src/notifications/services/delivery/email_presenter';
import { EmailService } from '../../src/notifications/services/delivery/email_service';

function makeNotification(overrides: Partial<any> = {}) {
  return {
    id: 'notif-1',
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    type: NotificationType.NEEDS_EVIDENCE,
    title: 'Amazon Needs More Evidence',
    message: 'Amazon requested additional information for Case 19824203951. Margin linked the thread and is ready for your next response.',
    status: 'pending',
    priority: NotificationPriority.URGENT,
    channel: NotificationChannel.BOTH,
    payload: {},
    dedupe_key: null,
    delivery_state: {},
    last_delivery_error: null,
    read_at: undefined,
    delivered_at: undefined,
    expires_at: undefined,
    created_at: new Date('2026-04-03T11:34:39.000Z'),
    updated_at: new Date('2026-04-03T11:34:39.000Z'),
    ...overrides
  };
}

describe('buildNotificationEmailViewModel', () => {
  it('renders closure wording for needs_evidence when Amazon closed the case due to no response', () => {
    const notification = makeNotification({
      payload: {
        payload: {
          payload: {
            subject: '[Case ID:19824203951]*Your Case Resolved* Inventory lost in FBA warehouse',
            metadata: { raw_event_name: 'needs_evidence' },
            disputeId: '3f4e475a-99b2-48e2-9155-c5a2216418cc',
            entity_id: '3f4e475a-99b2-48e2-9155-c5a2216418cc',
            tenant_id: 'f1181d15-3f4e-4500-a73e-2741fdaf2b88',
            tenant_slug: 'demo-workspace',
            timestamp: '2026-04-03T11:34:37.823Z',
            case_state: 'needs_evidence',
            event_type: 'needs_evidence',
            entity_type: 'dispute_case',
            body_preview:
              'Because we haven’t received a response from you, we assume that your issue is resolved. We have now closed this case. If the issue is not resolved, you can reopen this case and provide the requested information.',
            amazon_case_id: '19824203951',
            dispute_case_id: '3f4e475a-99b2-48e2-9155-c5a2216418cc',
            provider_message_id: '19d4cc7123e3396d',
            dedupe_key: '19d4cc7123e3396d'
          }
        }
      }
    });

    const result = buildNotificationEmailViewModel(notification as any, {
      frontendUrl: 'https://app.margin-finance.com'
    });

    expect(result.email_subject).toBe('Amazon closed your case (19824203951) pending more information');
    expect(result.email_summary).toContain('Amazon closed this case after not receiving the requested response');
    expect(result.email_detail_lines).toEqual([
      { label: 'Amazon case', value: '19824203951' },
      { label: 'Status', value: 'Closed - no response received' },
      { label: 'Updated', value: 'Apr 3, 2026, 11:34 AM UTC' }
    ]);
    expect(result.why_this_matters).toContain('Amazon may keep this case closed');
    expect(result.amazon_said_preview).toContain('Because we haven’t received a response from you');
    expect(result.trust_line).toBe('Margin has linked this case and is tracking it for you.');
    expect(result.what_to_do_next).toContain('reopen only if you can provide the missing information');
    expect(result.action_url).toBe('https://app.margin-finance.com/app/redirect?target=%2Fcases%2F3f4e475a-99b2-48e2-9155-c5a2216418cc&tenant=demo-workspace');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('tenant_id');
    expect(serialized).not.toContain('provider_message_id');
    expect(serialized).not.toContain('dedupe_key');
    expect(serialized).not.toContain('entity_type');
  });

  it('renders true evidence-request wording when the case is still asking for information', () => {
    const notification = makeNotification({
      payload: {
        subject: 'Your help needed for Case 19824203951',
        tenant_slug: 'demo-workspace',
        timestamp: '2026-04-03T11:34:37.823Z',
        case_state: 'needs_evidence',
        body_preview: '<p>Hello from Amazon Support.</p><p>Please provide the invoice and proof of shipment so we can continue reviewing your case.</p>',
        amazon_case_id: '19824203951',
        dispute_case_id: '3f4e475a-99b2-48e2-9155-c5a2216418cc'
      }
    });

    const result = buildNotificationEmailViewModel(notification as any, {
      frontendUrl: 'https://app.margin-finance.com'
    });

    expect(result.email_subject).toBe('Amazon needs more information for your case (19824203951)');
    expect(result.email_summary).toBe('Amazon asked for additional information before it can continue reviewing this case.');
    expect(result.email_detail_lines[1]).toEqual({ label: 'Status', value: 'Action required' });
    expect(result.why_this_matters).toBe('If no action is taken, Amazon may close this case before reimbursement can be approved.');
    expect(result.amazon_said_preview).toBe('Hello from Amazon Support. Please provide the invoice and proof of shipment so we can continue reviewing your case.');
    expect(result.what_to_do_next).toBe('Open the case in Margin to review Amazon’s request and respond with the required details or evidence.');
    expect(result.trust_line).toBe('Margin has linked this case and is tracking it for you.');
  });

  it.each([
    [NotificationType.APPROVED, 'Amazon approved your case (19824203951)', 'Approved'],
    [NotificationType.REJECTED, 'Amazon rejected your case (19824203951)', 'Rejected'],
    [NotificationType.PAID, 'Amazon confirmed payment for your case (19824203951)', 'Paid']
  ])('renders clean wording for %s', (type, subject, statusLabel) => {
    const notification = makeNotification({
      type,
      title: 'Internal title should not leak',
      message: 'Internal message should not leak',
      payload: {
        amazon_case_id: '19824203951',
        tenant_slug: 'demo-workspace',
        dispute_case_id: '3f4e475a-99b2-48e2-9155-c5a2216418cc',
        timestamp: '2026-04-03T11:34:37.823Z'
      }
    });

    const result = buildNotificationEmailViewModel(notification as any, {
      frontendUrl: 'https://app.margin-finance.com'
    });

    expect(result.email_subject).toBe(subject);
    expect(result.email_detail_lines[1]).toEqual({ label: 'Status', value: statusLabel });
  });

  it('fails closed to a safe fallback when payload is empty or malformed', () => {
    const notification = makeNotification({
      type: 'unknown_event',
      title: 'Margin notification',
      message: 'Margin has an update for you.',
      payload: {
        payload: 'not-an-object',
        metadata: { raw_event_name: 'unknown_event' },
        tenant_id: 'internal-tenant',
        provider_message_id: 'secret'
      }
    });

    const result = buildNotificationEmailViewModel(notification as any, {
      frontendUrl: 'https://app.margin-finance.com'
    });

    expect(result.email_subject).toBe('Margin notification');
    expect(result.email_summary).toBe('Margin has an update for you.');
    expect(result.email_detail_lines).toEqual([{ label: 'Updated', value: 'Apr 3, 2026, 11:34 AM UTC' }]);
    expect(result.action_url).toBe('https://app.margin-finance.com/notifications');
  });

  it('sanitizes unsafe tenant and case identifiers when building the action URL', () => {
    const notification = makeNotification({
      payload: {
        amazon_case_id: '19824203951',
        tenant_slug: '../../evil-tenant',
        dispute_case_id: '3f4e475a-99b2-48e2-9155-c5a2216418cc<script>',
        timestamp: '2026-04-03T11:34:37.823Z'
      }
    });

    const result = buildNotificationEmailViewModel(notification as any, {
      frontendUrl: 'https://app.margin-finance.com'
    });

    expect(result.action_url).toBe('https://app.margin-finance.com/notifications');
  });
});

describe('EmailService email rendering', () => {
  it('does not dump raw JSON or internal fields into the rendered email template', () => {
    const service = new EmailService() as any;
    const notification = makeNotification({
      payload: {
        payload: {
          payload: {
            subject: '[Case ID:19824203951]*Your Case Resolved* Inventory lost in FBA warehouse',
            tenant_slug: 'demo-workspace',
            timestamp: '2026-04-03T11:34:37.823Z',
            case_state: 'needs_evidence',
            body_preview:
              'Because we haven’t received a response from you, we assume that your issue is resolved. We have now closed this case.',
            amazon_case_id: '19824203951',
            dispute_case_id: '3f4e475a-99b2-48e2-9155-c5a2216418cc',
            provider_message_id: '19d4cc7123e3396d',
            metadata: { raw_event_name: 'needs_evidence' },
            tenant_id: 'tenant-1'
          }
        }
      }
    });

    const template = service.generateEmailTemplate(notification);

    expect(template.subject).toBe('Amazon closed your case (19824203951) pending more information');
    expect(template.html).toContain('Why this matters');
    expect(template.html).toContain('What Amazon said');
    expect(template.html).toContain('What to do next');
    expect(template.html).toContain('View in App');
    expect(template.html).toContain('If the button doesn’t work, copy and paste this link:');
    expect(template.html).toContain('app/redirect?target=%2Fcases%2F3f4e475a-99b2-48e2-9155-c5a2216418cc&amp;tenant=demo-workspace');
    expect(template.html).not.toContain('Payload:');
    expect(template.html).not.toContain('provider_message_id');
    expect(template.html).not.toContain('tenant_id');
    expect(template.html).not.toContain('metadata');
    expect(template.html).not.toContain('dedupe_key');
    expect(template.html).not.toContain('{&quot;');

    expect(template.text).toContain('Amazon closed this case after not receiving the requested response.');
    expect(template.text).toContain('Why this matters:');
    expect(template.text).toContain('What Amazon said:');
    expect(template.text).toContain('If the button doesn’t work, copy and paste this link:');
    expect(template.text).not.toContain('Payload:');
    expect(template.text).not.toContain('provider_message_id');
    expect(template.text).not.toContain('tenant_id');
  });
});
