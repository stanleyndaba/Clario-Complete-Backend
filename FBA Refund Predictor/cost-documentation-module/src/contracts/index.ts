import { z } from 'zod';

// Shared error shape
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  details: z.any().optional(),
});

// Transaction Journal contracts
export const RecordTransactionSchema = z.object({
  tx_type: z.string().min(1),
  entity_id: z.string().min(1),
  payload: z.record(z.unknown()),
});

export type RecordTransactionRequest = z.infer<typeof RecordTransactionSchema>;

export const RecordTransactionResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    tx_type: z.string(),
    entity_id: z.string(),
    payload: z.record(z.unknown()),
    timestamp: z.string(),
    actor_id: z.string(),
    hash: z.string(),
  }),
});

export const ListTransactionsQuerySchema = z.object({
  tx_type: z.string().optional(),
  entity_id: z.string().optional(),
  actor_id: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().uuid().optional(),
});

export const ListTransactionsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        tx_type: z.string(),
        entity_id: z.string(),
        payload: z.record(z.unknown()),
        timestamp: z.string(),
        actor_id: z.string(),
        hash: z.string(),
      })
    ),
    nextCursor: z.string().uuid().optional(),
  }),
});

export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;

// Cost Doc v1.1 (surface minimal contracts for new endpoints)
export const LockDocParamsSchema = z.object({ id: z.string().uuid() });
export const LockDocResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    id: z.string().uuid(),
    status: z.string(),
    locked_at: z.string().optional(),
    locked_by: z.string().optional(),
  }),
});

export const ExportDocsBodySchema = z.object({
  document_ids: z.array(z.string().uuid()).min(1),
  bundle_name: z.string().min(1),
  description: z.string().optional(),
  format: z.enum(['zip', 'combined_pdf']),
});

export const AuditTrailParamsSchema = z.object({ id: z.string().uuid() });

// Re-export for frontend consumption
export * as Contracts from './index';


