param(
  [string]$BaseUrl = "http://localhost",
  [string]$Jwt
)

Write-Host "[1] Bringing up services..."
docker compose up -d --build | Out-Null

Write-Host "[2] Health checks..."
Invoke-RestMethod -Uri "$BaseUrl/health" -Method GET | Out-Null

Write-Host "[3] Auth profile..."
Invoke-RestMethod -Uri "$BaseUrl/api/v1/integrations/auth/me" -Headers @{ Authorization = "Bearer $Jwt" } -Method GET | Out-Null

Write-Host "[4] Start sync..."
$syncResp = Invoke-RestMethod -Uri "$BaseUrl/api/v1/integrations/sync/start" -Headers @{ Authorization = "Bearer $Jwt"; 'Content-Type'='application/json' } -Method POST -Body (@{ syncType='inventory'; enableDetection=$true } | ConvertTo-Json)
$syncId = $syncResp.syncId
Write-Host "SYNC_ID=$syncId"

Write-Host "[5] Trigger detection..."
Invoke-RestMethod -Uri "$BaseUrl/api/v1/integrations/detections/run" -Headers @{ Authorization = "Bearer $Jwt"; 'Content-Type'='application/json' } -Method POST -Body (@{ syncId=$syncId } | ConvertTo-Json) | Out-Null

Write-Host "[6] Start dispute (mock)..."
$detRes = Invoke-RestMethod -Uri "$BaseUrl/api/v1/integrations/detections/status/$syncId" -Headers @{ Authorization = "Bearer $Jwt" } -Method GET
$detId = $detRes.results[0].id
$dispRes = Invoke-RestMethod -Uri "$BaseUrl/api/v1/integrations/disputes/start" -Headers @{ Authorization = "Bearer $Jwt"; 'Content-Type'='application/json' } -Method POST -Body (@{ detectionResultId=$detId } | ConvertTo-Json)
$disputeId = $dispRes.dispute.id
Write-Host "DISPUTE_ID=$disputeId"

Write-Host "[7] Generate document..."
Invoke-RestMethod -Uri "$BaseUrl/api/v1/documents/generate" -Headers @{ Authorization = "Bearer $Jwt"; 'Content-Type'='application/json' } -Method POST -Body (@{ claimId=$detId } | ConvertTo-Json) | Out-Null

Write-Host "[8] Confirm autoclaim..."
Invoke-RestMethod -Uri "$BaseUrl/api/v1/integrations/autoclaim/confirm" -Headers @{ Authorization = "Bearer $Jwt"; 'Content-Type'='application/json' } -Method POST -Body (@{ disputeId=$disputeId } | ConvertTo-Json) | Out-Null

Write-Host "[9] Stripe webhook test (requires stripe listen) ..."
Write-Host "Run: stripe listen --forward-to localhost:3000/api/v1/integrations/stripe/webhook"
Write-Host "Then: stripe trigger payment_intent.succeeded"

Write-Host "[DONE] Smoke test prepared."


