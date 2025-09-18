import axios from 'axios';

export interface ProofItem {
  type: string;
  timestamp: string;
  payload: Record<string, any>;
}

export interface ProofContext {
  claimDetectorUrl?: string;
  mcdeBaseUrl?: string;
  mcdeApiKey?: string;
}

export async function buildProofMetadata(
  userId: string,
  sku: string,
  amazonQty: number,
  internalQty: number,
  ctx: ProofContext
): Promise<{ proof: ProofItem[]; confidence: number; valueComparison?: any; mcdeDocumentUrl?: string }> {
  const proof: ProofItem[] = [];

  // Inventory snapshot proof
  proof.push({
    type: 'inventory_snapshot',
    timestamp: new Date().toISOString(),
    payload: {
      sku,
      amazon_quantity: amazonQty,
      internal_quantity: internalQty,
      discrepancy_amount: amazonQty - internalQty,
    },
  });

  let confidence = computeConfidence(amazonQty, internalQty);
  let valueComparison: any;
  let mcdeDocumentUrl: string | undefined;

  // Optional: fetch value comparison from Claim Detector EVE
  if (ctx.claimDetectorUrl) {
    try {
      const res = await axios.get(`${ctx.claimDetectorUrl}/evidence/value/compare`, {
        params: { sku, seller_id: userId },
        timeout: 10000,
      });
      valueComparison = res.data;
      proof.push({
        type: 'value_comparison',
        timestamp: new Date().toISOString(),
        payload: valueComparison,
      });
      // Slightly boost confidence if net_gain present and positive
      if (valueComparison?.net_gain && valueComparison.net_gain > 0) {
        confidence = Math.min(1, confidence + 0.05);
      }
    } catch (e) {
      // Non-fatal
    }
  }

  // Optional: generate a cost document via MCDE
  if (ctx.mcdeBaseUrl) {
    try {
      const resp = await axios.post(
        `${ctx.mcdeBaseUrl}/generate-document`,
        { claim_id: `sku-${sku}-${Date.now()}`, cost_estimate: {}, document_type: 'cost_document' },
        { headers: ctx.mcdeApiKey ? { Authorization: `Bearer ${ctx.mcdeApiKey}` } : {}, timeout: 10000 }
      );
      mcdeDocumentUrl = resp.data?.document_url;
      if (mcdeDocumentUrl) {
        proof.push({
          type: 'mcde_document',
          timestamp: new Date().toISOString(),
          payload: { document_url: mcdeDocumentUrl },
        });
      }
    } catch (e) {
      // Non-fatal
    }
  }

  return { proof, confidence, valueComparison, mcdeDocumentUrl };
}

export function computeConfidence(amazonQty: number, internalQty: number): number {
  const delta = Math.abs(amazonQty - internalQty);
  // Heuristic: base 0.8, add up to +0.15 for larger deltas, clamp 0.95
  let conf = 0.8 + Math.min(0.15, delta / 100);
  if (delta === 0) conf = 0.5;
  return Math.max(0.5, Math.min(0.95, conf));
}



