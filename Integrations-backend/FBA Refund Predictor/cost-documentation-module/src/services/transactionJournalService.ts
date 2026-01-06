import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { RecordTransactionInput, TransactionJournalEntry, TransactionQuery } from '../types/costDocumentation';

const prisma = new PrismaClient();

function computeTxHash(payload: Record<string, any>, timestampIso: string): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(`${canonical}|${timestampIso}`).digest('hex');
}

export class TransactionJournalService {
  async recordTransaction(input: RecordTransactionInput): Promise<TransactionJournalEntry> {
    const timestamp = new Date().toISOString();
    const hash = computeTxHash(input.payload, timestamp);

    const entry = await prisma.transactionJournal.create({
      data: {
        tx_type: input.tx_type,
        entity_id: input.entity_id,
        payload: input.payload as any,
        timestamp: new Date(timestamp),
        actor_id: input.actor_id,
        hash,
      },
    });

    return {
      id: entry.id,
      tx_type: entry.tx_type,
      entity_id: entry.entity_id,
      payload: entry.payload as any,
      timestamp: entry.timestamp.toISOString(),
      actor_id: entry.actor_id,
      hash: entry.hash,
    };
  }

  async getTransactions(query: TransactionQuery): Promise<{ items: TransactionJournalEntry[]; nextCursor?: string }> {
    const take = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const where: any = {};
    if (query.tx_type) where.tx_type = query.tx_type;
    if (query.entity_id) where.entity_id = query.entity_id;
    if (query.actor_id) where.actor_id = query.actor_id;
    if (query.since || query.until) {
      where.timestamp = {};
      if (query.since) where.timestamp.gte = new Date(query.since);
      if (query.until) where.timestamp.lte = new Date(query.until);
    }

    const items = await prisma.transactionJournal.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: take + 1,
      skip: query.cursor ? 1 : 0,
      cursor: query.cursor ? { id: query.cursor } : undefined,
    });

    const hasMore = items.length > take;
    const sliced = hasMore ? items.slice(0, take) : items;

    return {
      items: sliced.map((e) => ({
        id: e.id,
        tx_type: e.tx_type,
        entity_id: e.entity_id,
        payload: e.payload as any,
        timestamp: e.timestamp.toISOString(),
        actor_id: e.actor_id,
        hash: e.hash,
      })),
      nextCursor: hasMore ? sliced[sliced.length - 1].id : undefined,
    };
  }

  async getTransactionById(id: string): Promise<TransactionJournalEntry | null> {
    const e = await prisma.transactionJournal.findUnique({ where: { id } });
    if (!e) return null;
    return {
      id: e.id,
      tx_type: e.tx_type,
      entity_id: e.entity_id,
      payload: e.payload as any,
      timestamp: e.timestamp.toISOString(),
      actor_id: e.actor_id,
      hash: e.hash,
    };
  }
}

export const transactionJournalService = new TransactionJournalService();


