# Agent 3: Detector Status Manifest

This document tracks the calibration and production status of all Agent 3 detection algorithms.

## ❄️ Frozen Flagship Core (Production)
These detectors have been hardened, calibrated, and are currently active in the production pipeline via the `EnhancedDetectionService`.

| Detector Name | ID | Status | Calibration Standard | Last Hardened |
| :--- | :--- | :--- | :--- | :--- |
| **Whale Hunter** | `lost-inventory` | FROZEN | **Deterministic freeze** | 2026-03-01 |
| **Refund Trap** | `refund-gap` | FROZEN | **Precision-locked** | 2026-03-05 |
| **Broken Goods** | `damaged-stock` | FROZEN | **Zero-FP required** | 2026-03-08 |
| **Fee Phantom** | `fee-overcharge` | FROZEN | **Deterministic freeze** | 2026-03-10 |
| **Inbound Inspector** | `inbound-shortage` | FROZEN | **Precision-locked** | 2026-03-12 |
| **Transfer Auditor** | `fc-transfer` | FROZEN | **Zero-FP required** | 2026-03-14 |
| **The Sentinel** | `sentinel` | FROZEN | **Deterministic freeze** | 2026-03-16 |

## 🧪 Lab: Staging & Calibration
Detectors currently under review or undergoing calibration in the staging surface.

| Detector Name | ID | Lab Lead | Status | Target Freeze |
| :--- | :--- | :--- | :--- | :--- |
| *None* | - | - | Ready | - |

## 📦 Archive: Uncalibrated Algorithms
Preserved for future testing. These are NOT imported into production runtime paths.

- Contains 19 early-stage algorithms.
- See `/src/services/detection/archive/uncalibrated_algorithms/` for source.
