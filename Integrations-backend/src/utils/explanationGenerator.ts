/**
 * Explanation Generator
 * 
 * Generates human-readable financial explanations for detections.
 * Every detection gets a structured explanation object.
 */

export interface DetectionExplanation {
    detectionId: string;
    anomalyType: string;

    // Core explanation
    summary: string;                    // One-line summary
    rootCause: string;                  // Why this happened
    evidence: string[];                 // Supporting data points

    // Financial impact
    estimatedRecovery: number;
    currency: string;
    confidence: number;
    recoveryProbability: number;

    // Action guidance
    recommendedAction: string;
    urgency: 'low' | 'medium' | 'high' | 'critical';
    windowRemaining?: string;           // Time to file claim
}

// Explanation templates by anomaly type
const EXPLANATION_TEMPLATES: Record<string, {
    summary: (ctx: any) => string;
    rootCause: (ctx: any) => string;
    evidence: (ctx: any) => string[];
    action: (ctx: any) => string;
}> = {
    lost_inventory: {
        summary: (ctx) => `${ctx.quantity} unit(s) of ${ctx.sku || 'product'} were received by Amazon but never appeared in your inventory.`,
        rootCause: (ctx) => `Amazon's fulfillment center received shipment ${ctx.shipmentId || 'FBA'} but failed to properly reconcile ${ctx.quantity} unit(s). This typically occurs during warehouse transfers or receiving errors.`,
        evidence: (ctx) => [
            `Shipment ID: ${ctx.shipmentId || 'N/A'}`,
            `Units shipped: ${ctx.unitsShipped || ctx.quantity}`,
            `Units received: ${ctx.unitsReceived || 0}`,
            `Discrepancy: ${ctx.quantity} units`,
            `Date: ${ctx.date || 'Recent'}`
        ],
        action: (ctx) => `File reimbursement claim for ${ctx.quantity} lost unit(s) valued at $${(ctx.amount || 0).toFixed(2)}`
    },

    refund_without_return: {
        summary: (ctx) => `Customer received a $${(ctx.amount || 0).toFixed(2)} refund but never returned the product.`,
        rootCause: (ctx) => `Order ${ctx.orderId || 'N/A'} was refunded ${ctx.daysSinceRefund || 45}+ days ago. Amazon's policy requires returns within 45 days. Customer kept both the refund and the product.`,
        evidence: (ctx) => [
            `Order ID: ${ctx.orderId || 'N/A'}`,
            `Refund amount: $${(ctx.amount || 0).toFixed(2)}`,
            `Refund date: ${ctx.refundDate || 'N/A'}`,
            `Return received: No`,
            `Days since refund: ${ctx.daysSinceRefund || 45}+`
        ],
        action: (ctx) => `Claim reimbursement for unreturned item ($${(ctx.amount || 0).toFixed(2)})`
    },

    damaged_inventory: {
        summary: (ctx) => `${ctx.quantity} unit(s) were damaged at Amazon's warehouse, not your fault.`,
        rootCause: (ctx) => `Product ${ctx.sku || 'N/A'} sustained damage while stored or handled at Amazon's fulfillment center. Amazon is responsible for warehouse-caused damage.`,
        evidence: (ctx) => [
            `SKU: ${ctx.sku || 'N/A'}`,
            `Units damaged: ${ctx.quantity}`,
            `Damage code: ${ctx.damageCode || 'WAREHOUSE'}`,
            `Estimated value: $${(ctx.amount || 0).toFixed(2)}`
        ],
        action: (ctx) => `File claim for warehouse-damaged inventory ($${(ctx.amount || 0).toFixed(2)})`
    },

    fee_overcharge: {
        summary: (ctx) => `You were overcharged $${(ctx.amount || 0).toFixed(2)} in FBA fees due to incorrect product dimensions.`,
        rootCause: (ctx) => `Amazon classified ${ctx.sku || 'product'} using incorrect weight/dimensions, placing it in a higher fee tier than warranted.`,
        evidence: (ctx) => [
            `SKU: ${ctx.sku || 'N/A'}`,
            `Charged fee tier: ${ctx.chargedTier || 'Large'}`,
            `Correct fee tier: ${ctx.correctTier || 'Standard'}`,
            `Overcharge per unit: $${(ctx.overchargePerUnit || 0).toFixed(2)}`,
            `Total overcharge: $${(ctx.amount || 0).toFixed(2)}`
        ],
        action: (ctx) => `Request dimension/weight verification and fee correction`
    },

    chargeback_dispute: {
        summary: (ctx) => `Defensible chargeback: delivery proof exists for disputed order.`,
        rootCause: (ctx) => `Customer disputed order ${ctx.orderId || 'N/A'} claiming non-receipt, but tracking shows successful delivery on ${ctx.deliveryDate || 'N/A'}.`,
        evidence: (ctx) => [
            `Order ID: ${ctx.orderId || 'N/A'}`,
            `Dispute amount: $${(ctx.amount || 0).toFixed(2)}`,
            `Delivery confirmed: ${ctx.deliveryDate || 'Yes'}`,
            `Carrier: ${ctx.carrier || 'Amazon Logistics'}`,
            `Tracking: ${ctx.trackingNumber || 'Available'}`
        ],
        action: (ctx) => `Submit delivery proof to reverse chargeback`
    },

    reimbursement_underpayment: {
        summary: (ctx) => `Amazon's reimbursement was $${(ctx.shortfall || 0).toFixed(2)} less than the fair value.`,
        rootCause: (ctx) => `Reimbursement for ${ctx.sku || 'product'} was calculated using outdated or incorrect pricing data.`,
        evidence: (ctx) => [
            `Expected: $${(ctx.expectedAmount || 0).toFixed(2)}`,
            `Received: $${(ctx.actualAmount || 0).toFixed(2)}`,
            `Shortfall: $${(ctx.shortfall || 0).toFixed(2)}`
        ],
        action: (ctx) => `File appeal for additional $${(ctx.shortfall || 0).toFixed(2)}`
    },

    default: {
        summary: (ctx) => `Potential recovery opportunity: $${(ctx.amount || 0).toFixed(2)}`,
        rootCause: (ctx) => `Discrepancy detected in Amazon's financial records that may warrant a reimbursement claim.`,
        evidence: (ctx) => [
            `Type: ${ctx.anomalyType || 'Unknown'}`,
            `Amount: $${(ctx.amount || 0).toFixed(2)}`
        ],
        action: (ctx) => `Review and file claim if applicable`
    }
};

/**
 * Generate explanation for a detection result
 */
export function generateExplanation(
    detectionId: string,
    anomalyType: string,
    amount: number,
    confidence: number,
    context: Record<string, any> = {}
): DetectionExplanation {
    // Normalize anomaly type
    const normalizedType = anomalyType.toLowerCase().replace(/\s+/g, '_');

    // Get template or use default
    const template = EXPLANATION_TEMPLATES[normalizedType] || EXPLANATION_TEMPLATES.default;

    // Build context object
    const ctx = {
        amount,
        confidence,
        anomalyType,
        ...context
    };

    // Calculate urgency based on amount and confidence
    let urgency: 'low' | 'medium' | 'high' | 'critical';
    if (amount >= 500 || confidence >= 0.95) {
        urgency = 'critical';
    } else if (amount >= 100 || confidence >= 0.85) {
        urgency = 'high';
    } else if (amount >= 25 || confidence >= 0.7) {
        urgency = 'medium';
    } else {
        urgency = 'low';
    }

    // Calculate recovery probability (conservative)
    const recoveryProbability = Math.min(confidence * 0.9, 0.95);

    return {
        detectionId,
        anomalyType,
        summary: template.summary(ctx),
        rootCause: template.rootCause(ctx),
        evidence: template.evidence(ctx),
        estimatedRecovery: amount,
        currency: 'USD',
        confidence,
        recoveryProbability,
        recommendedAction: template.action(ctx),
        urgency,
        windowRemaining: context.daysRemaining ? `${context.daysRemaining} days` : undefined
    };
}

/**
 * Generate batch explanations
 */
export function generateBatchExplanations(
    detections: Array<{
        id: string;
        anomalyType: string;
        amount: number;
        confidence: number;
        context?: Record<string, any>;
    }>
): DetectionExplanation[] {
    return detections.map(d =>
        generateExplanation(d.id, d.anomalyType, d.amount, d.confidence, d.context)
    );
}

export default { generateExplanation, generateBatchExplanations };
