# Evidence & Value Engine - MVP Implementation

## Overview
The Evidence & Value Engine provides deterministic, auditable proof generation for flagged claims. This MVP focuses on `invoice_text` processing with basic anomaly detection and entity extraction.

## Architecture

### Core Components
- **ClaimsController**: Handles flagging claims and retrieving proofs
- **EvidenceEngine**: Orchestrates proof creation and anomaly detection
- **SupabaseRepo**: Database operations via Supabase REST API
- **RLS Policies**: Enforce append-only writes for immutability

### Data Flow
```
invoice_text → anomaly detection → proof bundle → claim + evidence link → audit trail
```

## API Endpoints

### POST `/api/v1/claims/flag`
Flags invoice anomalies and persists proof.

**Request Body:**
```json
{
  "case_number": "TEST-001",
  "claim_amount": 150.00,
  "invoice_text": "Vendor: Amazon FBA, Invoice Number: INV-2024-001, Date: 2024-01-15, Overcharge detected on shipping fees $150.00",
  "actor_id": "optional-user-id"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "claim": { "id": "uuid", "anomaly_score": 0.9, ... },
    "proof": { "id": "uuid", "content_hash": "sha256", ... }
  }
}
```

### GET `/api/v1/proofs/:id`
Fetches full auditable proof bundle.

**Response:**
```json
{
  "success": true,
  "data": {
    "proof": { "id": "uuid", "payload": {...}, "content_hash": "sha256" },
    "claim": { "id": "uuid", "claimNumber": "TEST-001", ... },
    "links": [{ "claim_id": "uuid", "link_type": "invoice_text", "link_value": "...", "metadata": {...} }]
  }
}
```

## Setup

### 1. Environment Variables
```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 2. Database Schema
Ensure these tables exist in Supabase:
- `ProofBundle` (id, claim_id, payload, content_hash, created_at, created_by)
- `EvidenceLink` (id, claim_id, link_type, link_value, metadata, created_at, created_by)
- `Claim` (id, claimNumber, userId, status, amount, anomaly_score, claim_type, proof_bundle_id)

### 3. RLS Policies
Run the SQL script to enforce append-only writes:
```bash
psql -h your_host -U your_user -d your_db -f rls-policies.sql
```

## Testing

### 1. Start the API Server
```bash
cd refund-engine
npm start
```

### 2. Run Test Harness
```bash
# Set your test JWT token
export TEST_TOKEN="your-jwt-token-here"
export API_URL="http://localhost:3000"

# Run tests
node test-evidence-engine.js
```

### 3. Manual Testing with curl
```bash
# Flag a claim
curl -X POST http://localhost:3000/api/v1/claims/flag \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "case_number": "TEST-001",
    "claim_amount": 150.00,
    "invoice_text": "Vendor: Amazon FBA, Overcharge detected $150.00"
  }'

# Get proof bundle
curl -X GET http://localhost:3000/api/v1/proofs/PROOF_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Anomaly Detection

### Current Implementation (MVP)
- **Heuristic-based scoring**: Regex patterns for keywords like "overcharge", "damaged", "lost"
- **Amount detection**: Extracts dollar amounts from text
- **Score range**: 0.1 to 1.0

### Future Enhancements
- ML-based anomaly detection
- Historical pattern analysis
- Confidence scoring

## Entity Extraction

### Current Implementation (MVP)
- **Vendor**: Regex pattern for vendor names
- **Invoice Number**: Pattern matching for invoice identifiers
- **Date**: ISO date format detection
- **Metadata storage**: JSON column in EvidenceLink table

### Future Enhancements
- OCR for image-based invoices
- Advanced NER with spaCy/Hugging Face
- Structured data validation

## Security & Immutability

### RLS Policies
- **ProofBundle**: Insert only, no updates/deletes
- **EvidenceLink**: Insert only, no updates/deletes  
- **Claim**: Insert/select, status updates only, no deletes

### Hash Verification
- **Content hash**: `sha256(payload|timestamp|actor_id)`
- **Deterministic**: Same input always produces same hash
- **Auditable**: Hash frozen once created

## Monitoring & Debugging

### Check RLS Enforcement
```sql
SELECT * FROM check_rls_enforcement();
```

### Verify Proof Integrity
```sql
-- Check proof bundle hashes
SELECT id, content_hash, created_at FROM "ProofBundle";

-- Verify claim-proof linkage
SELECT c.id, c.claimNumber, p.content_hash 
FROM "Claim" c 
JOIN "ProofBundle" p ON c.proof_bundle_id = p.id;
```

## Next Steps

### Phase 2: OCR Integration
- Bull.js worker queue for image processing
- AWS Textract or Tesseract integration
- Async proof generation for invoice_url

### Phase 3: Advanced ML
- Isolation Forest for anomaly detection
- Named Entity Recognition models
- Confidence scoring and validation

## Troubleshooting

### Common Issues

1. **Authentication errors**: Ensure valid JWT token in Authorization header
2. **RLS policy violations**: Check if policies are properly applied
3. **Database connection**: Verify Supabase credentials and network access
4. **Hash mismatches**: Ensure deterministic input processing

### Debug Commands
```bash
# Check API health
curl http://localhost:3000/health

# Verify RLS policies
psql -c "SELECT * FROM check_rls_enforcement();"

# Test endpoint directly
curl -v -X POST http://localhost:3000/api/v1/claims/flag \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"case_number":"TEST","claim_amount":100,"invoice_text":"test"}'
```

## Support
For issues or questions:
1. Check the test harness output
2. Verify RLS policies are applied
3. Check Supabase logs for detailed errors
4. Ensure all environment variables are set correctly
