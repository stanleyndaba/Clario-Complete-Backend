# Agent 3: Core Architecture (Refactored)

The Agent 3 Detection Engine is organized into a strict hierarchy to ensure runtime safety and development clarity.

## 🏗️ Structural Layers

### 1. The Orchestration Layer (`src/services/enhancedDetectionService.ts`)
- The "Real Brain" of Detective.
- **Strict Boundary**: Only imports from the Core Registry.
- Coordinates the execution of the 7 Frozen Flagships.
- Aggregates results and triggers financial impact recording.

### 2. The Core Registry (`src/services/detection/core/registry/index.ts`)
- The single point of entry for production detectors.
- Standardizes the interface for all production-ready algorithms.
- Prevents uncalibrated code from leaking into runtime paths.

### 3. The Flagship Core (`src/services/detection/core/detectors/`)
- Isolated, high-trust algorithm implementations.
- Standardized `run*` entry points.
- Shared utilities located in `core/detectors/shared/`.

### 4. The Staging Stays in the Lab (`/lab/active_detector/`)
- A dedicated calibration surface for new detectors.
- Contains harnesses and scenario templates.
- Detectors move here for "Auditing" before being promoted to Core.

### 5. The Archive (`src/services/detection/archive/uncalibrated_algorithms/`)
- Safety vault for the 19 uncalibrated algorithms.
- Standardized package structure (Helpers + Tests + Implementation).
- Zero runtime overhead.

## 🛂 Production Safety Check
- **No Direct Imports**: Only the Registry is allowed to import from `core/detectors`.
- **Archive Isolation**: No code in `src/` (outside archive) should ever import from the `archive/` path.

## 🎖️ The Primary Seven Standard
The following detectors are established as the **Primary and Main** production standard for Agent 3. No other algorithms are permitted to execute in the production pipeline:

1. **Whale Hunter** (`lost-inventory`)
2. **Refund Trap** (`refund-gap`)
3. **Broken Goods** (`damaged-stock`)
4. **Fee Phantom** (`fee-overcharge`)
5. **Inbound Inspector** (`inbound-shortage`)
6. **Transfer Auditor** (`fc-transfer`)
7. **The Sentinel** (`reconcile-integrity`)

*Any new detection capabilities MUST be developed in the `/lab/`, undergo calibration, and be formally promoted to `core/` before entering the Production Registry.*
