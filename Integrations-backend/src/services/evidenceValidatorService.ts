import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface ClaimCandidate {
  disputeId?: string; // optional pre-created
  sellerId: string;
  sku?: string;
  asin?: string;
  quantity?: number;
  detectionDate?: string; // ISO
}

export type ValidationOutcome =
  | { status: 'proof_found'; evidenceDocumentId: string }
  | { status: 'ambiguity'; options: Array<{ id: string; label: string; evidenceDocumentId: string }> }
  | { status: 'no_proof' };

function buildLabel(row: any): string {
  const parts = [row.supplier_name, row.invoice_number, row.document_date];
  return parts.filter(Boolean).join(' · ');
}

export const evidenceValidatorService = {
  async validate(candidate: ClaimCandidate): Promise<ValidationOutcome> {
    const { sellerId, sku, asin, quantity, detectionDate } = candidate;

    // Basic window: +/- 30 days around detection date (if provided)
    const from = detectionDate ? new Date(new Date(detectionDate).getTime() - 30 * 24 * 3600 * 1000).toISOString() : undefined;
    const to = detectionDate ? new Date(new Date(detectionDate).getTime() + 30 * 24 * 3600 * 1000).toISOString() : undefined;

    // Query normalized line items if available, otherwise fallback to documents JSON
    let docIds: string[] = [];
    try {
      let liQuery = supabase
        .from('evidence_line_items')
        .select('document_id, sku, asin, quantity, document_date')
        .eq('seller_id', sellerId);
      if (sku) liQuery = liQuery.eq('sku', sku);
      if (asin) liQuery = liQuery.eq('asin', asin);
      if (from && to) liQuery = liQuery.gte('document_date', from).lte('document_date', to);
      const { data: liRows, error: liErr } = await liQuery.limit(200);
      if (!liErr && liRows && liRows.length) {
        const grouped: Record<string, number> = {};
        for (const r of liRows as any[]) {
          grouped[r.document_id] = Math.max(grouped[r.document_id] || 0, r.quantity || 0);
        }
        docIds = Object.keys(grouped).filter(id => !quantity || grouped[id] >= quantity);
      }
    } catch {}

    let candidates: any[] = [];
    if (docIds.length) {
      const { data: docs } = await supabase
        .from('evidence_documents')
        .select('id, supplier_name, invoice_number, document_date')
        .in('id', docIds)
        .limit(50);
      candidates = docs || [];
    } else {
      let query = supabase
        .from('evidence_documents')
        .select('id, supplier_name, invoice_number, document_date, extracted')
        .eq('seller_id', sellerId)
        .eq('doc_type', 'invoice');
      if (from && to) query = query.gte('document_date', from).lte('document_date', to);
      const { data, error } = await query.limit(50);
      if (error) throw new Error(`Evidence query failed: ${error.message}`);
      candidates = (data || []).filter((row: any) => {
        const items = (row.extracted?.items || []) as Array<{ sku?: string; asin?: string; quantity?: number }>;
        const skuMatch = sku ? items.some(i => (i.sku || '').toLowerCase() === sku.toLowerCase()) : true;
        const asinMatch = asin ? items.some(i => (i.asin || '').toLowerCase() === asin.toLowerCase()) : true;
        const qtyOk = quantity ? items.some(i => (i.quantity || 0) >= quantity) : true;
        return skuMatch && asinMatch && qtyOk;
      });
    }

    if (candidates.length === 0) return { status: 'no_proof' };
    if (candidates.length === 1) return { status: 'proof_found', evidenceDocumentId: candidates[0].id };

    // Ambiguous: return top options
    const options = candidates.slice(0, 3).map(c => ({ id: c.id, label: buildLabel(c), evidenceDocumentId: c.id }));
    return { status: 'ambiguity', options };
  }
};

export default evidenceValidatorService;


