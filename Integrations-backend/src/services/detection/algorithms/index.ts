/**
 * Detection Algorithms Registry - Agent 3's Complete Brain
 * 
 * Central export for all detection algorithm modules.
 * Each module implements specialized detection logic for specific anomaly types.
 * 
 * THE FULL ARSENAL:
 * - P0 Trinity: Whale Hunter + Refund Trap + Broken Goods Hunter
 * - P1: Fee Auditor
 * - P2: Dispute Defender
 * - P3: Ad Auditor
 */

// P0 Priority - THE TRINITY (Highest Value Detections)
export * from './inventoryAlgorithms';
export { default as inventoryAlgorithms } from './inventoryAlgorithms';

export * from './refundAlgorithms';
export { default as refundAlgorithms } from './refundAlgorithms';

export * from './damagedAlgorithms';
export { default as damagedAlgorithms } from './damagedAlgorithms';

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
import { detectDamagedInventory } from './damagedAlgorithms';
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
    // P0 Trinity - Inventory
    'lost_warehouse': detectLostInventory,
    'lost_inbound': detectLostInventory,

    // P0 Trinity - Damaged (Broken Goods Hunter)
    'damaged_warehouse': detectDamagedInventory,
    'damaged_inbound': detectDamagedInventory,
    'damaged_removal': detectDamagedInventory,

    // P0 Trinity - Refunds
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
// THE COMPLETE ARSENAL - Agent 3 Detection Capabilities
// ============================================================================
//
// 🐋 WHALE HUNTER (inventoryAlgorithms.ts)
//    Formula: Input - Output vs WarehouseBalance
//    - Lost warehouse inventory
//    - Lost inbound shipments
//
// 💥 BROKEN GOODS HUNTER (damagedAlgorithms.ts)  ← NEW!
//    Rule: Amazon fault codes (E, M, Q, K, H) + No reimbursement > 45 days
//    - Damaged warehouse inventory
//    - Damaged inbound shipments
//    - Damaged during removal
//
// 🪤 REFUND TRAP (refundAlgorithms.ts)
//    Rule: Refund > 45 days + No Return + No Reimbursement
//    - Refunds without returns
//
// 💰 FEE AUDITOR (feeAlgorithms.ts)
//    - Fulfillment fee overcharges
//    - Weight/dimensional fee errors
//    - Storage fee overcharges
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
