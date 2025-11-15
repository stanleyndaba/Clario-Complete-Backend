# Agent 11: Learning Agent — Analysis

**Date:** 2025-01-27  
**Status:** Analysis Complete — Ready for Implementation

---

## 📋 Agent 11 Requirements

1. **Continuous Model Improvement**
   - Collect data from Agents 4-10
   - Fine-tune discovery and matching models
   - Adjust decision thresholds dynamically

2. **Automated Feedback Loops**
   - Detect patterns in successful/unsuccessful refunds
   - Automatically retrain models on new data
   - Update thresholds and rules dynamically

3. **Cross-Step Insights**
   - Predict refund success probability
   - Highlight evidence gaps proactively
   - Suggest optimal action sequences

4. **Adaptation to Amazon Rule Changes**
   - Learn from rejections
   - Pivot when Amazon rules change
   - Update rules and models automatically

---

## ✅ What Exists (Python Backend)

### 1. **Rejection Logger** (`Claim Detector Model/claim_detector/src/feedback_loop/rejection_logger.py`)

**Status:** ✅ **IMPLEMENTED**

**Features:**
- ✅ Captures every rejected claim with SKU/ASIN, claim type, and Amazon's exact rejection reason
- ✅ Automatic normalization of Amazon's varied rejection text into standard categories
- ✅ Intelligent feedback tagging as 'fixable' or 'unclaimable'
- ✅ Real-time processing with immediate learning activation

**Key Methods:**
```python
log_rejection(rejection_data: RejectionData) -> str
normalize_reason(amazon_reason: str) -> NormalizedRejection
tag_feedback(normalized_rejection: NormalizedRejection) -> str
```

**Rejection Categories:**
- "Policy not claimable" (unclaimable)
- "Documentation missing" (fixable)
- "Timeframe expired" (unclaimable)
- "Evidence insufficient" (fixable)
- "Format error" (fixable)

### 2. **Detector Feedback Loop** (`Claim Detector Model/claim_detector/src/feedback_loop/detector_feedback_loop.py`)

**Status:** ✅ **IMPLEMENTED**

**Features:**
- ✅ Automatically updates rules engine based on rejections
- ✅ Retrains model with fixable rejections
- ✅ Updates knowledge base with successful claim templates
- ✅ Batch processing of rejections
- ✅ Model retraining triggers (threshold-based)

**Key Methods:**
```python
process_rejection_feedback(rejection_tracking_id: str) -> Dict
batch_process_rejections(max_rejections: int = 50) -> Dict
_should_retrain_model() -> bool
_retrain_model_with_fixable_rejections() -> bool
_update_rules_for_unclaimable(rejection_data: Dict) -> List[RuleUpdate]
```

**Configuration:**
- `retraining_threshold = 10` — Minimum rejections to trigger retraining
- `rule_update_threshold = 3` — Minimum pattern count to update rules
- `accuracy_improvement_threshold = 0.02` — Minimum improvement to save model

### 3. **Feedback Training Pipeline** (`Claim Detector Model/claim_detector/src/feedback_loop/feedback_training_pipeline.py`)

**Status:** ✅ **IMPLEMENTED**

**Features:**
- ✅ Prepares retraining data from feedback
- ✅ Retrains model with new data
- ✅ Evaluates model performance
- ✅ Saves model if improvement is significant
- ✅ Tracks retraining history

**Key Methods:**
```python
prepare_retraining_data() -> pd.DataFrame
retrain_model(training_data: pd.DataFrame) -> Dict
should_retrain() -> Tuple[bool, str]
```

### 4. **Knowledge Base Sync** (Referenced in feedback loop)

**Status:** ✅ **IMPLEMENTED** (Referenced)

**Features:**
- ✅ Updates Claim Playbook with successful claim templates
- ✅ Stores edge cases with success/failure patterns
- ✅ Pattern accumulation for continuous strategy improvement

### 5. **Orchestration Integration** (`Integrations-backend/src/jobs/orchestrationJob.ts`)

**Status:** ⚠️ **PARTIALLY IMPLEMENTED**

**Features:**
- ✅ `executePhase6_ClaimRejection()` — Logs rejections to Python API
- ✅ Calls Python API endpoint: `/api/v1/claim-detector/rejections/log`
- ⚠️ Only handles rejections, not all agent events
- ⚠️ No centralized data collection

**Current Implementation:**
```typescript
// Phase 6: Continuous Learning Brain
private static async executePhase6_ClaimRejection(
  userId: string, 
  syncId: string, 
  metadata?: Record<string, any>
): Promise<JobResult> {
  // Logs rejection to Python API
  await axios.post(`${pythonApiUrl}/api/v1/claim-detector/rejections/log`, {
    user_id: userId,
    claim_id: claimId,
    amazon_case_id: amazonCaseId,
    rejection_reason: rejectionReason
  });
}
```

---

## ❌ What's Missing (TypeScript Backend)

### 1. **No TypeScript Learning Worker**
- ❌ No automated background worker for learning
- ❌ No scheduled data collection from Agents 4-10
- ❌ No integration with Python learning system

### 2. **No Centralized Event Logging**
- ❌ No event-level logging for all agents
- ❌ No data warehouse for agent events
- ❌ No metadata collection (timestamps, confidence scores, errors, outcomes)

### 3. **No Agent Event Collection**
- ❌ Agent 4 (Evidence Ingestion) — No event logging
- ❌ Agent 5 (Document Parsing) — No event logging
- ❌ Agent 6 (Evidence Matching) — No event logging
- ❌ Agent 7 (Refund Filing) — Only rejection logging (partial)
- ❌ Agent 8 (Recoveries) — No event logging
- ❌ Agent 9 (Billing) — No event logging

### 4. **No Performance Metrics Collection**
- ❌ No success rate tracking per agent
- ❌ No precision/recall metrics
- ❌ No model performance monitoring
- ❌ No threshold optimization

### 5. **No Dynamic Threshold Adjustment**
- ❌ No automatic threshold tuning
- ❌ No A/B testing infrastructure
- ❌ No multi-armed bandit approaches

### 6. **No Cross-Step Insights**
- ❌ No refund success probability prediction
- ❌ No evidence gap detection
- ❌ No optimal action sequence suggestions

---

## 🎯 What Needs to be Built

### 1. **Agent Event Logging Service** (`src/services/agentEventLogger.ts`)

**Purpose:** Centralized event logging for all agents

**Features:**
- Log events from Agents 4-10
- Store metadata: timestamps, confidence scores, errors, outcomes
- Track success/failure rates
- Store in `agent_events` table

**Key Methods:**
```typescript
logAgentEvent(agent: string, eventType: string, data: AgentEventData): Promise<void>
logEvidenceIngestion(userId: string, result: IngestionResult): Promise<void>
logDocumentParsing(userId: string, documentId: string, result: ParsingResult): Promise<void>
logEvidenceMatching(userId: string, result: MatchingResult): Promise<void>
logRefundFiling(userId: string, disputeId: string, result: FilingResult): Promise<void>
logRecovery(userId: string, disputeId: string, result: RecoveryResult): Promise<void>
logBilling(userId: string, disputeId: string, result: BillingResult): Promise<void>
```

### 2. **Learning Worker** (`src/workers/learningWorker.ts`)

**Purpose:** Automated background worker for continuous learning

**Features:**
- Runs every 30 minutes
- Collects events from Agents 4-10
- Analyzes patterns and success rates
- Triggers Python API for model retraining
- Updates thresholds dynamically
- Generates insights and recommendations

**Key Methods:**
```typescript
start(): void
stop(): void
collectAgentEvents(): Promise<AgentEventStats>
analyzePatterns(events: AgentEvent[]): Promise<PatternAnalysis>
optimizeThresholds(analysis: PatternAnalysis): Promise<ThresholdUpdates>
triggerModelRetraining(data: RetrainingData): Promise<void>
generateInsights(userId: string): Promise<LearningInsights>
```

### 3. **Learning Service** (`src/services/learningService.ts`)

**Purpose:** Service wrapper for Python learning API

**Features:**
- Wraps Python learning endpoints
- Handles retry logic
- Processes feedback data
- Triggers model retraining
- Updates rules

**Key Methods:**
```typescript
logRejection(userId: string, rejectionData: RejectionData): Promise<void>
triggerModelRetraining(userId: string, trainingData: any): Promise<void>
updateRules(userId: string, ruleUpdates: RuleUpdate[]): Promise<void>
getModelPerformance(userId: string): Promise<ModelPerformance>
optimizeThresholds(userId: string, metrics: PerformanceMetrics): Promise<ThresholdUpdates>
```

### 4. **Database Migration** (`migrations/018_learning_worker.sql`)

**Purpose:** Create tables for agent events and learning data

**Tables:**
- `agent_events` — Event-level logging from all agents
- `learning_metrics` — Model performance metrics
- `threshold_optimizations` — Threshold update history
- `model_retraining_history` — Retraining records
- `learning_insights` — Generated insights and recommendations

### 5. **Agent Integrations** (Update Agents 4-10)

**Agent 4 (Evidence Ingestion):**
- Log ingestion events (success/failure, document count, timing)

**Agent 5 (Document Parsing):**
- Log parsing events (success/failure, confidence, extraction method)

**Agent 6 (Evidence Matching):**
- Log matching events (confidence, auto-submit/smart-prompt/hold decisions)

**Agent 7 (Refund Filing):**
- Log filing events (success/failure, approval/denial, rejection reasons)

**Agent 8 (Recoveries):**
- Log recovery events (payout detection, matching, reconciliation)

**Agent 9 (Billing):**
- Log billing events (success/failure, fee calculation, Stripe transactions)

### 6. **Test Script** (`scripts/test-agent11-learning.ts`)

**Test Cases:**
- Migration verification
- Event logging from all agents
- Pattern analysis
- Threshold optimization
- Model retraining triggers
- Python API integration

---

## 🔄 Integration Flow

```
Agent 4-10 (All Agents)
  ↓
  Log events via agentEventLogger
  ↓
  Store in agent_events table
  ↓
Agent 11 (Learning Worker)
  ↓
  Collects events every 30 minutes
  ↓
  Analyzes patterns and success rates
  ↓
  Optimizes thresholds
  ↓
  Triggers Python API for model retraining
  ↓
  Updates rules and models
  ↓
  Feeds improvements back to Agents 4-10
```

---

## 📊 Data Collection Strategy

### Event Types to Collect:

**Agent 4 (Evidence Ingestion):**
- Documents ingested count
- Success/failure rate
- Timing metrics
- Source quality

**Agent 5 (Document Parsing):**
- Parsing success rate
- Confidence scores
- Extraction method used
- Error types

**Agent 6 (Evidence Matching):**
- Matching confidence scores
- Auto-submit vs smart-prompt vs hold decisions
- Match quality metrics

**Agent 7 (Refund Filing):**
- Filing success rate
- Approval/denial rates
- Rejection reasons (normalized)
- Time to approval

**Agent 8 (Recoveries):**
- Payout detection rate
- Matching accuracy
- Reconciliation success
- Discrepancy patterns

**Agent 9 (Billing):**
- Billing success rate
- Fee calculation accuracy
- Stripe transaction success

---

## 🎯 Key Features to Build

1. **Event-Level Logging**
   - Centralized `agent_events` table
   - Rich metadata (timestamps, confidence, outcomes)
   - Success/failure tracking

2. **Pattern Analysis**
   - Detect which evidence types lead to successful refunds
   - Identify common rejection patterns
   - Find optimal action sequences

3. **Threshold Optimization**
   - Dynamic adjustment of confidence thresholds
   - A/B testing infrastructure
   - Multi-armed bandit approaches

4. **Model Retraining Integration**
   - Trigger Python API for retraining
   - Pass collected data to Python backend
   - Track retraining results

5. **Performance Monitoring**
   - Success rates per agent
   - Precision/recall metrics
   - Model drift detection
   - Alert on performance degradation

6. **Insights Generation**
   - Refund success probability prediction
   - Evidence gap detection
   - Optimal action sequence suggestions

---

## 📝 Summary

**What Exists:**
- ✅ Python backend: Rejection logging, feedback loops, model retraining
- ✅ Partial TypeScript integration: Phase 6 rejection logging

**What's Missing:**
- ❌ TypeScript Learning Worker
- ❌ Centralized event logging from Agents 4-10
- ❌ Data warehouse for agent events
- ❌ Performance metrics collection
- ❌ Dynamic threshold optimization
- ❌ Cross-step insights generation

**Build Required:**
1. `agentEventLogger.ts` — Centralized event logging
2. `learningWorker.ts` — Automated background worker
3. `learningService.ts` — Python API wrapper
4. `018_learning_worker.sql` — Database migration
5. Agent integrations — Update Agents 4-10 to log events
6. Test script — Verify all functionality

---

**Status:** Ready for Implementation ✅

**Strategic Value:** Agent 11 is the **defensible AI moat** — transforms static workflows into adaptive, self-optimizing systems that continuously improve from real-world data.

