import { describe, expect, it } from '@jest/globals';
import { resolveEmailConfig } from '../../src/notifications/services/delivery/email_service';

describe('resolveEmailConfig', () => {
  it('uses only the Resend key for email delivery', () => {
    const config = resolveEmailConfig({
      EMAIL_API_KEY: 'stale-sendgrid-key',
      RESEND_API_KEY: 'resend-key',
      SENDGRID_API_KEY: 'sendgrid-key',
      EMAIL_FROM_EMAIL: 'notifications@margin-finance.com',
      EMAIL_FROM_NAME: 'Margin'
    });

    expect(config.provider).toBe('resend');
    expect(config.apiKey).toBe('resend-key');
    expect(config.fromEmail).toBe('notifications@margin-finance.com');
    expect(config.fromName).toBe('Margin');
  });

  it('ignores legacy provider settings and still resolves Resend', () => {
    const config = resolveEmailConfig({
      EMAIL_PROVIDER: 'sendgrid',
      EMAIL_API_KEY: 'stale-sendgrid-key',
      SENDGRID_API_KEY: 'sendgrid-key',
      RESEND_API_KEY: 'resend-key'
    });

    expect(config.provider).toBe('resend');
    expect(config.apiKey).toBe('resend-key');
  });

  it('does not fall back to generic email keys', () => {
    const config = resolveEmailConfig({
      EMAIL_API_KEY: 'generic-key'
    });

    expect(config.provider).toBe('resend');
    expect(config.apiKey).toBe('');
  });

  it('does not use SendGrid even if only a SendGrid key exists', () => {
    const config = resolveEmailConfig({
      EMAIL_PROVIDER: 'sendgrid',
      SENDGRID_API_KEY: 'sendgrid-key'
    });

    expect(config.provider).toBe('resend');
    expect(config.apiKey).toBe('');
  });
});
