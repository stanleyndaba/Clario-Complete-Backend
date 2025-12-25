/**
 * Detection Algorithms Registry - Agent 3's Complete Brain
 * 
 * THE FULL ARSENAL - 9 Algorithm Modules, 50+ Anomaly Types
 * 
 * P0 Trinity: Whale Hunter + Refund Trap + Broken Goods Hunter
 * P1: Fee Auditor
 * P2: Dispute Defender
 * P3: Ad Auditor
 * Clusters: Inbound Inspector + Removal Tracker + Fraud Hunter
 */

// =====================================================
// MODULE EXPORTS - Detection Functions Only
// (Avoiding duplicate interface exports across modules)
// =====================================================

// P0 Priority - THE TRINITY
export { detectLostInventory } from './inventoryAlgorithms';
export { default as inventoryAlgorithms } from './inventoryAlgorithms';

export { detectRefundWithoutReturn, fetchReturnEvents, fetchReimbursementEvents } from './refundAlgorithms';
export { default as refundAlgorithms } from './refundAlgorithms';

export { detectDamagedInventory } from './damagedAlgorithms';
export { default as damagedAlgorithms } from './damagedAlgorithms';

// P1 Priority - Fee Overcharges
export { detectAllFeeOvercharges } from './feeAlgorithms';
export { default as feeAlgorithms } from './feeAlgorithms';

// P2 Priority - Chargebacks/Disputes
export { detectDefensibleChargebacks } from './chargebackAlgorithms';
export { default as chargebackAlgorithms } from './chargebackAlgorithms';

// P3 Priority - Advertising/Promotions
export { detectAllAdvertisingErrors } from './advertisingAlgorithms';
export { default as advertisingAlgorithms } from './advertisingAlgorithms';

// CLUSTER 1 - Inbound & Receiving
export { detectInboundAnomalies } from './inboundAlgorithms';
export { default as inboundAlgorithms } from './inboundAlgorithms';

// CLUSTER 2 - Removal & Disposal
export { detectRemovalAnomalies } from './removalAlgorithms';
export { default as removalAlgorithms } from './removalAlgorithms';

// CLUSTER 3 - Fraud & Fulfillment Errors
export { detectFraudAnomalies } from './fraudAlgorithms';
export { default as fraudAlgorithms } from './fraudAlgorithms';

// Algorithm Registry
import { detectLostInventory } from './inventoryAlgorithms';
import { detectRefundWithoutReturn } from './refundAlgorithms';
import { detectDamagedInventory } from './damagedAlgorithms';
import { detectAllFeeOvercharges } from './feeAlgorithms';
import { detectDefensibleChargebacks } from './chargebackAlgorithms';
import { detectAllAdvertisingErrors } from './advertisingAlgorithms';
import { detectInboundAnomalies } from './inboundAlgorithms';
import { detectRemovalAnomalies } from './removalAlgorithms';
import { detectFraudAnomalies } from './fraudAlgorithms';

export const algorithmRegistry = {
    // P0 Trinity
    'lost_warehouse': detectLostInventory, 'lost_inbound': detectLostInventory,
    'damaged_warehouse': detectDamagedInventory, 'damaged_inbound': detectDamagedInventory, 'damaged_removal': detectDamagedInventory,
    'refund_no_return': detectRefundWithoutReturn,

    // P1 Fees
    'all_fee_overcharges': detectAllFeeOvercharges,

    // P2 Disputes
    'chargeback': detectDefensibleChargebacks, 'atoz_claim': detectDefensibleChargebacks,

    // P3 Advertising
    'all_advertising_errors': detectAllAdvertisingErrors,

    // Cluster 1 - Inbound
    'shipment_missing': detectInboundAnomalies, 'shipment_shortage': detectInboundAnomalies,
    'receiving_error': detectInboundAnomalies, 'carrier_damage': detectInboundAnomalies,

    // Cluster 2 - Removal
    'removal_unfulfilled': detectRemovalAnomalies, 'disposal_error': detectRemovalAnomalies,
    'removal_order_lost': detectRemovalAnomalies, 'removal_quantity_mismatch': detectRemovalAnomalies,

    // Cluster 3 - Fraud
    'customer_return_fraud': detectFraudAnomalies, 'switcheroo': detectFraudAnomalies,
    'wrong_item_returned': detectFraudAnomalies, 'returnless_refund_abuse': detectFraudAnomalies,
};

export type RegisteredAnomalyType = keyof typeof algorithmRegistry;
