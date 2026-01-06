import express, { Request, Response, NextFunction } from 'express';
import { StripeService } from '@/services/stripeService';

/**
 * Middleware to parse raw body for webhook verification
 * This should be used before the verifyStripeWebhook middleware
 */
export const stripeRawBody = express.raw({ type: 'application/json' });

/**
 * Middleware to verify Stripe webhook signatures
 */
export function verifyStripeWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const signature = req.headers['stripe-signature'] as string;
    
    if (!signature) {
      return res.status(400).json({
        error: 'Missing Stripe signature',
        message: 'Stripe signature header is required',
      });
    }

    // Get the raw body for signature verification
    const rawBody = (req as any).rawBody || (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : undefined);
    
    if (!rawBody) {
      return res.status(400).json({
        error: 'Missing request body',
        message: 'Request body is required for webhook verification',
      });
    }

    // Verify the webhook signature
    try {
      const event = StripeService.verifyWebhookSignature(rawBody, signature);

      // Attach the verified event to the request
      (req as any).stripeEvent = event;
      
      next();
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      return res.status(400).json({
        error: 'Invalid webhook signature',
        message: 'The webhook signature could not be verified',
      });
    }
  } catch (error) {
    console.error('Error in webhook verification middleware:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to verify webhook signature',
    });
  }
}

/**
 * Middleware to check if webhook event has already been processed
 */
export async function checkWebhookIdempotency(req: Request, res: Response, next: NextFunction) {
  try {
    const event = (req as any).stripeEvent;
    
    if (!event) {
      return res.status(400).json({
        error: 'Missing Stripe event',
        message: 'Stripe event is required',
      });
    }

    // Check if event has already been processed
    const { prisma } = await import('@/prisma/client');
    
    const existingEvent = await prisma.stripeWebhookEvent.findUnique({
      where: { eventId: event.id },
    });

    if (existingEvent && existingEvent.processed) {
      console.log(`Webhook event ${event.id} already processed, skipping`);
      return res.status(200).json({
        message: 'Event already processed',
        eventId: event.id,
      });
    }

    next();
  } catch (error) {
    console.error('Error checking webhook idempotency:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to check webhook idempotency',
    });
  }
}

/**
 * Middleware to validate webhook event type
 */
export function validateWebhookEventType(allowedEvents: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const event = (req as any).stripeEvent;
      
      if (!event) {
        return res.status(400).json({
          error: 'Missing Stripe event',
          message: 'Stripe event is required',
        });
      }

      if (!allowedEvents.includes(event.type)) {
        console.log(`Unsupported webhook event type: ${event.type}`);
        return res.status(200).json({
          message: 'Event type not supported',
          eventType: event.type,
        });
      }

      next();
    } catch (error) {
      console.error('Error validating webhook event type:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to validate webhook event type',
      });
    }
  };
}

/**
 * Middleware to log webhook events
 */
export async function logWebhookEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const event = (req as any).stripeEvent;
    
    if (!event) {
      return res.status(400).json({
        error: 'Missing Stripe event',
        message: 'Stripe event is required',
      });
    }

    // Import TransactionLogger here to avoid circular dependencies
    const { TransactionLogger } = await import('@/services/transactionLogger');
    
    // Log the webhook event
    await TransactionLogger.logWebhookEvent({
      eventId: event.id,
      eventType: event.type,
      payload: event,
    });

    next();
  } catch (error) {
    console.error('Error logging webhook event:', error);
    // Don't fail the request if logging fails
    next();
  }
} 