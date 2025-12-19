/**
 * Composite PDF Service
 * Generates bundled PDF documents for Amazon FBA claims
 * 
 * Bundles together:
 * 1. Cover sheet (Opside summary: Claim ID, SKU, amount, date)
 * 2. Invoice pages (highlighted line items for this claim)
 * 3. Supporting documents (BOL, POD, tracking screenshots)
 * 
 * Addresses Amazon's "1 document per SKU" limitation
 */

import { pdfGenerationService } from './pdfGenerationService';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface ClaimInfo {
    id: string;
    claimNumber?: string;
    claimType: string;
    amount: number;
    currency: string;
    sku?: string;
    asin?: string;
    status: string;
    discoveryDate?: string;
    deadlineDate?: string;
    details?: string;
}

export interface DocumentInfo {
    id: string;
    filename: string;
    type: 'invoice' | 'bol' | 'pod' | 'tracking' | 'other';
    supplier?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    totalAmount?: number;
    currency?: string;
    lineItems?: LineItem[];
    storageUrl?: string;
}

export interface LineItem {
    sku?: string;
    asin?: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
    highlighted?: boolean;
}

export interface CompositePacket {
    claim: ClaimInfo;
    documents: DocumentInfo[];
    generatedAt: string;
    totalValue: number;
}

class CompositePdfService {

    /**
     * Generate a composite PDF for a claim
     * Bundles cover sheet + invoice + supporting docs
     */
    async generateClaimPacket(
        claimId: string,
        userId: string
    ): Promise<{ buffer: Buffer; filename: string }> {
        try {
            logger.info('📄 [COMPOSITE PDF] Generating claim packet', { claimId, userId });

            // 1. Fetch claim details
            const claim = await this.getClaimDetails(claimId);
            if (!claim) {
                throw new Error(`Claim ${claimId} not found`);
            }

            // 2. Fetch linked documents
            const documents = await this.getLinkedDocuments(claimId, userId);

            // 3. Generate composite HTML
            const html = this.generateCompositeHTML({
                claim,
                documents,
                generatedAt: new Date().toISOString(),
                totalValue: claim.amount
            });

            // 4. Generate PDF using Puppeteer
            const buffer = await pdfGenerationService.generatePDFFromHTML(html, {
                format: 'A4',
                margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' }
            });

            const filename = `Claim_Packet_${claim.claimNumber || claim.id.slice(0, 8)}_${new Date().toISOString().split('T')[0]}.pdf`;

            logger.info('✅ [COMPOSITE PDF] Claim packet generated', {
                claimId,
                filename,
                documentCount: documents.length,
                sizeBytes: buffer.length
            });

            return { buffer, filename };

        } catch (error: any) {
            logger.error('❌ [COMPOSITE PDF] Failed to generate claim packet', {
                claimId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get claim details from database
     */
    private async getClaimDetails(claimId: string): Promise<ClaimInfo | null> {
        // Try detection_results first
        const { data: detection } = await supabaseAdmin
            .from('detection_results')
            .select('*')
            .eq('id', claimId)
            .single();

        if (detection) {
            const evidence = typeof detection.evidence === 'string'
                ? JSON.parse(detection.evidence)
                : detection.evidence || {};

            return {
                id: detection.id,
                claimNumber: detection.claim_number,
                claimType: detection.anomaly_type || 'unknown',
                amount: detection.estimated_value || 0,
                currency: detection.currency || 'USD',
                sku: detection.sku || evidence.sku,
                asin: detection.asin || evidence.asin,
                status: detection.status || 'pending',
                discoveryDate: detection.discovery_date || detection.created_at,
                deadlineDate: detection.deadline_date,
                details: detection.details
            };
        }

        // Try dispute_cases
        const { data: dispute } = await supabaseAdmin
            .from('dispute_cases')
            .select('*')
            .eq('id', claimId)
            .single();

        if (dispute) {
            return {
                id: dispute.id,
                claimNumber: dispute.case_number || dispute.claim_number,
                claimType: dispute.dispute_type || 'unknown',
                amount: dispute.claim_amount || 0,
                currency: dispute.currency || 'USD',
                sku: dispute.sku,
                asin: dispute.asin,
                status: dispute.status || 'pending',
                discoveryDate: dispute.created_at,
                deadlineDate: dispute.deadline_date,
                details: dispute.details
            };
        }

        return null;
    }

    /**
     * Get all documents linked to a claim
     */
    private async getLinkedDocuments(claimId: string, userId: string): Promise<DocumentInfo[]> {
        const documents: DocumentInfo[] = [];

        // Get documents from dispute_evidence_links
        const { data: links } = await supabaseAdmin
            .from('dispute_evidence_links')
            .select(`
        evidence_document_id,
        evidence_documents!inner(
          id, filename, supplier, invoice_number, parsed_metadata, doc_type
        )
      `)
            .eq('dispute_case_id', claimId);

        if (links && links.length > 0) {
            for (const link of links) {
                const doc = (link as any).evidence_documents;
                if (doc) {
                    const meta = typeof doc.parsed_metadata === 'string'
                        ? JSON.parse(doc.parsed_metadata)
                        : doc.parsed_metadata || {};

                    documents.push({
                        id: doc.id,
                        filename: doc.filename,
                        type: this.inferDocumentType(doc.filename, doc.doc_type),
                        supplier: doc.supplier || meta.supplier_name,
                        invoiceNumber: doc.invoice_number || meta.invoice_number,
                        invoiceDate: meta.invoice_date,
                        totalAmount: meta.total_amount,
                        currency: meta.currency || 'USD',
                        lineItems: meta.line_items || []
                    });
                }
            }
        }

        // If no links found, try to find documents by SKU/ASIN match
        if (documents.length === 0) {
            const claim = await this.getClaimDetails(claimId);
            if (claim && (claim.sku || claim.asin)) {
                const { data: matchedDocs } = await supabaseAdmin
                    .from('evidence_documents')
                    .select('id, filename, supplier, invoice_number, parsed_metadata, doc_type')
                    .eq('seller_id', userId)
                    .eq('parser_status', 'completed')
                    .limit(5);

                if (matchedDocs) {
                    for (const doc of matchedDocs) {
                        const meta = typeof doc.parsed_metadata === 'string'
                            ? JSON.parse(doc.parsed_metadata)
                            : doc.parsed_metadata || {};

                        const docAsins = meta.asins || [];
                        const docSkus = meta.skus || [];

                        if ((claim.asin && docAsins.includes(claim.asin)) ||
                            (claim.sku && docSkus.includes(claim.sku))) {
                            documents.push({
                                id: doc.id,
                                filename: doc.filename,
                                type: this.inferDocumentType(doc.filename, doc.doc_type),
                                supplier: doc.supplier || meta.supplier_name,
                                invoiceNumber: doc.invoice_number || meta.invoice_number,
                                invoiceDate: meta.invoice_date,
                                totalAmount: meta.total_amount,
                                currency: meta.currency || 'USD',
                                lineItems: meta.line_items || []
                            });
                        }
                    }
                }
            }
        }

        return documents;
    }

    /**
     * Infer document type from filename
     */
    private inferDocumentType(filename: string, docType?: string): DocumentInfo['type'] {
        if (docType) {
            const normalized = docType.toLowerCase();
            if (normalized.includes('invoice')) return 'invoice';
            if (normalized.includes('bol') || normalized.includes('bill of lading')) return 'bol';
            if (normalized.includes('pod') || normalized.includes('proof of delivery')) return 'pod';
            if (normalized.includes('tracking')) return 'tracking';
        }

        const lowerFilename = filename.toLowerCase();
        if (lowerFilename.includes('invoice') || lowerFilename.includes('inv')) return 'invoice';
        if (lowerFilename.includes('bol')) return 'bol';
        if (lowerFilename.includes('pod') || lowerFilename.includes('delivery')) return 'pod';
        if (lowerFilename.includes('track')) return 'tracking';

        return 'other';
    }

    /**
     * Generate composite HTML for the claim packet
     */
    private generateCompositeHTML(packet: CompositePacket): string {
        const { claim, documents, generatedAt } = packet;

        const claimTypeLabel = claim.claimType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const formattedDate = new Date(generatedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Generate line items HTML with highlighting
        const lineItemsHTML = documents
            .filter(d => d.type === 'invoice' && d.lineItems && d.lineItems.length > 0)
            .map(doc => {
                const items = doc.lineItems!.map(item => {
                    const isMatch = (item.sku && item.sku === claim.sku) ||
                        (item.asin && item.asin === claim.asin);
                    const rowClass = isMatch ? 'highlighted-row' : '';
                    return `
            <tr class="${rowClass}">
              <td>${item.sku || '—'}</td>
              <td>${item.asin || '—'}</td>
              <td>${item.description || '—'}</td>
              <td class="number">${item.quantity || '—'}</td>
              <td class="number">$${(item.unitPrice || 0).toFixed(2)}</td>
              <td class="number">$${(item.totalPrice || 0).toFixed(2)}</td>
            </tr>
          `;
                }).join('');

                return `
          <div class="document-section">
            <h3>📄 Invoice: ${doc.invoiceNumber || doc.filename}</h3>
            <div class="document-meta">
              <span>Supplier: ${doc.supplier || 'Unknown'}</span>
              <span>Date: ${doc.invoiceDate || 'Unknown'}</span>
              <span>Total: $${(doc.totalAmount || 0).toFixed(2)}</span>
            </div>
            <table class="line-items-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>ASIN</th>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${items}
              </tbody>
            </table>
          </div>
        `;
            }).join('');

        // Supporting documents list
        const supportingDocsHTML = documents
            .filter(d => d.type !== 'invoice')
            .map(doc => `
        <li class="supporting-doc">
          <span class="doc-type">${this.getDocTypeLabel(doc.type)}</span>
          <span class="doc-name">${doc.filename}</span>
        </li>
      `).join('');

        return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Claim Packet - ${claim.claimNumber || claim.id}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #333;
      line-height: 1.5;
      padding: 0;
    }
    
    /* Cover Page */
    .cover-page {
      page-break-after: always;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 40px;
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
    }
    .cover-header {
      text-align: center;
      margin-bottom: 60px;
    }
    .logo {
      font-size: 36px;
      font-weight: 700;
      color: #6366f1;
      letter-spacing: -1px;
    }
    .logo-sub {
      font-size: 14px;
      color: #64748b;
      margin-top: 5px;
    }
    .cover-title {
      text-align: center;
      margin: 60px 0;
    }
    .cover-title h1 {
      font-size: 42px;
      color: #1e293b;
      margin-bottom: 10px;
    }
    .cover-title .claim-type {
      font-size: 18px;
      color: #6366f1;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
    
    .claim-summary {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.05);
      margin: 30px 0;
    }
    .claim-summary h2 {
      font-size: 16px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 20px;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 10px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
    }
    .summary-item {
      padding: 15px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .summary-item .label {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .summary-item .value {
      font-size: 20px;
      font-weight: 600;
      color: #1e293b;
      margin-top: 5px;
    }
    .summary-item .value.amount {
      color: #059669;
    }
    
    .cover-footer {
      margin-top: auto;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
    }
    
    /* Content Pages */
    .content-page {
      padding: 40px;
    }
    .page-header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 15px;
      margin-bottom: 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .page-header h2 {
      font-size: 24px;
      color: #1e293b;
    }
    .page-header .claim-id {
      font-size: 14px;
      color: #64748b;
    }
    
    .document-section {
      margin-bottom: 40px;
      page-break-inside: avoid;
    }
    .document-section h3 {
      font-size: 18px;
      color: #334155;
      margin-bottom: 15px;
    }
    .document-meta {
      display: flex;
      gap: 20px;
      font-size: 13px;
      color: #64748b;
      margin-bottom: 15px;
    }
    
    .line-items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .line-items-table th {
      background: #f1f5f9;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #475569;
      border-bottom: 2px solid #e2e8f0;
    }
    .line-items-table td {
      padding: 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    .line-items-table .number {
      text-align: right;
    }
    .line-items-table .highlighted-row {
      background: #fef3c7;
      font-weight: 600;
    }
    .line-items-table .highlighted-row td {
      border-color: #fcd34d;
    }
    
    .supporting-docs {
      margin-top: 40px;
    }
    .supporting-docs h3 {
      font-size: 18px;
      color: #334155;
      margin-bottom: 15px;
    }
    .supporting-docs ul {
      list-style: none;
    }
    .supporting-doc {
      padding: 12px 15px;
      background: #f8fafc;
      border-radius: 8px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .doc-type {
      font-size: 11px;
      font-weight: 600;
      color: #6366f1;
      background: #eef2ff;
      padding: 4px 10px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .doc-name {
      color: #334155;
    }
    
    @media print {
      .cover-page {
        background: white !important;
      }
    }
  </style>
</head>
<body>
  <!-- COVER PAGE -->
  <div class="cover-page">
    <div class="cover-header">
      <div class="logo">Opside</div>
      <div class="logo-sub">FBA Claims Management Platform</div>
    </div>
    
    <div class="cover-title">
      <div class="claim-type">${claimTypeLabel}</div>
      <h1>Claim Evidence Packet</h1>
    </div>
    
    <div class="claim-summary">
      <h2>Claim Summary</h2>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="label">Claim ID</div>
          <div class="value">${claim.claimNumber || claim.id.slice(0, 12)}</div>
        </div>
        <div class="summary-item">
          <div class="label">Claim Amount</div>
          <div class="value amount">${claim.currency} $${claim.amount.toLocaleString()}</div>
        </div>
        <div class="summary-item">
          <div class="label">SKU</div>
          <div class="value">${claim.sku || '—'}</div>
        </div>
        <div class="summary-item">
          <div class="label">ASIN</div>
          <div class="value">${claim.asin || '—'}</div>
        </div>
        <div class="summary-item">
          <div class="label">Status</div>
          <div class="value">${claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}</div>
        </div>
        <div class="summary-item">
          <div class="label">Discovery Date</div>
          <div class="value">${claim.discoveryDate ? new Date(claim.discoveryDate).toLocaleDateString() : '—'}</div>
        </div>
      </div>
    </div>
    
    <div class="claim-summary">
      <h2>Documents Included (${documents.length})</h2>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="label">Invoices</div>
          <div class="value">${documents.filter(d => d.type === 'invoice').length}</div>
        </div>
        <div class="summary-item">
          <div class="label">Supporting Documents</div>
          <div class="value">${documents.filter(d => d.type !== 'invoice').length}</div>
        </div>
      </div>
    </div>
    
    <div class="cover-footer">
      <p>Generated by Opside on ${formattedDate}</p>
      <p>This document is intended for Amazon FBA reimbursement claims</p>
    </div>
  </div>
  
  <!-- INVOICE DETAILS PAGE -->
  ${documents.filter(d => d.type === 'invoice').length > 0 ? `
  <div class="content-page">
    <div class="page-header">
      <h2>Invoice Details</h2>
      <span class="claim-id">Claim: ${claim.claimNumber || claim.id.slice(0, 12)}</span>
    </div>
    
    ${lineItemsHTML || '<p>No line items extracted from invoices.</p>'}
    
    ${documents.filter(d => d.type !== 'invoice').length > 0 ? `
    <div class="supporting-docs">
      <h3>📎 Supporting Documents</h3>
      <ul>
        ${supportingDocsHTML}
      </ul>
    </div>
    ` : ''}
  </div>
  ` : `
  <div class="content-page">
    <div class="page-header">
      <h2>Documents</h2>
      <span class="claim-id">Claim: ${claim.claimNumber || claim.id.slice(0, 12)}</span>
    </div>
    <p>No invoices linked to this claim. Upload invoices with matching SKU/ASIN to include them in future packets.</p>
  </div>
  `}
</body>
</html>
    `;
    }

    /**
     * Get document type label
     */
    private getDocTypeLabel(type: DocumentInfo['type']): string {
        switch (type) {
            case 'invoice': return 'Invoice';
            case 'bol': return 'Bill of Lading';
            case 'pod': return 'Proof of Delivery';
            case 'tracking': return 'Tracking';
            default: return 'Document';
        }
    }
}

export const compositePdfService = new CompositePdfService();
export default compositePdfService;
