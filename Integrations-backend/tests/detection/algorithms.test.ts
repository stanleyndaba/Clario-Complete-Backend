/**
 * Unit Tests for Agent 3 Detection Algorithms
 * 
 * Tests the P0 Trinity: Whale Hunter, Refund Trap, Broken Goods Hunter
 * And all cluster algorithms: Inbound, Removal, Fraud
 */

import {
    detectLostInventory,
    SyncedData
} from '../../src/services/detection/algorithms/inventoryAlgorithms';

import {
    detectRefundWithoutReturn,
    RefundSyncedData
} from '../../src/services/detection/algorithms/refundAlgorithms';

import {
    detectDamagedInventory,
    DamagedSyncedData
} from '../../src/services/detection/algorithms/damagedAlgorithms';

import {
    detectInboundAnomalies,
    InboundSyncedData
} from '../../src/services/detection/algorithms/inboundAlgorithms';

import {
    detectRemovalAnomalies,
    RemovalSyncedData
} from '../../src/services/detection/algorithms/removalAlgorithms';

import {
    detectFraudAnomalies,
    FraudSyncedData
} from '../../src/services/detection/algorithms/fraudAlgorithms';

// Mock logger to prevent console output during tests
jest.mock('../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }
}));

describe('Agent 3 Detection Algorithms', () => {
    const sellerId = 'test-seller-123';
    const syncId = 'test-sync-456';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ============================================================================
    // P0: WHALE HUNTER - Lost Inventory Detection
    // ============================================================================

    describe('Whale Hunter - Lost Inventory', () => {
        it('should detect lost inventory when balance is less than expected', () => {
            const data: SyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inventory_ledger: [
                    {
                        id: 'event-1',
                        seller_id: sellerId,
                        sku: 'SKU-001',
                        fnsku: 'FNSKU-001',
                        asin: 'B001TEST',
                        product_name: 'Test Product',
                        event_type: 'Receipts',
                        fulfillment_center: 'PHX5',
                        quantity: 100,
                        disposition: 'SELLABLE',
                        event_date: new Date(Date.now() - 120 * 86400000).toISOString(), // 120 days ago
                        created_at: new Date().toISOString()
                    },
                    {
                        id: 'event-2',
                        seller_id: sellerId,
                        sku: 'SKU-001',
                        fnsku: 'FNSKU-001',
                        asin: 'B001TEST',
                        product_name: 'Test Product',
                        event_type: 'Shipments',
                        fulfillment_center: 'PHX5',
                        quantity: 30,
                        disposition: 'SELLABLE',
                        event_date: new Date(Date.now() - 100 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                inventory_balances: [
                    {
                        id: 'balance-1',
                        seller_id: sellerId,
                        sku: 'SKU-001',
                        fnsku: 'FNSKU-001',
                        asin: 'B001TEST',
                        product_name: 'Test Product',
                        fulfillment_center: 'PHX5',
                        available: 50, // Should be 70, so 20 units lost
                        reserved: 0,
                        inbound: 0,
                        snapshot_date: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectLostInventory(sellerId, syncId, data);

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].anomaly_type).toBe('lost_warehouse');
            expect(results[0].severity).toBeDefined();
        });

        it('should not flag when already reimbursed', () => {
            const data: SyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inventory_ledger: [
                    {
                        id: 'event-1',
                        seller_id: sellerId,
                        sku: 'SKU-001',
                        fnsku: 'FNSKU-001',
                        event_type: 'Receipts',
                        quantity: 100,
                        event_date: new Date(Date.now() - 120 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                inventory_balances: [
                    {
                        id: 'balance-1',
                        seller_id: sellerId,
                        sku: 'SKU-001',
                        fnsku: 'FNSKU-001',
                        available: 50,
                        snapshot_date: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: [
                    {
                        id: 'reimb-1',
                        seller_id: sellerId,
                        fnsku: 'FNSKU-001',
                        sku: 'SKU-001',
                        quantity_reimbursed: 20,
                        reimbursement_amount: 400,
                        currency: 'USD',
                        reimbursement_date: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    }
                ]
            };

            const results = detectLostInventory(sellerId, syncId, data);

            // Should have fewer results since reimbursement exists
            expect(results.filter(r => r.sku === 'SKU-001').length).toBe(0);
        });

        it('should return empty array when no inventory data', () => {
            const data: SyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inventory_ledger: [],
                inventory_balances: [],
                reimbursement_events: []
            };

            const results = detectLostInventory(sellerId, syncId, data);

            expect(results).toEqual([]);
        });
    });

    // ============================================================================
    // P0: REFUND TRAP - Refund Without Return Detection
    // ============================================================================

    describe('Refund Trap - Refund Without Return', () => {
        it('should detect refunds without returns after 45 days', () => {
            const data: RefundSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                refund_events: [
                    {
                        id: 'refund-1',
                        seller_id: sellerId,
                        order_id: 'ORDER-001',
                        sku: 'SKU-001',
                        refund_amount: 150,
                        currency: 'USD',
                        refund_date: new Date(Date.now() - 60 * 86400000).toISOString(), // 60 days ago
                        refund_reason: 'Customer return',
                        created_at: new Date().toISOString()
                    }
                ],
                return_events: [], // No returns!
                reimbursement_events: []
            };

            const results = detectRefundWithoutReturn(sellerId, syncId, data);

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].anomaly_type).toBe('refund_no_return');
            expect(results[0].estimated_value).toBe(150);
        });

        it('should not flag if return exists', () => {
            const data: RefundSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                refund_events: [
                    {
                        id: 'refund-1',
                        seller_id: sellerId,
                        order_id: 'ORDER-001',
                        sku: 'SKU-001',
                        refund_amount: 150,
                        currency: 'USD',
                        refund_date: new Date(Date.now() - 60 * 86400000).toISOString(),
                        refund_reason: 'Customer return',
                        created_at: new Date().toISOString()
                    }
                ],
                return_events: [
                    {
                        id: 'return-1',
                        seller_id: sellerId,
                        order_id: 'ORDER-001',
                        sku: 'SKU-001',
                        quantity_returned: 1,
                        return_date: new Date(Date.now() - 55 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectRefundWithoutReturn(sellerId, syncId, data);

            // Should not detect since return exists
            expect(results.filter(r => r.evidence.order_id === 'ORDER-001').length).toBe(0);
        });

        it('should skip refunds less than 45 days old', () => {
            const data: RefundSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                refund_events: [
                    {
                        id: 'refund-1',
                        seller_id: sellerId,
                        order_id: 'ORDER-001',
                        sku: 'SKU-001',
                        refund_amount: 150,
                        currency: 'USD',
                        refund_date: new Date(Date.now() - 30 * 86400000).toISOString(), // Only 30 days ago
                        refund_reason: 'Customer return',
                        created_at: new Date().toISOString()
                    }
                ],
                return_events: [],
                reimbursement_events: []
            };

            const results = detectRefundWithoutReturn(sellerId, syncId, data);

            // Should skip since too recent
            expect(results.filter(r => r.evidence.order_id === 'ORDER-001').length).toBe(0);
        });
    });

    // ============================================================================
    // P0: BROKEN GOODS HUNTER - Damaged Inventory Detection
    // ============================================================================

    describe('Broken Goods Hunter - Damaged Inventory', () => {
        it('should detect Amazon-fault damaged inventory', () => {
            const data: DamagedSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inventory_ledger: [
                    {
                        id: 'damage-1',
                        seller_id: sellerId,
                        sku: 'SKU-001',
                        fnsku: 'FNSKU-001',
                        event_type: 'Adjustment',
                        disposition: 'DAMAGED',
                        reason_code: 'E', // Amazon at fault
                        quantity: -10,
                        event_date: new Date(Date.now() - 60 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectDamagedInventory(sellerId, syncId, data);

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].anomaly_type).toContain('damaged');
            expect(results[0].confidence_score).toBe(0.95);
        });

        it('should skip non-Amazon fault codes', () => {
            const data: DamagedSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inventory_ledger: [
                    {
                        id: 'damage-1',
                        seller_id: sellerId,
                        sku: 'SKU-001',
                        fnsku: 'FNSKU-001',
                        event_type: 'Adjustment',
                        disposition: 'DAMAGED',
                        reason_code: 'X', // NOT Amazon at fault
                        quantity: -10,
                        event_date: new Date(Date.now() - 60 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectDamagedInventory(sellerId, syncId, data);

            // Should not detect non-Amazon fault codes
            expect(results.length).toBe(0);
        });
    });

    // ============================================================================
    // CLUSTER 1: INBOUND INSPECTOR
    // ============================================================================

    describe('Inbound Inspector - Shipment Anomalies', () => {
        it('should detect shipment shortage', () => {
            const data: InboundSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inbound_shipment_items: [
                    {
                        id: 'shipment-1',
                        seller_id: sellerId,
                        shipment_id: 'FBA-SHIP-001',
                        sku: 'SKU-001',
                        quantity_shipped: 100,
                        quantity_received: 80, // 20 short
                        shipment_status: 'CLOSED',
                        shipment_created_date: new Date(Date.now() - 120 * 86400000).toISOString(),
                        shipment_closed_date: new Date(Date.now() - 100 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectInboundAnomalies(sellerId, syncId, data);

            expect(results.length).toBeGreaterThan(0);
            const shortage = results.find(r => r.anomaly_type === 'shipment_shortage');
            expect(shortage).toBeDefined();
            expect(shortage?.evidence.shortage).toBe(20);
        });

        it('should detect missing shipment (0 received)', () => {
            const data: InboundSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inbound_shipment_items: [
                    {
                        id: 'shipment-1',
                        seller_id: sellerId,
                        shipment_id: 'FBA-SHIP-001',
                        sku: 'SKU-001',
                        quantity_shipped: 50,
                        quantity_received: 0, // Nothing received!
                        shipment_status: 'CLOSED',
                        shipment_created_date: new Date(Date.now() - 120 * 86400000).toISOString(),
                        shipment_closed_date: new Date(Date.now() - 100 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectInboundAnomalies(sellerId, syncId, data);

            const missing = results.find(r => r.anomaly_type === 'shipment_missing');
            expect(missing).toBeDefined();
            expect(missing?.severity).toBe('critical');
        });

        it('should skip shipments under 90 days', () => {
            const data: InboundSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inbound_shipment_items: [
                    {
                        id: 'shipment-1',
                        seller_id: sellerId,
                        shipment_id: 'FBA-SHIP-001',
                        sku: 'SKU-001',
                        quantity_shipped: 100,
                        quantity_received: 80,
                        shipment_status: 'CLOSED',
                        shipment_created_date: new Date(Date.now() - 60 * 86400000).toISOString(),
                        shipment_closed_date: new Date(Date.now() - 50 * 86400000).toISOString(), // Only 50 days ago
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectInboundAnomalies(sellerId, syncId, data);

            expect(results.length).toBe(0);
        });
    });

    // ============================================================================
    // CLUSTER 2: REMOVAL TRACKER
    // ============================================================================

    describe('Removal Tracker - Removal Anomalies', () => {
        it('should detect unfulfilled removal', () => {
            const data: RemovalSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                removal_orders: [
                    {
                        id: 'removal-1',
                        seller_id: sellerId,
                        order_id: 'REMOVAL-001',
                        order_type: 'Return',
                        order_status: 'completed',
                        sku: 'SKU-001',
                        requested_quantity: 50,
                        shipped_quantity: 0, // Nothing shipped!
                        request_date: new Date(Date.now() - 90 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectRemovalAnomalies(sellerId, syncId, data);

            const unfulfilled = results.find(r => r.anomaly_type === 'removal_unfulfilled');
            expect(unfulfilled).toBeDefined();
            expect(unfulfilled?.evidence.requested).toBe(50);
            expect(unfulfilled?.evidence.processed).toBe(0);
        });

        it('should detect incomplete disposal', () => {
            const data: RemovalSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                removal_orders: [
                    {
                        id: 'removal-1',
                        seller_id: sellerId,
                        order_id: 'REMOVAL-001',
                        order_type: 'Disposal',
                        order_status: 'completed',
                        sku: 'SKU-001',
                        requested_quantity: 100,
                        disposed_quantity: 70, // 30 missing
                        request_date: new Date(Date.now() - 90 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectRemovalAnomalies(sellerId, syncId, data);

            const incomplete = results.find(r => r.anomaly_type === 'disposal_error');
            expect(incomplete).toBeDefined();
        });
    });

    // ============================================================================
    // CLUSTER 3: FRAUD HUNTER
    // ============================================================================

    describe('Fraud Hunter - Return Fraud', () => {
        it('should detect switcheroo fraud', () => {
            const data: FraudSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                return_events: [
                    {
                        id: 'return-1',
                        seller_id: sellerId,
                        order_id: 'ORDER-001',
                        sku: 'SKU-001',
                        detailed_disposition: 'SWITCHEROO',
                        quantity_returned: 1,
                        refund_amount: 200,
                        return_date: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                refund_events: [],
                reimbursement_events: []
            };

            const results = detectFraudAnomalies(sellerId, syncId, data);

            const switcheroo = results.find(r => r.anomaly_type === 'switcheroo');
            expect(switcheroo).toBeDefined();
            expect(switcheroo?.severity).toBe('critical');
            expect(switcheroo?.confidence_score).toBe(0.95);
        });

        it('should detect returnless refund abuse pattern', () => {
            const now = Date.now();
            const data: FraudSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                return_events: [],
                refund_events: [
                    // 5 returnless refunds from same customer in 90 days
                    {
                        id: 'refund-1',
                        seller_id: sellerId,
                        order_id: 'ORDER-001',
                        refund_amount: 50,
                        refund_date: new Date(now - 10 * 86400000).toISOString(),
                        customer_id: 'ABUSER-001',
                        is_returnless: true,
                        created_at: new Date().toISOString()
                    },
                    {
                        id: 'refund-2',
                        seller_id: sellerId,
                        order_id: 'ORDER-002',
                        refund_amount: 75,
                        refund_date: new Date(now - 20 * 86400000).toISOString(),
                        customer_id: 'ABUSER-001',
                        is_returnless: true,
                        created_at: new Date().toISOString()
                    },
                    {
                        id: 'refund-3',
                        seller_id: sellerId,
                        order_id: 'ORDER-003',
                        refund_amount: 100,
                        refund_date: new Date(now - 30 * 86400000).toISOString(),
                        customer_id: 'ABUSER-001',
                        is_returnless: true,
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            const results = detectFraudAnomalies(sellerId, syncId, data);

            const abuse = results.find(r => r.anomaly_type === 'returnless_refund_abuse');
            expect(abuse).toBeDefined();
            expect(abuse?.evidence.refund_count).toBe(3);
            expect(abuse?.evidence.customer_id).toBe('ABUSER-001');
        });

        it('should detect wrong item returned', () => {
            const data: FraudSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                return_events: [
                    {
                        id: 'return-1',
                        seller_id: sellerId,
                        order_id: 'ORDER-001',
                        sku: 'SKU-001',
                        detailed_disposition: 'WRONG_ITEM',
                        quantity_returned: 1,
                        refund_amount: 150,
                        return_date: new Date().toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                refund_events: [],
                reimbursement_events: []
            };

            const results = detectFraudAnomalies(sellerId, syncId, data);

            const wrongItem = results.find(r => r.anomaly_type === 'wrong_item_returned');
            expect(wrongItem).toBeDefined();
        });
    });

    // ============================================================================
    // EDGE CASES
    // ============================================================================

    describe('Edge Cases', () => {
        it('should handle empty data gracefully', () => {
            expect(() => detectLostInventory(sellerId, syncId, {
                seller_id: sellerId,
                sync_id: syncId,
                inventory_ledger: [],
                inventory_balances: [],
                reimbursement_events: []
            })).not.toThrow();

            expect(() => detectRefundWithoutReturn(sellerId, syncId, {
                seller_id: sellerId,
                sync_id: syncId,
                refund_events: [],
                return_events: [],
                reimbursement_events: []
            })).not.toThrow();

            expect(() => detectDamagedInventory(sellerId, syncId, {
                seller_id: sellerId,
                sync_id: syncId,
                inventory_ledger: [],
                reimbursement_events: []
            })).not.toThrow();
        });

        it('should handle null/undefined fields in data', () => {
            const data: InboundSyncedData = {
                seller_id: sellerId,
                sync_id: syncId,
                inbound_shipment_items: [
                    {
                        id: 'shipment-1',
                        seller_id: sellerId,
                        shipment_id: 'FBA-SHIP-001',
                        sku: 'SKU-001',
                        quantity_shipped: 100,
                        quantity_received: undefined as any, // Undefined
                        shipment_status: 'CLOSED',
                        shipment_created_date: new Date(Date.now() - 120 * 86400000).toISOString(),
                        shipment_closed_date: new Date(Date.now() - 100 * 86400000).toISOString(),
                        created_at: new Date().toISOString()
                    }
                ],
                reimbursement_events: []
            };

            expect(() => detectInboundAnomalies(sellerId, syncId, data)).not.toThrow();
        });
    });
});
