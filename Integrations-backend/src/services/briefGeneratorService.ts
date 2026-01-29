
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

const BRIEF_TEMPLATES: Record<string, {
    subject: (ctx: BriefContext) => string;
    body: (ctx: BriefContext) => string;
    policy: string;
}> = {
    missing_inbound_shipment: {
        subject: (ctx) => `Reimbursement Request: Inbound Shipment ${ctx.shipmentId || 'N/A'} - ${ctx.sku || ctx.asin || 'Product'} - Quantity Discrepancy`,
        policy: 'FBA Policy 9.1: Inventory Reimbursement - Inbound Shipments',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We are writing to request a reimbursement for a quantity discrepancy identifying in shipment ${ctx.shipmentId || 'N/A'}.

Details of the Discrepancy:
- Shipment ID: ${ctx.shipmentId || 'N/A'}
- SKU/ASIN: ${ctx.sku || ctx.asin || 'N/A'}
- Expected Quantity: ${ctx.quantity || 1}
- Received Quantity: 0
- Discrepancy: ${ctx.quantity || 1} unit(s)
- Estimated Value: ${ctx.amount} ${ctx.currency}

Per FBA Policy 9.1 (Inventory Reimbursement), Amazon is responsible for items that are lost or damaged while under Amazon's control during the inbound process. Our records confirm that this shipment was delivered and accepted at the fulfillment center, yet the specified units were never added to our available inventory.

Attached Evidence:
${ctx.evidenceFilenames.map(f => `- ${f}`).join('\n')}

Please review the attached documentation and issue the corresponding reimbursement to our account.

Regards,
Inventory Audit Team
        `.trim()
    },
    refund_without_return: {
        subject: (ctx) => `Discrepancy: Order ${ctx.orderId || 'N/A'} - Refunded Without Return - FBA Policy Compliance`,
        policy: 'FBA Policy: Customer Return Reimbursement',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We have identified an order where the customer was issued a refund, but the product was not returned to our inventory within the mandatory 45-day window.

Order Details:
- Order ID: ${ctx.orderId || 'N/A'}
- Product: ${ctx.sku || ctx.asin || 'N/A'}
- Refund Amount: ${ctx.amount} ${ctx.currency}
- Refund Date: ${ctx.date || 'N/A'}

According to Amazon's Customer Return Policy, if a customer is refunded but the item is not returned to the fulfillment center within 45 days, the seller is entitled to a reimbursement. Our audits show that the 45-day window has expired, and no return has been processed for this order.

Attached Evidence:
${ctx.evidenceFilenames.map(f => `- ${f}`).join('\n')}

We request that you verify this discrepancy and process the reimbursement for the fair market value of the item.

Regards,
Inventory Audit Team
        `.trim()
    },
    damaged_warehouse: {
        subject: (ctx) => `Inventory Damage: ${ctx.sku || ctx.asin || 'Product'} - FBA Policy 9.2 (Warehouse Damage Liability)`,
        policy: 'FBA Policy 9.2: Warehouse Damage Liability',
        body: (ctx) => `
Dear Amazon Seller Support Team,

This is a request for reimbursement for inventory that was damaged while being handled within Amazon's fulfillment center.

Case Details:
- SKU/ASIN: ${ctx.sku || ctx.asin || 'N/A'}
- Condition: Damaged (Warehouse)
- Impacted Units: ${ctx.quantity || 1}
- Estimated Value: ${ctx.amount} ${ctx.currency}

Per FBA Policy 9.2, Amazon assumes responsibility for inventory that is damaged by Amazon or by a third party providing services on Amazon's behalf. Our data indicates that these units were in sellable condition upon arrival but were subsequently marked as damaged while in Amazon's possession.

Attached Evidence:
${ctx.evidenceFilenames.map(f => `- ${f}`).join('\n')}

Please process the reimbursement for the damaged units as per the standard FBA reimbursement valuation.

Regards,
Inventory Audit Team
        `.trim()
    },
    default: {
        subject: (ctx) => `Inquiry: Discrepancy Detected for Order/Shipment ${ctx.orderId || ctx.shipmentId || 'N/A'}`,
        policy: 'FBA General Reimbursement Policy',
        body: (ctx) => `
Dear Amazon Seller Support Team,

We have detected a financial discrepancy regarding our FBA inventory/orders that requires your verification.

Summary:
- Reference ID: ${ctx.orderId || ctx.shipmentId || 'N/A'}
- SKU/ASIN: ${ctx.sku || ctx.asin || 'N/A'}
- Discrepancy Amount: ${ctx.amount} ${ctx.currency}

We have performed a full reconciliation of our records and found that this transaction remains unresolved. We request that you review the details and provide a resolution or reimbursement in accordance with FBA policies.

Attached Evidence:
${ctx.evidenceFilenames.map(f => `- ${f}`).join('\n')}

Regards,
Inventory Audit Team
        `.trim()
    }
};

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
        const type = ctx.caseType.toLowerCase();
        let template = BRIEF_TEMPLATES[type] || BRIEF_TEMPLATES.default;

        // Special handling for variations
        if (type.includes('missing') || type.includes('lost')) {
            template = BRIEF_TEMPLATES.missing_inbound_shipment;
        } else if (type.includes('return') || type.includes('refund')) {
            template = BRIEF_TEMPLATES.refund_without_return;
        } else if (type.includes('damage')) {
            template = BRIEF_TEMPLATES.damaged_warehouse;
        }

        return {
            subject: template.subject(ctx),
            body: template.body(ctx),
            policyCited: template.policy
        };
    }
}

export const briefGeneratorService = new BriefGeneratorService();
export default briefGeneratorService;
