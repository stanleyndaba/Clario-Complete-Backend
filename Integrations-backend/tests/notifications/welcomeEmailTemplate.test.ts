import { describe, expect, it } from '@jest/globals';
import {
  buildAuditStartUrl,
  buildWelcomeEmail,
  shouldSuppressWelcomeEmailForAuditProgress
} from '../../src/services/welcomeEmailService';

describe('workspace welcome email template', () => {
  it('renders the approved Audit-focused welcome message, branded header, trusted CTA, and footer', () => {
    const template = buildWelcomeEmail({
      userId: 'user-1',
      email: 'seller@example.com',
      firstName: 'Amina',
      tenantId: 'tenant-1',
      tenantName: 'Acme',
      tenantSlug: 'acme'
    }, {
      amazonConnected: false,
      reliable: true
    });

    expect(template.subject).toBe('Welcome to Margin — your free Recovery Audit is ready');
    expect(template.html).toContain('Welcome to Margin, Amina.');
    expect(template.html).toContain('logoimagetwo.png');
    expect(template.html).toContain('font-family:Merriweather, Georgia');
    expect(template.html).toContain('Run your free Recovery Audit');
    expect(template.html).toContain(buildAuditStartUrl('acme'));
    expect(template.html).toContain('Read-only access &middot; No payment to run the Audit &middot; Nothing is submitted without your approval');
    expect(template.html).toContain('Here is how we will get you started');
    expect(template.html).toContain('You stay in control at every meaningful step.');
    expect(template.html).toContain('Clear recovery work. You stay in control.');
    expect(template.html).toContain('© 2026 Margin. All rights reserved.');
    expect(template.html).toContain('https://app.margin-finance.com/privacy');
    expect(template.html).toContain('https://app.margin-finance.com/terms');
    expect(template.text).toContain('Run your free Recovery Audit');
    expect(template.text).toContain(buildAuditStartUrl('acme'));
    expect(template.text).toContain('Questions about your account or Audit? Reply to this email');
    expect(template.html).not.toContain('what Amazon may owe you');
    expect(template.html).not.toContain('reimbursement opportunities');
  });

  it('uses the required non-personalized greeting when no verified first name is available', () => {
    const template = buildWelcomeEmail({
      userId: 'user-1',
      email: 'seller@example.com',
      firstName: null,
      tenantId: 'tenant-1',
      tenantSlug: 'acme'
    }, {
      amazonConnected: false,
      reliable: true
    });

    expect(template.html).toContain('Welcome to Margin.');
    expect(template.html).not.toContain('Welcome to Margin, .');
    expect(template.text).toContain('Welcome to Margin.');
  });

  it('keeps the CTA on the first authenticated Audit step', () => {
    expect(buildAuditStartUrl('acme')).toBe('https://app.margin-finance.com/app/acme/connect-amazon');
  });

  it('suppresses the welcome email when the seller has already entered or completed the Audit journey', () => {
    expect(shouldSuppressWelcomeEmailForAuditProgress({ hasAttachedAuditIntent: true })).toBe(true);
    expect(shouldSuppressWelcomeEmailForAuditProgress({ hasStartedOrCompletedAudit: true })).toBe(true);
    expect(shouldSuppressWelcomeEmailForAuditProgress({})).toBe(false);
  });
});
