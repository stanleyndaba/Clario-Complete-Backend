# Workflow Orchestrator Deployment

## ✅ Deployment Status: Already Deployed

The workflow orchestrator is **already part of the Python service** and doesn't need separate deployment.

## Architecture

You have **2 deployed services**:
1. **Python Service** (`main-api`) - Contains all Python services including orchestrator
2. **Node.js Service** (`integrations-backend`) - Contains all Node.js services

## Where Orchestrator Lives

**File**: `src/services/workflow_orchestrator.py`
**Deployment**: Part of Python service (already deployed)

## How It Works

### Python Service (Internal Calls)
- Orchestrator calls Python services **directly via imports** (no HTTP)
- Example: `from src.evidence.matching_engine import EvidenceMatchingEngine`
- All Python services are in the same codebase, so direct imports work

### Node.js → Python (HTTP Calls)
- Node.js services call Python webhook endpoints via HTTP
- Example: `POST ${PYTHON_API_URL}/api/v1/workflow/sync/complete`
- Uses `PYTHON_API_URL` environment variable

### Python → Node.js (HTTP Calls)
- Python orchestrator calls Node.js services via HTTP
- Example: `POST ${INTEGRATIONS_URL}/api/v1/integrations/amazon/sync`
- Uses `INTEGRATIONS_URL` environment variable

## Webhook Endpoints (Python Service)

These endpoints are in the Python service and are **already deployed**:

- `POST /api/v1/workflow/sync/complete` - Called by Node.js when sync completes
- `POST /api/v1/workflow/detection/complete` - Called by Node.js when detection completes
- `POST /api/v1/workflow/evidence-matching/complete` - Called by Python (internal)
- `POST /api/v1/workflow/claim/submitted` - Called by Python (internal)
- `POST /api/v1/workflow/claim/rejected` - Called by external webhook handler
- `POST /api/v1/workflow/payout/received` - Called by external webhook handler
- `GET /api/v1/workflow/status/{user_id}` - Dashboard status endpoint

## Simplified Flow

```
Node.js Service:
  Sync completes → POST /api/v1/workflow/sync/complete (Python)
  Detection completes → POST /api/v1/workflow/detection/complete (Python)

Python Service:
  Webhook received → Orchestrator handles it
  Orchestrator → Direct imports (matching_engine, auto_submit, etc.)
  Orchestrator → WebSocket updates
  Orchestrator → HTTP calls to Node.js (if needed)
```

## Environment Variables Needed

**Python Service:**
- `INTEGRATIONS_URL` - Node.js service URL (for calling Node.js)
- `PYTHON_API_URL` - Python service URL (for Node.js to call back)

**Node.js Service:**
- `PYTHON_API_URL` - Python service URL (for calling webhooks)

## No Additional Deployment Needed

✅ Orchestrator is in Python service - already deployed
✅ Webhook endpoints are in Python service - already deployed
✅ All Python services use direct imports - no HTTP overhead
✅ Node.js calls Python webhooks via HTTP - works across services

## Summary

- **Orchestrator**: Already deployed (part of Python service)
- **Webhooks**: Already deployed (part of Python service)
- **Internal calls**: Direct imports (fast, no HTTP)
- **Cross-service calls**: HTTP (Node.js ↔ Python)

No separate deployment needed! 🎉

