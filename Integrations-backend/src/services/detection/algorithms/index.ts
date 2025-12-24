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

// P1 Priority - Fee Overcharges
export * from './feeAlgorithms';
export { default as feeAlgorithms } from './feeAlgorithms';

// P2 Priority - Chargebacks/Disputes
export * from './chargebackAlgorithms';
export { default as chargebackAlgorithms } from './chargebackAlgorithms';

// Algorithm Registry - maps anomaly types to detection functions
import { detectLostInventory } from './inventoryAlgorithms';
import { detectRefundWithoutReturn } from './refundAlgorithms';
import {
    detectFulfillmentFeeOvercharge,
    detectStorageFeeOvercharge,
    detectCommissionOvercharge,
    detectAllFeeOvercharges
} from './feeAlgorithms';
import {
    detectDefensibleChargebacks,
    detectAtoZClaims
} from './chargebackAlgorithms';

export const algorithmRegistry = {
    // P0 - Inventory
    'lost_warehouse': detectLostInventory,
    'damaged_warehouse': detectLostInventory,
    'lost_inbound': detectLostInventory,
    'damaged_inbound': detectLostInventory,

    // P0 - Refunds
    'refund_no_return': detectRefundWithoutReturn,

    // P1 - Fees
    'fulfillment_fee_error': detectFulfillmentFeeOvercharge,
    'weight_fee_overcharge': detectFulfillmentFeeOvercharge,
    'storage_overcharge': detectStorageFeeOvercharge,
    'lts_overcharge': detectStorageFeeOvercharge,
    'commission_overcharge': detectCommissionOvercharge,
    'referral_fee_error': detectCommissionOvercharge,
    'all_fee_overcharges': detectAllFeeOvercharges,

    // P2 - Chargebacks/Disputes
    'chargeback': detectDefensibleChargebacks,
    'atoz_claim': detectAtoZClaims,
    'safet_claim': detectDefensibleChargebacks,
    'inr_claim': detectDefensibleChargebacks,
    'undefended_dispute': detectDefensibleChargebacks,
};

export type RegisteredAnomalyType = keyof typeof algorithmRegistry;
