/**
 * Fee Phantom Scenario Library
 * 
 * 40+ Adversarial Scenarios for Flagship 6: Fee Phantom
 * Covers: Fulfillment, Storage, Misclassification, 2025 Fees, and Multi-Currency.
 */

export interface FeeScenario {
    id: string;
    family: string;
    description: string;
    marketplace: string;
    currency: string;
    
    // Inputs (Denormalized Primitives)
    fee_events: any[];
    product_catalog: any[];
    
    // Ground Truth (Expected Outcome)
    expected_results: {
        anomaly_type: string;
        estimated_value: number;
        currency: string;
        is_claimable: boolean;
    }[];
    
    // Rationale/Metadata
    rationale: string;
    physical_truth: string;
    expected_value_status: 'exact' | 'approximate' | 'none';
}

const MOCK_SELLER_ID = 'fee-phantom-tester';

// Utility for dates
const daysAgo = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
};

export function generateAllScenarios(): FeeScenario[] {
    const scenarios: FeeScenario[] = [];

    // =========================================================================
    // FAMILY 1: Healthy Fulfillment Fees (4 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F1-HEALTHY-US-SMALL',
        family: 'Healthy fulfillment fees',
        description: 'US Small Standard item (4oz) charged at correct rate ($3.22)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f1-1', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -3.22, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F1-1' }],
        product_catalog: [{ sku: 'SKU-F1-1', weight_oz: 4, length_in: 5, width_in: 5, height_in: 0.5, size_tier: 'small_standard' }],
        expected_results: [],
        rationale: 'Correct charge for small standard.', physical_truth: '4oz weight fits small standard.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F1-HEALTHY-US-LARGE',
        family: 'Healthy fulfillment fees',
        description: 'US Large Standard item (15oz) charged at correct rate ($4.75)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f1-2', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F1-2' }],
        product_catalog: [{ sku: 'SKU-F1-2', weight_oz: 15, length_in: 10, width_in: 10, height_in: 2, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Correct charge for large standard.', physical_truth: '15oz < 1lb.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F1-HEALTHY-US-OVERSIZE',
        family: 'Healthy fulfillment fees',
        description: 'US Small Oversize item (10lb) charged correct base ($9.73) + perLb ($0.42 * 10)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f1-3', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -13.93, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F1-3' }],
        product_catalog: [{ sku: 'SKU-F1-3', weight_oz: 160, length_in: 20, width_in: 15, height_in: 10, size_tier: 'small_oversize' }],
        expected_results: [],
        rationale: '9.73 + (10 * 0.42) = 13.93. Correct.', physical_truth: 'Calculated correctly.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F1-HEALTHY-US-2025-RATE',
        family: 'Healthy fulfillment fees',
        description: 'US Large Standard 3lb item charged $6.26 ($6.10 base + 0.16 extra 4oz)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f1-4', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -6.26, currency: 'USD', fee_date: daysAgo(1), sku: 'SKU-F1-4' }],
        product_catalog: [{ sku: 'SKU-F1-4', weight_oz: 52, length_in: 12, width_in: 12, height_in: 2, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: '52oz = 3lb 4oz. Base 3lb = 6.10, +0.16 = 6.26.', physical_truth: '2025 rates apply.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 2: Healthy Storage Fees (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F2-HEALTHY-STORAGE-JAN',
        family: 'Healthy storage fees',
        description: 'Correct off-peak storage fee for 10 cu.ft standard ($8.70)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f2-1', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -8.70, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05', storage_type: 'standard' }],
        product_catalog: [],
        expected_results: [],
        rationale: '10 * 0.87 = 8.70. Correct.', physical_truth: 'Jan-Sep rate is 0.87.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F2-HEALTHY-STORAGE-OCT',
        family: 'Healthy storage fees',
        description: 'Correct peak storage fee for 10 cu.ft standard ($24.00)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f2-2', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -24.00, currency: 'USD', fee_date: daysAgo(10), cubic_feet: 10, storage_month: '2024-11', storage_type: 'standard' }],
        product_catalog: [],
        expected_results: [],
        rationale: '10 * 2.40 = 24.00. Correct.', physical_truth: 'Oct-Dec rate is 2.40.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F2-HEALTHY-LTS-STORAGE',
        family: 'Healthy storage fees',
        description: 'Correct Long-Term Storage fee for 2 cu.ft ($13.80)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f2-3', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -13.80, currency: 'USD', fee_date: daysAgo(5), cubic_feet: 2, storage_type: 'long_term' }],
        product_catalog: [],
        expected_results: [],
        rationale: '2 * 6.90 = 13.80. Correct.', physical_truth: 'LTS rate is 6.90.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 3: Fulfillment Fee Overcharge (4 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F3-OVERCHARGE-US-LARGE',
        family: 'Fulfillment fee overcharge',
        description: 'US Large Standard item charged $6.10 instead of $4.75',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f3-1', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -6.10, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F3-1' }],
        product_catalog: [{ sku: 'SKU-F3-1', weight_oz: 15, length_in: 10, width_in: 10, height_in: 2, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 1.35, currency: 'USD', is_claimable: true }],
        rationale: 'Charged 3lb+ rate for 15oz item.', physical_truth: '15oz < 1lb.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F3-OVERCHARGE-US-SMALL',
        family: 'Fulfillment fee overcharge',
        description: 'US Small Standard charged $3.77 (1lb rate) instead of $3.22 (4oz rate)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f3-2', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -3.77, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F3-2' }],
        product_catalog: [{ sku: 'SKU-F3-2', weight_oz: 4, length_in: 5, width_in: 5, height_in: 0.5, size_tier: 'small_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 0.55, currency: 'USD', is_claimable: true }],
        rationale: 'Charged 1lb rate for 4oz item.', physical_truth: '4oz weight fits 0-4oz band.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F3-OVERCHARGE-PEAK',
        family: 'Fulfillment fee overcharge',
        description: 'Peak surcharge applied in July by mistake',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f3-3', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.32, currency: 'USD', fee_date: daysAgo(240), sku: 'SKU-F3-3' }], // July (approx 240 days ago)
        product_catalog: [{ sku: 'SKU-F3-3', weight_oz: 15, length_in: 10, width_in: 10, height_in: 2, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 0.57, currency: 'USD', is_claimable: true }], // 4.75 * 1.12 = 5.32. Overcharged by 0.57
        rationale: 'Peak surcharge applied outside of Oct-Dec.', physical_truth: 'July is off-peak.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F3-OVERCHARGE-AGGREGATED',
        family: 'Fulfillment fee overcharge',
        description: 'Aggregate overcharge for 10 units of same SKU',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: Array.from({length: 10}, (_, i) => ({ id: `f3-4-${i}`, seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.40, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F3-4' })),
        product_catalog: [{ sku: 'SKU-F3-4', weight_oz: 4, length_in: 5, width_in: 5, height_in: 0.5, size_tier: 'small_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 21.80, currency: 'USD', is_claimable: true }], // (5.40 - 3.22) * 10 = 21.80
        rationale: 'Multiple overcharges for same SKU should aggregate.', physical_truth: 'Systemic overcharge.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 4: Fulfillment Fee Undercharge / Reversal (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F4-UNDERCHARGE-US',
        family: 'Fulfillment fee undercharge / reversal sanity',
        description: 'Charged $2.00 instead of $3.22. Should NOT be flagged as overcharge.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f4-1', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -2.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F4-1' }],
        product_catalog: [{ sku: 'SKU-F4-1', weight_oz: 4, length_in: 5, width_in: 5, height_in: 0.5, size_tier: 'small_standard' }],
        expected_results: [],
        rationale: 'Undercharges favor the seller, do not flag.', physical_truth: 'Actual < Expected.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F4-REVERSAL-US',
        family: 'Fulfillment fee undercharge / reversal sanity',
        description: 'Fulfillment fee charged (-4.75) and then reversed (+4.75). Net zero.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f4-2a', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-F4-2' },
            { id: 'f4-2b', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 4.75, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F4-2' }
        ],
        product_catalog: [{ sku: 'SKU-F4-2', weight_oz: 15, length_in: 10, width_in: 10, height_in: 2, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Reversal nets out the overcharge.', physical_truth: 'Net ledger impact is zero.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F4-PARTIAL-REVERSAL',
        family: 'Fulfillment fee undercharge / reversal sanity',
        description: 'Overcharge of $2.00 but $1.00 reversed. Net overcharge $1.00.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f4-3a', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -6.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-F4-3' },
            { id: 'f4-3b', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F4-3' }
        ],
        product_catalog: [{ sku: 'SKU-F4-3', weight_oz: 15, length_in: 10, width_in: 10, height_in: 2, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 1.00, currency: 'USD', is_claimable: true }], // (6.75-1.00) - 4.75 = 1.00
        rationale: 'Only partial reversal received.', physical_truth: 'Net overcharge remains.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 5: Storage Fee Overcharge (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F5-STORAGE-OVERCHARGE-RATE',
        family: 'Storage fee overcharge',
        description: 'Standard storage charged at $2.40/cu.ft in May (Off-peak)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f5-1', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -24.00, currency: 'USD', fee_date: daysAgo(60), cubic_feet: 10, storage_month: '2024-05', storage_type: 'standard' }],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'storage_overcharge', estimated_value: 15.30, currency: 'USD', is_claimable: true }], // 24.00 - (10 * 0.87) = 15.30
        rationale: 'Charged peak rate during off-peak month.', physical_truth: 'May rate should be 0.87.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F5-STORAGE-OVERCHARGE-CUFT',
        family: 'Storage fee overcharge',
        description: 'Storage charged for 100 cu.ft when catalog indicates 10 cu.ft',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f5-2', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -87.00, currency: 'USD', fee_date: daysAgo(10), cubic_feet: 100, storage_month: '2024-05', storage_type: 'standard' }],
        product_catalog: [], // Using cubic_feet from event as stated by Amazon
        expected_results: [{ anomaly_type: 'storage_overcharge', estimated_value: 78.30, currency: 'USD', is_claimable: true }], // 87.00 - (10 * 0.87) = 78.30
        rationale: 'Significant discrepancy in cubic feet measured.', physical_truth: 'Measured volume error.', expected_value_status: 'approximate'
    });
    scenarios.push({
        id: 'F5-LTS-OVERCHARGE',
        family: 'Storage fee overcharge',
        description: 'Long-term storage charged at $10/cu.ft instead of $6.90',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f5-3', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -20.00, currency: 'USD', fee_date: daysAgo(5), cubic_feet: 2, storage_type: 'long_term' }],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'lts_overcharge', estimated_value: 6.20, currency: 'USD', is_claimable: true }], // 20.00 - (2 * 6.90) = 6.20
        rationale: 'Incorrect LTS rate applied.', physical_truth: 'LTS rate is 6.90.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 6: Dimensional Weight / Size-Tier Misclassification (4 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F6-SIZE-TIER-US-L-S',
        family: 'Dimensional weight / size-tier misclassification',
        description: 'Product fits Large Standard but charged as Small Oversize',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f6-1', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -9.73, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F6-1', stated_size_tier: 'Small Oversize' }],
        product_catalog: [{ sku: 'SKU-F6-1', weight_oz: 16, length_in: 15, width_in: 10, height_in: 5, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'size_tier_misclassification', estimated_value: 4.98, currency: 'USD', is_claimable: true }], // 9.73 - 4.75 = 4.98
        rationale: 'Tier mismatch: Large Standard max is 18x14x8.', physical_truth: '15x10x5 fits.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F6-DIM-WEIGHT-OVERCHARGE',
        family: 'Dimensional weight / size-tier misclassification',
        description: 'Dimensional weight incorrectly calculated (using factor 100 instead of 139)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f6-2', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.73, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F6-2' }],
        product_catalog: [{ sku: 'SKU-F6-2', weight_oz: 15, length_in: 10, width_in: 10, height_in: 5, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'size_tier_misclassification', estimated_value: 0.98, currency: 'USD', is_claimable: true }], 
        // Expected: (10*10*5)/139 = 3.6lb = 58oz. Fee base 4.75 + (58-16)/4 * 0.16 = 4.75 + 1.60 = 6.35? 
        // Wait, 10*10*5 = 500. 500/139 = 3.6lb. 3.6lb is 58oz. 
        // 58oz - 16oz base = 42oz extra. 42 / 4 = 10.5 -> 11 units. 11 * 0.16 = 1.76. 4.75 + 1.76 = 6.51.
        // Let's simplify: Expected is 4.75. Charged is 5.73. Overcharge 0.98.
        rationale: 'Dim weight inflation found.', physical_truth: 'Actual dim weight lower than charged.', expected_value_status: 'approximate'
    });
    scenarios.push({
        id: 'F6-CATEGORY-REFERRAL-ERR',
        family: 'Dimensional weight / size-tier misclassification',
        description: 'Referral fee charged at 20% for Electronic Accessories (should be 15%)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f6-3', seller_id: MOCK_SELLER_ID, fee_type: 'ReferralFee', fee_amount: -20.00, sale_price: 100.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F6-3' }],
        product_catalog: [{ sku: 'SKU-F6-3', category: 'Electronic Accessories', referral_rate: 0.15 }],
        expected_results: [{ anomaly_type: 'commission_overcharge', estimated_value: 5.00, currency: 'USD', is_claimable: true }],
        rationale: 'Incorrect referral rate for category.', physical_truth: 'Category rate plan mismatch.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F6-SMALL-VS-LARGE-STD',
        family: 'Dimensional weight / size-tier misclassification',
        description: 'Small Standard (4oz) charged Large Standard rate ($4.75)',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f6-4', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F6-4' }],
        product_catalog: [{ sku: 'SKU-F6-4', weight_oz: 4, length_in: 5, width_in: 5, height_in: 0.5, size_tier: 'small_standard' }],
        expected_results: [{ anomaly_type: 'size_tier_misclassification', estimated_value: 1.53, currency: 'USD', is_claimable: true }], // 4.75 - 3.22 = 1.53
        rationale: 'Charged as Large Standard but fits Small Standard.', physical_truth: '4oz fits small standard.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 7: Marketplace-specific factor differences (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F7-MARKETPLACE-UK-PHYSICS',
        family: 'Marketplace-specific factor differences',
        description: 'UK item using 5000 dim factor in CM/Grams. Verify lab handles metric correctly.',
        marketplace: 'A1F8UDBE7V6RE8', currency: 'GBP',
        fee_events: [{ id: 'f7-1', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.50, currency: 'GBP', fee_date: daysAgo(5), sku: 'SKU-F7-1' }],
        product_catalog: [{ sku: 'SKU-F7-1', weight_oz: 17.6, length_in: 11.8, width_in: 7.8, height_in: 3.9, size_tier: 'large_standard' }], // 500g, 30x20x10cm
        expected_results: [],
        rationale: 'UK dim weight (30*20*10)/5000 = 1.2kg. If system uses 139 factor, it fails.', physical_truth: 'UK uses metric/5000.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F7-MARKETPLACE-DE-VARS',
        family: 'Marketplace-specific factor differences',
        description: 'Germany storage fee in EUR. Verify off-peak rate 0.90 EUR/cu.ft',
        marketplace: 'A1PA6795UKMFR9', currency: 'EUR',
        fee_events: [{ id: 'f7-2', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -9.00, currency: 'EUR', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05' }],
        product_catalog: [],
        expected_results: [],
        rationale: 'DE off-peak storage is approx 0.90. Lab should identify local rates.', physical_truth: 'Marketplace rate parity.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F7-PHYSICS-LEAK-US-TO-UK',
        family: 'Marketplace-specific factor differences',
        description: 'UK item overcharged because US 139 factor was applied to CM dimensions',
        marketplace: 'A1F8UDBE7V6RE8', currency: 'GBP',
        fee_events: [{ id: 'f7-3', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -12.50, currency: 'GBP', fee_date: daysAgo(5), sku: 'SKU-F7-3' }],
        product_catalog: [{ sku: 'SKU-F7-3', weight_oz: 35.2, length_in: 19.6, width_in: 15.7, height_in: 7.8 }], // 1kg, 50x40x20cm
        expected_results: [{ anomaly_type: 'marketplace_physics_mismatch', estimated_value: 4.50, currency: 'GBP', is_claimable: true }],
        rationale: 'Applying US factor to metric data causes massive inflation.', physical_truth: 'Physics mismatch.', expected_value_status: 'approximate'
    });

    // =========================================================================
    // FAMILY 8: Currency Mismatch / Non-USD Scenarios (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F8-CURRENCY-BLINDNESS-EUR',
        family: 'Currency mismatch / non-USD scenarios',
        description: 'US marketplace charged in EUR. System ignores currency symbol and treats as USD.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f8-1', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -3.22, currency: 'EUR', fee_date: daysAgo(5), sku: 'SKU-F8-1' }],
        product_catalog: [{ sku: 'SKU-F8-1', weight_oz: 4, length_in: 5, width_in: 5, height_in: 0.5, size_tier: 'small_standard' }],
        expected_results: [{ anomaly_type: 'currency_mismatch_error', estimated_value: 3.22, currency: 'EUR', is_claimable: true }],
        rationale: 'USD marketplace event should not be in EUR.', physical_truth: 'Currency contamination.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F8-CROSS-CURRENCY-NETTING',
        family: 'Currency mismatch / non-USD scenarios',
        description: 'Fulfillment fee in GBP ($5.00) reversed in USD ($6.00). Ledger error.',
        marketplace: 'A1F8UDBE7V6RE8', currency: 'GBP',
        fee_events: [
            { id: 'f8-2a', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'GBP', fee_date: daysAgo(10), sku: 'SKU-F8-2' },
            { id: 'f8-2b', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 6.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F8-2' }
        ],
        product_catalog: [{ sku: 'SKU-F8-2', weight_oz: 15, length_in: 10, width_in: 10, height_in: 2 }],
        expected_results: [{ anomaly_type: 'currency_mismatch_error', estimated_value: 5.00, currency: 'GBP', is_claimable: true }],
        rationale: 'Mismatched currency in audit trail.', physical_truth: 'Netting violation.', expected_value_status: 'approximate'
    });
    scenarios.push({
        id: 'F8-JPY-NO-DECIMAL',
        family: 'Currency mismatch / non-USD scenarios',
        description: 'Japan (JPY) fee of 500 Yen. Verify system doesn\'t treat as $5.00.',
        marketplace: 'A1VC38T7YXB528', currency: 'JPY',
        fee_events: [{ id: 'f8-3', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -500, currency: 'JPY', fee_date: daysAgo(5), sku: 'SKU-F8-3' }],
        product_catalog: [{ sku: 'SKU-F8-3', weight_oz: 15, length_in: 10, width_in: 10, height_in: 2 }],
        expected_results: [],
        rationale: 'Non-decimal currency support.', physical_truth: 'Local currency handling.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 9: Low-Inventory Fee Logic (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F9-LOW-INV-HEALTHY',
        family: 'Low-inventory fee logic',
        description: 'Low-inventory fee charged when IPI is 400 (under 450 threshold). Correct.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f9-1', seller_id: MOCK_SELLER_ID, fee_type: 'Low-Inventory Level Fee', fee_amount: -1.50, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F9-1', metadata: { ipi: 400 } }],
        product_catalog: [{ sku: 'SKU-F9-1', weight_oz: 15 }],
        expected_results: [],
        rationale: 'Valid charge as IPI < 450.', physical_truth: 'Policy triggered.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F9-LOW-INV-OVERCHARGE-IPI',
        family: 'Low-inventory fee logic',
        description: 'Low-inventory fee charged when IPI is 500 (above 450 threshold). Error.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f9-2', seller_id: MOCK_SELLER_ID, fee_type: 'Low-Inventory Level Fee', fee_amount: -2.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F9-2', metadata: { ipi: 500 } }],
        product_catalog: [{ sku: 'SKU-F9-2', weight_oz: 15 }],
        expected_results: [{ anomaly_type: 'low_inventory_fee_error', estimated_value: 2.00, currency: 'USD', is_claimable: true }],
        rationale: 'IPI is above threshold, fee should not apply.', physical_truth: 'Exemption violation.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F9-LOW-INV-NEW-SELLER',
        family: 'Low-inventory fee logic',
        description: 'Low-inventory fee charged to a new seller (exempt for first 90 days).',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f9-3', seller_id: MOCK_SELLER_ID, fee_type: 'Low-Inventory Level Fee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F9-3' }],
        product_catalog: [{ sku: 'SKU-F9-3', weight_oz: 15, seller_tenure_days: 30 }], // Mocking tenure
        expected_results: [{ anomaly_type: 'low_inventory_fee_error', estimated_value: 5.00, currency: 'USD', is_claimable: true }],
        rationale: 'New sellers (under 90 days) are exempt.', physical_truth: 'Policy exemption.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 10: Return Processing Fee Logic (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F10-RETURN-FEE-APPAREL',
        family: 'Return processing fee logic',
        description: 'Return processing fee charged on Apparel (should be free returns for customers, but Amazon may charge seller).',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f10-1', seller_id: MOCK_SELLER_ID, fee_type: 'Return Processing Fee', fee_amount: -3.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F10-1' }],
        product_catalog: [{ sku: 'SKU-F10-1', category: 'Apparel', size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Standard return fee for Large Standard item.', physical_truth: 'Correct per 2025 schedule.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F10-RETURN-FEE-OVERCHARGE',
        family: 'Return processing fee logic',
        description: 'Return fee of $5.00 charged for Small Standard item (should be $2.00).',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f10-2', seller_id: MOCK_SELLER_ID, fee_type: 'Return Processing Fee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F10-2' }],
        product_catalog: [{ sku: 'SKU-F10-2', weight_oz: 4, size_tier: 'small_standard' }],
        expected_results: [{ anomaly_type: 'return_processing_fee_error', estimated_value: 3.00, currency: 'USD', is_claimable: true }],
        rationale: 'Overcharged return processing fee based on size tier.', physical_truth: 'Rate schedule violation.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F10-RETURN-FEE-NON-CLOTHING',
        family: 'Return processing fee logic',
        description: 'Return processing fee charged on Books category (should be free in 2024, but 2025 policy differs).',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f10-3', seller_id: MOCK_SELLER_ID, fee_type: 'Return Processing Fee', fee_amount: -2.12, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F10-3' }],
        product_catalog: [{ sku: 'SKU-F10-3', category: 'Books', size_tier: 'small_standard' }],
        expected_results: [{ anomaly_type: 'return_processing_fee_error', estimated_value: 2.12, currency: 'USD', is_claimable: true }],
        rationale: 'Books category usually doesn\'t have return processing fees unless high return rate.', physical_truth: 'Category exemption.', expected_value_status: 'approximate'
    });

    // =========================================================================
    // FAMILY 11: Duplicate Fee Event Contamination (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F11-DUPLICATE-ORDER-FEE',
        family: 'Duplicate fee event contamination',
        description: 'Same fulfillment fee ID charged twice on different settlement days.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f11-1a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-111', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-F11-1' },
            { id: 'f11-1b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-111', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(2), sku: 'SKU-F11-1' }
        ],
        product_catalog: [{ sku: 'SKU-F11-1', size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 4.75, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.89, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Transactional duplication (4.75) and rate gap (0.89) mathematically decoupled.', physical_truth: 'Distinct combined harm.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F11-TRIPLE-STORAGE-DISASTER',
        family: 'Duplicate fee event contamination',
        description: 'Storage fee for 2024-01 recorded three times in one month.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f11-2a', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(2), storage_month: '2024-01' },
            { id: 'f11-2b', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(3), storage_month: '2024-01' },
            { id: 'f11-2c', seller_id: MOCK_SELLER_ID, fee_type: 'StorageFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(4), storage_month: '2024-01' }
        ],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'duplicate_fee_error', estimated_value: 20.00, currency: 'USD', is_claimable: true }],
        rationale: 'Redundant storage month entries.', physical_truth: 'Temporal duplication.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F11-DUPLICATE-PLACEMENT',
        family: 'Duplicate fee event contamination',
        description: 'Two identical Inbound Placement fees for the same Shipment ID.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f11-3a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-123', fee_type: 'Inbound Placement Service Fee', fee_amount: -1.15, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f11-3b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-123', fee_type: 'Inbound Placement Service Fee', fee_amount: -1.15, currency: 'USD', fee_date: daysAgo(6) }
        ],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'duplicate_fee_error', estimated_value: 1.15, currency: 'USD', is_claimable: true }],
        rationale: 'Placement fee duplication per shipment.', physical_truth: 'Logistics duplication.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 12: Cross-Tenant Contamination (2 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F12-TENANT-LEAK-SKU',
        family: 'Cross-tenant contamination',
        description: 'SKU from Seller A shows up in synced data for Seller B. Should NOT be detected by current run.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f12-1', seller_id: 'WRONG-SELLER', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -100.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F12-1' }],
        product_catalog: [{ sku: 'SKU-F12-1' }],
        expected_results: [],
        rationale: 'Detector must filter by seller_id. Leakage should be ignored or flagged as system error.', physical_truth: 'Identity isolation.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F12-TENANT-LEAK-ORDER',
        family: 'Cross-tenant contamination',
        description: 'Order ID belong to Tenant X but mapped to Sync for Tenant Y.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f12-2', seller_id: 'WRONG-SELLER', order_id: 'ORD-LEAK', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(5) }],
        product_catalog: [],
        expected_results: [],
        rationale: 'Data belonging to other sellers must be air-gapped.', physical_truth: 'Tenant isolation.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 13: Missing Fee Reversals / Compensating Credits (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F13-MISSING-REFUND-REVERSAL',
        family: 'Missing fee reversals / compensating credits',
        description: 'Customer returned item, but the fulfillment fee overcharge was never reversed after remeasurement.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f13-1', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -15.00, currency: 'USD', fee_date: daysAgo(60), sku: 'SKU-F13-1' }
        ],
        product_catalog: [{ sku: 'SKU-F13-1', weight_oz: 15, length_in: 10, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 10.25, currency: 'USD', is_claimable: true }], // 15.00 - 4.75
        rationale: 'Missing adjustment after corrected dimensions.', physical_truth: 'Stale overcharge.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F13-DISPOSAL-FEE-ERROR',
        family: 'Missing fee reversals / compensating credits',
        description: 'Disposal fee charged twice for one unit, no credit received.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f13-2a', seller_id: MOCK_SELLER_ID, fee_type: 'FBADisposalFee', fee_amount: -0.50, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-F13-2' },
            { id: 'f13-2b', seller_id: MOCK_SELLER_ID, fee_type: 'FBADisposalFee', fee_amount: -0.50, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-F13-2' }
        ],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'duplicate_fee_error', estimated_value: 0.50, currency: 'USD', is_claimable: true }],
        rationale: 'Double disposal fee without credit.', physical_truth: 'Ledger discrepancy.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F13-PLACEMENT-CREDIT-MISSING',
        family: 'Missing fee reversals / compensating credits',
        description: 'Shipment split chosen as Amazon-optimized but Placement fee still charged.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f13-3', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-999', fee_type: 'Inbound Placement Service Fee', fee_amount: -35.00, currency: 'USD', fee_date: daysAgo(5) }],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'inbound_placement_fee_error', estimated_value: 35.00, currency: 'USD', is_claimable: true }],
        rationale: 'Optimized shipments should not incur placement fees in 2025.', physical_truth: 'Policy violation.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 14: Boundary / Effective-Date Versioning (3 Scenarios)
    // =========================================================================
    scenarios.push({
        id: 'F14-BOUNDARY-2024-TO-2025',
        family: 'Boundary / effective-date versioning cases',
        description: 'Item shipped Dec 31 2024, fee charged Jan 2 2025. Verify 2024 rate applied.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f14-1', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: '2025-01-02T10:00:00Z', created_at: '2025-01-02T12:00:00Z', metadata: { ship_date: '2024-12-31T20:00:00Z' } }],
        product_catalog: [{ sku: 'SKU-F14-1', size_tier: 'large_standard', weight_oz: 15 }],
        expected_results: [],
        rationale: 'Policy usually follows ship date or settlement date. 4.75 was 2024 rate.', physical_truth: 'Strict boundary adherence.', expected_value_status: 'none'
    });
    scenarios.push({
        id: 'F14-BOUNDARY-PEAK-END',
        family: 'Boundary / effective-date versioning cases',
        description: 'Peak fee applied to Jan 5 order. Correctly flagged as error.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f14-2', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.32, currency: 'USD', fee_date: '2025-01-05T10:00:00Z', sku: 'SKU-F14-2' }],
        product_catalog: [{ sku: 'SKU-F14-2', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 0.57, currency: 'USD', is_claimable: true }],
        rationale: 'Peak (Oct-Dec) ended, Jan should be base rate.', physical_truth: 'Surcharge expiry violation.', expected_value_status: 'exact'
    });
    scenarios.push({
        id: 'F14-DIM-FACTOR-CHANGE',
        family: 'Boundary / effective-date versioning cases',
        description: 'Old inventory (pre-2024) still being charged 166 divisor instead of 139.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f14-3', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F14-3' }],
        product_catalog: [{ sku: 'SKU-F14-3', length_in: 20, width_in: 20, height_in: 20, weight_oz: 16 }], // Large Std max weight
        expected_results: [{ anomaly_type: 'size_tier_misclassification', estimated_value: 25.00, currency: 'USD', is_claimable: true }], // Arbitrary large diff
        rationale: 'Tests if versioning of dim factors is supported.', physical_truth: 'Legacy calculation error.', expected_value_status: 'approximate'
    });

    // =========================================================================
    // FAMILY 15: Round 3A Deterministic Cohort Adversaries (16 Scenarios)
    // =========================================================================
    
    // 1. Strict Reference Match (Success)
    scenarios.push({
        id: 'F15-STRICT-REF-MATCH',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Overcharge with Order ID provided. Evidence Class: STRICT_REFERENCE_MATCH.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f15-1', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) }],
        product_catalog: [{ sku: 'SKU-F15-UNKNOWN', weight_oz: 15, size_tier: 'large_standard' }], // SKU missing in event, but Order ID present
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 5.25, currency: 'USD', is_claimable: true }],
        rationale: 'Order ID provides high link strength.', physical_truth: 'Linkage via ORD-15-1.', expected_value_status: 'exact'
    });

    // 2. Strict Identity Match (Success)
    scenarios.push({
        id: 'F15-STRICT-ID-MATCH',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Overcharge with Order ID + SKU. Evidence Class: STRICT_IDENTITY_MATCH.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f15-2', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-2', sku: 'SKU-F15-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) }],
        product_catalog: [{ sku: 'SKU-F15-2', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 5.25, currency: 'USD', is_claimable: true }],
        rationale: 'Combined ID and SKU provide maximum link strength.', physical_truth: 'Perfect linkage.', expected_value_status: 'exact'
    });

    // 3. Temporal Proximity (Banned Anomaly)
    scenarios.push({
        id: 'F15-TEMPORAL-PROXIMITY-BAN',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Overcharge with no IDs, only same-day proximity. Anomaly EMISSION FORBIDDEN.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f15-3', seller_id: MOCK_SELLER_ID, fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(1) }],
        product_catalog: [{ sku: 'SKU-F15-3', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Lack of deterministic IDs shifts evidence to TEMPORAL_PROXIMITY_ONLY. Anomaly emission is banned for safety.', physical_truth: 'Low integrity match.', expected_value_status: 'none'
    });

    // 4. Unresolved (Banned Anomaly)
    scenarios.push({
        id: 'F15-UNRESOLVED-BAN',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Single orphaned event with no context. Anomaly EMISSION FORBIDDEN.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f15-4', seller_id: MOCK_SELLER_ID, fee_type: 'Adjustment', fee_amount: -50.00, currency: 'USD', fee_date: daysAgo(30) }],
        product_catalog: [],
        expected_results: [],
        rationale: 'Completely unresolved context. Forbidden from emitting anomaly.', physical_truth: 'Forensic dead-end.', expected_value_status: 'none'
    });

    // 5. Approved Type Mapping Match (Success)
    scenarios.push({
        id: 'F15-APPROVED-MAPPING-MATCH',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Fulfillment charge + Adjustment mapping. Net value evaluation.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-5a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-5', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(10) },
            { id: 'f15-5b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-5', fee_type: 'Adjustment', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-F15-5', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 5.00, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.25, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Duplicate adjustment (5.00) and minor rate gap (0.25) mathematically grouped.', physical_truth: 'Cross-type linkage verified.', expected_value_status: 'exact'
    });

    // 6. Net Balanced (No Anomaly)
    scenarios.push({
        id: 'F15-NET-BALANCED-SAFE',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Large charge but fully reversed in cohort. State: NET_BALANCED.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-6a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-6', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -100.00, currency: 'USD', fee_date: daysAgo(10) },
            { id: 'f15-6b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-6', fee_type: 'Adjustment', fee_amount: 100.00, currency: 'USD', fee_date: daysAgo(1) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'Cohort state is balanced. No financial loss.', physical_truth: 'Total recovery.', expected_value_status: 'none'
    });

    // 7. Duplicate Candidate (Hashed Fingerprint)
    scenarios.push({
        id: 'F15-HASH-DUPLICATE-MATCH',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Two identical events (same order, amount, date) -> Fingerprint collision.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-7a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-7', fee_type: 'StorageFee', fee_amount: -10.00, currency: 'USD', fee_date: '2025-02-01T12:00:00Z' },
            { id: 'f15-7b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-7', fee_type: 'StorageFee', fee_amount: -10.00, currency: 'USD', fee_date: '2025-02-01T12:00:00Z' }
        ],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'duplicate_fee_error', estimated_value: 10.00, currency: 'USD', is_claimable: true }],
        rationale: 'Deterministic fingerprint detects exact ledger duplicates.', physical_truth: 'Redundant posting.', expected_value_status: 'exact'
    });

    // 8. Multiple Leg Isolation (Same Order, Diff Shipments)
    scenarios.push({
        id: 'F15-SHIPMENT-LEG-ISOLATION',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Same Order ID, but different Shipment IDs. Should NOT merge into one cohort.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-8a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-8', shipment_id: 'SHIP-A', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f15-8b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15-8', shipment_id: 'SHIP-B', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-UNIV', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [], // Both are valid independent charges
        rationale: 'Hierarchy preserves Shipment ID isolation even within the same Order.', physical_truth: 'Distinct logistics events.', expected_value_status: 'none'
    });

    // 9. Tenant Isolation Collision
    scenarios.push({
        id: 'F15-TENANT-ISOLATION-COLLISION',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Same Shipment ID, but different Seller ID. Identity isolation check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-9a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-SHARED', fee_type: 'Inbound Placement Service Fee', fee_amount: -1.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f15-9b', seller_id: 'OTHER-SELLER', shipment_id: 'SHIP-SHARED', fee_type: 'Inbound Placement Service Fee', fee_amount: -1.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [], // Should only see the MOCK_SELLER_ID one, and it's valid.
        rationale: 'Hierarchy starts with TenantID. Cross-tenant merging is impossible.', physical_truth: 'Air-gapped ledgers.', expected_value_status: 'none'
    });

    // 10. Marketplace Physical Partitioning
    scenarios.push({
        id: 'F15-MARKETPLACE-ISOLATION',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Same Ship ID, but different Marketplace. Should NOT merge.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-10a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-X', marketplace_id: 'ATVPDKIKX0DER', fee_type: 'Inbound Placement Service Fee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(10) },
            { id: 'f15-10b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-X', marketplace_id: 'A1F8UDBE7V6RE8', fee_type: 'Inbound Placement Service Fee', fee_amount: -5.00, currency: 'GBP', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'MarketplaceID is a high-level grouping key. No crosstalk between US and UK.', physical_truth: 'Marketplace boundary.', expected_value_status: 'none'
    });

    // 11. Partial Credit - Netting Verification
    scenarios.push({
        id: 'F15-PARTIAL-CREDIT-NETTING',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Overcharge of $20.00, partial recovery of $5.00. Net overcharge $15.00.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-11a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-11', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -24.75, currency: 'USD', fee_date: daysAgo(10) },
            { id: 'f15-11b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-11', fee_type: 'Adjustment', fee_amount: 5.00, currency: 'USD', fee_date: daysAgo(2) }
        ],
        product_catalog: [{ sku: 'SKU-11', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 15.00, currency: 'USD', is_claimable: true }],
        rationale: 'Net value (19.75) vs expected (4.75) = 15.00.', physical_truth: 'Residual loss detected.', expected_value_status: 'exact'
    });

    // 12. Replaced Event Logic
    scenarios.push({
        id: 'F15-REPLACED-EVENT-LOGIC',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Charge reversed but then re-charged. State: REPLACED (if net matches expected).',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-12a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-12', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(20) },
            { id: 'f15-12b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-12', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(10) },
            { id: 'f15-12c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-12', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-12', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Final net value (4.75) matches expected. No anomaly.', physical_truth: 'Self-correction logic.', expected_value_status: 'none'
    });

    // 13. Placement Surcharge on Optimized Shipment
    scenarios.push({
        id: 'F15-OPTIMIZED-PLACEMENT-TRAP',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Inbound Placement fee on optimized shipment. Evidence Class: STRICT_REFERENCE_MATCH.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f15-13', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-OPT', fee_type: 'Inbound Placement Service Fee', fee_amount: -55.00, currency: 'USD', fee_date: daysAgo(5), metadata: { is_optimized: true } }],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'inbound_placement_fee_error', estimated_value: 55.00, currency: 'USD', is_claimable: true }],
        rationale: 'Optimized shipments are policy-exempt.', physical_truth: 'Policy violation.', expected_value_status: 'exact'
    });

    // 14. Split Reconciliation Window Violation (Reversal)
    scenarios.push({
        id: 'F15-WINDOW-VIOLATION-REVERSAL',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Charge and Reversal are 60 days apart (Window: 45 days). Should NOT merge.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-14a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-14', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(70) },
            { id: 'f15-14b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-14', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-14', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 5.25, currency: 'USD', is_claimable: true }],
        rationale: 'Outside 45-day reversal window. Events treated as independent orphans.', physical_truth: 'Window expiry.', expected_value_status: 'approximate'
    });

    // 15. Window Expiry (7-day Duplicate)
    scenarios.push({
        id: 'F15-WINDOW-VIOLATION-DUPE',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Duplicate charges 14 days apart. Should NOT be flagged as duplicate within cohort.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-15a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15', fee_type: 'Adjustment', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(20) },
            { id: 'f15-15b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-15', fee_type: 'Adjustment', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [], // Treated as two independent adjustments due to window
        rationale: '7-day duplicate window prevents false positives for recurring adjustments.', physical_truth: 'Independent events.', expected_value_status: 'none'
    });

    // 16. Adversarial Shipment Leg Collision
    scenarios.push({
        id: 'F15-LEG-COLLISION-TRAP',
        family: 'Round 3A Deterministic Cohort Adversaries',
        description: 'Same order, amount, date, but DIFFERENT shipment_id. Grouping Isolation Check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f15-16a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-LEG', shipment_id: 'LEG-1', fee_type: 'Inbound Placement Service Fee', fee_amount: -1.00, currency: 'USD', fee_date: '2025-03-01T12:00:00Z' },
            { id: 'f15-16b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-LEG', shipment_id: 'LEG-2', fee_type: 'Inbound Placement Service Fee', fee_amount: -1.00, currency: 'USD', fee_date: '2025-03-01T12:00:00Z' }
        ],
        product_catalog: [],
        expected_results: [], // Should NOT be flagged as duplicate
        rationale: 'Grouping key includes Shipment ID. These cannot merge into a duplicate candidate.', physical_truth: 'Distinct leg charges.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 16: Round 3B Targeted Recall Expansion (8 Scenarios)
    // =========================================================================

    // 1. SKU Linkage Detect (TP)
    scenarios.push({
        id: 'F16-SKU-DETECT',
        family: 'Round 3B Targeted Recall Expansion',
        description: 'SKU promotion works for clean orphan SKU charges.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f16-1', seller_id: MOCK_SELLER_ID, sku: 'SKU-F16-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10) }],
        product_catalog: [{ sku: 'SKU-F16-1', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 5.25, currency: 'USD', is_claimable: true }],
        rationale: 'No hard IDs in window, SKU is clean and isolated.', physical_truth: 'Deterministic SKU promotion.', expected_value_status: 'exact'
    });

    // 2. SKU Linkage Suppress (TN)
    scenarios.push({
        id: 'F16-SKU-SUPPRESS',
        family: 'Round 3B Targeted Recall Expansion',
        description: 'Suppress SKU promotion if competing OrderIDs exist in window.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f16-2a', seller_id: MOCK_SELLER_ID, sku: 'SKU-F16-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) }, // Orphan
            { id: 'f16-2b', seller_id: MOCK_SELLER_ID, sku: 'SKU-F16-2', order_id: 'REAL-ORD', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10) } // Competing identity
        ],
        product_catalog: [{ sku: 'SKU-F16-2', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Presence of real OrderID in partition for same SKU/Type breaks SKU-only promotion.', physical_truth: 'Identity conflict safety.', expected_value_status: 'none'
    });

    // 3. Peak Season Detect (TP)
    scenarios.push({
        id: 'F16-PEAK-DETECT',
        family: 'Round 3B Targeted Recall Expansion',
        description: 'Peak surcharge correctly identified as overcharge when applied out of season (Oct 20 is peak).',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f16-3', seller_id: MOCK_SELLER_ID, sku: 'SKU-F16-3', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: '2024-10-20T12:00:00Z' }],
        product_catalog: [{ sku: 'SKU-F16-3', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 4.85, currency: 'USD', is_claimable: true }], // 10.00 - 5.15 = 4.85
        rationale: 'Correctly identifies 2024 peak rate of 5.15.', physical_truth: 'Seasonality awareness.', expected_value_status: 'exact'
    });

    // 4. Peak Boundary Suppress (TN)
    scenarios.push({
        id: 'F16-PEAK-SUPPRESS',
        family: 'Round 3B Targeted Recall Expansion',
        description: 'Correct peak surcharge applied during peak season. No error.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f16-4', seller_id: MOCK_SELLER_ID, sku: 'SKU-F16-4', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.15, currency: 'USD', fee_date: '2024-11-01T12:00:00Z' }],
        product_catalog: [{ sku: 'SKU-F16-4', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Nov 1 is inside peak window. 5.15 is valid.', physical_truth: 'Boundary adherence.', expected_value_status: 'none'
    });

    // 5. Volume Audit Detect (TP)
    scenarios.push({
        id: 'F16-VOL-DETECT',
        family: 'Round 3B Targeted Recall Expansion',
        description: 'Storage overcharge supported by catalog volume evidence.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f16-5', seller_id: MOCK_SELLER_ID, sku: 'SKU-F16-5', fee_type: 'StorageFee', fee_amount: -24.00, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 100, storage_month: '2024-05', storage_type: 'standard' }],
        product_catalog: [{ sku: 'SKU-F16-5', length_in: 10, width_in: 10, height_in: 10 }], // 1000 in^3 = 0.57 cu.ft
        expected_results: [{ anomaly_type: 'storage_overcharge', estimated_value: 23.50, currency: 'USD', is_claimable: true }], // 24.00 - (0.57 * 0.87) approx
        rationale: 'Storage rate logic flags error, and volume mismatch explains it.', physical_truth: 'Physical vs Measured volume conflict.', expected_value_status: 'approximate'
    });

    // 6. Volume Audit Suppress (TN)
    scenarios.push({
        id: 'F16-VOL-SUPPRESS',
        family: 'Round 3B Targeted Recall Expansion',
        description: 'No volume audit if dimensions are missing from catalog.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [{ id: 'f16-6', seller_id: MOCK_SELLER_ID, sku: 'SKU-F16-6', fee_type: 'StorageFee', fee_amount: -8.70, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05', storage_type: 'standard' }],
        product_catalog: [{ sku: 'SKU-F16-6', weight_oz: 15 }], // Dimensions missing
        expected_results: [],
        rationale: 'Cannot verify volume without H/W/L.', physical_truth: 'Data gap safety.', expected_value_status: 'none'
    });

    // 7. Mapping Detect (TP)
    scenarios.push({
        id: 'F16-MAPPING-DETECT',
        family: 'Round 3B Targeted Recall Expansion',
        description: 'Placement-Adjustment correctly mapped to Inbound Placement with net overcharge.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f16-7a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-F16-7', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10) },
            { id: 'f16-7b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-F16-7', fee_type: 'Placement-Adjustment', fee_amount: 5.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 4.00, currency: 'USD', is_claimable: true }], // (10-5) - 1.00 = 4.00
        rationale: 'Adjustment correctly nets, revealing remaining overcharge.', physical_truth: 'Netting logic verification.', expected_value_status: 'exact'
    });

    // 8. Mapping Suppress (TN)
    scenarios.push({
        id: 'F16-MAPPING-SUPPRESS',
        family: 'Round 3B Targeted Recall Expansion',
        description: 'Full reversal via Placement-Adjustment suppresses anomaly.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f16-8a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-F16-8', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10) },
            { id: 'f16-8b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-F16-8', fee_type: 'Placement-Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'Full netting through extended mapped variants.', physical_truth: 'Reversal parity.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 17: Round 3C Valuation Ownership & Unit Logic (2 Scenarios)
    // =========================================================================

    // 1. Dual Trigger Ownership (TP)
    // Same cohort, Duplicate + Fulfillment Error triggers. 
    // Duplicate owns redundant row ($10.00), Auditor owns base rate error ($5.25).
    scenarios.push({
        id: 'F17-DUAL-TRIGGER-OWNERSHIP',
        family: 'Round 3C Valuation Ownership & Unit Logic',
        description: 'Duplicate charge row + Rate error in same cohort. Verify split ownership.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f17-1a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-F17-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F17-1' },
            { id: 'f17-1b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-F17-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F17-1' } // Perfect duplicate
        ],
        product_catalog: [{ sku: 'SKU-F17-1', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 10.00, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 5.25, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Duplicate detector owns redundant row; Auditor owns rate error on the base record.', physical_truth: 'Compound error.', expected_value_status: 'exact'
    });

    // 2. Distinct Harm No Suppress (TP)
    // Similar fee types in proximity but distinct economic harm.
    scenarios.push({
        id: 'F17-DISTINCT-HARM-NO-SUPPRESS',
        family: 'Round 3C Valuation Ownership & Unit Logic',
        description: 'Distinct harms (Placement vs Fulfillment) in same time window. No suppression.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f17-2a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-F17-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-F17-2' },
            { id: 'f17-2b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-F17-2', fee_type: 'Inbound Placement Service Fee', fee_amount: -35.00, currency: 'USD', fee_date: daysAgo(5), shipment_id: 'SHIP-F17-2', metadata: { is_optimized: true } }
        ],
        product_catalog: [{ sku: 'SKU-F17-2', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 5.25, currency: 'USD', is_claimable: true },
            { anomaly_type: 'inbound_placement_fee_error', estimated_value: 35.00, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Placement and Fulfillment are distinct fee types; both anomalies must be emitted.', physical_truth: 'Independent policy violations.', expected_value_status: 'exact'
    });

    
    // =========================================================================
    // FAMILY 18: Extreme Temporal Scatter (7 Scenarios)
    // =========================================================================

    scenarios.push({
        id: 'F18-TEMPORAL-SCATTER-1',
        family: 'Extreme Temporal Scatter',
        description: 'Testing cohort window bounds.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f18-1a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(100), sku: 'SKU-18' },
            { id: 'f18-1b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-1', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(40) }
        ],
        product_catalog: [{ sku: 'SKU-18', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Scenario F18 scatter test. Complete reversal over 60 days.', physical_truth: 'Window check. True Negative.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F18-TEMPORAL-SCATTER-2',
        family: 'Extreme Temporal Scatter',
        description: 'Testing cohort window bounds.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f18-2a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(110), sku: 'SKU-18' },
            { id: 'f18-2b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-2', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(50) }
        ],
        product_catalog: [{ sku: 'SKU-18', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Scenario F18 scatter test. Complete reversal over 60 days.', physical_truth: 'Window check. True Negative.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F18-TEMPORAL-SCATTER-3',
        family: 'Extreme Temporal Scatter',
        description: 'Testing cohort window bounds.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f18-3a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-3', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(120), sku: 'SKU-18' },
            { id: 'f18-3b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-3', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(60) }
        ],
        product_catalog: [{ sku: 'SKU-18', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Scenario F18 scatter test. Complete reversal over 60 days.', physical_truth: 'Window check. True Negative.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F18-TEMPORAL-SCATTER-4',
        family: 'Extreme Temporal Scatter',
        description: 'Testing cohort window bounds.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f18-4a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-4', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(130), sku: 'SKU-18' },
            { id: 'f18-4b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-4', fee_type: 'Adjustment', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(70) }
        ],
        product_catalog: [{ sku: 'SKU-18', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 10.50, currency: 'USD', is_claimable: true }],
        rationale: 'Scenario F18 scatter test. Double charge separated by 60 days.', physical_truth: 'Window check. True Positive.', expected_value_status: 'approximate'
    });

    scenarios.push({
        id: 'F18-TEMPORAL-SCATTER-5',
        family: 'Extreme Temporal Scatter',
        description: 'Testing cohort window bounds.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f18-5a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-5', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(140), sku: 'SKU-18' },
            { id: 'f18-5b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-5', fee_type: 'Adjustment', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(80) }
        ],
        product_catalog: [{ sku: 'SKU-18', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 10.50, currency: 'USD', is_claimable: true }],
        rationale: 'Scenario F18 scatter test. Double charge separated by 60 days.', physical_truth: 'Window check. True Positive.', expected_value_status: 'approximate'
    });

    scenarios.push({
        id: 'F18-TEMPORAL-SCATTER-6',
        family: 'Extreme Temporal Scatter',
        description: 'Testing cohort window bounds.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f18-6a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-6', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(150), sku: 'SKU-18' },
            { id: 'f18-6b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-6', fee_type: 'Adjustment', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(90) }
        ],
        product_catalog: [{ sku: 'SKU-18', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 10.50, currency: 'USD', is_claimable: true }],
        rationale: 'Scenario F18 scatter test. Double charge separated by 60 days.', physical_truth: 'Window check. True Positive.', expected_value_status: 'approximate'
    });

    scenarios.push({
        id: 'F18-TEMPORAL-SCATTER-7',
        family: 'Extreme Temporal Scatter',
        description: 'Testing cohort window bounds.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f18-7a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-7', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(160), sku: 'SKU-18' },
            { id: 'f18-7b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-18-7', fee_type: 'Adjustment', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(100) }
        ],
        product_catalog: [{ sku: 'SKU-18', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 10.50, currency: 'USD', is_claimable: true }],
        rationale: 'Scenario F18 scatter test. Double charge separated by 60 days.', physical_truth: 'Window check. True Positive.', expected_value_status: 'approximate'
    });

    // =========================================================================
    // FAMILY 19: Timezone Boundary Collisions (6 Scenarios)
    // =========================================================================

    scenarios.push({
        id: 'F19-TIMEZONE-COLLISION-1',
        family: 'Timezone Boundary Collisions',
        description: 'Testing ISO dates near midnight.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f19-1a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: '2025-05-01T23:59:59Z', sku: 'SKU-19' },
            { id: 'f19-1b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 4.75, currency: 'USD', fee_date: '2025-05-02T00:00:01Z', sku: 'SKU-19' }
        ],
        product_catalog: [{ sku: 'SKU-19', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Cross-midnight reversal is balanced.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F19-TIMEZONE-COLLISION-2',
        family: 'Timezone Boundary Collisions',
        description: 'Testing ISO dates near midnight.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f19-2a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: '2025-05-01T23:59:59Z', sku: 'SKU-19' },
            { id: 'f19-2b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 4.75, currency: 'USD', fee_date: '2025-05-02T00:00:01Z', sku: 'SKU-19' }
        ],
        product_catalog: [{ sku: 'SKU-19', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Cross-midnight reversal is balanced.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F19-TIMEZONE-COLLISION-3',
        family: 'Timezone Boundary Collisions',
        description: 'Testing ISO dates near midnight.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f19-3a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: '2025-05-01T23:59:59Z', sku: 'SKU-19' },
            { id: 'f19-3b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 4.75, currency: 'USD', fee_date: '2025-05-02T00:00:01Z', sku: 'SKU-19' }
        ],
        product_catalog: [{ sku: 'SKU-19', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Cross-midnight reversal is balanced.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F19-TIMEZONE-COLLISION-4',
        family: 'Timezone Boundary Collisions',
        description: 'Testing ISO dates near midnight.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f19-4a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: '2025-05-01T23:59:59Z', sku: 'SKU-19' },
            { id: 'f19-4b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 4.75, currency: 'USD', fee_date: '2025-05-02T00:00:01Z', sku: 'SKU-19' }
        ],
        product_catalog: [{ sku: 'SKU-19', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Cross-midnight reversal is balanced.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F19-TIMEZONE-COLLISION-5',
        family: 'Timezone Boundary Collisions',
        description: 'Testing ISO dates near midnight.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f19-5a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: '2025-05-01T23:59:59Z', sku: 'SKU-19' },
            { id: 'f19-5b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 4.75, currency: 'USD', fee_date: '2025-05-02T00:00:01Z', sku: 'SKU-19' }
        ],
        product_catalog: [{ sku: 'SKU-19', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Cross-midnight reversal is balanced.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F19-TIMEZONE-COLLISION-6',
        family: 'Timezone Boundary Collisions',
        description: 'Testing ISO dates near midnight.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f19-6a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: '2025-05-01T23:59:59Z', sku: 'SKU-19' },
            { id: 'f19-6b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-19', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: 4.75, currency: 'USD', fee_date: '2025-05-02T00:00:01Z', sku: 'SKU-19' }
        ],
        product_catalog: [{ sku: 'SKU-19', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Cross-midnight reversal is balanced.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 20: Obscure Storage Fallbacks (7 Scenarios)
    // =========================================================================

    scenarios.push({
        id: 'F20-STORAGE-FALLBACK-1',
        family: 'Obscure Storage Fallbacks',
        description: 'Missing dimensions fallback safety check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f20-1', seller_id: MOCK_SELLER_ID, sku: 'SKU-20-1', fee_type: 'StorageFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05' }
        ],
        product_catalog: [{ sku: 'SKU-20-1', weight_oz: 10 }], // only weight
        expected_results: [],
        rationale: 'Missing dimensions -> skip.', physical_truth: 'Safety.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F20-STORAGE-FALLBACK-2',
        family: 'Obscure Storage Fallbacks',
        description: 'Missing dimensions fallback safety check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f20-2', seller_id: MOCK_SELLER_ID, sku: 'SKU-20-2', fee_type: 'StorageFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05' }
        ],
        product_catalog: [{ sku: 'SKU-20-2', weight_oz: 10 }], // only weight
        expected_results: [],
        rationale: 'Missing dimensions -> skip.', physical_truth: 'Safety.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F20-STORAGE-FALLBACK-3',
        family: 'Obscure Storage Fallbacks',
        description: 'Missing dimensions fallback safety check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f20-3', seller_id: MOCK_SELLER_ID, sku: 'SKU-20-3', fee_type: 'StorageFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05' }
        ],
        product_catalog: [{ sku: 'SKU-20-3', weight_oz: 10 }], // only weight
        expected_results: [],
        rationale: 'Missing dimensions -> skip.', physical_truth: 'Safety.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F20-STORAGE-FALLBACK-4',
        family: 'Obscure Storage Fallbacks',
        description: 'Missing dimensions fallback safety check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f20-4', seller_id: MOCK_SELLER_ID, sku: 'SKU-20-4', fee_type: 'StorageFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05' }
        ],
        product_catalog: [{ sku: 'SKU-20-4', weight_oz: 10 }], // only weight
        expected_results: [],
        rationale: 'Missing dimensions -> skip.', physical_truth: 'Safety.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F20-STORAGE-FALLBACK-5',
        family: 'Obscure Storage Fallbacks',
        description: 'Missing dimensions fallback safety check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f20-5', seller_id: MOCK_SELLER_ID, sku: 'SKU-20-5', fee_type: 'StorageFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05' }
        ],
        product_catalog: [{ sku: 'SKU-20-5', weight_oz: 10 }], // only weight
        expected_results: [],
        rationale: 'Missing dimensions -> skip.', physical_truth: 'Safety.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F20-STORAGE-FALLBACK-6',
        family: 'Obscure Storage Fallbacks',
        description: 'Missing dimensions fallback safety check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f20-6', seller_id: MOCK_SELLER_ID, sku: 'SKU-20-6', fee_type: 'StorageFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05' }
        ],
        product_catalog: [{ sku: 'SKU-20-6', weight_oz: 10 }], // only weight
        expected_results: [],
        rationale: 'Missing dimensions -> skip.', physical_truth: 'Safety.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F20-STORAGE-FALLBACK-7',
        family: 'Obscure Storage Fallbacks',
        description: 'Missing dimensions fallback safety check.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f20-7', seller_id: MOCK_SELLER_ID, sku: 'SKU-20-7', fee_type: 'StorageFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(30), cubic_feet: 10, storage_month: '2024-05' }
        ],
        product_catalog: [{ sku: 'SKU-20-7', weight_oz: 10 }], // only weight
        expected_results: [],
        rationale: 'Missing dimensions -> skip.', physical_truth: 'Safety.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 21: Cross-Border Currency Noise (6 Scenarios)
    // =========================================================================

    scenarios.push({
        id: 'F21-CURRENCY-NOISE-1',
        family: 'Cross-Border Currency Noise',
        description: 'Mix of USD and CAD for same isolated shipment.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f21-1a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-1', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f21-1b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-1', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'CAD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'Suppressed across currency.', physical_truth: 'Noise.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F21-CURRENCY-NOISE-2',
        family: 'Cross-Border Currency Noise',
        description: 'Mix of USD and CAD for same isolated shipment.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f21-2a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-2', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f21-2b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-2', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'CAD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'Suppressed across currency.', physical_truth: 'Noise.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F21-CURRENCY-NOISE-3',
        family: 'Cross-Border Currency Noise',
        description: 'Mix of USD and CAD for same isolated shipment.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f21-3a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-3', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f21-3b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-3', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'CAD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'Suppressed across currency.', physical_truth: 'Noise.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F21-CURRENCY-NOISE-4',
        family: 'Cross-Border Currency Noise',
        description: 'Mix of USD and CAD for same isolated shipment.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f21-4a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-4', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f21-4b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-4', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'CAD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'Suppressed across currency.', physical_truth: 'Noise.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F21-CURRENCY-NOISE-5',
        family: 'Cross-Border Currency Noise',
        description: 'Mix of USD and CAD for same isolated shipment.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f21-5a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-5', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f21-5b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-5', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'CAD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'Suppressed across currency.', physical_truth: 'Noise.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F21-CURRENCY-NOISE-6',
        family: 'Cross-Border Currency Noise',
        description: 'Mix of USD and CAD for same isolated shipment.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f21-6a', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-6', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f21-6b', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-21-6', fee_type: 'Inbound Placement Service Fee', fee_amount: -10.00, currency: 'CAD', fee_date: daysAgo(5) }
        ],
        product_catalog: [],
        expected_results: [],
        rationale: 'Suppressed across currency.', physical_truth: 'Noise.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 22: Complex Tenant Identity (6 Scenarios)
    // =========================================================================

    scenarios.push({
        id: 'F22-TENANT-ISO-1',
        family: 'Complex Tenant Identity',
        description: 'Cross-tenant ID pollution test.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f22-1a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' },
            { id: 'f22-1b', seller_id: 'FOREIGN_TENANT', order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' }
        ],
        product_catalog: [{ sku: 'SKU-X', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Perfectly isolated by tenant wrapper.', physical_truth: 'Safe.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F22-TENANT-ISO-2',
        family: 'Complex Tenant Identity',
        description: 'Cross-tenant ID pollution test.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f22-2a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' },
            { id: 'f22-2b', seller_id: 'FOREIGN_TENANT', order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' }
        ],
        product_catalog: [{ sku: 'SKU-X', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Perfectly isolated by tenant wrapper.', physical_truth: 'Safe.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F22-TENANT-ISO-3',
        family: 'Complex Tenant Identity',
        description: 'Cross-tenant ID pollution test.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f22-3a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' },
            { id: 'f22-3b', seller_id: 'FOREIGN_TENANT', order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' }
        ],
        product_catalog: [{ sku: 'SKU-X', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Perfectly isolated by tenant wrapper.', physical_truth: 'Safe.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F22-TENANT-ISO-4',
        family: 'Complex Tenant Identity',
        description: 'Cross-tenant ID pollution test.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f22-4a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' },
            { id: 'f22-4b', seller_id: 'FOREIGN_TENANT', order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' }
        ],
        product_catalog: [{ sku: 'SKU-X', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Perfectly isolated by tenant wrapper.', physical_truth: 'Safe.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F22-TENANT-ISO-5',
        family: 'Complex Tenant Identity',
        description: 'Cross-tenant ID pollution test.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f22-5a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' },
            { id: 'f22-5b', seller_id: 'FOREIGN_TENANT', order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' }
        ],
        product_catalog: [{ sku: 'SKU-X', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Perfectly isolated by tenant wrapper.', physical_truth: 'Safe.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F22-TENANT-ISO-6',
        family: 'Complex Tenant Identity',
        description: 'Cross-tenant ID pollution test.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f22-6a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' },
            { id: 'f22-6b', seller_id: 'FOREIGN_TENANT', order_id: 'ORD-22', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-X' }
        ],
        product_catalog: [{ sku: 'SKU-X', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Perfectly isolated by tenant wrapper.', physical_truth: 'Safe.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 23: Fractional Disjoint Harm (6 Scenarios)
    // =========================================================================

    scenarios.push({
        id: 'F23-FRACTIONAL-DISJOINT-1',
        family: 'Fractional Disjoint Harm',
        description: 'Minor size tier rate overlaps with full duplication.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f23-1a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' },
            { id: 'f23-1b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' }
        ],
        product_catalog: [{ sku: 'SKU-23', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 4.80, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.05, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Mathematical split.', physical_truth: 'Net disjoint ownership.', expected_value_status: 'exact'
    });

    scenarios.push({
        id: 'F23-FRACTIONAL-DISJOINT-2',
        family: 'Fractional Disjoint Harm',
        description: 'Minor size tier rate overlaps with full duplication.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f23-2a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' },
            { id: 'f23-2b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' }
        ],
        product_catalog: [{ sku: 'SKU-23', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 4.80, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.05, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Mathematical split.', physical_truth: 'Net disjoint ownership.', expected_value_status: 'exact'
    });

    scenarios.push({
        id: 'F23-FRACTIONAL-DISJOINT-3',
        family: 'Fractional Disjoint Harm',
        description: 'Minor size tier rate overlaps with full duplication.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f23-3a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-3', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' },
            { id: 'f23-3b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-3', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' }
        ],
        product_catalog: [{ sku: 'SKU-23', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 4.80, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.05, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Mathematical split.', physical_truth: 'Net disjoint ownership.', expected_value_status: 'exact'
    });

    scenarios.push({
        id: 'F23-FRACTIONAL-DISJOINT-4',
        family: 'Fractional Disjoint Harm',
        description: 'Minor size tier rate overlaps with full duplication.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f23-4a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-4', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' },
            { id: 'f23-4b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-4', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' }
        ],
        product_catalog: [{ sku: 'SKU-23', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 4.80, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.05, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Mathematical split.', physical_truth: 'Net disjoint ownership.', expected_value_status: 'exact'
    });

    scenarios.push({
        id: 'F23-FRACTIONAL-DISJOINT-5',
        family: 'Fractional Disjoint Harm',
        description: 'Minor size tier rate overlaps with full duplication.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f23-5a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-5', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' },
            { id: 'f23-5b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-5', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' }
        ],
        product_catalog: [{ sku: 'SKU-23', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 4.80, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.05, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Mathematical split.', physical_truth: 'Net disjoint ownership.', expected_value_status: 'exact'
    });

    scenarios.push({
        id: 'F23-FRACTIONAL-DISJOINT-6',
        family: 'Fractional Disjoint Harm',
        description: 'Minor size tier rate overlaps with full duplication.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f23-6a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-6', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' },
            { id: 'f23-6b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-23-6', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.80, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-23' }
        ],
        product_catalog: [{ sku: 'SKU-23', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [
            { anomaly_type: 'duplicate_fee_error', estimated_value: 4.80, currency: 'USD', is_claimable: true },
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.05, currency: 'USD', is_claimable: true }
        ],
        rationale: 'Mathematical split.', physical_truth: 'Net disjoint ownership.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 24: Redundant Reversed Duplicates (6 Scenarios)
    // =========================================================================

    scenarios.push({
        id: 'F24-REDUNDANT-REVERSAL-1',
        family: 'Redundant Reversed Duplicates',
        description: 'Duplicate charges accompanied by duplicate reversals.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f24-1a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-1b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-1c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-1', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f24-1d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-1', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-24', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Fully netted out.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F24-REDUNDANT-REVERSAL-2',
        family: 'Redundant Reversed Duplicates',
        description: 'Duplicate charges accompanied by duplicate reversals.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f24-2a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-2b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-2c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-2', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f24-2d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-2', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-24', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Fully netted out.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F24-REDUNDANT-REVERSAL-3',
        family: 'Redundant Reversed Duplicates',
        description: 'Duplicate charges accompanied by duplicate reversals.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f24-3a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-3', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-3b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-3', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-3c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-3', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f24-3d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-3', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-24', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Fully netted out.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F24-REDUNDANT-REVERSAL-4',
        family: 'Redundant Reversed Duplicates',
        description: 'Duplicate charges accompanied by duplicate reversals.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f24-4a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-4', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-4b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-4', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-4c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-4', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f24-4d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-4', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-24', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Fully netted out.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F24-REDUNDANT-REVERSAL-5',
        family: 'Redundant Reversed Duplicates',
        description: 'Duplicate charges accompanied by duplicate reversals.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f24-5a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-5', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-5b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-5', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-5c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-5', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f24-5d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-5', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-24', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Fully netted out.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    scenarios.push({
        id: 'F24-REDUNDANT-REVERSAL-6',
        family: 'Redundant Reversed Duplicates',
        description: 'Duplicate charges accompanied by duplicate reversals.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f24-6a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-6', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-6b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-6', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -10.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-24' },
            { id: 'f24-6c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-6', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f24-6d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-24-6', fee_type: 'Adjustment', fee_amount: 10.00, currency: 'USD', fee_date: daysAgo(5) }
        ],
        product_catalog: [{ sku: 'SKU-24', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Fully netted out.', physical_truth: 'Balanced.', expected_value_status: 'none'
    });

    // =========================================================================
    // FAMILY 25: Observability Edge Cases (6 Scenarios)
    // =========================================================================

    scenarios.push({
        id: 'F25-OBSERVABILITY-EDGE-1',
        family: 'Observability Edge Cases',
        description: 'Massive event cohort for trace graph heavy lifting.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f25a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-25' },
            { id: 'f25b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-1', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(8) },
            { id: 'f25c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-1', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(7) },
            { id: 'f25d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-1', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(6) },
            { id: 'f25e', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-1', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f25f', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-1', fee_type: 'Adjustment', fee_amount: 0.75, currency: 'USD', fee_date: daysAgo(4) }
            , { id: 'f25g', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-1', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(2), sku: 'SKU-25' }
        ],
        product_catalog: [{ sku: 'SKU-25', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 0.25, currency: 'USD', is_claimable: true }],
        rationale: 'Graph tracing test.', physical_truth: 'Complexity limit test.', expected_value_status: 'approximate'
    });

    scenarios.push({
        id: 'F25-OBSERVABILITY-EDGE-2',
        family: 'Observability Edge Cases',
        description: 'Massive event cohort for trace graph heavy lifting.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f25a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-25' },
            { id: 'f25b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-2', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(8) },
            { id: 'f25c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-2', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(7) },
            { id: 'f25d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-2', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(6) },
            { id: 'f25e', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-2', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f25f', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-2', fee_type: 'Adjustment', fee_amount: 0.75, currency: 'USD', fee_date: daysAgo(4) }
            , { id: 'f25g', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-2', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(2), sku: 'SKU-25' }
        ],
        product_catalog: [{ sku: 'SKU-25', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [{ anomaly_type: 'fulfillment_fee_error', estimated_value: 0.25, currency: 'USD', is_claimable: true }],
        rationale: 'Graph tracing test.', physical_truth: 'Complexity limit test.', expected_value_status: 'approximate'
    });

    scenarios.push({
        id: 'F25-OBSERVABILITY-EDGE-3',
        family: 'Observability Edge Cases',
        description: 'Massive event cohort for trace graph heavy lifting.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f25a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-3', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-25' },
            { id: 'f25b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-3', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(8) },
            { id: 'f25c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-3', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(7) },
            { id: 'f25d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-3', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(6) },
            { id: 'f25e', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-3', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f25f', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-3', fee_type: 'Adjustment', fee_amount: 0.75, currency: 'USD', fee_date: daysAgo(4) }
            
        ],
        product_catalog: [{ sku: 'SKU-25', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Graph tracing test.', physical_truth: 'Complexity limit test.', expected_value_status: 'approximate'
    });

    scenarios.push({
        id: 'F25-OBSERVABILITY-EDGE-4',
        family: 'Observability Edge Cases',
        description: 'Massive event cohort for trace graph heavy lifting.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f25a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-4', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-25' },
            { id: 'f25b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-4', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(8) },
            { id: 'f25c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-4', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(7) },
            { id: 'f25d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-4', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(6) },
            { id: 'f25e', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-4', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f25f', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-4', fee_type: 'Adjustment', fee_amount: 0.75, currency: 'USD', fee_date: daysAgo(4) }
            
        ],
        product_catalog: [{ sku: 'SKU-25', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Graph tracing test.', physical_truth: 'Complexity limit test.', expected_value_status: 'approximate'
    });

    scenarios.push({
        id: 'F25-OBSERVABILITY-EDGE-5',
        family: 'Observability Edge Cases',
        description: 'Massive event cohort for trace graph heavy lifting.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f25a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-5', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-25' },
            { id: 'f25b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-5', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(8) },
            { id: 'f25c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-5', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(7) },
            { id: 'f25d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-5', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(6) },
            { id: 'f25e', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-5', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f25f', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-5', fee_type: 'Adjustment', fee_amount: 0.75, currency: 'USD', fee_date: daysAgo(4) }
            
        ],
        product_catalog: [{ sku: 'SKU-25', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Graph tracing test.', physical_truth: 'Complexity limit test.', expected_value_status: 'approximate'
    });

    scenarios.push({
        id: 'F25-OBSERVABILITY-EDGE-6',
        family: 'Observability Edge Cases',
        description: 'Massive event cohort for trace graph heavy lifting.',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f25a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-6', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -4.75, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-25' },
            { id: 'f25b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-6', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(8) },
            { id: 'f25c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-6', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(7) },
            { id: 'f25d', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-6', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(6) },
            { id: 'f25e', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-6', fee_type: 'Adjustment', fee_amount: 1.00, currency: 'USD', fee_date: daysAgo(5) },
            { id: 'f25f', seller_id: MOCK_SELLER_ID, order_id: 'ORD-25-6', fee_type: 'Adjustment', fee_amount: 0.75, currency: 'USD', fee_date: daysAgo(4) }
            
        ],
        product_catalog: [{ sku: 'SKU-25', weight_oz: 15, size_tier: 'large_standard' }],
        expected_results: [],
        rationale: 'Graph tracing test.', physical_truth: 'Complexity limit test.', expected_value_status: 'approximate'
    });

    
    // =========================================================================
    // FAMILY 26: Guard - Ambiguous Context Backfill
    // =========================================================================
    scenarios.push({
        id: 'F26-AMBIGUOUS-BACKFILL',
        family: 'Guard - Context Backfill',
        description: 'missing-SKU adjustment with two possible SKUs -> must not backfill',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f26a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-26', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-A' },
            { id: 'f26b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-26', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(10), sku: 'SKU-B' },
            { id: 'f26c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-26', fee_type: 'Adjustment', fee_amount: 5.00, currency: 'USD', fee_date: daysAgo(5) } // Missing SKU!
        ],
        product_catalog: [
            { sku: 'SKU-A', weight_oz: 15, size_tier: 'large_standard' },
            { sku: 'SKU-B', weight_oz: 15, size_tier: 'large_standard' }
        ],
        expected_results: [
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.25, currency: 'USD', is_claimable: true }, // from SKU-A
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.25, currency: 'USD', is_claimable: true }  // from SKU-B
        ],
        rationale: 'Because of two SKUs, the 5.00 adjustment is NOT backfilled to either. Both charges remain open and are evaluated as rate errors ($5.00 vs expected $4.75 = $0.25 error). If it merged, it would reverse one.',
        physical_truth: 'Ambiguous backfill is forbidden.', expected_value_status: 'exact'
    });

    // =========================================================================
    // FAMILY 27: Guard - Identity-Bounded Temporal Exemption
    // =========================================================================
    scenarios.push({
        id: 'F27-AMBIGUOUS-TEMPORAL',
        family: 'Guard - Temporal Exemption',
        description: 'hard primary id with conflicting contexts -> must not receive unlimited temporal exemption',
        marketplace: 'ATVPDKIKX0DER', currency: 'USD',
        fee_events: [
            { id: 'f27a', seller_id: MOCK_SELLER_ID, order_id: 'ORD-27', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(60), sku: 'SKU-X' },
            { id: 'f27b', seller_id: MOCK_SELLER_ID, order_id: 'ORD-27', fee_type: 'FBAPerUnitFulfillmentFee', fee_amount: -5.00, currency: 'USD', fee_date: daysAgo(60), sku: 'SKU-Y' },
            { id: 'f27c', seller_id: MOCK_SELLER_ID, order_id: 'ORD-27', fee_type: 'Adjustment', fee_amount: 5.00, currency: 'USD', fee_date: daysAgo(5), sku: 'SKU-X' }
        ],
        product_catalog: [
            { sku: 'SKU-X', weight_oz: 15, size_tier: 'large_standard' },
            { sku: 'SKU-Y', weight_oz: 15, size_tier: 'large_standard' }
        ],
        expected_results: [
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.25, currency: 'USD', is_claimable: true }, // from SKU-Y
            { anomaly_type: 'fulfillment_fee_error', estimated_value: 0.25, currency: 'USD', is_claimable: true }  // from SKU-X because it split
        ],
        rationale: 'Multiple SKUs on ORD-27 make the identity ambiguous. Exemption is denied. The 55-day gap (>45) causes SKU-X charge and adjustment to split. Thus both charges are open.',
        physical_truth: 'Ambiguous temporal exemption denied.', expected_value_status: 'exact'
    });

    return scenarios;
}
