# Workflow Orchestration Architecture

## Overview

The Clario workflow is orchestrated by a **centralized Node.js OrchestrationJobManager** that coordinates all 7 phases of the user experience. Python services trigger phases via HTTP endpoints, and the orchestrator manages the complete workflow using Bull queues and Redis.

## Architecture

```
┌─────────────────────────────────────┐
│   Python Service (main-api)         │
│   ├─ OAuth Callback                 │
│   ├─ Evidence Matching              │
│   └─ Auto-Submit Engine             │
│         ↓ HTTP POST                  │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│   Node.js Service (integrations)    │
│   ├─ OrchestrationJobManager        │
│   │  ├─ Phase 1-7 Methods           │
│   │  ├─ Bull Queue (Redis)          │
│   │  └─ WebSocket Updates            │
│   ├─ Amazon Sync                    │
│   ├─ Detection Service              │
│   └─ Workflow Routes                │
└─────────────────────────────────────┘
```

## 7-Phase Workflow

### Phase 1: Zero-Friction Onboarding
**Trigger**: OAuth callback completes  
**Location**: `src/api/auth.py`  
**Action**: Calls `POST /api/v1/workflow/phase/1`  
**Orchestrator**: `executePhase1_OAuthCompletion()`  
**Result**: Triggers background sync, sends WebSocket update

### Phase 2: Autonomous Money Discovery
**Trigger**: Sync completes  
**Location**: `Integrations-backend/src/jobs/amazonSyncJob.ts`  
**Action**: Calls `OrchestrationJobManager.triggerPhase2_SyncCompletion()`  
**Orchestrator**: `executePhase2_SyncCompletion()`  
**Result**: Triggers detection job, sends WebSocket update

### Phase 3: Intelligent Evidence Ecosystem
**Trigger**: Detection completes  
**Location**: `Integrations-backend/src/services/detectionService.ts`  
**Action**: Calls `OrchestrationJobManager.triggerPhase3_DetectionCompletion()`  
**Orchestrator**: `executePhase3_DetectionCompletion()`  
**Result**: Triggers evidence matching, sends WebSocket update

### Phase 4: Predictive Refund Orchestration
**Trigger**: Evidence matching completes  
**Location**: `src/evidence/matching_worker.py`  
**Action**: Calls `POST /api/v1/workflow/phase/4`  
**Orchestrator**: `executePhase4_EvidenceMatching()`  
**Result**: Routes claims to auto-submit (≥85%) or smart prompts (50-85%), sends WebSocket update

### Phase 5: Autonomous Recovery Pipeline
**Trigger**: Claim submitted  
**Location**: `src/evidence/auto_submit_engine.py`  
**Action**: Calls `POST /api/v1/workflow/phase/5`  
**Orchestrator**: `executePhase5_ClaimSubmission()`  
**Result**: Starts payout monitoring, sends WebSocket update

### Phase 6: Continuous Learning Brain
**Trigger**: Claim rejected by Amazon  
**Location**: External webhook handler  
**Action**: Calls `POST /api/v1/workflow/phase/6`  
**Orchestrator**: `executePhase6_ClaimRejection()`  
**Result**: Logs rejection for learning, triggers learning pipeline, sends WebSocket update

### Phase 7: Hyper-Transparency Layer
**Trigger**: Payout received  
**Location**: External webhook handler  
**Action**: Calls `POST /api/v1/workflow/phase/7`  
**Orchestrator**: `executePhase7_PayoutReceived()`  
**Result**: Processes Stripe fee (20%), generates proof packet, sends WebSocket update

## API Endpoints

### Node.js Orchestrator Endpoints

**POST** `/api/v1/workflow/phase/:phaseNumber`
- **Description**: Trigger a specific phase of the workflow
- **Parameters**: 
  - `phaseNumber` (1-7): The phase to trigger
  - `user_id` (required): User ID
  - `sync_id` (optional): Sync/Job ID
  - Additional metadata per phase
- **Example**:
  ```json
  POST /api/v1/workflow/phase/1
  {
    "user_id": "user_123",
    "seller_id": "seller_456",
    "sync_id": "oauth_user_123_1234567890"
  }
  ```

## Implementation Details

### Node.js Orchestrator
**File**: `Integrations-backend/src/jobs/orchestrationJob.ts`

- Uses **Bull queues** with Redis for job processing
- Each phase is a separate job in the queue
- WebSocket updates sent via `websocketService.sendNotificationToUser()`
- Non-blocking: failures don't break the main process

### Python Service Integration
Python services call the Node.js orchestrator via HTTP:

```python
import httpx
from src.common.config import settings

integrations_url = settings.INTEGRATIONS_URL or "http://localhost:3001"

async with httpx.AsyncClient(timeout=5.0) as client:
    await client.post(
        f"{integrations_url}/api/v1/workflow/phase/4",
        json={
            "user_id": user_id,
            "sync_id": job_id,
            "matches": matches
        },
        headers={"Content-Type": "application/json"}
    )
```

### Type Safety
The workflow route uses TypeScript type definitions to ensure only valid phase numbers (1-7) are accepted:

```typescript
type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

function isValidPhaseNumber(num: number): num is PhaseNumber {
  return Number.isInteger(num) && num >= 1 && num <= 7;
}
```

## Environment Variables

**Python Service:**
- `INTEGRATIONS_URL` - Node.js service URL (default: `http://localhost:3001`)

**Node.js Service:**
- `PYTHON_API_URL` - Python service URL (for calling Python services)
- `REDIS_URL` - Redis connection for Bull queues (default: `redis://localhost:6379`)

## Error Handling

- All orchestrator calls are **non-blocking** (fire-and-forget)
- Failures are logged but don't break the main process
- Each phase has fallback behavior if orchestrator is unavailable
- WebSocket updates are sent even if orchestrator fails

## Monitoring

- Queue statistics: `OrchestrationJobManager.getQueueStats()`
- WebSocket connections: `websocketService.getConnectedClientsCount()`
- Phase completion tracking in database (`sync_progress` table)

## Future Enhancements

- [ ] Add retries to Python POSTs (in case Node is temporarily unavailable)
- [ ] Centralized Phase Audit Log in PostgreSQL or Redis (for debugging/analytics)
- [ ] WebSocket → EventBridge mirror for external integrations
- [ ] Phase transition metrics and alerting
- [ ] Automatic retry for failed phase transitions

