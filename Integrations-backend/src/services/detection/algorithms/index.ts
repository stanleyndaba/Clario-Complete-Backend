/**
 * Detection Algorithms Registry
 * 
 * Central export for all detection algorithm modules.
 * Each module implements specialized detection logic for specific anomaly types.
 */

// P0 Priority - Highest Value Detections
export * from './inventoryAlgorithms';
export { default as inventoryAlgorithms } from './inventoryAlgorithms';

export * from './refundAlgorithms';
export { default as refundAlgorithms } from './refundAlgorithms';

// Future P1 Priority - Fee Overcharges
// export * from './feeAlgorithms';

// Future P2 Priority - Chargebacks/Disputes
// export * from './chargebackAlgorithms';

// Algorithm Registry - maps anomaly types to detection functions
import { detectLostInventory } from './inventoryAlgorithms';
import { detectRefundWithoutReturn } from './refundAlgorithms';

export const algorithmRegistry = {
    // P0 - Inventory
    'lost_warehouse': detectLostInventory,
    'damaged_warehouse': detectLostInventory,
    'lost_inbound': detectLostInventory,
    'damaged_inbound': detectLostInventory,

    // P0 - Refunds
    'refund_no_return': detectRefundWithoutReturn,

    // P1 - Fees (to be implemented)
    // 'weight_fee_overcharge': detectFeeOvercharge,
    // 'fulfillment_fee_error': detectFeeOvercharge,

    // P2 - Chargebacks (to be implemented)
    // 'chargeback': detectChargeback,
    // 'atoz_claim': detectAtoZClaim,
};

export type RegisteredAnomalyType = keyof typeof algorithmRegistry;
