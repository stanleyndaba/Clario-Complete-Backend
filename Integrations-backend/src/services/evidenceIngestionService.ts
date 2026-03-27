import { supabase, supabaseAdmin } from '../database/supabaseClient';
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const evidenceIngestionService = {
  async triggerDocumentParsing(documentId: string, sellerId: string, tenantId?: string | null): Promise<void> {
    try {
      logger.info('Queueing durable Step 5 document parsing job', { documentId, sellerId, tenantId });

      const client = supabaseAdmin || supabase;
      const timestamp = new Date().toISOString();
      const safeUserId = isUuid(sellerId) ? sellerId : null;

      const { data: existingJob, error: existingJobError } = await client
        .from('parser_jobs')
        .select('id, status')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingJobError) {
        throw new Error(`Failed to lookup parser job: ${existingJobError.message}`);
      }

      let parserJobId = existingJob?.id as string | undefined;
      const parserStatus = existingJob?.status === 'processing' ? 'retrying' : 'pending';

      if (parserJobId) {
        const updatePayload: Record<string, any> = {
          status: parserStatus,
          error: null,
          result: null,
          started_at: null,
          completed_at: null,
          updated_at: timestamp
        };
        if (tenantId) updatePayload.tenant_id = tenantId;
        if (safeUserId) updatePayload.user_id = safeUserId;

        const { error: updateJobError } = await client
          .from('parser_jobs')
          .update(updatePayload)
          .eq('id', parserJobId);

        if (updateJobError) {
          throw new Error(`Failed to refresh parser job: ${updateJobError.message}`);
        }
      } else {
        const insertPayload: Record<string, any> = {
          document_id: documentId,
          parser_type: 'pdf',
          status: 'pending',
          created_at: timestamp,
          updated_at: timestamp
        };
        if (tenantId) insertPayload.tenant_id = tenantId;
        if (safeUserId) insertPayload.user_id = safeUserId;

        const { data: createdJob, error: createJobError } = await client
          .from('parser_jobs')
          .insert(insertPayload)
          .select('id')
          .single();

        if (createJobError || !createdJob?.id) {
          throw new Error(`Failed to create parser job: ${createJobError?.message || 'missing job id'}`);
        }

        parserJobId = createdJob.id as string;
      }

      const { error: updateDocumentError } = await client
        .from('evidence_documents')
        .update({
          parser_job_id: parserJobId,
          parser_status: parserStatus,
          parser_error: null,
          parser_started_at: null,
          parser_completed_at: null,
          parsed_at: null,
          updated_at: timestamp
        })
        .eq('id', documentId);

      if (updateDocumentError) {
        throw new Error(`Failed to mirror parser job state to evidence document: ${updateDocumentError.message}`);
      }

      logger.info('Durable Step 5 parsing job ready', {
        documentId,
        jobId: parserJobId,
        sellerId,
        tenantId,
        parserStatus
      });
    } catch (error: any) {
      logger.error('Failed to queue durable Step 5 parsing job', {
        documentId,
        sellerId,
        tenantId,
        error: error?.message || error
      });
    }
  },
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
        extracted: { items: doc.items || [] },
        parser_status: 'pending'
      })
      .select('id, tenant_id')
      .single();
    if (error) throw new Error(`Failed to ingest document: ${error.message}`);
    const documentId = data.id as string;
    const tenantId = (data as any).tenant_id || null;

    // Durable Step 5 handoff
    void this.triggerDocumentParsing(documentId, sellerId, tenantId);

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








