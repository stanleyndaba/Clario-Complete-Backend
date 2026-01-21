/**
 * Invoice PDF Service
 * Generates professional PDF invoices for billing
 */

import PDFDocument from 'pdfkit';
import { supabase } from '../database/supabaseClient';
import logger from '../utils/logger';

interface InvoiceData {
    id: string;
    dateIssued: string;
    periodStart?: string;
    periodEnd?: string;
    status: 'paid' | 'due' | 'overdue' | 'pending';
    totalRecovered: number;
    commission: number;
    amountCharged: number;
    recoveryClaimIds?: string[];
    tenantId?: string;
    companyName?: string;
    taxId?: string;
}

interface RecoveryItem {
    claimId: string;
    orderId: string;
    amount: number;
    detectionType: string;
    recoveredAt: string;
}

class InvoicePdfService {
    private readonly COMMISSION_RATE = 0.20; // 20%

    /**
     * Generate PDF invoice for a given invoice ID
     */
    async generateInvoicePdf(invoiceId: string, userId: string): Promise<Buffer> {
        logger.info('[INVOICE PDF] Generating invoice', { invoiceId, userId });

        // Fetch invoice data
        const invoice = await this.getInvoiceData(invoiceId, userId);
        if (!invoice) {
            throw new Error(`Invoice not found: ${invoiceId}`);
        }

        // Fetch recovery line items
        const items = await this.getRecoveryItems(invoice.recoveryClaimIds || []);

        // Generate PDF
        return this.createPdf(invoice, items);
    }

    /**
     * Fetch invoice data from database
     */
    private async getInvoiceData(invoiceId: string, userId: string): Promise<InvoiceData | null> {
        try {
            const { data, error } = await supabase
                .from('billing_invoices')
                .select('*')
                .eq('id', invoiceId)
                .eq('user_id', userId)
                .single();

            if (error || !data) {
                // Try alternative lookup by invoice_id column
                const { data: altData, error: altError } = await supabase
                    .from('billing_invoices')
                    .select('*')
                    .eq('invoice_id', invoiceId)
                    .eq('user_id', userId)
                    .single();

                if (altError || !altData) {
                    logger.warn('[INVOICE PDF] Invoice not found', { invoiceId, userId });
                    return null;
                }
                return this.mapInvoiceData(altData);
            }

            return this.mapInvoiceData(data);
        } catch (err: any) {
            logger.error('[INVOICE PDF] Error fetching invoice', { invoiceId, error: err.message });
            return null;
        }
    }

    private mapInvoiceData(data: any): InvoiceData {
        return {
            id: data.invoice_id || data.id,
            dateIssued: data.period_end || data.created_at || new Date().toISOString(),
            periodStart: data.period_start,
            periodEnd: data.period_end,
            status: data.status?.toLowerCase() || 'paid',
            totalRecovered: data.total_amount || 0,
            commission: data.platform_fee || 0,
            amountCharged: data.platform_fee || 0,
            recoveryClaimIds: data.recovery_ids || [],
            tenantId: data.tenant_id,
            companyName: data.company_name,
            taxId: data.tax_id,
        };
    }

    /**
     * Fetch recovery line items for the invoice
     */
    private async getRecoveryItems(claimIds: string[]): Promise<RecoveryItem[]> {
        if (!claimIds.length) return [];

        try {
            const { data, error } = await supabase
                .from('recoveries')
                .select('id, order_id, amount, detection_type, recovered_at')
                .in('id', claimIds);

            if (error || !data) return [];

            return data.map((r: any) => ({
                claimId: r.id,
                orderId: r.order_id || 'N/A',
                amount: r.amount || 0,
                detectionType: r.detection_type || 'Reimbursement',
                recoveredAt: r.recovered_at || r.created_at,
            }));
        } catch {
            return [];
        }
    }

    /**
     * Create the PDF document
     */
    private createPdf(invoice: InvoiceData, items: RecoveryItem[]): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            const doc = new PDFDocument({ margin: 50, size: 'A4' });

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Header
            this.renderHeader(doc, invoice);

            // Invoice Details
            this.renderInvoiceDetails(doc, invoice);

            // Line Items Table
            this.renderLineItems(doc, invoice, items);

            // Summary
            this.renderSummary(doc, invoice);

            // Footer
            this.renderFooter(doc);

            doc.end();
        });
    }

    private renderHeader(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
        // Company Logo/Name
        doc.fontSize(24).font('Helvetica-Bold').fillColor('#111827').text('Margin', 50, 50);
        doc.fontSize(10).font('Helvetica').fillColor('#6B7280').text('AI-Powered FBA Recovery', 50, 80);

        // Invoice Title
        doc.fontSize(28).font('Helvetica-Bold').fillColor('#111827').text('INVOICE', 400, 50, { align: 'right' });

        // Invoice Number
        doc.fontSize(10).font('Helvetica').fillColor('#6B7280').text(`Invoice #: ${invoice.id}`, 400, 85, { align: 'right' });

        // Status Badge
        const statusColors: Record<string, string> = {
            paid: '#059669',
            due: '#D97706',
            overdue: '#DC2626',
            pending: '#6B7280',
        };
        const statusColor = statusColors[invoice.status] || '#6B7280';
        doc.fontSize(10).font('Helvetica-Bold').fillColor(statusColor)
            .text(invoice.status.toUpperCase(), 400, 102, { align: 'right' });

        doc.moveDown(2);
    }

    private renderInvoiceDetails(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
        const y = 140;

        // Left Column - Bill To
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151').text('BILL TO', 50, y);
        doc.fontSize(10).font('Helvetica').fillColor('#6B7280');
        doc.text(invoice.companyName || 'Account Holder', 50, y + 18);
        if (invoice.taxId) {
            doc.text(`Tax ID: ${invoice.taxId}`, 50, y + 34);
        }

        // Right Column - Invoice Details
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151').text('INVOICE DETAILS', 350, y);
        doc.fontSize(10).font('Helvetica').fillColor('#6B7280');
        doc.text(`Date Issued: ${this.formatDate(invoice.dateIssued)}`, 350, y + 18);
        if (invoice.periodStart && invoice.periodEnd) {
            doc.text(`Period: ${this.formatDate(invoice.periodStart)} - ${this.formatDate(invoice.periodEnd)}`, 350, y + 34);
        }

        doc.moveDown(3);
    }

    private renderLineItems(doc: PDFKit.PDFDocument, invoice: InvoiceData, items: RecoveryItem[]): void {
        const startY = 230;
        const tableWidth = 495;

        // Table Header
        doc.rect(50, startY, tableWidth, 25).fill('#F3F4F6');
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151');
        doc.text('Recovery', 60, startY + 8);
        doc.text('Order ID', 180, startY + 8);
        doc.text('Type', 300, startY + 8);
        doc.text('Amount', 450, startY + 8, { align: 'right', width: 85 });

        // Table Rows
        let rowY = startY + 30;

        if (items.length > 0) {
            items.forEach((item, i) => {
                if (i % 2 === 0) {
                    doc.rect(50, rowY - 5, tableWidth, 22).fill('#FAFAFA');
                }
                doc.fontSize(9).font('Helvetica').fillColor('#374151');
                doc.text(item.claimId.slice(0, 12) + '...', 60, rowY);
                doc.text(item.orderId.slice(0, 15), 180, rowY);
                doc.text(this.formatDetectionType(item.detectionType), 300, rowY);
                doc.text(this.formatCurrency(item.amount), 450, rowY, { align: 'right', width: 85 });
                rowY += 22;
            });
        } else {
            // Summary row when no line items
            doc.fontSize(9).font('Helvetica').fillColor('#6B7280');
            doc.text('Platform recovery services', 60, rowY);
            doc.text(this.formatCurrency(invoice.totalRecovered), 450, rowY, { align: 'right', width: 85 });
            rowY += 22;
        }

        // Draw bottom border
        doc.moveTo(50, rowY).lineTo(545, rowY).stroke('#E5E7EB');
    }

    private renderSummary(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
        const summaryY = 450;

        // Summary Box
        doc.rect(350, summaryY, 195, 100).fill('#F9FAFB').stroke('#E5E7EB');

        doc.fontSize(10).font('Helvetica').fillColor('#6B7280');
        doc.text('Total Recovered:', 360, summaryY + 15);
        doc.text('Commission (20%):', 360, summaryY + 35);

        doc.fontSize(10).font('Helvetica').fillColor('#374151');
        doc.text(this.formatCurrency(invoice.totalRecovered), 460, summaryY + 15, { align: 'right', width: 75 });
        doc.text(this.formatCurrency(invoice.commission), 460, summaryY + 35, { align: 'right', width: 75 });

        // Divider
        doc.moveTo(360, summaryY + 55).lineTo(535, summaryY + 55).stroke('#E5E7EB');

        // Total Due
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#111827');
        doc.text('Amount Due:', 360, summaryY + 70);
        doc.text(this.formatCurrency(invoice.amountCharged), 460, summaryY + 70, { align: 'right', width: 75 });

        // Net to Seller (info)
        const netToSeller = invoice.totalRecovered - invoice.commission;
        doc.fontSize(9).font('Helvetica').fillColor('#059669');
        doc.text(`Your Net Recovered: ${this.formatCurrency(netToSeller)}`, 50, summaryY + 70);
    }

    private renderFooter(doc: PDFKit.PDFDocument): void {
        const footerY = 750;

        doc.fontSize(8).font('Helvetica').fillColor('#9CA3AF');
        doc.text('Thank you for choosing Margin for your FBA recovery needs.', 50, footerY, { align: 'center', width: 495 });
        doc.text('Questions? Contact support@marginrecovery.com', 50, footerY + 14, { align: 'center', width: 495 });
        doc.text('Margin | AI-Powered Amazon FBA Recovery', 50, footerY + 28, { align: 'center', width: 495 });
    }

    private formatDate(dateStr: string): string {
        try {
            return new Date(dateStr).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            });
        } catch {
            return dateStr;
        }
    }

    private formatCurrency(amount: number): string {
        return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    private formatDetectionType(type: string): string {
        return type
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .slice(0, 20);
    }
}

export const invoicePdfService = new InvoicePdfService();
export default invoicePdfService;
