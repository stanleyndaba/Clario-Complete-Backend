# Agent 3: Calibration Workflow

Standard operating procedure for promoting an algorithm from the Archive to the Frozen Core.

## Step 1: Lab Deployment
1. Identify the target algorithm package in `/archive/`.
2. Move the implementation and its helpers to `/lab/active_detector/`.
3. Update the `README.md` and `STATUS.md` in the lab.

## Step 2: Calibration & Hardening
1. Use the `harness_template.ts` to build a localized test runner.
2. Define failure scenarios in `scenario_template.ts`.
3. Conduct 3 rounds of the "Detective Audit" (documented in `audit_template.md`).
4. Hardened logic to reach >80% precision threshold.

## Step 3: Core Promotion
1. Move the hardened files to `src/services/detection/core/detectors/[new_detector_package]`.
2. Standardize imports (using `core`/`database`/`utils` standards).
3. Export the detector through `src/services/detection/core/registry/index.ts`.
4. Update `DETECTOR_STATUS.md` to indicate "Frozen" status.

## Step 4: Orchestration Integration
1. Add the new `run*` call to `enhancedDetectionService.ts`.
2. Verify impact aggregation logic.
