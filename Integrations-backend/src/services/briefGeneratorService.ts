
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

const BRIEF_TEMPLATES: Record<string, {
    subject: (ctx: BriefContext) => string;
    body: (ctx: BriefContext) => string;
    policy: string;
}> = {
    missing_inbound_shipment: {
        subject: (ctx) => `Reimbursement Request - Inbound Shipment ${ctx.shipmentId || 'Reference Required'} - ${ctx.sku || ctx.asin || 'Product'}`,
        policy: 'Inbound shipment reimbursement review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

Claim Type: Inbound shipment discrepancy
Shipment ID: ${ctx.shipmentId || 'Unavailable'}
Order ID: ${ctx.orderId || 'Unavailable'}
SKU/ASIN: ${ctx.sku || ctx.asin || 'Unavailable'}
Quantity: ${ctx.quantity || 1}
Requested Amount: ${ctx.amount} ${ctx.currency}

Attached Files:
${listEvidence(ctx)}

Please review the identifiers and attached files for this single inbound reimbursement request.

Regards,
Inventory Audit Team
        `.trim()
    },
    refund_without_return: {
        subject: (ctx) => `Reimbursement Request - Refunded Without Return - Order ${ctx.orderId || 'Reference Required'}`,
        policy: 'Refund without return review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

Claim Type: Refunded without return
Order ID: ${ctx.orderId || 'Unavailable'}
SKU/ASIN: ${ctx.sku || ctx.asin || 'Unavailable'}
Quantity: ${ctx.quantity || 1}
Requested Amount: ${ctx.amount} ${ctx.currency}
Reference Date: ${ctx.date || 'Unavailable'}

Attached Files:
${listEvidence(ctx)}

Please review this single reimbursement request using the attached records and order identifiers.

Regards,
Inventory Audit Team
        `.trim()
    },
    damaged_warehouse: {
        subject: (ctx) => `Reimbursement Request - Warehouse Damage - ${ctx.sku || ctx.asin || 'Product'}`,
        policy: 'Warehouse damage reimbursement review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

Claim Type: Warehouse-damaged inventory
Shipment/Reference ID: ${ctx.shipmentId || ctx.orderId || 'Unavailable'}
SKU/ASIN: ${ctx.sku || ctx.asin || 'Unavailable'}
Quantity: ${ctx.quantity || 1}
Requested Amount: ${ctx.amount} ${ctx.currency}

Attached Files:
${listEvidence(ctx)}

Please review the attached records for this single warehouse-damage reimbursement request.

Regards,
Inventory Audit Team
        `.trim()
    },
    fc_lost_or_damaged: {
        subject: (ctx) => `Reimbursement Request - FC Inventory Loss/Damage - ${ctx.sku || ctx.asin || 'Product'} - ${ctx.shipmentId || ctx.orderId || 'Reference Required'}`,
        policy: 'FC lost or damaged inventory review',
        body: (ctx) => `
Dear Amazon Seller Support Team,

Claim Type: FC lost or damaged inventory
Reference ID: ${ctx.shipmentId || ctx.orderId || 'Unavailable'}
SKU/ASIN: ${ctx.sku || ctx.asin || 'Unavailable'}
Quantity: ${ctx.quantity || 1}
Requested Amount: ${ctx.amount} ${ctx.currency}

Attached Files:
${listEvidence(ctx)}

Please review the attached records for this single FC reimbursement request.

Regards,
Inventory Audit Team
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
