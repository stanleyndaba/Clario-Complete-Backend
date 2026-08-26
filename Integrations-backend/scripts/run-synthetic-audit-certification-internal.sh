#!/usr/bin/env bash
set -euo pipefail

# Complete bounded internal certification for S0–S11.
# Deliberately excluded: legacy detectionService Redis queue tests and Transfer-positive
# truth tests. Synthetic CSV execution invokes the enhanced non-Transfer pipeline
# synchronously and must remain Redis-independent and Transfer-prohibited.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./node_modules/.bin/jest --runInBand \
  tests/services/syntheticAuditCertificationMatrix.test.ts \
  tests/services/syntheticAuditCertificationFixtureContract.test.ts \
  tests/services/csvIngestionService.repair.test.ts \
  tests/services/manualAuditTruthPhase1.test.ts \
  tests/services/syntheticAuditExecutionContext.test.ts \
  tests/services/enhancedDetectionService.syntheticTraining.test.ts \
  tests/services/auditRunService.syntheticTraining.test.ts \
  tests/services/auditRunService.csvUpload.test.ts \
  tests/services/csvDetectionFallbackSafety.test.ts \
  tests/routes/detectionRoutes.syntheticBoundary.test.ts \
  tests/routes/csvUploadRoutes.syntheticTraining.test.ts \
  tests/middleware/userIdMiddleware.syntheticTraining.test.ts \
  tests/config/corsConfig.syntheticTraining.test.ts \
  tests/services/inboundInspectorP1Regression.test.ts \
  tests/services/fulfillmentInboundV0Service.test.ts \
  tests/services/feeAlgorithmsPersistence.test.ts \
  tests/services/sentinelReviewValueBoundary.test.ts \
  tests/services/whaleHunterPersistenceContract.test.ts \
  tests/services/whaleHunterReimbursementIdentity.test.ts \
  tests/services/connectedAuditTruthService.test.ts
