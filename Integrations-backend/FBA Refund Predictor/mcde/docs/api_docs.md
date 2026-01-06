# MCDE API Documentation

## Overview

The MCDE (Manufacturing Cost Document Engine) API provides endpoints for document processing, cost estimation, and compliance validation for Amazon FBA operations.

## Base URL

```
https://api.mcde.opside.com/v1
```

## Authentication

All API requests require authentication using Bearer tokens:

```
Authorization: Bearer <your-api-token>
```

## Endpoints

### Health Check

#### GET /health

Check service health and dependencies.

**Response:**
```json
{
  "status": "healthy",
  "service": "mcde",
  "version": "1.0.0",
  "timestamp": "2024-01-15T10:30:00Z",
  "dependencies": {
    "refund_engine": "healthy"
  }
}
```

### Document Upload

#### POST /upload-document

Upload manufacturing documents for processing.

**Form Data:**
- `file`: Document file (PDF, JPG, PNG, TIFF)
- `document_type`: Type of document (invoice, receipt, etc.)
- `user_id`: User uploading the document

**Response:**
```json
{
  "document_id": "uuid-12345",
  "filename": "invoice.pdf",
  "document_type": "invoice",
  "status": "uploaded",
  "uploaded_at": "2024-01-15T10:30:00Z",
  "metadata": {
    "file_size": 1024000,
    "file_extension": ".pdf",
    "page_count": 2
  }
}
```

### Cost Estimation

#### POST /cost-estimate

Estimate manufacturing cost from uploaded document.

**Request Body:**
```json
{
  "claim_id": "claim-12345",
  "document_id": "uuid-12345",
  "processing_options": {
    "ocr_confidence_threshold": 0.8
  }
}
```

**Response:**
```json
{
  "claim_id": "claim-12345",
  "document_id": "uuid-12345",
  "estimated_cost": 150.0,
  "confidence": 0.85,
  "cost_components": {
    "material_cost": 80.0,
    "labor_cost": 40.0,
    "overhead_cost": 20.0,
    "shipping_cost": 5.0,
    "tax_cost": 5.0
  },
  "validation_status": "validated",
  "generated_at": "2024-01-15T10:30:00Z"
}
```

### Document Generation

#### POST /generate-document

Generate Amazon-compliant cost document.

**Request Body:**
```json
{
  "claim_id": "claim-12345",
  "cost_estimate": {
    "estimated_cost": 150.0,
    "cost_components": {
      "material_cost": 80.0,
      "labor_cost": 40.0,
      "overhead_cost": 20.0,
      "shipping_cost": 5.0,
      "tax_cost": 5.0
    }
  },
  "document_type": "cost_document"
}
```

**Response:**
```json
{
  "claim_id": "claim-12345",
  "document_url": "https://mcde-documents.s3.amazonaws.com/claim-12345/cost_document.pdf",
  "document_type": "cost_document",
  "generated_at": "2024-01-15T10:30:00Z",
  "status": "generated"
}
```

### Compliance Validation

#### POST /validate-compliance

Validate document compliance with Amazon requirements.

**Request Body:**
```json
{
  "claim_id": "claim-12345",
  "document_id": "uuid-12345",
  "cost_data": {
    "estimated_cost": 150.0,
    "cost_components": {
      "material_cost": 80.0,
      "labor_cost": 40.0,
      "overhead_cost": 20.0,
      "shipping_cost": 5.0,
      "tax_cost": 5.0
    }
  }
}
```

**Response:**
```json
{
  "claim_id": "claim-12345",
  "is_compliant": true,
  "validation_errors": [],
  "compliance_score": 0.95,
  "validated_at": "2024-01-15T10:30:00Z"
}
```

### Refund Engine Callback

#### POST /refund-engine-callback

Handle callbacks from Refund Engine service.

**Request Body:**
```json
{
  "claim_id": "claim-12345",
  "event_type": "cost_validation_request",
  "data": {
    "cost_estimate": 150.0,
    "confidence": 0.85
  }
}
```

**Response:**
```json
{
  "status": "received",
  "processed_at": "2024-01-15T10:30:00Z"
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid request parameters",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 413 Payload Too Large
```json
{
  "error": "File too large. Maximum size: 50MB",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Rate Limiting

- **Upload endpoints**: 10 requests per minute
- **Processing endpoints**: 20 requests per minute
- **Health check**: 60 requests per minute

## File Upload Limits

- **Maximum file size**: 50MB
- **Supported formats**: PDF, JPG, JPEG, PNG, TIFF
- **Maximum pages**: 50 pages per document

## Integration with Refund Engine

MCDE integrates bidirectionally with the Refund Engine:

1. **MCDE → Refund Engine**: Cost validation, feature sharing
2. **Refund Engine → MCDE**: Document generation requests, callback processing

## Security

- All data is encrypted at rest
- API tokens are required for all endpoints
- Audit trails are maintained for all operations
- GDPR compliance for data handling

## Monitoring

- Request/response logging
- Performance metrics
- Error tracking
- Health monitoring

## Support

For API support and questions:
- Email: api-support@opside.com
- Documentation: https://docs.mcde.opside.com
- Status page: https://status.mcde.opside.com 