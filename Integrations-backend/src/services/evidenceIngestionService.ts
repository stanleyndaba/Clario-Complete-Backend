import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface EvidenceSource {
  id: string;
  seller_id: string;
  provider: 'gmail' | 'outlook' | 'dropbox' | 'gdrive' | 'onedrive' | 's3' | 'other';
  display_name?: string;
  metadata?: Record<string, any>;
}

export interface ParsedLineItem {
  sku?: string;
  asin?: string;
  quantity?: number;
  unit_cost?: number;
}

export interface ParsedDocument {
  doc_type: 'invoice' | 'shipping' | 'po' | 'other';
  supplier_name?: string;
  invoice_number?: string;
  purchase_order_number?: string;
  document_date?: string;
  currency?: string;
  total_amount?: number;
  file_url?: string;
  raw_text?: string;
  items?: ParsedLineItem[];
}

export const evidenceIngestionService = {
  async registerSource(sellerId: string, provider: EvidenceSource['provider'], displayName?: string, metadata?: Record<string, any>): Promise<string> {
    const { data, error } = await supabase
      .from('evidence_sources')
      .insert({ seller_id: sellerId, provider, display_name: displayName, metadata: metadata || {} })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to register evidence source: ${error.message}`);
    return data.id as string;
  },

  async ingestParsedDocument(sellerId: string, sourceId: string | null, doc: ParsedDocument): Promise<string> {
    const { data, error } = await supabase
      .from('evidence_documents')
      .insert({
        seller_id: sellerId,
        source_id: sourceId,
        doc_type: doc.doc_type,
        supplier_name: doc.supplier_name,
        invoice_number: doc.invoice_number,
        purchase_order_number: doc.purchase_order_number,
        document_date: doc.document_date,
        currency: doc.currency,
        total_amount: doc.total_amount,
        file_url: doc.file_url,
        raw_text: doc.raw_text,
        extracted: { items: doc.items || [] }
      })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to ingest document: ${error.message}`);
    const documentId = data.id as string;

    // Also persist normalized line items for performant queries
    try {
      const items = doc.items || [];
      if (items.length) {
        const rows = items.map(it => ({
          seller_id: sellerId,
          document_id: documentId,
          sku: it.sku,
          asin: it.asin,
          quantity: it.quantity,
          unit_cost: it.unit_cost,
          currency: doc.currency,
          document_date: doc.document_date
        }));
        await supabase.from('evidence_line_items').insert(rows);
      }
    } catch {}

    return documentId;
  }
};

export default evidenceIngestionService;


