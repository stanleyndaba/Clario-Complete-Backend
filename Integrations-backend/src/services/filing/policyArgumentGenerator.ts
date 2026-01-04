/**
 * Policy Argument Generator
 * 
 * Agent 7 Enhancement: Auto-generates Amazon policy-aware claim arguments
 * 
 * Features:
 * - Correct reimbursement category for each issue type
 * - Policy reference citations
 * - Evidence-linked arguments
 * - Professional language templates
 * 
 * Goal: Higher approval rate per dollar of discrepancy
 */

import logger from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type ReimbursementCategory =
    | 'WAREHOUSE_LOST'
    | 'WAREHOUSE_DAMAGED'
    | 'INBOUND_LOST'
    | 'INBOUND_DAMAGED'
    | 'CUSTOMER_RETURN_NOT_RECEIVED'
    | 'CUSTOMER_RETURN_NOT_CREDITED'
    | 'FEE_OVERCHARGE'
    | 'REMOVAL_ORDER'
    | 'DISPOSAL_WITHOUT_REQUEST'
    | 'GENERAL_ADJUSTMENT';

export interface ClaimArgument {
    category: ReimbursementCategory;
    subject_line: string;
    opening_statement: string;
    policy_reference: string;
    evidence_summary: string;
    requested_action: string;
    closing_statement: string;
    full_argument: string;

    // Metadata
    confidence_score: number;
    evidence_strength: 'strong' | 'moderate' | 'weak';
    escalation_ready: boolean;
}

export interface ClaimContext {
    anomaly_type: string;
    seller_name?: string;
    seller_id: string;
    order_id?: string;
    shipment_id?: string;
    sku?: string;
    asin?: string;
    product_name?: string;
    quantity: number;
    unit_cost: number;
    total_value: number;
    currency: string;
    event_date: string;
    discovery_date: string;
    evidence_documents: Array<{
        type: string;
        file_name: string;
        key_data?: any;
    }>;
}

// ============================================================================
// Policy References
// ============================================================================

const AMAZON_POLICIES: Record<ReimbursementCategory, {
    policy_name: string;
    policy_section: string;
    policy_text: string;
}> = {
    'WAREHOUSE_LOST': {
        policy_name: 'FBA Lost Inventory Reimbursement Policy',
        policy_section: 'Section 2.1 - Lost Inventory',
        policy_text: 'Amazon will reimburse sellers for inventory that is lost while in Amazon fulfillment centers. The reimbursement will be based on the manufacturing cost or fair market value of the item.'
    },
    'WAREHOUSE_DAMAGED': {
        policy_name: 'FBA Damaged Inventory Reimbursement Policy',
        policy_section: 'Section 2.2 - Damaged Inventory',
        policy_text: 'Amazon will reimburse sellers for inventory that is damaged while in Amazon fulfillment centers at no fault of the seller. Documentation of the original condition may be required.'
    },
    'INBOUND_LOST': {
        policy_name: 'FBA Inbound Shipment Policy',
        policy_section: 'Section 4.1 - Lost Inbound Shipments',
        policy_text: 'Sellers may request reimbursement for units that were shipped to Amazon but not received or reconciled within the expected timeframe.'
    },
    'INBOUND_DAMAGED': {
        policy_name: 'FBA Inbound Shipment Policy',
        policy_section: 'Section 4.2 - Damaged Inbound Shipments',
        policy_text: 'Amazon will reimburse sellers for inventory damaged during the inbound receiving process when damage is not attributable to inadequate packaging.'
    },
    'CUSTOMER_RETURN_NOT_RECEIVED': {
        policy_name: 'FBA Customer Returns Policy',
        policy_section: 'Section 3.1 - Return Processing',
        policy_text: 'Sellers are entitled to reimbursement when a customer return refund is issued but the returned item is never received at the fulfillment center within 45 days.'
    },
    'CUSTOMER_RETURN_NOT_CREDITED': {
        policy_name: 'FBA Customer Returns Policy',
        policy_section: 'Section 3.2 - Return Credit',
        policy_text: 'When a returned item is received but not properly credited to seller inventory, the seller may request investigation and reimbursement.'
    },
    'FEE_OVERCHARGE': {
        policy_name: 'FBA Fee Schedule and Policies',
        policy_section: 'Section 1 - Fee Accuracy',
        policy_text: 'Sellers may dispute fulfillment fees that do not align with the published fee schedule based on verified product dimensions and weight.'
    },
    'REMOVAL_ORDER': {
        policy_name: 'FBA Removal Order Policy',
        policy_section: 'Section 5.1 - Removal Processing',
        policy_text: 'Sellers are entitled to reimbursement for items in removal orders that are not returned to the seller or disposed of as requested.'
    },
    'DISPOSAL_WITHOUT_REQUEST': {
        policy_name: 'FBA Inventory Disposal Policy',
        policy_section: 'Section 5.3 - Unauthorized Disposal',
        policy_text: 'Inventory disposed of without seller authorization or before the end of the storage period may be subject to reimbursement.'
    },
    'GENERAL_ADJUSTMENT': {
        policy_name: 'FBA General Adjustment Policy',
        policy_section: 'General Terms',
        policy_text: 'Sellers may request review and adjustment for any financial discrepancy related to FBA fulfillment services.'
    }
};

// ============================================================================
// Argument Templates
// ============================================================================

const ARGUMENT_TEMPLATES = {
    'WAREHOUSE_LOST': {
        subject: 'Reimbursement Request: Lost Inventory - {sku} ({quantity} units)',
        opening: 'I am writing to request reimbursement for {quantity} units of {product_name} (SKU: {sku}, ASIN: {asin}) that were lost while in Amazon fulfillment center custody.',
        action: 'I respectfully request reimbursement of {amount} {currency} for the {quantity} lost units based on the attached invoice documentation showing a unit cost of {unit_cost} {currency}.'
    },
    'WAREHOUSE_DAMAGED': {
        subject: 'Reimbursement Request: Warehouse Damaged Inventory - {sku}',
        opening: 'I am requesting reimbursement for {quantity} units of {product_name} (SKU: {sku}) that were damaged while stored in Amazon fulfillment centers.',
        action: 'Please process reimbursement of {amount} {currency} for the damaged inventory. Photos and invoice documentation are attached as evidence.'
    },
    'INBOUND_LOST': {
        subject: 'Inbound Shipment Discrepancy - Shipment {shipment_id}',
        opening: 'I am reporting a discrepancy for inbound shipment {shipment_id}. Records indicate {quantity} units of {product_name} (SKU: {sku}) were shipped but not received.',
        action: 'I request investigation and reimbursement of {amount} {currency} for the missing units. Bill of Lading and packing slip are attached.'
    },
    'INBOUND_DAMAGED': {
        subject: 'Inbound Damaged Units - Shipment {shipment_id}',
        opening: 'I am requesting reimbursement for {quantity} units of {product_name} that were received damaged during inbound processing for shipment {shipment_id}.',
        action: 'Please reimburse {amount} {currency}. The units were properly packaged per Amazon guidelines as documented in the attached photos.'
    },
    'CUSTOMER_RETURN_NOT_RECEIVED': {
        subject: 'Customer Return Not Received - Order {order_id}',
        opening: 'I am requesting reimbursement for a customer return that was never received. Order {order_id} was refunded on {event_date}, but the item has not been returned to inventory after 45+ days.',
        action: 'Per Amazon policy, I request reimbursement of {amount} {currency} for the unreturned item. Refund events are documented in Seller Central reports.'
    },
    'CUSTOMER_RETURN_NOT_CREDITED': {
        subject: 'Return Received But Not Credited - Order {order_id}',
        opening: 'A customer return for Order {order_id} was received at the fulfillment center but was never credited back to my inventory or reimbursed.',
        action: 'I request investigation and reimbursement of {amount} {currency} for this item. Return receipt documentation is attached.'
    },
    'FEE_OVERCHARGE': {
        subject: 'Fee Dispute: Fulfillment Fee Overcharge - {sku}',
        opening: 'I am disputing the fulfillment fees charged for {product_name} (SKU: {sku}). Based on verified dimensions and weight, the correct fee should be lower than what was charged.',
        action: 'I request a fee adjustment of {amount} {currency}. Dimension certificate and weight documentation are attached as evidence.'
    },
    'REMOVAL_ORDER': {
        subject: 'Removal Order Discrepancy - {quantity} Units Missing',
        opening: 'I submitted a removal order for {quantity} units of {product_name} (SKU: {sku}), but the units were never received at the specified address.',
        action: 'I request reimbursement of {amount} {currency} for the missing units from the incomplete removal order.'
    },
    'DISPOSAL_WITHOUT_REQUEST': {
        subject: 'Unauthorized Disposal of Inventory - {sku}',
        opening: 'I am reporting that {quantity} units of {product_name} (SKU: {sku}) were disposed of without my authorization.',
        action: 'I request immediate reimbursement of {amount} {currency} for this unauthorized disposal. I did not request disposal and had active inventory that should not have been destroyed.'
    },
    'GENERAL_ADJUSTMENT': {
        subject: 'Adjustment Request: {sku}',
        opening: 'I am requesting a financial adjustment for a discrepancy related to {product_name} (SKU: {sku}), Order: {order_id}.',
        action: 'I request investigation and adjustment of {amount} {currency}. Supporting documentation is attached.'
    }
};

// ============================================================================
// Category Mapping
// ============================================================================

function getReimbursementCategory(anomalyType: string): ReimbursementCategory {
    const mapping: Record<string, ReimbursementCategory> = {
        'lost_warehouse': 'WAREHOUSE_LOST',
        'missing_unit': 'WAREHOUSE_LOST',
        'damaged_warehouse': 'WAREHOUSE_DAMAGED',
        'damaged_stock': 'WAREHOUSE_DAMAGED',
        'lost_inbound': 'INBOUND_LOST',
        'damaged_inbound': 'INBOUND_DAMAGED',
        'refund_no_return': 'CUSTOMER_RETURN_NOT_RECEIVED',
        'return_not_restocked': 'CUSTOMER_RETURN_NOT_CREDITED',
        'customer_return': 'CUSTOMER_RETURN_NOT_CREDITED',
        'weight_fee_overcharge': 'FEE_OVERCHARGE',
        'fulfillment_fee_error': 'FEE_OVERCHARGE',
        'storage_overcharge': 'FEE_OVERCHARGE',
        'commission_overcharge': 'FEE_OVERCHARGE',
        'removal_fee_error': 'REMOVAL_ORDER',
        'destroyed_without_consent': 'DISPOSAL_WITHOUT_REQUEST',
    };

    return mapping[anomalyType] || 'GENERAL_ADJUSTMENT';
}

// ============================================================================
// Argument Generation
// ============================================================================

/**
 * Generate a policy-aware claim argument
 */
export function generateClaimArgument(context: ClaimContext): ClaimArgument {
    const category = getReimbursementCategory(context.anomaly_type);
    const policy = AMAZON_POLICIES[category];
    const template = ARGUMENT_TEMPLATES[category];

    // Helper to replace placeholders
    const replacePlaceholders = (text: string): string => {
        return text
            .replace('{sku}', context.sku || 'N/A')
            .replace('{asin}', context.asin || 'N/A')
            .replace('{product_name}', context.product_name || context.sku || 'Product')
            .replace('{quantity}', context.quantity.toString())
            .replace('{unit_cost}', context.unit_cost.toFixed(2))
            .replace('{amount}', context.total_value.toFixed(2))
            .replace('{currency}', context.currency)
            .replace('{order_id}', context.order_id || 'N/A')
            .replace('{shipment_id}', context.shipment_id || 'N/A')
            .replace('{event_date}', context.event_date.substring(0, 10))
            .replace('{seller_name}', context.seller_name || 'Seller');
    };

    // Build subject line
    const subject_line = replacePlaceholders(template.subject);

    // Build opening statement
    const opening_statement = replacePlaceholders(template.opening);

    // Build policy reference
    const policy_reference = `Per the ${policy.policy_name} (${policy.policy_section}): "${policy.policy_text}"`;

    // Build evidence summary
    let evidence_summary = 'Supporting documentation attached:\n';
    for (const doc of context.evidence_documents) {
        evidence_summary += `- ${doc.type}: ${doc.file_name}\n`;
    }
    if (context.evidence_documents.length === 0) {
        evidence_summary = 'Please refer to the transaction records in Seller Central.';
    }

    // Build requested action
    const requested_action = replacePlaceholders(template.action);

    // Build closing statement
    const closing_statement = 'Thank you for your prompt attention to this matter. I look forward to a timely resolution. Please do not hesitate to contact me if additional information is required.';

    // Assemble full argument
    const full_argument = `${opening_statement}\n\n${policy_reference}\n\n${evidence_summary}\n${requested_action}\n\n${closing_statement}`;

    // Calculate evidence strength
    let evidence_strength: 'strong' | 'moderate' | 'weak' = 'weak';
    const docCount = context.evidence_documents.length;
    if (docCount >= 3) evidence_strength = 'strong';
    else if (docCount >= 1) evidence_strength = 'moderate';

    // Calculate confidence
    let confidence_score = 0.5;
    if (evidence_strength === 'strong') confidence_score = 0.9;
    else if (evidence_strength === 'moderate') confidence_score = 0.75;

    // Check if escalation-ready
    const escalation_ready = evidence_strength === 'strong' && context.total_value >= 100;

    const argument: ClaimArgument = {
        category,
        subject_line,
        opening_statement,
        policy_reference,
        evidence_summary,
        requested_action,
        closing_statement,
        full_argument,
        confidence_score,
        evidence_strength,
        escalation_ready
    };

    logger.info('[ARGUMENT GENERATOR] Claim argument generated', {
        anomalyType: context.anomaly_type,
        category,
        evidenceStrength: evidence_strength,
        totalValue: context.total_value
    });

    return argument;
}

/**
 * Generate escalation argument (for denied claims)
 */
export function generateEscalationArgument(
    originalArgument: ClaimArgument,
    denialReason: string
): string {
    return `
I am respectfully requesting escalation of my previous reimbursement request.

ORIGINAL REQUEST:
${originalArgument.opening_statement}

DENIAL RESPONSE:
"${denialReason}"

ESCALATION ARGUMENT:
I understand Amazon's initial determination, however I believe this case warrants further review based on the following:

1. POLICY COMPLIANCE: ${originalArgument.policy_reference}

2. EVIDENCE PROVIDED: ${originalArgument.evidence_summary}

3. DOCUMENTATION: All supporting documents have been provided and verify the accuracy of my claim.

I kindly request that this case be reviewed by a senior member of the reimbursement team. The attached evidence clearly demonstrates the validity of this reimbursement request.

${originalArgument.closing_statement}
`;
}

/**
 * Get the correct reimbursement category for display
 */
export function getCategoryDisplayName(category: ReimbursementCategory): string {
    const names: Record<ReimbursementCategory, string> = {
        'WAREHOUSE_LOST': 'Lost Inventory - Fulfillment Center',
        'WAREHOUSE_DAMAGED': 'Damaged Inventory - Fulfillment Center',
        'INBOUND_LOST': 'Lost Inbound Shipment',
        'INBOUND_DAMAGED': 'Damaged Inbound Shipment',
        'CUSTOMER_RETURN_NOT_RECEIVED': 'Customer Return - Not Received',
        'CUSTOMER_RETURN_NOT_CREDITED': 'Customer Return - Not Credited',
        'FEE_OVERCHARGE': 'Fee Dispute',
        'REMOVAL_ORDER': 'Removal Order Discrepancy',
        'DISPOSAL_WITHOUT_REQUEST': 'Unauthorized Disposal',
        'GENERAL_ADJUSTMENT': 'General Adjustment Request'
    };

    return names[category] || 'Reimbursement Request';
}

export default {
    generateClaimArgument,
    generateEscalationArgument,
    getReimbursementCategory,
    getCategoryDisplayName,
    AMAZON_POLICIES
};
