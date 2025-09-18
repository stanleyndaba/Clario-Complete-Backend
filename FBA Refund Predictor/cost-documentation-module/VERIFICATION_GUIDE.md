# Cost Documentation Module - Verification Guide

This guide provides comprehensive testing procedures to verify the hardening features of the Cost Documentation module.

## 🎯 Verification Goals

1. **Determinism**: Same input → identical PDF output
2. **Idempotency**: Duplicate requests return same result
3. **Security**: JWT required, tenant isolation, rate limiting
4. **Queue Management**: Retry logic, backpressure, priority handling
5. **S3 Pathing**: Stable, organized file structure

## 🧪 Test Setup

### Prerequisites

```bash
# Install dependencies
npm install

# Set environment variables
cp env.example .env
# Edit .env with your configuration

# Start services
npm run dev                    # Main service
npm run worker:cost-docs      # Worker (in another terminal)
```

### Environment Variables

```bash
# Required for testing
JWT_TOKEN=your-jwt-token-here
REDIS_URL=redis://localhost:6379
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=your-bucket
DATABASE_URL=postgresql://user:pass@localhost:5432/cost_docs

# Optional for testing
PDF_TEMPLATE_VERSION=v1.0
MAX_CONCURRENCY=2
MAX_RETRIES=3
SIGNED_URL_TTL=3600
```

## 🔍 1. Determinism Testing

### Manual Testing with curl

```bash
# Test 1: Generate PDF with same evidence
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json \
  | tee /tmp/run1.json

# Test 2: Generate again with same evidence
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json \
  | tee /tmp/run2.json

# Compare responses (excluding timestamps)
jq 'del(.pdf.generated_at, .timestamp)' /tmp/run1.json > /tmp/run1_clean.json
jq 'del(.pdf.generated_at, .timestamp)' /tmp/run2.json > /tmp/run2_clean.json
diff /tmp/run1_clean.json /tmp/run2_clean.json
```

### PDF Hash Comparison

```bash
# Download PDFs from signed URLs
curl -o /tmp/doc1.pdf "$(jq -r '.pdf.url' /tmp/run1.json)"
curl -o /tmp/doc2.pdf "$(jq -r '.pdf.url' /tmp/run2.json)"

# Compare SHA256 hashes
sha256sum /tmp/doc1.pdf /tmp/doc2.pdf

# Should show identical hashes
```

### Automated Testing

```bash
# Run determinism tests
npm test -- tests/renderer.determinism.test.ts

# Run with coverage
npm run test:coverage -- tests/renderer.determinism.test.ts
```

## 🔄 2. Idempotency Testing

### Duplicate Request Testing

```bash
# Test 1: First request
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json \
  | jq '.job_id' > /tmp/job1.txt

# Test 2: Duplicate request (should return same job)
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json \
  | jq '.job_id' > /tmp/job2.txt

# Compare job IDs
diff /tmp/job1.txt /tmp/job2.txt
# Should be identical
```

### Database Verification

```bash
# Check database for duplicate records
psql $DATABASE_URL -c "
SELECT anomaly_id, seller_id, template_version, COUNT(*) 
FROM generated_pdfs 
GROUP BY anomaly_id, seller_id, template_version 
HAVING COUNT(*) > 1;
"
# Should return no rows
```

### Automated Testing

```bash
# Run idempotency tests
npm test -- tests/idempotency-key.test.ts
```

## 🛡️ 3. Security Testing

### JWT Authentication

```bash
# Test 1: No token (should fail)
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json

# Expected: 401 Unauthorized

# Test 2: Invalid token (should fail)
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer invalid.token.here" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json

# Expected: 401 Unauthorized

# Test 3: Valid token (should succeed)
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json

# Expected: 200 OK
```

### Role-Based Authorization

```bash
# Test user role access
curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/queue/stats \
  -H "Authorization: Bearer $USER_JWT_TOKEN"

# Expected: 403 Forbidden (user can't access admin endpoints)

# Test admin role access
curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/queue/stats \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN"

# Expected: 200 OK
```

### Rate Limiting

```bash
# Test rate limiting
for i in {1..105}; do
  curl -sS -X POST \
    http://localhost:3001/api/v1/cost-documentation/generate/manual \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d @examples/evidence.lost-units.json \
    -w "%{http_code}\n" | tail -1
done | grep "429" | wc -l

# Should show some 429 responses (rate limited)
```

### Automated Testing

```bash
# Run security tests
npm test -- tests/auth.routes.test.ts
```

## ⚙️ 4. Queue Management Testing

### Retry Logic Testing

```bash
# Test 1: Check queue stats
curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/queue/stats \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN"

# Test 2: Add job to queue
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json

# Test 3: Check job status
JOB_ID=$(curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json | jq -r '.job_id')

curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/queue/job/$JOB_ID \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN
```

### Backpressure Testing

```bash
# Test 1: Pause queue
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/queue/pause \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN"

# Test 2: Add multiple jobs
for i in {1..25}; do
  curl -sS -X POST \
    http://localhost:3001/api/v1/cost-documentation/generate/auto \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d @examples/evidence.lost-units.json &
done
wait

# Test 3: Check queue depth
curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/queue/stats \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN"

# Test 4: Resume queue
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/queue/resume \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN"
```

### Automated Testing

```bash
# Run queue tests
npm test -- tests/queue.retry.test.ts
```

## 📁 5. S3 Pathing Testing

### Path Structure Verification

```bash
# Test 1: Generate PDF and check S3 key
RESPONSE=$(curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json)

# Extract S3 key from response
S3_KEY=$(echo $RESPONSE | jq -r '.pdf.s3_key')

# Verify path structure
echo $S3_KEY | grep -E "^docs/seller/[^/]+/anomalies/[^/]+/costdoc/v[0-9.]+\.pdf$"

# Expected: Path matches pattern
```

### Path Stability Testing

```bash
# Test 1: Generate with same evidence
RESPONSE1=$(curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json)

RESPONSE2=$(curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json)

# Compare S3 keys
S3_KEY1=$(echo $RESPONSE1 | jq -r '.pdf.s3_key')
S3_KEY2=$(echo $RESPONSE2 | jq -r '.pdf.s3_key')

if [ "$S3_KEY1" = "$S3_KEY2" ]; then
  echo "✅ S3 keys are identical: $S3_KEY1"
else
  echo "❌ S3 keys differ: $S3_KEY1 vs $S3_KEY2"
fi
```

### Automated Testing

```bash
# Run S3 pathing tests
npm test -- tests/s3-pathing.test.ts
```

## 🔧 6. Integration Testing

### End-to-End Workflow

```bash
# Test 1: Automatic trigger (queue job)
AUTO_RESPONSE=$(curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json)

JOB_ID=$(echo $AUTO_RESPONSE | jq -r '.job_id')
echo "Job queued: $JOB_ID"

# Test 2: Check job status
sleep 2
curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/queue/job/$JOB_ID \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN

# Test 3: Wait for completion and retrieve PDF
sleep 5
curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/anomaly/lost-units-2025-001 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Detection Pipeline Integration

```bash
# Simulate detection completion
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.overcharges.json

# Check that job was queued
curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/queue/stats \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN
```

## 📊 7. Performance Testing

### Load Testing

```bash
# Test 1: Single request timing
time curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json

# Test 2: Concurrent requests
for i in {1..10}; do
  curl -sS -X POST \
    http://localhost:3001/api/v1/cost-documentation/generate/auto \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d @examples/evidence.lost-units.json &
done
wait

# Test 3: Check queue performance
curl -sS -X GET \
  http://localhost:3001/api/v1/cost-documentation/queue/stats \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN
```

## 🚨 8. Error Handling Testing

### Invalid Input Testing

```bash
# Test 1: Missing required fields
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "lost_units"}'

# Expected: 400 Bad Request

# Test 2: Invalid anomaly type
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/manual \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json | \
  jq '. | .type = "invalid_type"' | \
  curl -sS -X POST \
    http://localhost:3001/api/v1/cost-documentation/generate/manual \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-

# Expected: 400 Bad Request
```

### Service Failure Testing

```bash
# Test 1: Stop Redis and try to queue job
# (Stop Redis service first)
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json

# Expected: 500 Internal Server Error

# Test 2: Restart Redis and verify recovery
# (Start Redis service)
curl -sS -X POST \
  http://localhost:3001/api/v1/cost-documentation/generate/auto \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/evidence.lost-units.json

# Expected: 202 Accepted
```

## 📋 9. Test Results Summary

### Success Criteria

- ✅ **Determinism**: Same input produces identical PDF (SHA256 match)
- ✅ **Idempotency**: Duplicate requests return same result
- ✅ **Security**: JWT required, proper authorization, rate limiting
- ✅ **Queue Management**: Retry logic works, backpressure handled
- ✅ **S3 Pathing**: Stable, organized file structure
- ✅ **Error Handling**: Graceful degradation, proper error codes
- ✅ **Performance**: Reasonable response times under load

### Test Commands Summary

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- tests/renderer.determinism.test.ts
npm test -- tests/idempotency-key.test.ts
npm test -- tests/auth.routes.test.ts
npm test -- tests/queue.retry.test.ts
npm test -- tests/s3-pathing.test.ts

# Run with coverage
npm run test:coverage

# Manual verification
./scripts/verify-determinism.sh
```

## 🔍 10. Troubleshooting

### Common Issues

1. **JWT Token Expired**: Refresh token and retry
2. **Redis Connection Failed**: Check Redis service status
3. **S3 Upload Failed**: Verify AWS credentials and bucket permissions
4. **Database Connection Failed**: Check PostgreSQL service and connection string
5. **PDF Generation Failed**: Check Puppeteer installation and memory

### Debug Mode

```bash
# Enable debug logging
DEBUG=* npm run dev

# Check service logs
tail -f logs/cost-documentation.log

# Monitor Redis queue
redis-cli monitor
```

## 📚 11. Additional Resources

- [API Documentation](./COST_DOCUMENTATION_README.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
- [Integration Examples](./examples/integration-example.ts)
- [Environment Configuration](./env.example)

---

**Note**: This verification guide assumes the service is running on `localhost:3001`. Adjust URLs and ports as needed for your environment.







