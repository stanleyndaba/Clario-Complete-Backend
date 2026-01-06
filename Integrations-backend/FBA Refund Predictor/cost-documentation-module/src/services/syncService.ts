import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { transactionJournalService } from './transactionJournalService';

const prisma = new PrismaClient();

function canonicalHash(obj: any): string {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash('sha256').update(json).digest('hex');
}

export type SourceName = 'amazon' | 'shopify' | 'internal';

export class SyncService {
  async fetchFromSource(source: SourceName, entityId: string): Promise<any> {
    // Placeholder: integrate real connectors here
    return { entityId, stock: Math.floor(Math.random() * 100), price: 10.0 };
  }

  async archivePayload(source: SourceName, entityId: string, payload: any, s3_key?: string): Promise<void> {
    await prisma.rawPayloadArchive.create({
      data: { source, entity_id: entityId, payload, s3_key }
    });
  }

  async upsertSnapshot(source: SourceName, entityId: string, state: any): Promise<{ hash: string }> {
    const hash = canonicalHash(state);
    await prisma.snapshotState.upsert({
      where: { entity_id_source: { entity_id: entityId, source } as any },
      create: { entity_id: entityId, source, state, hash },
      update: { state, hash, refreshed_at: new Date() }
    });
    return { hash };
  }

  async compareWithSnapshot(source: SourceName, entityId: string, latest: any): Promise<{ isInSync: boolean; diff: any }> {
    const snapshot = await prisma.snapshotState.findUnique({ where: { entity_id_source: { entity_id: entityId, source } as any } });
    if (!snapshot) return { isInSync: false, diff: { reason: 'no_snapshot' } };
    const diffs: Record<string, { expected: any; actual: any }> = {};
    const keys = new Set([...Object.keys(snapshot.state as any), ...Object.keys(latest)]);
    for (const k of keys) {
      const a = (snapshot.state as any)[k];
      const b = (latest as any)[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs[k] = { expected: a, actual: b };
    }
    return { isInSync: Object.keys(diffs).length === 0, diff: diffs };
  }

  async setDiscrepancy(source: SourceName, entityId: string, isInSync: boolean, diff: any): Promise<void> {
    await prisma.discrepancyStatus.upsert({
      where: { entity_id_source: { entity_id: entityId, source } as any },
      create: { entity_id: entityId, source, is_in_sync: isInSync, diff_summary: diff },
      update: { is_in_sync: isInSync, diff_summary: diff, last_checked_at: new Date() }
    });
  }

  async checkNow(source: SourceName, entityId: string): Promise<{ is_in_sync: boolean; snapshot_hash?: string; diff?: any }> {
    const latest = await this.fetchFromSource(source, entityId);
    await this.archivePayload(source, entityId, latest);
    const { isInSync, diff } = await this.compareWithSnapshot(source, entityId, latest);
    await this.setDiscrepancy(source, entityId, isInSync, diff);
    const snapshot = await prisma.snapshotState.findUnique({ where: { entity_id_source: { entity_id: entityId, source } as any } });
    return { is_in_sync: isInSync, snapshot_hash: snapshot?.hash, diff };
  }

  async refresh(source: SourceName, entityId: string, actorId: string): Promise<{ snapshot_hash: string }> {
    const latest = await this.fetchFromSource(source, entityId);
    await this.archivePayload(source, entityId, latest);
    const { hash } = await this.upsertSnapshot(source, entityId, latest);
    await this.setDiscrepancy(source, entityId, true, {});
    await transactionJournalService.recordTransaction({
      tx_type: 'sync_refresh',
      entity_id: entityId,
      payload: { source, hash },
      actor_id: actorId
    });
    return { snapshot_hash: hash };
  }
}

export const syncService = new SyncService();


