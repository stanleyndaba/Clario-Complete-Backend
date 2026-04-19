import { describe, expect, it } from '@jest/globals';
import { buildWelcomeEmail } from '../../src/services/welcomeEmailService';

describe('workspace welcome email template', () => {
  it('renders as a restrained account note without CTA buttons or marketing-heavy copy', () => {
    const template = buildWelcomeEmail({
      userId: 'user-1',
      email: 'seller@example.com',
      tenantId: 'tenant-1',
      tenantName: 'Acme',
      tenantSlug: 'acme'
    }, {
      amazonConnected: false,
      reliable: true
    });

    expect(template.subject).toBe('Welcome to Margin');
    expect(template.html).toContain('Welcome to Margin');
    expect(template.html).toContain('Margin Team');
    expect(template.text).toContain('reply to this email');
    expect(template.html).not.toContain('<a href=');
    expect(template.html).not.toContain('Connect Amazon</a>');
    expect(template.html).not.toContain('what Amazon may owe you');
    expect(template.html).not.toContain('reimbursement opportunities');
    expect(template.html).not.toContain('Current audit coverage');
  });
});
