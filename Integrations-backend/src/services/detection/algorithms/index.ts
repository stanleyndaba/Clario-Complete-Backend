/**
 * Detection Algorithms Registry
 * 
 * Central export for all detection algorithm modules.
 * Each module implements specialized detection logic for specific anomaly types.
 */

// P0 Priority - Highest Value Detections
export * from './inventoryAlgorithms';
export { default as inventoryAlgorithms } from './inventoryAlgorithms';

// Future P1 Priority - Fee Overcharges
// export * from './feeAlgorithms';

// Future P2 Priority - Chargebacks/Disputes
// export * from './chargebackAlgorithms';

// Future P3 Priority - Refunds/Returns
// export * from './refundAlgorithms';

// Algorithm Registry - maps anomaly types to detection functions
import { detectLostInventory } from './inventoryAlgorithms';

export const algorithmRegistry = {
    // P0 - Inventory
    'lost_warehouse': detectLostInventory,
    'damaged_warehouse': detectLostInventory, // Uses same base algorithm
    'lost_inbound': detectLostInventory,
    'damaged_inbound': detectLostInventory,

    // P1 - Fees (to be implemented)
    // 'weight_fee_overcharge': detectFeeOvercharge,
    // 'fulfillment_fee_error': detectFeeOvercharge,

    // P2 - Chargebacks (to be implemented)
    // 'chargeback': detectChargeback,
    // 'atoz_claim': detectAtoZClaim,
};

export type RegisteredAnomalyType = keyof typeof algorithmRegistry;
