import { Router, Request, Response } from 'express';
import { earlyAccessEmailService } from '../services/earlyAccessEmailService';
import logger from '../utils/logger';

const router = Router();

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();
const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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
      message: 'Your Early Access details are secured. Redirecting to PayPal checkout.',
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
      message: 'We could not secure your Early Access details right now. Please try again in a moment.',
    });
  }
});

export default router;
