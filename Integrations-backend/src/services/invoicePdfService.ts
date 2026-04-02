/**
 * Invoice PDF Service
 * New invoices reflect flat subscription billing.
 * Legacy recovery-fee invoices remain available for historical reference only.
 */

import PDFDocument from 'pdfkit';
import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import recoveryFinancialTruthService from './recoveryFinancialTruthService';
import { billingIntervalLabel, planTierLabel } from './subscriptionBillingTruthService';

type InvoiceStatus =
  | 'draft'
  | 'pending'
  | 'scheduled'
  | 'pending_payment_method'
  | 'sent'
  | 'paid'
  | 'failed'
  | 'void'
  | 'legacy'
  | 'charged'
  | 'credited'
  | 'refunded'
  | null;

interface InvoiceData {
  id: string;
  invoiceId: string;
  invoiceType: 'subscription_invoice' | 'legacy_recovery_fee_invoice';
  invoiceModel: 'subscription' | 'legacy_recovery_fee';
  billingModel: 'flat_subscription' | 'legacy_recovery_fee';
  legacyLabel: string | null;
  dateIssued: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: InvoiceStatus;
  planTier?: string | null;
  billingInterval?: string | null;
  currency?: string | null;
  totalAmount: number | null;
  amountCharged: number | null;
  promoNote?: string | null;
  paymentProvider?: 'yoco' | null;
  paymentLinkKey?: string | null;
  paymentLinkUrl?: string | null;
  providerInvoiceId?: string | null;
  providerChargeId?: string | null;
  companyName?: string | null;
  taxId?: string | null;
  totalRecovered?: number | null;
  commission?: number | null;
  creditApplied?: number | null;
  creditBalanceRemaining?: number | null;
  recoveryClaimIds?: string[];
  disputeCaseIds?: string[];
  tenantId?: string;
}

interface RecoveryItem {
  eventId: string;
  referenceId: string;
  settlementId: string;
  payoutBatchId: string;
  amount: number;
  eventType: string;
  eventDate: string;
}

const NOT_AVAILABLE = 'Not Available';

class InvoicePdfService {
  async generateInvoicePdf(invoiceId: string, userId: string, tenantId: string): Promise<Buffer> {
    logger.info('[INVOICE PDF] Generating invoice', { invoiceId, userId, tenantId });

    const invoice = await this.getInvoiceData(invoiceId, userId, tenantId);
    if (!invoice) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    const recoveryItems = invoice.invoiceModel === 'legacy_recovery_fee'
      ? await this.getLegacyRecoveryItems(invoice, tenantId)
      : [];

    return this.createPdf(invoice, recoveryItems);
  }

  private async getInvoiceData(invoiceId: string, userId: string, tenantId: string): Promise<InvoiceData | null> {
    try {
      const { data: invoiceData, error: invoiceError } = await supabase
        .from('billing_invoices')
        .select('*')
        .eq('tenant_id', tenantId)
        .or(`id.eq.${invoiceId},invoice_id.eq.${invoiceId}`)
        .maybeSingle();

      if (!invoiceError && invoiceData) {
        if (!invoiceData.user_id || String(invoiceData.user_id) === String(userId)) {
          return this.mapSubscriptionInvoiceData(invoiceData);
        }
      }

      const { data: transactionData, error: transactionError } = await supabase
        .from('billing_transactions')
        .select('*')
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!transactionError && transactionData) {
        return this.mapLegacyTransactionData(transactionData);
      }

      logger.warn('[INVOICE PDF] Invoice not found', { invoiceId, userId, tenantId });
      return null;
    } catch (err: any) {
      logger.error('[INVOICE PDF] Error fetching invoice', { invoiceId, error: err.message });
      return null;
    }
  }

  private mapSubscriptionInvoiceData(data: any): InvoiceData {
    return {
      id: data.id,
      invoiceId: data.invoice_id || data.id,
      invoiceType: data.invoice_type === 'legacy_recovery_fee_invoice' ? 'legacy_recovery_fee_invoice' : 'subscription_invoice',
      invoiceModel: data.invoice_model === 'legacy_recovery_fee' ? 'legacy_recovery_fee' : 'subscription',
      billingModel: data.billing_model === 'legacy_recovery_fee' ? 'legacy_recovery_fee' : 'flat_subscription',
      legacyLabel: data.invoice_model === 'legacy_recovery_fee' ? 'Legacy Recovery Fee' : null,
      dateIssued: data.invoice_date || data.created_at || null,
      periodStart: data.billing_period_start || null,
      periodEnd: data.billing_period_end || null,
      status: this.normalizeInvoiceStatus(data.status),
      planTier: data.plan_tier || null,
      billingInterval: data.billing_interval || null,
      currency: data.currency || 'USD',
      totalAmount: this.toOptionalMoney(data.billing_amount_cents),
      amountCharged: this.toOptionalMoney(data.amount_charged_cents),
      promoNote: data.promo_note || null,
      paymentProvider: data.payment_provider || null,
      paymentLinkKey: data.payment_link_key || null,
      paymentLinkUrl: data.payment_link_url || null,
      providerInvoiceId: data.provider_invoice_id || null,
      providerChargeId: data.provider_charge_id || null,
      companyName: data.company_name || null,
      taxId: data.tax_id || null,
      tenantId: data.tenant_id,
    };
  }

  private mapLegacyTransactionData(data: any): InvoiceData {
    return {
      id: data.id,
      invoiceId: data.id,
      invoiceType: 'legacy_recovery_fee_invoice',
      invoiceModel: 'legacy_recovery_fee',
      billingModel: 'legacy_recovery_fee',
      legacyLabel: 'Legacy Recovery Fee',
      dateIssued: data.created_at || null,
      status: this.normalizeInvoiceStatus(data.billing_status),
      currency: data.currency || 'USD',
      totalAmount: this.toOptionalMoney(data.amount_due_cents),
      amountCharged: ['charged', 'refunded'].includes(String(data.billing_status || '').toLowerCase())
        ? this.toOptionalMoney(data.amount_due_cents)
        : null,
      paymentProvider: null,
      paymentLinkKey: null,
      paymentLinkUrl: null,
      providerInvoiceId: data.paypal_invoice_id || data.metadata?.paypal_invoice_id || null,
      providerChargeId: data.external_payment_id || null,
      totalRecovered: this.toOptionalMoney(data.amount_recovered_cents),
      commission: this.toOptionalMoney(data.platform_fee_cents),
      creditApplied: this.toOptionalMoney(data.credit_applied_cents),
      creditBalanceRemaining: this.toOptionalMoney(data.credit_balance_after_cents),
      recoveryClaimIds: data.recovery_id ? [data.recovery_id] : [],
      disputeCaseIds: data.dispute_id ? [data.dispute_id] : [],
      tenantId: data.tenant_id,
      companyName: data.company_name || null,
      taxId: data.tax_id || null,
    };
  }

  private async getLegacyRecoveryItems(invoice: InvoiceData, tenantId: string): Promise<RecoveryItem[]> {
    const disputeIds = new Set<string>((invoice.disputeCaseIds || []).filter(Boolean));
    const recoveryIds = Array.from(new Set((invoice.recoveryClaimIds || []).filter(Boolean)));

    if (recoveryIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('recoveries')
        .select('id, dispute_id')
        .eq('tenant_id', tenantId)
        .in('id', recoveryIds);

      (data || []).forEach((row: any) => {
        if (row?.dispute_id) disputeIds.add(String(row.dispute_id));
      });
    }

    if (disputeIds.size === 0) return [];

    try {
      const truth = await recoveryFinancialTruthService.getFinancialTruth({
        tenantId,
        caseIds: Array.from(disputeIds),
      });

      return Array.from(disputeIds).flatMap((disputeId) => {
        const events = truth.eventsByInputId[disputeId] || [];
        return events.map((event) => ({
          eventId: event.event_id,
          referenceId: event.reference_id || NOT_AVAILABLE,
          settlementId: event.settlement_id || NOT_AVAILABLE,
          payoutBatchId: event.payout_batch_id || NOT_AVAILABLE,
          amount: event.amount || 0,
          eventType: event.event_type || 'financial_event',
          eventDate: event.event_date || '',
        }));
      });
    } catch {
      return [];
    }
  }

  private createPdf(invoice: InvoiceData, items: RecoveryItem[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ margin: 50, size: 'A4' });

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.renderHeader(doc, invoice);
      this.renderInvoiceDetails(doc, invoice);
      if (invoice.invoiceModel === 'subscription') {
        this.renderSubscriptionLineItems(doc, invoice);
        this.renderSubscriptionSummary(doc, invoice);
      } else {
        this.renderLegacyLineItems(doc, invoice, items);
        this.renderLegacySummary(doc, invoice);
      }
      this.renderFooter(doc, invoice);

      doc.end();
    });
  }

  private renderHeader(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#111827').text('Margin', 50, 50);
    doc.fontSize(10).font('Helvetica').fillColor('#6B7280').text('Subscription Billing', 50, 80);

    const title = invoice.invoiceModel === 'subscription'
      ? 'SUBSCRIPTION INVOICE'
      : 'LEGACY INVOICE';

    doc.fontSize(26).font('Helvetica-Bold').fillColor('#111827').text(title, 320, 50, { align: 'right' });
    doc.fontSize(10).font('Helvetica').fillColor('#6B7280').text(`Invoice #: ${invoice.invoiceId}`, 320, 84, { align: 'right' });

    const statusColor = this.statusColor(invoice.status);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(statusColor)
      .text(invoice.status ? String(invoice.status).toUpperCase() : NOT_AVAILABLE.toUpperCase(), 320, 102, { align: 'right' });

    if (invoice.legacyLabel) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#92400E')
        .text(invoice.legacyLabel.toUpperCase(), 50, 104);
    }
  }

  private renderInvoiceDetails(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
    const y = 145;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151').text('BILL TO', 50, y);
    doc.fontSize(10).font('Helvetica').fillColor('#6B7280');
    doc.text(invoice.companyName || 'Account Holder', 50, y + 18);
    if (invoice.taxId) {
      doc.text(`Tax ID: ${invoice.taxId}`, 50, y + 34);
    }

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151').text('DETAILS', 330, y);
    doc.fontSize(10).font('Helvetica').fillColor('#6B7280');
    doc.text(`Date Issued: ${this.formatDate(invoice.dateIssued)}`, 330, y + 18);
    doc.text(`Billing Model: ${invoice.billingModel === 'flat_subscription' ? 'Flat Subscription' : 'Legacy Recovery Fee'}`, 330, y + 34);
    doc.text(`Invoice Type: ${invoice.invoiceType === 'subscription_invoice' ? 'Subscription Invoice' : 'Legacy Recovery Fee Invoice'}`, 330, y + 50);
    if (invoice.periodStart && invoice.periodEnd) {
      doc.text(`Period: ${this.formatDate(invoice.periodStart)} - ${this.formatDate(invoice.periodEnd)}`, 330, y + 66);
    }
  }

  private renderSubscriptionLineItems(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
    const startY = 245;
    const tableWidth = 495;

    doc.rect(50, startY, tableWidth, 25).fill('#F3F4F6');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151');
    doc.text('Plan', 60, startY + 8);
    doc.text('Interval', 200, startY + 8);
    doc.text('Period', 310, startY + 8);
    doc.text('Amount', 450, startY + 8, { align: 'right', width: 85 });

    const rowY = startY + 32;
    doc.fontSize(9).font('Helvetica').fillColor('#374151');
    doc.text(planTierLabel(invoice.planTier as any) || NOT_AVAILABLE, 60, rowY);
    doc.text(billingIntervalLabel(invoice.billingInterval as any) || NOT_AVAILABLE, 200, rowY);
    doc.text(
      invoice.periodStart && invoice.periodEnd
        ? `${this.formatDate(invoice.periodStart)} - ${this.formatDate(invoice.periodEnd)}`
        : NOT_AVAILABLE,
      310,
      rowY,
      { width: 115 }
    );
    doc.text(this.formatCurrency(invoice.totalAmount), 450, rowY, { align: 'right', width: 85 });

    doc.moveTo(50, rowY + 22).lineTo(545, rowY + 22).stroke('#E5E7EB');

    if (invoice.promoNote) {
      doc.fontSize(9).font('Helvetica').fillColor('#6B7280')
        .text(`Promo note: ${invoice.promoNote}`, 50, rowY + 38, { width: 495 });
    }
  }

  private renderSubscriptionSummary(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
    const summaryY = 415;

    doc.rect(350, summaryY, 195, 145).fill('#F9FAFB').stroke('#E5E7EB');
    doc.fontSize(10).font('Helvetica').fillColor('#6B7280');
    doc.text('Subscription amount:', 360, summaryY + 15);
    doc.text('Charged amount:', 360, summaryY + 35);
    doc.text('Payment provider:', 360, summaryY + 55);
    doc.text('YOCO link key:', 360, summaryY + 75);
    doc.text('Checkout link:', 360, summaryY + 95);

    doc.fontSize(10).font('Helvetica').fillColor('#374151');
    doc.text(this.formatCurrency(invoice.totalAmount), 460, summaryY + 15, { align: 'right', width: 75 });
    doc.text(this.formatCurrency(invoice.amountCharged), 460, summaryY + 35, { align: 'right', width: 75 });
    doc.text(invoice.paymentProvider === 'yoco' ? 'YOCO' : NOT_AVAILABLE, 360, summaryY + 55, { width: 175 });
    doc.text(invoice.paymentLinkKey || NOT_AVAILABLE, 360, summaryY + 75, { width: 175 });
    doc.text(invoice.paymentLinkUrl || NOT_AVAILABLE, 360, summaryY + 95, { width: 175 });

    doc.fontSize(9).font('Helvetica').fillColor('#059669');
    doc.text('Recoveries never determine this invoice amount.', 50, summaryY + 120);
  }

  private renderLegacyLineItems(doc: PDFKit.PDFDocument, invoice: InvoiceData, items: RecoveryItem[]): void {
    const startY = 245;
    const tableWidth = 495;

    doc.rect(50, startY, tableWidth, 25).fill('#F3F4F6');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151');
    doc.text('Event', 60, startY + 8);
    doc.text('Reference', 180, startY + 8);
    doc.text('Settlement', 300, startY + 8);
    doc.text('Amount', 450, startY + 8, { align: 'right', width: 85 });

    let rowY = startY + 30;
    if (items.length > 0) {
      items.forEach((item, index) => {
        if (index % 2 === 0) {
          doc.rect(50, rowY - 5, tableWidth, 22).fill('#FAFAFA');
        }
        doc.fontSize(9).font('Helvetica').fillColor('#374151');
        doc.text(`${this.formatDetectionType(item.eventType)} • ${this.formatDate(item.eventDate)}`, 60, rowY, { width: 110 });
        doc.text(item.referenceId.slice(0, 15), 180, rowY);
        doc.text(item.settlementId.slice(0, 18), 300, rowY);
        doc.text(this.formatCurrency(item.amount), 450, rowY, { align: 'right', width: 85 });
        rowY += 22;
      });
    } else {
      doc.fontSize(9).font('Helvetica').fillColor('#6B7280');
      doc.text('Canonical legacy recovery proof unavailable', 60, rowY);
      doc.text(this.formatCurrency(invoice.totalRecovered), 450, rowY, { align: 'right', width: 85 });
      rowY += 22;
    }

    doc.moveTo(50, rowY).lineTo(545, rowY).stroke('#E5E7EB');
  }

  private renderLegacySummary(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
    const summaryY = 430;

    doc.rect(350, summaryY, 195, 100).fill('#F9FAFB').stroke('#E5E7EB');
    doc.fontSize(10).font('Helvetica').fillColor('#6B7280');
    doc.text('Recovered amount:', 360, summaryY + 15);
    doc.text('Legacy fee amount:', 360, summaryY + 35);
    doc.text('Credit Applied:', 360, summaryY + 55);

    doc.fontSize(10).font('Helvetica').fillColor('#374151');
    doc.text(this.formatCurrency(invoice.totalRecovered), 460, summaryY + 15, { align: 'right', width: 75 });
    doc.text(this.formatCurrency(invoice.commission), 460, summaryY + 35, { align: 'right', width: 75 });
    doc.text(this.formatCurrency(invoice.creditApplied), 460, summaryY + 55, { align: 'right', width: 75 });

    doc.moveTo(360, summaryY + 75).lineTo(535, summaryY + 75).stroke('#E5E7EB');
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#111827');
    doc.text('Legacy amount due:', 360, summaryY + 90);
    doc.text(this.formatCurrency(invoice.amountCharged || invoice.totalAmount), 460, summaryY + 90, { align: 'right', width: 75 });

    doc.fontSize(9).font('Helvetica').fillColor('#92400E');
    doc.text('Historical record only. New Margin billing is flat subscription pricing.', 50, summaryY + 90);
  }

  private renderFooter(doc: PDFKit.PDFDocument, invoice: InvoiceData): void {
    const footerY = 750;
    doc.fontSize(8).font('Helvetica').fillColor('#9CA3AF');
    doc.text('Margin subscription billing: flat pricing, no commissions, no recovery-based charges.', 50, footerY, {
      align: 'center',
      width: 495,
    });
    if (invoice.invoiceModel === 'legacy_recovery_fee') {
      doc.text('This document is a historical legacy invoice from before the subscription billing migration.', 50, footerY + 14, {
        align: 'center',
        width: 495,
      });
    } else {
      doc.text('Payment execution layer: YOCO checkout links. Questions? billing@margin-finance.com', 50, footerY + 14, {
        align: 'center',
        width: 495,
      });
    }
  }

  private statusColor(status: InvoiceStatus): string {
    switch (status) {
      case 'paid':
      case 'charged':
        return '#059669';
      case 'sent':
      case 'scheduled':
        return '#0284C7';
      case 'pending':
      case 'pending_payment_method':
      case 'draft':
        return '#D97706';
      case 'failed':
        return '#DC2626';
      case 'legacy':
      case 'refunded':
      case 'credited':
      case 'void':
        return '#78716C';
      default:
        return '#6B7280';
    }
  }

  private formatDate(dateStr?: string | null): string {
    if (!dateStr) return NOT_AVAILABLE;
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return NOT_AVAILABLE;
    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private formatCurrency(amount?: number | null): string {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return NOT_AVAILABLE;
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private toOptionalMoney(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Number((parsed / 100).toFixed(2)) : null;
  }

  private normalizeInvoiceStatus(value: unknown): InvoiceStatus {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if ([
      'draft',
      'pending',
      'scheduled',
      'pending_payment_method',
      'sent',
      'paid',
      'failed',
      'void',
      'legacy',
      'charged',
      'credited',
      'refunded',
    ].includes(normalized)) {
      return normalized as InvoiceStatus;
    }
    return null;
  }

  private formatDetectionType(type: string): string {
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
      .slice(0, 20);
  }
}

export const invoicePdfService = new InvoicePdfService();
export default invoicePdfService;
