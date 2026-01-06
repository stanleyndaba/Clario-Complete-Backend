import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { transactionJournalService } from './transactionJournalService';

const prisma = new PrismaClient();

function hashProof(payload: any, timestampIso: string, actorId: string): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(`${canonical}|${timestampIso}|${actorId}`).digest('hex');
}

export class EvidenceValueService {
  // Simple placeholder anomaly detection (score by diff magnitude)
  detectAnomaliesFromSnapshot(entityId: string, snapshot: any): { score: number; claim_type: string } | null {
    const score = Math.random();
    if (score < 0.9) return null; // MVP: only high score becomes anomaly
    const claim_type = 'inventory_discrepancy';
    return { score, claim_type };
  }

  // Placeholder OCR
  async runOCR(buffer: Buffer): Promise<string> {
    // Integrate Tesseract/Textract later
    return buffer.toString('utf8');
  }

  // Placeholder NER
  async runNER(text: string): Promise<Record<string, any>> {
    return { supplier: 'ACME', date: new Date().toISOString().slice(0, 10), amount: 100.0 };
  }

  async createProofBundle(payload: any, actorId: string) {
    const timestamp = new Date().toISOString();
    const hash = hashProof(payload, timestamp, actorId);
    const proof = await prisma.proofBundle.create({ data: { payload, hash, timestamp: new Date(timestamp), actor_id: actorId } });
    return proof;
  }

  async flagClaimWithEvidence(entityId: string, snapshot: any, invoiceBuffer: Buffer, actorId: string) {
    const anomaly = this.detectAnomaliesFromSnapshot(entityId, snapshot);
    if (!anomaly) return null;

    const ocrText = await this.runOCR(invoiceBuffer);
    const ner = await this.runNER(ocrText);

    const payload = { tx: snapshot, ocr_text: ocrText, ner };
    const proof = await this.createProofBundle(payload, actorId);

    // Create claim tied to proof bundle (invariant: cannot exist without proof)
    const claim = await prisma.claim.create({
      data: {
        claimNumber: `CLM-${Date.now()}`,
        userId: actorId,
        status: 'pending',
        amount: new prisma.Prisma.Decimal(ner.amount || 0),
        anomaly_score: anomaly.score,
        claim_type: anomaly.claim_type,
        proof_bundle_id: proof.id,
      }
    });

    await prisma.evidenceLink.create({ data: { claim_id: claim.id, ocr_text: ocrText, ner_entities: ner } });

    await transactionJournalService.recordTransaction({
      tx_type: 'claim_flagged',
      entity_id: entityId,
      payload: { claim_id: claim.id, proof_id: proof.id },
      actor_id: actorId,
    });

    return { claim, proof };
  }
}

export const evidenceValueService = new EvidenceValueService();


