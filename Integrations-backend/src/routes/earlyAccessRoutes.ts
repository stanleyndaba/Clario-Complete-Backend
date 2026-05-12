import { Router, Request, Response } from 'express';
import {
  buildEarlyAccessIntakeReceivedEmail,
  buildEarlyAccessPaymentConfirmedEmail,
  buildEarlyAccessSetupScheduledEmail,
  earlyAccessEmailService
} from '../services/earlyAccessEmailService';
import requirePlatformAdmin from '../middleware/platformAdminMiddleware';
import logger from '../utils/logger';

const router = Router();

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();
const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeTemplateKey = (value: unknown): FoundingTemplateKey | null => {
  const key = String(value || '').trim().toLowerCase();
  return key in foundingTemplateRegistry ? key as FoundingTemplateKey : null;
};

const foundingTemplateRegistry = {
  payment_confirmed: {
    label: 'Payment confirmed',
    build: buildEarlyAccessPaymentConfirmedEmail,
    send: (email: string) => earlyAccessEmailService.sendEarlyAccessPaymentConfirmedEmail(email)
  },
  intake_received: {
    label: 'Intake received',
    build: buildEarlyAccessIntakeReceivedEmail,
    send: (email: string) => earlyAccessEmailService.sendEarlyAccessIntakeReceivedEmail(email)
  },
  setup_scheduled: {
    label: 'Setup scheduled',
    build: buildEarlyAccessSetupScheduledEmail,
    send: (email: string) => earlyAccessEmailService.sendEarlyAccessSetupScheduledEmail(email)
  }
};

type FoundingTemplateKey = keyof typeof foundingTemplateRegistry;

router.post('/reservations', async (req: Request, res: Response) => {
  const email = normalizeEmail(req.body?.email);
  const {
    source_page,
    offer,
    price,
    intent,
  } = req.body || {};

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required',
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Please enter a valid email address.',
    });
  }

  try {
    logger.info('[EARLY ACCESS] Reservation contact capture received', {
      email,
      source_page: source_page || '/early-access',
      intent: intent || 'reserve_early_access',
    });

    await earlyAccessEmailService.sendEarlyAccessLeadEmail({
      email,
      source_page: source_page || '/early-access',
      offer: offer || 'Margin Early Access',
      price: price || '$99',
      intent: intent || 'reserve_early_access',
      user_agent: req.headers['user-agent'] ? String(req.headers['user-agent']) : null,
      ip: req.ip || null,
    });

    let confirmationEmailStatus: 'queued' | 'failed' = 'queued';
    try {
      await earlyAccessEmailService.sendEarlyAccessConfirmationEmail(email);
    } catch (emailError: any) {
      confirmationEmailStatus = 'failed';
      logger.warn('[EARLY ACCESS] Buyer confirmation email failed after contact capture', {
        email,
        error: emailError?.message || String(emailError),
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Your audit request is secured. Redirecting you to checkout.',
      confirmation_email_status: confirmationEmailStatus,
      capture_mode: 'email_only',
    });
  } catch (error: any) {
    logger.error('[EARLY ACCESS] Reservation contact capture failed', {
      email,
      error: error?.message || String(error),
    });

    return res.status(503).json({
      success: false,
      message: 'We could not secure your audit request right now. Please try again in a moment.',
    });
  }
});

router.get('/templates', requirePlatformAdmin, (_req: Request, res: Response) => {
  return res.json({
    success: true,
    templates: Object.entries(foundingTemplateRegistry).map(([key, template]) => {
      const rendered = template.build();
      return {
        key,
        label: template.label,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text
      };
    })
  });
});

router.get('/templates/:templateKey', requirePlatformAdmin, (req: Request, res: Response) => {
  const templateKey = normalizeTemplateKey(req.params.templateKey);
  if (!templateKey) {
    return res.status(404).json({
      success: false,
      error: 'EARLY_ACCESS_TEMPLATE_NOT_FOUND',
      allowed_templates: Object.keys(foundingTemplateRegistry)
    });
  }

  const template = foundingTemplateRegistry[templateKey];
  const rendered = template.build();

  return res.json({
    success: true,
    template: {
      key: templateKey,
      label: template.label,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text
    }
  });
});

router.post('/templates/:templateKey/test-send', requirePlatformAdmin, async (req: Request, res: Response) => {
  const templateKey = normalizeTemplateKey(req.params.templateKey);
  const email = normalizeEmail(req.body?.email || req.body?.to);

  if (!templateKey) {
    return res.status(404).json({
      success: false,
      error: 'EARLY_ACCESS_TEMPLATE_NOT_FOUND',
      allowed_templates: Object.keys(foundingTemplateRegistry)
    });
  }

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      error: 'VALID_TEST_EMAIL_REQUIRED',
      message: 'A valid test recipient email is required.'
    });
  }

  try {
    const template = foundingTemplateRegistry[templateKey];
    const sendResult = await template.send(email);

    logger.info('[EARLY ACCESS] Founding template test email sent', {
      templateKey,
      email,
      providerMessageId: sendResult.providerMessageId || null
    });

    return res.json({
      success: true,
      template: templateKey,
      email,
      providerMessageId: sendResult.providerMessageId || null
    });
  } catch (error: any) {
    logger.error('[EARLY ACCESS] Founding template test email failed', {
      templateKey,
      email,
      error: error?.message || String(error)
    });

    return res.status(503).json({
      success: false,
      error: 'EARLY_ACCESS_TEMPLATE_TEST_SEND_FAILED',
      message: 'The test email could not be sent right now.'
    });
  }
});

export default router;
