# Agent 3: Archive Inventory

This document tracks all uncalibrated algorithms preserved in the Agent 3 Archive. These algorithms are kept for future testing and calibration but are strictly isolated from production runtime paths.

## 📦 Uncalibrated Algorithm Inventory (19 Total)

| Algorithm Name | Original Lead | Archived Path | Package Completeness |
| :--- | :--- | :--- | :--- |
| **Account Health Impact** | - | `archive/uncalibrated_algorithms/accountHealthImpactAlgorithm.ts` | Complete |
| **Advertising Auditor** | - | `archive/uncalibrated_algorithms/advertisingAlgorithms.ts` | Complete |
| **Chargeback Monitor** | - | `archive/uncalibrated_algorithms/chargebackAlgorithms.ts` | Complete |
| **Delayed Revenue Impact** | - | `archive/uncalibrated_algorithms/delayedRevenueImpactAlgorithm.ts` | Complete |
| **False Closed Case** | - | `archive/uncalibrated_algorithms/falseClosedCaseAlgorithm.ts` | Complete |
| **Fee Drift Trend** | - | `archive/uncalibrated_algorithms/feeDriftTrendAlgorithm.ts` | Complete |
| **Fee Misclassification** | - | `archive/uncalibrated_algorithms/feeMisclassificationAlgorithm.ts` | Complete |
| **Fraud Detector** | - | `archive/uncalibrated_algorithms/fraudAlgorithms.ts` | Complete |
| **Inventory Shrinkage Drift** | - | `archive/uncalibrated_algorithms/inventoryShrinkageDriftAlgorithm.ts` | Complete |
| **Order Discrepancy** | - | `archive/uncalibrated_algorithms/orderDiscrepancyAlgorithm.ts` | Complete |
| **Phantom Refund** | - | `archive/uncalibrated_algorithms/phantomRefundAlgorithm.ts` | Complete |
| **Policy Claim Gaps** | - | `archive/uncalibrated_algorithms/policyClaimGapsAlgorithm.ts` | Complete |
| **Refund Price Shortfall** | - | `archive/uncalibrated_algorithms/refundPriceShortfallAlgorithm.ts` | Complete |
| **Reimbursement Delay** | - | `archive/uncalibrated_algorithms/reimbursementDelayAlgorithm.ts` | Complete |
| **Reimbursement Underpayment** | - | `archive/uncalibrated_algorithms/reimbursementUnderpaymentAlgorithm.ts` | Complete |
| **Removal Auditor** | - | `archive/uncalibrated_algorithms/removalAlgorithms.ts` | Complete |
| **Return Abuse Detector** | - | `archive/uncalibrated_algorithms/returnAbuseAlgorithm.ts` | Complete |
| **Silent Suppression** | - | `archive/uncalibrated_algorithms/silentSuppressionAlgorithm.ts` | Complete |
| **SLA Breach Compensation** | - | `archive/uncalibrated_algorithms/slaBreachCompensationAlgorithm.ts` | Complete |

## 🛠️ Shared Archive Context
- **Shared Utilities**: `archive/uncalibrated_algorithms/shared/tenantUtils.ts` (Isolated copy for archive stability).

## 🛂 Access Policy
1. Archive algorithms MUST NOT be imported into `src/` (outside the archive itself).
2. Archive algorithms MUST NOT be referenced in the production `registry/index.ts`.
3. Promotion to production requires the full **Calibration Workflow**.
