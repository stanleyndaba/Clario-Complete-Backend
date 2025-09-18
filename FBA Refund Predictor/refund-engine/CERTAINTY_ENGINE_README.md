# Certainty Engine MVP - Implementation Guide

## Overview
The Certainty Engine MVP provides deterministic, auditable refund likelihood scoring for flagged claims from the Evidence & Value Engine. This system generates consistent probability scores and risk assessments based on invoice text analysis, claim characteristics, and evidence quality.

## 🏗️ Architecture

### Core Components
- **CertaintyEngine**: Deterministic scoring algorithm with feature extraction
- **CertaintyRepo**: Database operations via Supabase REST API
- **CertaintyController**: HTTP request handling and validation
- **CertaintyRoutes**: Express route definitions with authentication

### Data Flow
```
Flagged Claim → Feature Extraction → Deterministic Scoring → Risk Assessment → Database Persistence → API Response
```

## 📊 Scoring Algorithm

### Feature Extraction
The engine analyzes claim payloads to extract:

- **Text-based features**: Overcharge, damage, lost inventory, shipping issues, storage problems, quality concerns
- **Amount-based features**: Claim value tiers (low/medium/high), high-value penalties
- **Evidence quality**: Anomaly scores, proof bundle existence
- **Text quality**: Length, structured data presence

### Scoring Formula
```
Base Probability (50%) +
Text Features (0.05-0.15 each) +
Amount Features (-0.03 to +0.05) +
Evidence Quality (0.05-0.10) +
Text Quality (0.02-0.03) +
Hash-based Adjustment (±0.02) = Final Probability
```

### Risk Level Mapping
- **Low Risk**: < 30% refund probability
- **Medium Risk**: 30-70% refund probability  
- **High Risk**: > 70% refund probability

### Confidence Scoring
Confidence is calculated based on:
- Evidence quality (proof bundle, anomaly score)
- Text quality (length, structure)
- Issue specificity (multiple problem types)

## 🚀 API Endpoints

### POST `/api/v1/certainty/score`
Scores a flagged claim and persists the result.

**Request Body:**
```json
{
  "claim_id": "claim-uuid",
  "actor_id": "user-uuid", 
  "invoice_text": "Vendor: Amazon FBA, Overcharge detected $150.00",
  "proof_bundle_id": "proof-uuid",
  "claim_amount": 150.00,
  "anomaly_score": 0.9,
  "claim_type": "invoice_text"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "certainty_score": {
      "id": "certainty-uuid",
      "claim_id": "claim-uuid",
      "refund_probability": 0.75,
      "risk_level": "High",
      "created_at": "2024-01-15T10:00:00Z"
    },
    "scoring_details": {
      "refund_probability": 0.75,
      "risk_level": "High",
      "confidence": 0.85,
      "factors": ["Overcharge detected", "High anomaly score", "Evidence documented"]
    }
  },
  "message": "Claim scored successfully"
}
```

### GET `/api/v1/certainty/scores/:claim_id`
Retrieves all certainty scores for a specific claim.

**Response:**
```json
{
  "success": true,
  "data": {
    "claim_id": "claim-uuid",
    "certainty_scores": [...],
    "count": 2
  }
}
```

### GET `/api/v1/certainty/scores/:claim_id/latest`
Gets the most recent certainty score for a claim.

**Response:**
```json
{
  "success": true,
  "data": {
    "claim_id": "claim-uuid",
    "latest_certainty_score": {...}
  }
}
```

### GET `/api/v1/certainty/stats`
Retrieves aggregate statistics about certainty scores.

**Response:**
```json
{
  "success": true,
  "data": {
    "total_scores": 150,
    "average_probability": 0.62,
    "risk_level_distribution": {
      "Low": 45,
      "Medium": 78,
      "High": 27
    },
    "recent_scores_24h": 12
  }
}
```

## 🗄️ Database Schema

### certainty_scores Table
```sql
CREATE TABLE "certainty_scores" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL,
  refund_probability FLOAT NOT NULL CHECK (refund_probability >= 0.0 AND refund_probability <= 1.0),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT fk_certainty_scores_claim_id FOREIGN KEY (claim_id) REFERENCES "Claim"(id) ON DELETE CASCADE
);
```

### Indexes
- `idx_certainty_scores_claim_id` on `claim_id`
- `idx_certainty_scores_risk_level` on `risk_level`  
- `idx_certainty_scores_created_at` on `created_at`

### RLS Policies
- **Insert**: Allowed for authenticated users
- **Select**: Allowed for authenticated users
- **Update**: Denied (append-only)
- **Delete**: Denied (append-only)

## 🧪 Testing

### Unit Tests
```bash
# Run certainty engine tests
npm run test:certainty

# Run all tests
npm test

# Watch mode
npm run test:watch
```

### Integration Tests
```bash
# Set environment variables
export TEST_TOKEN="your-jwt-token-here"
export API_URL="http://localhost:3000"

# Run test harness
node test-certainty-engine.js
```

### Test Coverage
- ✅ Deterministic scoring verification
- ✅ Risk level mapping correctness
- ✅ Feature extraction accuracy
- ✅ Database operations (stubbed)
- ✅ API endpoint functionality
- ✅ Error handling and validation
- ✅ Authentication middleware

## 🔧 Setup & Configuration

### 1. Environment Variables
```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 2. Database Migration
```bash
# Run the migration
psql -h your_host -U your_user -d your_db -f migrations/002_certainty_scores.sql
```

### 3. Route Integration
Add to your main Express app:
```typescript
import certaintyRoutes from './src/api/routes/certaintyRoutes';

app.use('/api/v1/certainty', certaintyRoutes);
```

## 🔮 Future Enhancements

### ML Model Integration
The current deterministic scoring can be replaced with:
- **Logistic Regression**: Historical claim success rates
- **Random Forest**: Feature importance analysis
- **Neural Networks**: Complex pattern recognition
- **Ensemble Methods**: Multiple model combination

### Advanced Features
- **Actor History**: User-specific scoring based on past performance
- **Temporal Analysis**: Seasonal and trend-based adjustments
- **Market Context**: Industry-specific risk factors
- **Real-time Learning**: Continuous model updates from outcomes

### Performance Optimizations
- **Caching**: Redis-based score caching
- **Batch Processing**: Bulk scoring operations
- **Async Processing**: Background job queues
- **Horizontal Scaling**: Multiple engine instances

## 📈 Monitoring & Analytics

### Key Metrics
- **Scoring Volume**: Claims processed per time period
- **Risk Distribution**: Low/Medium/High risk percentages
- **Confidence Levels**: Average confidence scores
- **Processing Time**: Scoring latency metrics

### Business Intelligence
- **Success Rate Correlation**: Score vs. actual refund success
- **Risk-Adjusted Returns**: Expected value by risk level
- **Feature Importance**: Which factors drive high scores
- **Trend Analysis**: Scoring pattern changes over time

## 🚨 Error Handling

### Validation Errors
- Missing required fields (claim_id, actor_id, invoice_text, proof_bundle_id)
- Invalid data types
- Out-of-range values

### Service Errors
- Database connection failures
- Scoring engine failures
- Authentication/authorization issues

### Response Format
```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error description"
}
```

## 🔒 Security Considerations

### Authentication
- JWT token validation required for all endpoints
- User context available in request handlers

### Data Validation
- Input sanitization and type checking
- SQL injection prevention via parameterized queries
- XSS protection through proper output encoding

### Audit Trail
- All scoring operations are logged
- Append-only database design prevents tampering
- Deterministic hashing ensures data integrity

## 📚 API Documentation

### OpenAPI/Swagger
The API endpoints are documented with JSDoc comments and can be auto-generated into OpenAPI specifications.

### Postman Collection
A Postman collection is available for testing and integration development.

### SDK Examples
```typescript
// TypeScript client example
const certaintyScore = await certaintyClient.scoreClaim({
  claim_id: 'claim-uuid',
  actor_id: 'user-uuid',
  invoice_text: 'Vendor: Test, Overcharge $100',
  proof_bundle_id: 'proof-uuid'
});

console.log(`Risk Level: ${certaintyScore.risk_level}`);
console.log(`Probability: ${certaintyScore.refund_probability * 100}%`);
```

## 🤝 Integration Examples

### With Evidence Engine
```typescript
// After flagging a claim
const flaggedClaim = await evidenceEngine.flagClaimFromInvoiceText(/* ... */);

// Score the flagged claim
const certaintyScore = await certaintyEngine.scoreClaim({
  claim_id: flaggedClaim.claim.id,
  actor_id: flaggedClaim.claim.userId,
  invoice_text: flaggedClaim.claim.invoice_text,
  proof_bundle_id: flaggedClaim.proof.id,
  claim_amount: flaggedClaim.claim.amount,
  anomaly_score: flaggedClaim.claim.anomaly_score
});
```

### With Refund Processing
```typescript
// Before processing refund
const latestScore = await certaintyRepo.getLatestCertaintyScore(claimId);

if (latestScore.risk_level === 'High' && latestScore.refund_probability > 0.8) {
  // Auto-approve high-confidence claims
  await refundProcessor.autoApprove(claimId);
} else if (latestScore.risk_level === 'Low') {
  // Require manual review for low-risk claims
  await refundProcessor.flagForReview(claimId);
}
```

## 📞 Support & Maintenance

### Development Team
- **Lead Engineer**: [Your Name]
- **Product Owner**: [Product Manager]
- **QA Engineer**: [QA Lead]

### Monitoring
- **Health Checks**: `/api/v1/certainty/stats`
- **Error Logging**: Winston-based structured logging
- **Performance Metrics**: Response time monitoring

### Troubleshooting
- **Common Issues**: See troubleshooting guide
- **Debug Mode**: Enable verbose logging
- **Support Channels**: Slack #certainty-engine

---

**Version**: 1.0.0  
**Last Updated**: January 2024  
**Status**: MVP Complete - Ready for Production









