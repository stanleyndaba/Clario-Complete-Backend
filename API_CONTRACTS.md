# API Contracts - Version 1.0

## 🔒 **Locked JSON Schemas for Frontend/Backend Alignment**

This document defines the stable API contracts to prevent frontend/backend drift. All endpoints return these exact JSON schemas.

---

## 📋 **API Endpoints Overview**

| Endpoint | Method | Description | Response Schema |
|----------|--------|-------------|-----------------|
| `/api/auth/me` | GET | Get current user profile | `UserProfile` |
| `/api/auth/amazon/login` | GET | Initiate Amazon OAuth | `AmazonLoginResponse` |
| `/api/auth/logout` | POST | Logout user | `LogoutResponse` |
| `/api/integrations/connect` | POST | Connect integration | `IntegrationInfo` |
| `/api/sync/start` | POST | Start data sync | `SyncJob` |
| `/api/sync/status` | GET | Get sync status | `SyncJob` |
| `/api/sync/activity` | GET | Get sync activity | `SyncActivityResponse` |
| `/api/detections/run` | POST | Run claim detection | `DetectionJob` |
| `/api/detections/status/{id}` | GET | Get detection status | `DetectionResult` |
| `/api/recoveries` | GET | List recoveries | `RecoveryListResponse` |
| `/api/recoveries/{id}` | GET | Get recovery details | `Recovery` |
| `/api/recoveries/{id}/status` | GET | Get recovery status | `RecoveryStatusResponse` |
| `/api/claims/{id}/submit` | POST | Submit claim | `ClaimSubmissionResponse` |
| `/api/documents` | GET | List documents | `DocumentListResponse` |
| `/api/documents/{id}` | GET | Get document details | `Document` |
| `/api/documents/{id}/view` | GET | Get view URL | `DocumentViewResponse` |
| `/api/documents/{id}/download` | GET | Get download URL | `DocumentDownloadResponse` |
| `/api/documents/upload` | POST | Upload document | `DocumentUploadResponse` |
| `/api/metrics/recoveries` | GET | Get recovery metrics | `RecoveryMetrics` |
| `/api/metrics/dashboard` | GET | Get dashboard metrics | `DashboardMetrics` |

---

## 🔐 **Authentication**

All protected endpoints require JWT Bearer token in Authorization header:
```
Authorization: Bearer <jwt_token>
```

### Test Token for Development:
```
Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdDEyMyIsImV4cCI6OTk5OTk5OTk5OX0.KeaXK1WNm3wMZ-GDS81Ir8fe0qpft8iNw3xmNr4ShXY
```

---

## 📊 **Core Schemas**

### UserProfile
```json
{
  "id": "string",
  "email": "string",
  "name": "string",
  "amazon_connected": true,
  "stripe_connected": true,
  "created_at": "2025-01-01T00:00:00Z",
  "last_login": "2025-01-07T19:41:10.888495Z"
}
```

### Recovery (Claim)
```json
{
  "id": "recovery_user123_1",
  "claim_id": "CLM-000123",
  "type": "lost_inventory",
  "status": "submitted",
  "amount": 245.80,
  "currency": "USD",
  "created_at": "2025-01-01T10:00:00Z",
  "updated_at": "2025-01-07T15:30:00Z",
  "expected_payout_date": "2025-01-14T00:00:00Z",
  "confidence_score": 0.88,
  "evidence_count": 4,
  "auto_submit_ready": true,
  "amazon_case_id": "AMZ-12345678",
  "timeline": [
    {
      "status": "detected",
      "timestamp": "2025-01-01T10:00:00Z",
      "description": "Claim detected by ML system"
    }
  ],
  "evidence": [
    {
      "id": "ev_001",
      "type": "invoice",
      "url": "/api/documents/ev_001/view",
      "uploaded_at": "2025-01-01T09:45:00Z"
    }
  ],
  "metadata": {
    "sku": "WTR-BTL-32OZ",
    "asin": "B08XYZ1234",
    "fulfillment_center": "JFK8",
    "quantity_affected": 5
  }
}
```

### Document (Evidence)
```json
{
  "id": "doc_user123_1",
  "claim_id": "CLM-000123",
  "type": "invoice",
  "filename": "invoice_001.pdf",
  "size_bytes": 1024000,
  "uploaded_at": "2025-01-01T09:45:00Z",
  "view_url": "/api/documents/doc_user123_1/view",
  "download_url": "/api/documents/doc_user123_1/download",
  "status": "processed",
  "ocr_text": "Sample invoice OCR text with amount $245.80",
  "extracted_data": {
    "amount": 245.80,
    "date": "2025-01-01",
    "vendor": "Amazon FBA",
    "sku": "WTR-BTL-32OZ",
    "quantity": 5,
    "unit_price": 49.16
  },
  "metadata": {
    "pages": 1,
    "resolution": "300dpi",
    "language": "en",
    "confidence_score": 0.95
  }
}
```

### RecoveryMetrics
```json
{
  "period": "30d",
  "start_date": "2025-08-08T19:47:57.961737Z",
  "end_date": "2025-09-07T19:47:57.961737Z",
  "totals": {
    "total_claims": 45,
    "total_amount": 12450.80,
    "approved_claims": 38,
    "approved_amount": 10850.30,
    "pending_claims": 5,
    "pending_amount": 1200.50,
    "rejected_claims": 2,
    "rejected_amount": 400.00
  },
  "success_rate": 0.844,
  "average_claim_amount": 276.68,
  "recent_activity": [
    {
      "date": "2025-01-07",
      "claims_processed": 2,
      "amount_recovered": 150.50,
      "claims_approved": 1
    }
  ],
  "upcoming_payouts": [
    {
      "id": "recovery_001",
      "claim_id": "CLM-000123",
      "amount": 245.80,
      "expected_date": "2025-01-14T00:00:00Z",
      "status": "approved",
      "confidence": 0.95
    }
  ],
  "monthly_breakdown": [
    {
      "month": "2024-12",
      "claims": 12,
      "amount": 3250.40,
      "success_rate": 0.83
    }
  ],
  "top_claim_types": [
    {
      "type": "lost_inventory",
      "count": 18,
      "total_amount": 5400.20,
      "success_rate": 0.89
    }
  ]
}
```

---

## 🔄 **Service Integration Status**

| Service | Status | Base URL | Endpoints Connected |
|---------|--------|----------|-------------------|
| Smart Inventory Sync | ✅ Ready | `http://localhost:3001` | `/sync/start`, `/sync/status`, `/sync/activity` |
| Dispute Automation | ✅ Ready | `http://localhost:3002` | `/disputes`, `/disputes/{id}/submit` |
| Cost Documentation | ✅ Ready | `http://localhost:3003` | `/cost-docs/generate`, `/cost-docs/status` |
| Stripe Payments | ✅ Ready | `http://localhost:4000` | `/stripe/charge-commission`, `/stripe/transaction` |

---

## 🧪 **Testing Endpoints**

### Health Check
```bash
GET http://localhost:8000/health
```

### API Documentation
```bash
GET http://localhost:8000/docs
```

### Test Authentication
```bash
GET http://localhost:8000/api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdDEyMyIsImV4cCI6OTk5OTk5OTk5OX0.KeaXK1WNm3wMZ-GDS81Ir8fe0qpft8iNw3xmNr4ShXY
```

### Test Recoveries List
```bash
GET http://localhost:8000/api/recoveries
Authorization: Bearer <token>
```

### Test Metrics
```bash
GET http://localhost:8000/api/metrics/recoveries
Authorization: Bearer <token>
```

---

## 📝 **Version Control**

- **API Version**: 1.0.0
- **Schema Version**: 1.0.0
- **Last Updated**: 2025-01-07T00:00:00Z
- **Breaking Changes**: None (v1.0.0 is stable)

---

## 🚀 **Frontend Integration Ready**

All endpoints are:
- ✅ **CORS enabled** for frontend domains
- ✅ **JWT authenticated** with proper error handling
- ✅ **Schema validated** with Pydantic models
- ✅ **Service connected** to existing microservices
- ✅ **Error handled** with consistent error responses
- ✅ **Documented** with OpenAPI/Swagger

**Ready for frontend development!** 🎯





