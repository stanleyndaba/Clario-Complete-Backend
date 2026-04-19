import { describe, expect, it } from '@jest/globals';
import { buildManualUserBroadcastEmail } from '../../src/notifications/services/delivery/manual_broadcast_presenter';

describe('manual user broadcast email presenter', () => {
  it('renders a direct Margin message without requiring highlights or CTA', () => {
    const template = buildManualUserBroadcastEmail({
      subject: 'Service update',
      heading: 'A quick update from Margin',
      body: 'We are completing maintenance now.\n\nYour workspace will be available shortly.'
    });

    expect(template.subject).toBe('Service update');
    expect(template.view.email_heading).toBe('A quick update from Margin');
    expect(template.view.email_summary).toBeNull();
    expect(template.view.email_highlights).toEqual([]);
    expect(template.view.action_label).toBeNull();
    expect(template.view.action_url).toBeNull();
    expect(template.html).toContain('From Margin');
    expect(template.html).toContain('This is a direct account message from Margin.');
    expect(template.html).not.toContain('Key notes');
    expect(template.html).not.toContain('undefined');
  });

  it('renders highlights and CTA only when valid fields are present', () => {
    const template = buildManualUserBroadcastEmail({
      subject: 'Recovery audit update',
      heading: 'A quick update from Margin',
      summary: 'Your workspace is active while we expand coverage.',
      body: 'Margin is continuing to review FBA activity.',
      highlights: ['Monitoring is running', 'No action is needed today'],
      cta_label: 'Open Margin',
      cta_url: 'https://app.margin-finance.com/app'
    });

    expect(template.view.email_summary).toBe('Your workspace is active while we expand coverage.');
    expect(template.view.email_highlights).toEqual(['Monitoring is running', 'No action is needed today']);
    expect(template.view.action_label).toBe('Open Margin');
    expect(template.html).toContain('Key notes');
    expect(template.html).toContain('Open Margin');
    expect(template.text).toContain('- Monitoring is running');
  });
});
