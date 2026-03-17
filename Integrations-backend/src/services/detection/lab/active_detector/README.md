# Agent 3 Lab Surface - Active Calibration

This directory is the dedicated staging surface for calibrating and hardening new detectors before they are moved to the production core.

## Active Detector Workflow

1.  **Stage**: Place the detector logic in this directory (or a subdirectory).
2.  **Scenario**: Create a `scenario.ts` to define the test cases.
3.  **Harness**: Use the `harness.ts` to run the detector against the scenarios.
4.  **Audit**: Document the results in `audit.md`.
5.  **Status**: Update `STATUS.md` with calibration progress.

## Templates

- [audit_template.md](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/detection/lab/active_detector/audit_template.md)
- [scenario_template.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/detection/lab/active_detector/scenario_template.ts)
- [harness_template.ts](file:///c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/services/detection/lab/active_detector/harness_template.ts)
