import { createHash } from 'crypto';
import { insertProofBundle, insertEvidenceLink, createClaimWithProof, getProofBundle, getClaimByProofId, getEvidenceLinksByClaimId } from './supabaseRepo';

function canonical(obj: any) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function computeHash(payload: any, timestamp: string, actor_id: string) {
  return createHash('sha256').update(`${canonical(payload)}|${timestamp}|${actor_id}`).digest('hex');
}

export async function createProofBundleFromInvoiceText(userId: string, actor_id: string, invoice_text: string) {
  const timestamp = new Date().toISOString();
  const payload = { source: 'invoice_text', text: invoice_text };
  const hash = computeHash(payload, timestamp, actor_id);
  const proof = await insertProofBundle(payload, hash, timestamp, actor_id);
  return { proof, hash, timestamp };
}

export async function flagClaimFromInvoiceText(userId: string, actor_id: string, case_number: string, claim_amount: number, invoice_text: string) {
  const anomaly_score = getAnomalyScore(invoice_text);
  const claim_type = 'invoice_text';
  const { proof } = await createProofBundleFromInvoiceText(userId, actor_id, invoice_text);
  const entities = extractEntities(invoice_text);
  const claim = await createClaimWithProof(userId, case_number, claim_amount, claim_type, anomaly_score, proof.id);
  await insertEvidenceLink(claim.id, invoice_text, entities);
  return { claim, proof };
}

// Heuristic anomaly score (0..1)
export function getAnomalyScore(text: string): number {
  let score = 0.1;
  if (/overcharge/i.test(text)) score += 0.4;
  if (/damaged|lost/i.test(text)) score += 0.3;
  const amountMatch = text.match(/\$\s*(\d+[\d,]*(?:\.\d{2})?)/);
  if (amountMatch) score += 0.2;
  return Math.min(1, score);
}

// Basic regex NER
export function extractEntities(text: string): { vendor?: string; invoice_number?: string; date?: string } {
  const vendor = (text.match(/vendor[:\s-]+([A-Za-z0-9 &.,'-]+)/i) || [])[1];
  const invoice_number = (text.match(/invoice\s*(no\.|number)[:\s-]*([A-Za-z0-9-]+)/i) || [])[2];
  const date = (text.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/) || [])[1];
  return { vendor, invoice_number, date };
}

export async function getProofBundleWithLinks(proof_id: string) {
  const proof = await getProofBundle(proof_id);
  if (!proof) return null;
  const claim = await getClaimByProofId(proof_id);
  const links = claim ? await getEvidenceLinksByClaimId(claim.id) : [];
  return { proof, claim, links };
}


