/**
 * Detection Algorithms Registry - Agent 3's Complete Brain
 * 
 * Central export for all detection algorithm modules.
 * Each module implements specialized detection logic for specific anomaly types.
 * 
 * Current Capabilities:
 * - P0: Inventory (Whale Hunter) + Refunds (Refund Trap)
 * - P1: Fees (Fee Auditor)
 * - P2: Chargebacks/Disputes (Dispute Defender)
 * - P3: Advertising/Promotions (Ad Auditor)
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

// P3 Priority - Advertising/Promotions
export * from './advertisingAlgorithms';
export { default as advertisingAlgorithms } from './advertisingAlgorithms';

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
import {
    detectCouponErrors,
    detectDealFeeErrors,
    detectSubscribeSaveErrors,
    detectAllAdvertisingErrors
} from './advertisingAlgorithms';

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

    // P3 - Advertising/Promotions
    'coupon_overapplied': detectCouponErrors,
    'promotion_stacking_error': detectCouponErrors,
    'lightning_deal_fee_error': detectDealFeeErrors,
    'deal_fee_error': detectDealFeeErrors,
    'subscribe_save_error': detectSubscribeSaveErrors,
    'all_advertising_errors': detectAllAdvertisingErrors,
};

export type RegisteredAnomalyType = keyof typeof algorithmRegistry;

// ============================================================================
// Summary: Agent 3 Detection Capabilities
// ============================================================================
//
// 🐋 WHALE HUNTER (inventoryAlgorithms.ts)
//    - Lost warehouse inventory
//    - Damaged warehouse inventory
//    - Lost inbound shipments
//    - Damaged inbound shipments
//
// 🪤 REFUND TRAP (refundAlgorithms.ts)
//    - Refunds without returns (45-day rule)
//    - Restocking fee errors
//    - Refund commission errors
//
// 💰 FEE AUDITOR (feeAlgorithms.ts)
//    - Fulfillment fee overcharges
//    - Weight/dimensional fee errors
//    - Storage fee overcharges (monthly + Q4 + LTS)
//    - Commission/referral fee errors
//
// 🛡️ DISPUTE DEFENDER (chargebackAlgorithms.ts)
//    - Credit card chargebacks
//    - A-to-Z claims
//    - SAFE-T claims
//    - INR claims with delivery proof
//
// 📢 AD AUDITOR (advertisingAlgorithms.ts)
//    - Coupon over-application
//    - Promotion stacking errors
//    - Lightning Deal fee errors
//    - Subscribe & Save discount errors
// ============================================================================
