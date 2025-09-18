#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://localhost"
JWT="${JWT_TOKEN:-}"

echo "[1] Bringing up services..."
docker compose up -d --build

echo "[2] Health checks..."
curl -sf "$BASE_URL/health" | jq . >/dev/null

echo "[3] Auth profile..."
curl -sf -H "Authorization: Bearer $JWT" "$BASE_URL/api/v1/integrations/auth/me" | jq . >/dev/null

echo "[4] Start sync..."
SYNC_ID=$(curl -sf -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"syncType":"inventory","enableDetection":true}' "$BASE_URL/api/v1/integrations/sync/start" | jq -r .syncId)
echo "SYNC_ID=$SYNC_ID"

echo "[5] Trigger detection..."
curl -sf -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "{\"syncId\":\"$SYNC_ID\"}" "$BASE_URL/api/v1/integrations/detections/run" | jq . >/dev/null

echo "[6] Start dispute (mock) ..."
DETECTION_RESULTS=$(curl -sf -H "Authorization: Bearer $JWT" "$BASE_URL/api/v1/integrations/detections/status/$SYNC_ID")
DET_ID=$(echo "$DETECTION_RESULTS" | jq -r '.results[0].id')
DISPUTE=$(curl -sf -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "{\"detectionResultId\":\"$DET_ID\"}" "$BASE_URL/api/v1/integrations/disputes/start")
DISPUTE_ID=$(echo "$DISPUTE" | jq -r .dispute.id)
echo "DISPUTE_ID=$DISPUTE_ID"

echo "[7] Generate document..."
curl -sf -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "{\"claimId\":\"$DET_ID\"}" "$BASE_URL/api/v1/documents/generate" | jq . >/dev/null

echo "[8] Confirm autoclaim..."
curl -sf -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d "{\"disputeId\":\"$DISPUTE_ID\"}" "$BASE_URL/api/v1/integrations/autoclaim/confirm" | jq . >/dev/null

echo "[9] Stripe webhook test (requires stripe listen) ..."
echo "Run: stripe listen --forward-to localhost:3000/api/v1/integrations/stripe/webhook"
echo "Then: stripe trigger payment_intent.succeeded"

echo "[DONE] Smoke test prepared."


