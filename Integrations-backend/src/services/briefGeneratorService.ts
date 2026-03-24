
/**
 * Brief Generator Service (Agent 7 - The Lawyer)
 * 
 * Generates professional, data-driven "Legal Briefs" for Amazon SP-API submissions.
 * Follows FBA policies and maintains a cold, professional tone.
 */

import logger from '../utils/logger';

export interface LegalBrief {
    subject: string;
    body: string;
    policyCited: string;
}

export interface BriefContext {
    caseType: string;
    amount: number;
    currency: string;
    orderId?: string;
    shipmentId?: string;
    asin?: string;
    sku?: string;
    date?: string;
    quantity?: number;
    evidenceFilenames: string[];
}

function listEvidence(ctx: BriefContext): string {
    if (!ctx.evidenceFilenames.length) {
        return '- No verified files included';
    }
    return ctx.evidenceFilenames.map(f => `- ${f}`).join('\n');
}

function formatAmount(ctx: BriefContext): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: ctx.currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(ctx.amount || 0);
}

function describeInboundEvidence(ctx: BriefContext): string[] {
    const names = ctx.evidenceFilenames.map((name) => String(name || '').toLowerCase());
    const lines: string[] = [];

    if (names.some((name) => /invoice|supplier|manufacturer|po\b|purchase/.test(name))) {
        lines.push('Supplier or sourcing-cost documentation matching the identifiers above');
    }
    if (names.some((name) => /shipment|shipping|tracking|bill of lading|\bbol\b|pod|delivery|awb|waybill|manifest/.test(name))) {
        lines.push('Shipment or delivery documentation matching the inbound reference');
    }
    if (names.some((name) => /inventory|receiving|reconcile|reconciliation|discrepancy|adjustment/.test(name))) {
        lines.push('Inventory or discrepancy records tied to the shipment');
    }

    if (lines.length === 0) {
        lines.push('Attached documents matching the identifiers listed in this request');
    }

    return lines;
}

function describeOrderEvidence(ctx: BriefContext): string[] {
    const names = ctx.evidenceFilenames.map((name) => String(name || '').toLowerCase());
    const lines: string[] = [];

    if (names.some((name) => /invoice|supplier|manufacturer|po\b|purchase/.test(name))) {
        lines.push('Sourcing or invoice documentation matching the product identifiers');
    }
    if (names.some((name) => /order|refund|return|customer|rma|tracking|delivery/.test(name))) {
        lines.push('Order, refund, return, or delivery records tied to the reference above');
    }
    if (lines.length === 0) {
        lines.push('Attached documents matching the order and product identifiers in this request');
    }

    return lines;
}

function describeWarehouseEvidence(ctx: BriefContext): string[] {
    const names = ctx.evidenceFilenames.map((name) => String(name || '').toLowerCase());
    const lines: string[] = [];

    if (names.some((name) => /invoice|supplier|manufacturer|po\b|purchase/.test(name))) {
        lines.push('Sourcing-cost or invoice documentation for the affected inventory');
    }
    if (names.some((name) => /inventory|adjustment|damage|warehouse|fc|fulfillment/.test(name))) {
        lines.push('Warehouse, fulfillment-center, or inventory adjustment records tied to the affected units');
    }
    if (lines.length === 0) {
        lines.push('Attached documents matching the warehouse event and product identifiers listed above');
    }

    return lines;
}

function describeFeeEvidence(ctx: BriefContext): string[] {
    const names = ctx.evidenceFilenames.map((name) => String(name || '').toLowerCase());
    const lines: string[] = [];

    if (names.some((name) => /fee|settlement|statement|ledger|charge|invoice/.test(name))) {
        lines.push('Fee, settlement, or billing records matching the overcharge reference');
    }
    if (names.some((name) => /dimension|weight|size|catalog|product/.test(name))) {
        lines.push('Supporting product or catalog documentation relevant to the disputed fee basis');
    }
    if (lines.length === 0) {
        lines.push('Attached documents supporting the disputed fee calculation and identifiers above');
    }

    return lines;
}

function buildClaimDetails(lines: Array<[string, string | number]>): string {
    return lines.map(([label, value]) => `${label}: ${value}`).join('\n');
}

const BRIEF_TEMPLATES: Record<string, {
    subject: (ctx: BriefContext) => string;
    body: (ctx: BriefContext) => string;
    policy: string;
}> = {
    missing_inbound_shipment: {
        subject: (ctx) => `Reimbursement Request - Inbound Shipment Discrepancy - ${ctx.shipmentId || 'Reference Required'} - ${ctx.sku || ctx.asin || 'Product'}${ctx.quantity ? ` - ${ctx.quantity} unit${ctx.quantity === 1 ? '' : 's'}` : ''}`,
        policy: 'Inbound shipment discrepancy review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting reimbursement review for an inbound shipment discrepancy.

Claim Details:
Claim Type: Inbound Shipment Discrepancy
Shipment ID: ${ctx.shipmentId || 'Unavailable'}
Order ID: ${ctx.orderId || 'Unavailable'}
SKU: ${ctx.sku || 'Unavailable'}
ASIN: ${ctx.asin || 'Unavailable'}
Quantity Affected: ${ctx.quantity || 1}
Requested Reimbursement: ${formatAmount(ctx)}

Summary of Evidence:
The identifiers listed above match the attached documents included with this request.
${describeInboundEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review this inbound discrepancy using the attached shipment and sourcing records and process reimbursement for the requested amount if the attached documentation satisfies the reimbursement requirements.

Thank you.
        `.trim()
    },
    lost_inventory: {
        subject: (ctx) => `Reimbursement Request - Lost Inventory - ${ctx.shipmentId || ctx.orderId || 'Reference Required'} - ${ctx.sku || ctx.asin || 'Product'}${ctx.quantity ? ` - ${ctx.quantity} unit${ctx.quantity === 1 ? '' : 's'}` : ''}`,
        policy: 'Lost inventory reimbursement review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting reimbursement review for inventory that appears lost after receipt or internal handling.

Claim Details:
${buildClaimDetails([
    ['Claim Type', 'Lost Inventory'],
    ['Reference ID', ctx.shipmentId || ctx.orderId || 'Unavailable'],
    ['Order ID', ctx.orderId || 'Unavailable'],
    ['Shipment ID', ctx.shipmentId || 'Unavailable'],
    ['SKU', ctx.sku || 'Unavailable'],
    ['ASIN', ctx.asin || 'Unavailable'],
    ['Quantity Affected', ctx.quantity || 1],
    ['Requested Reimbursement', formatAmount(ctx)],
])}

Summary of Evidence:
The identifiers listed above match the attached inventory and sourcing documents included with this request.
${describeWarehouseEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review this inventory loss using the attached records and process reimbursement for the requested amount if the attached documentation satisfies the reimbursement requirements.

Thank you.
        `.trim()
    },
    damaged_stock: {
        subject: (ctx) => `Reimbursement Request - Damaged Inventory - ${ctx.shipmentId || ctx.orderId || 'Reference Required'} - ${ctx.sku || ctx.asin || 'Product'}${ctx.quantity ? ` - ${ctx.quantity} unit${ctx.quantity === 1 ? '' : 's'}` : ''}`,
        policy: 'Damaged inventory reimbursement review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting reimbursement review for inventory recorded as damaged while under Amazon handling or storage.

Claim Details:
${buildClaimDetails([
    ['Claim Type', 'Damaged Inventory'],
    ['Reference ID', ctx.shipmentId || ctx.orderId || 'Unavailable'],
    ['Order ID', ctx.orderId || 'Unavailable'],
    ['Shipment ID', ctx.shipmentId || 'Unavailable'],
    ['SKU', ctx.sku || 'Unavailable'],
    ['ASIN', ctx.asin || 'Unavailable'],
    ['Quantity Affected', ctx.quantity || 1],
    ['Requested Reimbursement', formatAmount(ctx)],
])}

Summary of Evidence:
The identifiers listed above match the attached sourcing and warehouse records included with this request.
${describeWarehouseEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review this damaged-inventory discrepancy using the attached records and process reimbursement for the requested amount if the attached documentation satisfies the reimbursement requirements.

Thank you.
        `.trim()
    },
    fee_overcharge: {
        subject: (ctx) => `Fee Review Request - Overcharge - ${ctx.sku || ctx.asin || ctx.orderId || 'Reference Required'}`,
        policy: 'Fee overcharge review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting review of an FBA fee discrepancy affecting the identifier below.

Claim Details:
${buildClaimDetails([
    ['Claim Type', 'Fee Overcharge Review'],
    ['Order ID', ctx.orderId || 'Unavailable'],
    ['SKU', ctx.sku || 'Unavailable'],
    ['ASIN', ctx.asin || 'Unavailable'],
    ['Requested Adjustment', formatAmount(ctx)],
    ['Reference Date', ctx.date || 'Unavailable'],
])}

Summary of Evidence:
The identifiers listed above match the attached fee and supporting product records included with this request.
${describeFeeEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review the attached records for this fee discrepancy and apply the appropriate reimbursement or adjustment if the attached documentation supports the requested amount.

Thank you.
        `.trim()
    },
    fc_transfer: {
        subject: (ctx) => `Reimbursement Review - FC Transfer Discrepancy - ${ctx.shipmentId || ctx.orderId || 'Reference Required'} - ${ctx.sku || ctx.asin || 'Product'}`,
        policy: 'FC transfer discrepancy review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting reimbursement review for an internal fulfillment-center transfer discrepancy affecting the inventory identified below.

Claim Details:
${buildClaimDetails([
    ['Claim Type', 'FC Transfer Discrepancy'],
    ['Reference ID', ctx.shipmentId || ctx.orderId || 'Unavailable'],
    ['SKU', ctx.sku || 'Unavailable'],
    ['ASIN', ctx.asin || 'Unavailable'],
    ['Quantity Affected', ctx.quantity || 1],
    ['Requested Reimbursement', formatAmount(ctx)],
])}

Summary of Evidence:
The identifiers listed above match the attached inventory and movement-related documents included with this request.
${describeWarehouseEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review this transfer-related discrepancy using the attached records and process reimbursement for the requested amount if the attached documentation satisfies the reimbursement requirements.

Thank you.
        `.trim()
    },
    reconcile_integrity: {
        subject: (ctx) => `Reimbursement Review - Reconciliation Discrepancy - ${ctx.orderId || ctx.shipmentId || 'Reference Required'} - ${ctx.sku || ctx.asin || 'Product'}`,
        policy: 'Reconciliation discrepancy review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting review of a reconciliation discrepancy identified in the records tied to the references below.

Claim Details:
${buildClaimDetails([
    ['Claim Type', 'Reconciliation Discrepancy'],
    ['Order ID', ctx.orderId || 'Unavailable'],
    ['Shipment ID', ctx.shipmentId || 'Unavailable'],
    ['SKU', ctx.sku || 'Unavailable'],
    ['ASIN', ctx.asin || 'Unavailable'],
    ['Quantity Affected', ctx.quantity || 1],
    ['Requested Reimbursement', formatAmount(ctx)],
])}

Summary of Evidence:
The identifiers listed above match the attached reconciliation and supporting sourcing records included with this request.
${describeOrderEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review this discrepancy against the attached records and process reimbursement or reconciliation correction for the requested amount if the attached documentation supports the claim.

Thank you.
        `.trim()
    },
    refund_gap: {
        subject: (ctx) => `Reimbursement Request - Refund or Return Discrepancy - Order ${ctx.orderId || 'Reference Required'} - ${ctx.sku || ctx.asin || 'Product'}`,
        policy: 'Refund and return discrepancy review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting reimbursement review for a refund or return discrepancy affecting the order identified below.

Claim Details:
${buildClaimDetails([
    ['Claim Type', 'Refund / Return Discrepancy'],
    ['Order ID', ctx.orderId || 'Unavailable'],
    ['SKU', ctx.sku || 'Unavailable'],
    ['ASIN', ctx.asin || 'Unavailable'],
    ['Quantity Affected', ctx.quantity || 1],
    ['Requested Reimbursement', formatAmount(ctx)],
    ['Reference Date', ctx.date || 'Unavailable'],
])}

Summary of Evidence:
The identifiers listed above match the attached order, return, and sourcing records included with this request.
${describeOrderEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review this refund or return discrepancy using the attached records and process reimbursement for the requested amount if the attached documentation satisfies the reimbursement requirements.

Thank you.
        `.trim()
    },
    refund_without_return: {
        subject: (ctx) => BRIEF_TEMPLATES.refund_gap.subject(ctx).replace('Refund or Return Discrepancy', 'Refunded Without Return'),
        policy: 'Refund without return review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting reimbursement review for a refunded order where the return flow remains unresolved.

Claim Details:
${buildClaimDetails([
    ['Claim Type', 'Refunded Without Return'],
    ['Order ID', ctx.orderId || 'Unavailable'],
    ['SKU', ctx.sku || 'Unavailable'],
    ['ASIN', ctx.asin || 'Unavailable'],
    ['Quantity Affected', ctx.quantity || 1],
    ['Requested Reimbursement', formatAmount(ctx)],
    ['Reference Date', ctx.date || 'Unavailable'],
])}

Summary of Evidence:
The identifiers listed above match the attached order, refund, and sourcing records included with this request.
${describeOrderEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review this refund-without-return discrepancy using the attached records and process reimbursement for the requested amount if the attached documentation satisfies the reimbursement requirements.

Thank you.
        `.trim()
    },
    damaged_warehouse: {
        subject: (ctx) => BRIEF_TEMPLATES.damaged_stock.subject(ctx).replace('Damaged Inventory', 'Warehouse Damage'),
        policy: 'Warehouse damage reimbursement review',
        body: (ctx) => BRIEF_TEMPLATES.damaged_stock.body(ctx).replace('Claim Type: Damaged Inventory', 'Claim Type: Warehouse Damage')
    },
    fc_lost_or_damaged: {
        subject: (ctx) => `Reimbursement Request - FC Inventory Loss or Damage - ${ctx.shipmentId || ctx.orderId || 'Reference Required'} - ${ctx.sku || ctx.asin || 'Product'}${ctx.quantity ? ` - ${ctx.quantity} unit${ctx.quantity === 1 ? '' : 's'}` : ''}`,
        policy: 'FC lost or damaged inventory review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are requesting reimbursement review for inventory that appears lost or damaged while under fulfillment-center handling.

Claim Details:
${buildClaimDetails([
    ['Claim Type', 'FC Inventory Loss or Damage'],
    ['Reference ID', ctx.shipmentId || ctx.orderId || 'Unavailable'],
    ['Order ID', ctx.orderId || 'Unavailable'],
    ['Shipment ID', ctx.shipmentId || 'Unavailable'],
    ['SKU', ctx.sku || 'Unavailable'],
    ['ASIN', ctx.asin || 'Unavailable'],
    ['Quantity Affected', ctx.quantity || 1],
    ['Requested Reimbursement', formatAmount(ctx)],
])}

Summary of Evidence:
The identifiers listed above match the attached inventory and sourcing records included with this request.
${describeWarehouseEvidence(ctx).map((line) => `- ${line}`).join('\n')}

Attached Files:
${listEvidence(ctx)}

Review Request:
Please review this fulfillment-center discrepancy using the attached records and process reimbursement for the requested amount if the attached documentation satisfies the reimbursement requirements.

Thank you.
        `.trim()
    },
    default: {
        subject: (ctx) => `Reimbursement Request - ${ctx.orderId || ctx.shipmentId || 'Reference Required'}`,
        policy: 'General reimbursement review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

Claim Type: ${ctx.caseType || 'General discrepancy'}
Reference ID: ${ctx.orderId || ctx.shipmentId || 'Unavailable'}
SKU/ASIN: ${ctx.sku || ctx.asin || 'Unavailable'}
Quantity: ${ctx.quantity || 1}
Requested Amount: ${ctx.amount} ${ctx.currency}

Attached Files:
${listEvidence(ctx)}

Please review the attached records for this reimbursement request.

Regards,
Inventory Audit Team
        `.trim()
    }
};

export function resolveBriefTemplateType(caseType: string): keyof typeof BRIEF_TEMPLATES {
    const type = caseType.toLowerCase();

    if (type.includes('reconcile') || type.includes('integrity') || type.includes('underpayment') || type.includes('missing_reimbursement')) {
        return 'reconcile_integrity';
    }
    if (type.includes('transfer')) {
        return 'fc_transfer';
    }
    if (type.includes('fee') || type.includes('overcharge') || type.includes('dimension') || type.includes('weight')) {
        return 'fee_overcharge';
    }
    if (type.includes('refund-gap') || type.includes('refund_gap')) {
        return 'refund_gap';
    }
    if (type.includes('damaged-stock') || type.includes('damaged_stock') || type.includes('damaged_inventory')) {
        return 'damaged_stock';
    }
    if (type.includes('lost-inventory') || type.includes('lost_inventory')) {
        return 'lost_inventory';
    }
    if (type.includes('warehouse') || type.includes('damage') || type.includes('fulfillment') || type.includes('fc_')) {
        return 'fc_lost_or_damaged';
    }
    if (type.includes('inbound') || type.includes('shipment') || type.includes('missing') || type.includes('lost')) {
        return 'missing_inbound_shipment';
    }
    if (type.includes('return') || type.includes('refund')) {
        return 'refund_without_return';
    }

    return 'default';
}

class BriefGeneratorService {
    /**
     * Generate a legal brief (Subject + Body) for a claim
     */
    generateBrief(ctx: BriefContext): LegalBrief {
        logger.debug('[BRIEF GENERATOR] Generating brief for anomaly', {
            type: ctx.caseType,
            orderId: ctx.orderId
        });

        // Normalize type
        const templateKey = resolveBriefTemplateType(ctx.caseType);
        const template = BRIEF_TEMPLATES[templateKey] || BRIEF_TEMPLATES.default;

        return {
            subject: template.subject(ctx),
            body: template.body(ctx),
            policyCited: template.policy
        };
    }
}

export const briefGeneratorService = new BriefGeneratorService();
export default briefGeneratorService;
