# Clario Complete Backend Workflow Plan

## Current Status

✅ **Agent 1: Discovery Agent (Claim Detection)**
- Fully functional end-to-end
- Synthetic dataset generation (3,000 samples)
- Training, evaluation, stress tests complete
- Stable predictions
- **STATUS: DONE - DO NOT MODIFY**

---

## Remaining Agents to Build (1-by-1, with permission)

### Agent 4: Evidence Ingestion Agent
**Purpose:** Connect to external data sources and fetch documents
- **Connections:**
  - Gmail
  - Outlook
  - Google Drive
  - Dropbox
- **Functionality:**
  - Fetch PDFs, invoices, receipts
  - Store metadata + raw file for parsing
  - Fully automated background job
- **Output:** Raw documents + metadata stored for Document Parsing Agent

---

### Agent 5: Document Parsing Agent
**Purpose:** Extract structured data from documents
- **Pipeline:** Regex → OCR → ML fallback
- **Extract:**
  - Supplier
  - Invoice number
  - Dates
  - SKU
  - Quantity
  - Cost
- **Output:** Clean structured JSON

---

### Agent 6: Evidence Matching Engine
**Purpose:** Match Discovery Agent claims to relevant documents
- **Approach:** Hybrid rules + ML
- **Confidence Thresholds:**
  - `>= 0.85` = auto-match
  - `0.5 - 0.85` = request manual confirmation
  - `< 0.5` = hold
- **Input:** Discovery Agent claims + Parsed documents
- **Output:** Matched evidence with confidence scores

---

### Agent 7: Refund Filing Agent
**Purpose:** File refund cases via Amazon SP-API
- **Functionality:**
  - Auto-file cases via Amazon SP-API
  - Track case status: Open → In Progress → Approved/Denied
  - Retry logic with stronger evidence if denied
- **Input:** Matched evidence from Agent 6
- **Output:** Case status tracking

---

### Agent 8: Recoveries Engine
**Purpose:** Track and reconcile Amazon payouts
- **Functionality:**
  - Detect payouts from Amazon
  - Verify they match expected claim
  - Reconcile amounts
  - Log full lifecycle
- **Input:** Case status from Agent 7
- **Output:** Reconciliation records

---

### Agent 9: Billing Engine
**Purpose:** Handle revenue share billing
- **Integration:** Stripe
- **Model:** Revenue share (20%)
- **Rule:** Only charge after money is recovered
- **Input:** Recovered amounts from Agent 8
- **Output:** Billing records

---

### Agent 10: Notifications Engine
**Purpose:** Push real-time updates to users
- **Channels:**
  - WebSocket push events
  - Email notifications
- **Events:**
  - Claim Detected
  - Evidence Found
  - Case Filed
  - Refund Approved
  - Funds Deposited
- **Input:** Events from all agents
- **Output:** Notifications to users

---

### Agent 11: Learning Agent
**Purpose:** Continuous improvement from all pipeline data
- **Functionality:**
  - Collect data from all steps
  - Improve discovery model
  - Improve evidence matching model
  - Improve decision thresholds
  - Continuous learning loop
- **Input:** All pipeline data
- **Output:** Updated models and thresholds

---

## Critical Requirements

1. **Individual Callability:** Each agent must be callable independently
2. **End-to-End Orchestration:** All agents must work together in a pipeline
3. **Input Source:** Use Discovery Agent output as input for all downstream agents
4. **Production-Ready:**
   - Error handling
   - Retries
   - Queues
   - Background workers
   - Comprehensive logging
5. **Fully Functional:** Everything must be testable and ready for FE wiring
6. **No Frontend Dependency:** Build everything as backend microservices/agents NOW

---

## Build Approach

- ✅ Build 1-by-1
- ✅ Ask for permission before moving to next agent
- ✅ Fully complete each agent before moving forward
- ✅ Test each agent individually
- ✅ Test integration with previous agents
- ✅ Get approval before proceeding

---

## Notes

- DO NOT wait for frontend integration
- Build everything as backend microservices/agents NOW
- Once wired to FE, the whole system should work instantly
- Discovery Agent is DONE - use its output as the source of truth

---

**Status:** Plan documented, awaiting permission to begin Agent 4




