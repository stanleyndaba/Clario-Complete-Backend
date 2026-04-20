import { describe, expect, it } from '@jest/globals';

import { buildWaitlistConfirmationEmail } from '../../src/services/waitlistEmailService';

describe('waitlistEmailService', () => {
  it('builds a restrained waitlist confirmation email', () => {
    const email = buildWaitlistConfirmationEmail();

    expect(email.subject).toBe('Welcome to Margin');
    expect(email.text).toContain("You're officially on the waitlist.");
    expect(email.text).toContain('identify missed reimbursement opportunities');
    expect(email.text).toContain('considered for early access');
    expect(email.html).toContain('Welcome to Margin');
    expect(email.html).toContain('Early access');
    expect(email.html).toContain('Amazon FBA sellers');
  });
});
