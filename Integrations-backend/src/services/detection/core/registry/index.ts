/**
 * Agent 3 Core Production Registry
 * 
 * STRICT BOUNDARY: This registry exports ONLY the 7 frozen flagship detectors.
 * These are the only algorithms trusted for production runtime execution.
 */

// =====================================================
// FROZEN FLAGSHIP DETECTORS (CORE)
// =====================================

// 1. Whale Hunter (Inventory Disappearance)
export { detectLostInventory, runLostInventoryDetection } from '../detectors/inventoryAlgorithms';

// 2. Transfer Loss (Warehouse Transfer Failures)
export { detectWarehouseTransferLoss, runTransferLossDetection } from '../detectors/warehouseTransferLossAlgorithm';

// 3. Inbound Inspector (Shipment Ingress Anomalies)
export { detectInboundAnomalies, runInboundDetection } from '../detectors/inboundAlgorithms';

// 4. Broken Goods Hunter (Warehouse Damage)
export { detectDamagedInventory, runDamagedInventoryDetection } from '../detectors/damagedAlgorithms';

// 5. Refund Trap (Refund Without Return)
export { detectRefundWithoutReturn, runRefundWithoutReturnDetection } from '../detectors/refundAlgorithms';

// 6. Fee Phantom (Fee Overcharges)
export { detectAllFeeOvercharges, runFeeOverchargeDetection } from '../detectors/feeAlgorithms';

// 7. The Sentinel (Reconciliation Integrity)
export { detectDuplicateMissedReimbursements, runSentinelDetection, storeSentinelResults as storeSentinelDetectionResults } from '../detectors/duplicateMissedReimbursementAlgorithm';

// =====================================================
// PRODUCTION ALGORITHM REGISTRY
// =====================================

import { detectLostInventory } from '../detectors/inventoryAlgorithms';
import { detectWarehouseTransferLoss } from '../detectors/warehouseTransferLossAlgorithm';
import { detectInboundAnomalies } from '../detectors/inboundAlgorithms';
import { detectDamagedInventory } from '../detectors/damagedAlgorithms';
import { detectRefundWithoutReturn } from '../detectors/refundAlgorithms';
import { detectAllFeeOvercharges } from '../detectors/feeAlgorithms';
import { detectDuplicateMissedReimbursements } from '../detectors/duplicateMissedReimbursementAlgorithm';

/**
 * Production-safe registry of anomaly types to their respective core detectors.
 */
export const algorithmRegistry = {
    // Inventory & Transfers
    'lost_warehouse': detectLostInventory,
    'lost_inbound': detectLostInventory,
    'warehouse_transfer_loss': detectWarehouseTransferLoss,

    // Damage & Returns
    'damaged_warehouse': detectDamagedInventory,
    'damaged_inbound': detectDamagedInventory,
    'refund_no_return': detectRefundWithoutReturn,

    // Fees & Integrity
    'fee_overcharge': detectAllFeeOvercharges,
    'duplicate_reimbursement': detectDuplicateMissedReimbursements,
    'missed_reimbursement': detectDuplicateMissedReimbursements,
};

export type RegisteredAnomalyType = keyof typeof algorithmRegistry;
