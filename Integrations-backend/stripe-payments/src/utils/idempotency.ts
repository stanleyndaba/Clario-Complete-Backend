import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/prisma/client';
import config from '@/config/env';

export interface IdempotencyResult {
  isDuplicate: boolean;
  cachedResponse?: any;
}

export interface StoreIdempotencyRequest {
  key: string;
  userId: number;
  endpoint: string;
  response: any;
}

/**
 * Process idempotency key to prevent duplicate operations
 */
export async function processIdempotency(
  req: Request,
  userId: number,
  endpoint: string
): Promise<IdempotencyResult> {
  try {
    const idempotencyKey = req.headers['idempotency-key'] as string || 
                           req.headers['x-idempotency-key'] as string;

    if (!idempotencyKey) {
      return { isDuplicate: false };
    }

    // Check if key already exists and is valid
    const existingKey = await prisma.idempotencyKey.findUnique({
      where: { id: idempotencyKey },
    });

    if (existingKey) {
      // Check if key is expired
      if (existingKey.expiresAt < new Date()) {
        // Clean up expired key
        await prisma.idempotencyKey.delete({
          where: { id: idempotencyKey },
        });
        return { isDuplicate: false };
      }

      // Check if this key belongs to the same user and endpoint
      if (existingKey.userId === userId && existingKey.endpoint === endpoint) {
        return {
          isDuplicate: true,
          cachedResponse: existingKey.response,
        };
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    console.error('Error processing idempotency:', error);
    // Don't fail the request if idempotency check fails
    return { isDuplicate: false };
  }
}

/**
 * Store idempotency key with response
 */
export async function storeIdempotencyKey(
  key: string,
  userId: number,
  endpoint: string,
  response: any
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + config.IDEMPOTENCY_TTL_SECONDS);

    await prisma.idempotencyKey.upsert({
      where: { id: key },
      update: {
        response,
        expiresAt,
      },
      create: {
        id: key,
        userId,
        endpoint,
        response,
        expiresAt,
      },
    });
  } catch (error) {
    console.error('Error storing idempotency key:', error);
    // Don't fail the request if idempotency storage fails
  }
}

/**
 * Middleware to validate idempotency keys
 */
export function validateIdempotencyKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const idempotencyKey = req.headers['idempotency-key'] as string || 
                         req.headers['x-idempotency-key'] as string;

  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Missing idempotency key',
      message: 'Idempotency-Key or X-Idempotency-Key header is required',
    });
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(idempotencyKey)) {
    return res.status(400).json({
      error: 'Invalid idempotency key format',
      message: 'Idempotency key must be a valid UUID v4',
    });
  }

  next();
}

/**
 * Clean up expired idempotency keys
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
  try {
    const result = await prisma.idempotencyKey.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  } catch (error) {
    console.error('Error cleaning up expired idempotency keys:', error);
    return 0;
  }
}

/**
 * Get idempotency key statistics
 */
export async function getIdempotencyStats(): Promise<{
  totalKeys: number;
  expiredKeys: number;
  activeKeys: number;
}> {
  try {
    const totalKeys = await prisma.idempotencyKey.count();
    const expiredKeys = await prisma.idempotencyKey.count({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return {
      totalKeys,
      expiredKeys,
      activeKeys: totalKeys - expiredKeys,
    };
  } catch (error) {
    console.error('Error getting idempotency stats:', error);
    return {
      totalKeys: 0,
      expiredKeys: 0,
      activeKeys: 0,
    };
  }
}


