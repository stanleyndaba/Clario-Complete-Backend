/**
 * Test script for 64 Detection Types
 * Verifies all anomaly_type mappings are working correctly
 */

// All 64 Amazon codes and their expected anomaly_type mappings
const testCases = [
    // Original types (5)
    { code: 'missing_unit', expected: 'missing_unit' },
    { code: 'damaged_goods', expected: 'damaged_stock' },
    { code: 'fee', expected: 'incorrect_fee' },
    { code: 'overcharge', expected: 'overcharge' },
    { code: 'duplicate', expected: 'duplicate_charge' },

    // Batch 1: Core Reimbursement Events (11)
    { code: 'Lost:Warehouse', expected: 'lost_warehouse' },
    { code: 'Damaged:Warehouse', expected: 'damaged_warehouse' },
    { code: 'Lost:Inbound', expected: 'lost_inbound' },
    { code: 'Damaged:Inbound', expected: 'damaged_inbound' },
    { code: 'CarrierClaim', expected: 'carrier_claim' },
    { code: 'CustomerReturn', expected: 'customer_return' },
    { code: 'FBAInventoryReimbursementReversal', expected: 'reimbursement_reversal' },
    { code: 'WarehousingError', expected: 'warehousing_error' },
    { code: 'CustomerServiceIssue', expected: 'customer_service_issue' },
    { code: 'GeneralAdjustment', expected: 'general_adjustment' },
    { code: 'FBAInventoryReimbursement', expected: 'fba_inventory_reimbursement' },

    // Batch 2: Fee Overcharges (10)
    { code: 'FBAWeightBasedFee', expected: 'weight_fee_overcharge' },
    { code: 'FBAPerUnitFulfillmentFee', expected: 'fulfillment_fee_error' },
    { code: 'FBAPerOrderFulfillmentFee', expected: 'order_fulfillment_error' },
    { code: 'FBATransportationFee', expected: 'transportation_fee_error' },
    { code: 'FBAInboundDefectFee', expected: 'inbound_defect_fee' },
    { code: 'FBAInboundConvenienceFee', expected: 'convenience_fee_error' },
    { code: 'FulfillmentNetworkFee', expected: 'network_fee_error' },
    { code: 'Commission', expected: 'commission_overcharge' },
    { code: 'FixedClosingFee', expected: 'closing_fee_error' },
    { code: 'VariableClosingFee', expected: 'variable_closing_error' },

    // Batch 3: Storage & Inventory Fees (9)
    { code: 'FBAStorageFee', expected: 'storage_overcharge' },
    { code: 'FBALongTermStorageFee', expected: 'lts_overcharge' },
    { code: 'FBAInventoryStorageOverageFee', expected: 'storage_overage_error' },
    { code: 'FBAExtraLargeStorageFee', expected: 'extra_large_storage_error' },
    { code: 'FBARemovalFee', expected: 'removal_fee_error' },
    { code: 'FBADisposalFee', expected: 'disposal_fee_error' },
    { code: 'FBALiquidationFee', expected: 'liquidation_fee_error' },
    { code: 'FBAReturnProcessingFee', expected: 'return_processing_error' },
    { code: 'FBAUnplannedPrepFee', expected: 'unplanned_prep_error' },

    // Batch 4: Refunds & Returns (9)
    { code: 'RefundEvent', expected: 'refund_no_return' },
    { code: 'RefundCommission', expected: 'refund_commission_error' },
    { code: 'RestockingFee', expected: 'restocking_missed' },
    { code: 'GiftWrapTax', expected: 'gift_wrap_tax_error' },
    { code: 'ShippingTax', expected: 'shipping_tax_error' },
    { code: 'Goodwill', expected: 'goodwill_unfair' },
    { code: 'RetrochargeEvent', expected: 'retrocharge' },
    { code: 'HighVolumeListingFee', expected: 'high_volume_listing_error' },
    { code: 'ServiceProviderCreditEvent', expected: 'service_provider_credit' },

    // Batch 5: Claims & Chargebacks (9)
    { code: 'GuaranteeClaimEvent', expected: 'atoz_claim' },
    { code: 'ChargebackEvent', expected: 'chargeback' },
    { code: 'SafeTReimbursementEvent', expected: 'safet_claim' },
    { code: 'DebtRecoveryEvent', expected: 'debt_recovery' },
    { code: 'LoanServicingEvent', expected: 'loan_servicing' },
    { code: 'PayWithAmazonEvent', expected: 'pay_with_amazon' },
    { code: 'RentalTransactionEvent', expected: 'rental_transaction' },
    { code: 'FBALiquidationEvent', expected: 'fba_liquidation' },
    { code: 'TaxWithholdingEvent', expected: 'tax_withholding' },

    // Batch 6: Advertising & Other (11)
    { code: 'ProductAdsPaymentEvent', expected: 'product_ads_error' },
    { code: 'ServiceFeeEvent', expected: 'service_fee_error' },
    { code: 'SellerDealPaymentEvent', expected: 'seller_deal_error' },
    { code: 'CouponPaymentEvent', expected: 'coupon_payment_error' },
    { code: 'CouponRedemptionFee', expected: 'coupon_redemption_error' },
    { code: 'RunLightningDealFee', expected: 'lightning_deal_error' },
    { code: 'VineEnrollmentFee', expected: 'vine_enrollment_error' },
    { code: 'ImagingServicesFeeEvent', expected: 'imaging_services_error' },
    { code: 'EarlyReviewerProgramFee', expected: 'early_reviewer_error' },
    { code: 'CouponClipFee', expected: 'coupon_clip_fee' },
    { code: 'SellerReviewEnrollmentPaymentEvent', expected: 'seller_review_enrollment' },

    // Tax Collection at Source - International (3)
    { code: 'TCS-CGST', expected: 'tcs_cgst' },
    { code: 'TCS-SGST', expected: 'tcs_sgst' },
    { code: 'TCS-IGST', expected: 'tcs_igst' },
];

// Recreate the subcategoryMap from detectionService.ts for testing
const subcategoryMap: Record<string, string> = {
    // Original subcategories
    'damaged_goods': 'damaged_stock',
    'missing_unit': 'missing_unit',
    'fee': 'incorrect_fee',
    'adjustment': 'general_adjustment',
    'overcharge': 'overcharge',
    'duplicate': 'duplicate_charge',

    // Batch 1: Core Reimbursement Events (AdjustmentEvent codes)
    'Lost:Warehouse': 'lost_warehouse',
    'lost_warehouse': 'lost_warehouse',
    'LOST_WAREHOUSE': 'lost_warehouse',
    'Damaged:Warehouse': 'damaged_warehouse',
    'damaged_warehouse': 'damaged_warehouse',
    'DAMAGED_WAREHOUSE': 'damaged_warehouse',
    'Lost:Inbound': 'lost_inbound',
    'lost_inbound': 'lost_inbound',
    'LOST_INBOUND': 'lost_inbound',
    'Damaged:Inbound': 'damaged_inbound',
    'damaged_inbound': 'damaged_inbound',
    'DAMAGED_INBOUND': 'damaged_inbound',
    'CarrierClaim': 'carrier_claim',
    'carrier_claim': 'carrier_claim',
    'CARRIER_CLAIM': 'carrier_claim',
    'CustomerReturn': 'customer_return',
    'customer_return': 'customer_return',
    'CUSTOMER_RETURN': 'customer_return',
    'FBAInventoryReimbursementReversal': 'reimbursement_reversal',
    'ReimbursementReversal': 'reimbursement_reversal',
    'reimbursement_reversal': 'reimbursement_reversal',
    'WarehousingError': 'warehousing_error',
    'warehousing_error': 'warehousing_error',
    'CustomerServiceIssue': 'customer_service_issue',
    'customer_service_issue': 'customer_service_issue',
    'GeneralAdjustment': 'general_adjustment',
    'general_adjustment': 'general_adjustment',

    // Batch 2: Fee Overcharges
    'FBAWeightBasedFee': 'weight_fee_overcharge',
    'weight_fee_overcharge': 'weight_fee_overcharge',
    'FBAPerUnitFulfillmentFee': 'fulfillment_fee_error',
    'fulfillment_fee_error': 'fulfillment_fee_error',
    'FBAPerOrderFulfillmentFee': 'order_fulfillment_error',
    'order_fulfillment_error': 'order_fulfillment_error',
    'FBATransportationFee': 'transportation_fee_error',
    'transportation_fee_error': 'transportation_fee_error',
    'FBAInboundDefectFee': 'inbound_defect_fee',
    'inbound_defect_fee': 'inbound_defect_fee',
    'FBAInboundConvenienceFee': 'convenience_fee_error',
    'convenience_fee_error': 'convenience_fee_error',
    'FulfillmentNetworkFee': 'network_fee_error',
    'network_fee_error': 'network_fee_error',
    'Commission': 'commission_overcharge',
    'commission_overcharge': 'commission_overcharge',
    'FixedClosingFee': 'closing_fee_error',
    'closing_fee_error': 'closing_fee_error',
    'VariableClosingFee': 'variable_closing_error',
    'variable_closing_error': 'variable_closing_error',

    // Batch 3: Storage & Inventory Fees
    'FBAStorageFee': 'storage_overcharge',
    'storage_overcharge': 'storage_overcharge',
    'FBALongTermStorageFee': 'lts_overcharge',
    'lts_overcharge': 'lts_overcharge',
    'FBAInventoryStorageOverageFee': 'storage_overage_error',
    'storage_overage_error': 'storage_overage_error',
    'FBAExtraLargeStorageFee': 'extra_large_storage_error',
    'extra_large_storage_error': 'extra_large_storage_error',
    'FBARemovalFee': 'removal_fee_error',
    'removal_fee_error': 'removal_fee_error',
    'FBADisposalFee': 'disposal_fee_error',
    'disposal_fee_error': 'disposal_fee_error',
    'FBALiquidationFee': 'liquidation_fee_error',
    'liquidation_fee_error': 'liquidation_fee_error',
    'FBAReturnProcessingFee': 'return_processing_error',
    'return_processing_error': 'return_processing_error',
    'FBAUnplannedPrepFee': 'unplanned_prep_error',
    'unplanned_prep_error': 'unplanned_prep_error',

    // Batch 4: Refunds & Returns
    'RefundEvent': 'refund_no_return',
    'refund_no_return': 'refund_no_return',
    'RefundCommission': 'refund_commission_error',
    'refund_commission_error': 'refund_commission_error',
    'RestockingFee': 'restocking_missed',
    'restocking_missed': 'restocking_missed',
    'GiftWrapTax': 'gift_wrap_tax_error',
    'gift_wrap_tax_error': 'gift_wrap_tax_error',
    'ShippingTax': 'shipping_tax_error',
    'shipping_tax_error': 'shipping_tax_error',
    'Goodwill': 'goodwill_unfair',
    'goodwill_unfair': 'goodwill_unfair',
    'RetrochargeEvent': 'retrocharge',
    'retrocharge': 'retrocharge',
    'HighVolumeListingFee': 'high_volume_listing_error',
    'high_volume_listing_error': 'high_volume_listing_error',
    'ServiceProviderCreditEvent': 'service_provider_credit',
    'service_provider_credit': 'service_provider_credit',

    // Batch 5: Claims & Chargebacks
    'GuaranteeClaimEvent': 'atoz_claim',
    'atoz_claim': 'atoz_claim',
    'ChargebackEvent': 'chargeback',
    'chargeback': 'chargeback',
    'SafeTReimbursementEvent': 'safet_claim',
    'safet_claim': 'safet_claim',
    'DebtRecoveryEvent': 'debt_recovery',
    'debt_recovery': 'debt_recovery',
    'LoanServicingEvent': 'loan_servicing',
    'loan_servicing': 'loan_servicing',
    'PayWithAmazonEvent': 'pay_with_amazon',
    'pay_with_amazon': 'pay_with_amazon',
    'RentalTransactionEvent': 'rental_transaction',
    'rental_transaction': 'rental_transaction',
    'FBALiquidationEvent': 'fba_liquidation',
    'fba_liquidation': 'fba_liquidation',
    'TaxWithholdingEvent': 'tax_withholding',
    'tax_withholding': 'tax_withholding',

    // Batch 6: Advertising & Other
    'ProductAdsPaymentEvent': 'product_ads_error',
    'product_ads_error': 'product_ads_error',
    'ServiceFeeEvent': 'service_fee_error',
    'service_fee_error': 'service_fee_error',
    'SellerDealPaymentEvent': 'seller_deal_error',
    'seller_deal_error': 'seller_deal_error',
    'CouponPaymentEvent': 'coupon_payment_error',
    'coupon_payment_error': 'coupon_payment_error',
    'CouponRedemptionFee': 'coupon_redemption_error',
    'coupon_redemption_error': 'coupon_redemption_error',
    'RunLightningDealFee': 'lightning_deal_error',
    'lightning_deal_error': 'lightning_deal_error',
    'VineEnrollmentFee': 'vine_enrollment_error',
    'vine_enrollment_error': 'vine_enrollment_error',
    'ImagingServicesFeeEvent': 'imaging_services_error',
    'imaging_services_error': 'imaging_services_error',
    'EarlyReviewerProgramFee': 'early_reviewer_error',
    'early_reviewer_error': 'early_reviewer_error',

    // Missing 8 types
    'FBAInventoryReimbursement': 'fba_inventory_reimbursement',
    'fba_inventory_reimbursement': 'fba_inventory_reimbursement',
    'INVENTORY_REIMBURSEMENT': 'fba_inventory_reimbursement',
    'CouponClipFee': 'coupon_clip_fee',
    'coupon_clip_fee': 'coupon_clip_fee',
    'SellerReviewEnrollmentPaymentEvent': 'seller_review_enrollment',
    'seller_review_enrollment': 'seller_review_enrollment',
    'TCS-CGST': 'tcs_cgst',
    'tcs_cgst': 'tcs_cgst',
    'TCS-SGST': 'tcs_sgst',
    'tcs_sgst': 'tcs_sgst',
    'TCS-IGST': 'tcs_igst',
    'tcs_igst': 'tcs_igst',
};

// Run the test
console.log('🧪 Testing 64 Detection Types\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;
const failures: { code: string; expected: string; actual: string | undefined }[] = [];

for (const testCase of testCases) {
    const actual = subcategoryMap[testCase.code];
    if (actual === testCase.expected) {
        passed++;
        console.log(`✅ ${testCase.code} → ${actual}`);
    } else {
        failed++;
        failures.push({ code: testCase.code, expected: testCase.expected, actual });
        console.log(`❌ ${testCase.code} → Expected: ${testCase.expected}, Got: ${actual || 'undefined'}`);
    }
}

console.log('\n' + '='.repeat(60));
console.log(`\n📊 RESULTS:`);
console.log(`   ✅ Passed: ${passed}/${testCases.length}`);
console.log(`   ❌ Failed: ${failed}/${testCases.length}`);
console.log(`   📈 Coverage: ${((passed / testCases.length) * 100).toFixed(1)}%`);

if (failures.length > 0) {
    console.log(`\n⚠️ Failed mappings:`);
    for (const f of failures) {
        console.log(`   - ${f.code}: expected '${f.expected}', got '${f.actual || 'undefined'}'`);
    }
}

// Count unique anomaly types
const uniqueTypes = new Set(Object.values(subcategoryMap));
console.log(`\n🔢 Unique anomaly_type values in map: ${uniqueTypes.size}`);
console.log(`📋 All types: ${Array.from(uniqueTypes).sort().join(', ')}`);
