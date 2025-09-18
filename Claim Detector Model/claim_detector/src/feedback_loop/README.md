# 🎭 Concierge Feedback Loop System

## Overview

The **Concierge Feedback Loop** is the bridge between your synthetic-trained Claim Detector and real-world Amazon FBA reimbursement outcomes. It transforms your prototype into a production-ready, continuously learning AI system that adapts to Amazon's ever-changing policies.

## 🎯 **Why You Need This**

**Without Concierge Loop:**
- ❌ Model stuck in "synthetic sandbox land"
- ❌ No real-world learning
- ❌ Can't adapt to Amazon policy changes
- ❌ Risk of missing new claim patterns

**With Concierge Loop:**
- ✅ Real-world data collection and tracking
- ✅ Human oversight and edge case identification
- ✅ Continuous model improvement
- ✅ Adaptation to Amazon rule changes
- ✅ Production-ready AI system

## 🏗️ **System Architecture**

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Claim         │    │   Amazon         │    │   Concierge     │
│   Detector      │───▶│   Decision       │───▶│   Review        │
│   (ML Model)    │    │   (Real World)   │    │   (Human)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Log Claim     │    │   Update Status  │    │   Flag Edge     │
│   Detection     │    │   & Outcome      │    │   Cases         │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌─────────────────────────────┐
                    │   Feedback-to-Training      │
                    │   Pipeline                  │
                    └─────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────┐
                    │   Model Retraining          │
                    │   & Improvement             │
                    └─────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────┐
                    │   Enhanced Claim Detector   │
                    │   (Learned from Real Data)  │
                    └─────────────────────────────┘
```

## 📁 **Components**

### 1. **Database Schema** (`claims_feedback_schema.sql`)
- **Table:** `claims_feedback` - Stores every claim from detection through Amazon's decision
- **View:** `claims_training_data` - Ready-to-use training data
- **Features:** UUID tracking, status management, edge case flagging, retraining priorities

### 2. **Claims Logger** (`claims_logger.py`)
- **Class:** `ClaimsLogger` - Manages the complete claim lifecycle
- **Functions:**
  - `log_new_claim()` - Record model detection
  - `update_amazon_decision()` - Record Amazon's outcome
  - `flag_edge_case()` - Mark for human review
  - `get_training_data()` - Extract data for retraining

### 3. **Feedback Training Pipeline** (`feedback_training_pipeline.py`)
- **Class:** `FeedbackTrainingPipeline` - Transforms feedback into improved models
- **Functions:**
  - `prepare_feedback_training_data()` - Convert outcomes to training format
  - `analyze_feedback_patterns()` - Identify improvement opportunities
  - `retrain_model()` - Continuous learning
  - `run_full_pipeline()` - End-to-end automation

### 4. **Concierge Example** (`concierge_example.py`)
- **Class:** `ConciergeFeedbackLoopDemo` - Complete workflow demonstration
- **Steps:** 6-step process showing real-world usage

## 🚀 **Quick Start**

### 1. **Setup Database**
```sql
-- Run the schema file
psql -d your_database -f claims_feedback_schema.sql
```

### 2. **Initialize Components**
```python
from feedback_loop.claims_logger import ClaimsLogger
from feedback_loop.feedback_training_pipeline import FeedbackTrainingPipeline

# Initialize logger (with or without database connection)
claims_logger = ClaimsLogger(db_connection=None)  # Uses memory cache

# Initialize training pipeline
pipeline = FeedbackTrainingPipeline(
    claims_logger=claims_logger,
    model_path="models/improved_fba_claims_model.pkl",
    output_path="models/retrained_fba_claims_model.pkl"
)
```

### 3. **Log New Claims**
```python
# When your model detects a claim
tracking_id = claims_logger.log_new_claim(
    claim_id="CLAIM-001",
    claim_type="lost",
    claim_text="Amazon warehouse lost 5 units during transfer",
    claim_amount=150.00,
    model_prediction=True,
    model_confidence=0.95,
    model_features={'text_length': 120, 'word_count': 20}
)
```

### 4. **Record Amazon's Decision**
```python
# After Amazon responds
success = claims_logger.update_amazon_decision(
    claim_id="CLAIM-001",
    amazon_status="accepted",
    amazon_final_amount=150.00,
    amazon_rule_version="FBA-2024-Q1"
)
```

### 5. **Flag Edge Cases**
```python
# When human review identifies patterns
success = claims_logger.flag_edge_case(
    claim_id="CLAIM-001",
    edge_case_tag="new_policy_pattern",
    concierge_notes="Amazon now requires photographic evidence for damage claims",
    retraining_priority=5  # High priority for immediate learning
)
```

### 6. **Run Training Pipeline**
```python
# Automatically retrain with new insights
results = pipeline.run_full_pipeline(
    min_samples=100,
    include_edge_cases=True,
    recent_days=90,
    auto_retrain=True
)
```

## 🔄 **Complete Workflow Example**

### **Step 1: Model Detection**
```python
# Your existing Claim Detector identifies a claim
claim_data = {
    'text': 'Product arrived damaged with broken packaging',
    'amount': 75.50,
    'type': 'damaged'
}

# Model makes prediction
prediction = model.predict(claim_data)
confidence = model.predict_proba(claim_data)[0][1]

# Log the detection
tracking_id = claims_logger.log_new_claim(
    claim_id=f"CLAIM-{uuid.uuid4().hex[:8]}",
    claim_type=claim_data['type'],
    claim_text=claim_data['text'],
    claim_amount=claim_data['amount'],
    model_prediction=prediction,
    model_confidence=confidence,
    model_features=extract_features(claim_data)
)
```

### **Step 2: Amazon Decision**
```python
# Later, Amazon responds
amazon_decision = {
    'status': 'rejected',
    'reason': 'Insufficient evidence of damage. Photos required.',
    'amount': 0.00,
    'rule_version': 'FBA-2024-Q1'
}

# Update the claim
claims_logger.update_amazon_decision(
    claim_id=claim_id,
    amazon_status=amazon_decision['status'],
    amazon_rejection_reason=amazon_decision['reason'],
    amazon_final_amount=amazon_decision['amount'],
    amazon_rule_version=amazon_decision['rule_version']
)
```

### **Step 3: Concierge Review**
```python
# Human reviewer identifies pattern
claims_logger.flag_edge_case(
    claim_id=claim_id,
    edge_case_tag='evidence_requirement',
    concierge_notes='Amazon now requires photographic evidence for all damage claims. This is a new policy change.',
    retraining_priority=5  # Critical for immediate learning
)
```

### **Step 4: Automated Learning**
```python
# Pipeline automatically processes feedback
results = pipeline.run_full_pipeline(
    min_samples=50,  # Lower threshold for immediate learning
    include_edge_cases=True,
    recent_days=30,  # Focus on recent policy changes
    auto_retrain=True
)

if results['retraining_results']['model_saved']:
    print("🎉 Model updated with new Amazon policy insights!")
```

## 📊 **Edge Case Categories**

### **Priority 5 (Critical - Immediate Retraining)**
- `model_miss` - Model failed to detect claimable transaction
- `policy_change` - New Amazon rule detected
- `revenue_loss` - Missed significant reimbursement opportunity

### **Priority 4 (High - Next Retraining Cycle)**
- `insufficient_evidence` - Evidence requirements changed
- `new_claim_type` - Previously unseen claim category
- `threshold_adjustment` - Model confidence thresholds need tuning

### **Priority 3 (Medium - Regular Retraining)**
- `partial_acceptance` - Partial vs full acceptance patterns
- `seasonal_patterns` - Time-based claim variations
- `marketplace_specific` - Different rules for different regions

### **Priority 2 (Low - Batch Processing)**
- `standard_claim` - Confirmed working patterns
- `minor_optimization` - Small accuracy improvements
- `data_quality` - Data format or quality issues

### **Priority 1 (Info - Monitoring Only)**
- `baseline_performance` - Expected behavior
- `no_action_needed` - Working as intended

## 🎯 **Key Benefits**

### **1. Real-World Adaptation**
- **Before:** Model trained on synthetic data only
- **After:** Model learns from actual Amazon decisions
- **Result:** Adapts to policy changes automatically

### **2. Human Oversight**
- **Before:** Black-box ML predictions
- **After:** Human experts identify edge cases
- **Result:** Combines AI speed with human wisdom

### **3. Continuous Improvement**
- **Before:** Static model performance
- **After:** Continuously improving accuracy
- **Result:** Revenue capture increases over time

### **4. Policy Change Detection**
- **Before:** Unaware of Amazon rule updates
- **After:** Automatically detects policy shifts
- **Result:** Stays compliant and effective

## 🔧 **Configuration Options**

### **Retraining Thresholds**
```python
# Minimum accuracy improvement required to save new model
pipeline.retrain_model(
    training_data=feedback_data,
    retrain_threshold=0.8  # 80% accuracy required
)
```

### **Data Freshness**
```python
# Only use recent feedback for training
pipeline.prepare_feedback_training_data(
    recent_days=90,  # Last 3 months only
    include_edge_cases=True
)
```

### **Sample Requirements**
```python
# Minimum samples before retraining
pipeline.run_full_pipeline(
    min_samples=100,  # Wait for 100 new samples
    auto_retrain=True
)
```

## 📈 **Performance Monitoring**

### **Key Metrics to Track**
1. **Model Accuracy** - Overall prediction accuracy
2. **Recall** - Percentage of claims detected (priority metric)
3. **Precision** - Percentage of correct predictions
4. **Edge Case Rate** - Frequency of unusual patterns
5. **Retraining Frequency** - How often model improves
6. **Policy Change Detection** - Time to adapt to new rules

### **Alert Thresholds**
- **Critical:** Accuracy drops below 80%
- **Warning:** Edge case rate above 20%
- **Info:** No retraining for 30+ days

## 🚨 **Troubleshooting**

### **Common Issues**

#### **1. No Training Data Available**
```python
# Check if feedback data exists
training_data = claims_logger.get_training_data(min_samples=10)
if not training_data:
    print("No feedback data available. Check claim logging.")
```

#### **2. Model Not Improving**
```python
# Analyze feedback patterns
analysis = pipeline.analyze_feedback_patterns(training_data)
print("Recommendations:", analysis['recommendations'])
```

#### **3. Database Connection Issues**
```python
# Fallback to memory-based logging
claims_logger = ClaimsLogger(db_connection=None)
print("Using memory cache. Data will be lost on restart.")
```

### **Debug Mode**
```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Run pipeline with detailed logging
results = pipeline.run_full_pipeline(
    min_samples=10,
    auto_retrain=True
)
```

## 🔮 **Future Enhancements**

### **Planned Features**
1. **Automated Policy Change Detection** - ML-based rule change identification
2. **Multi-Marketplace Support** - Different Amazon regions
3. **Advanced Edge Case Classification** - AI-powered pattern recognition
4. **Performance Forecasting** - Predict accuracy trends
5. **A/B Testing Framework** - Compare model versions

### **Integration Points**
1. **Amazon Selling Partner API** - Real-time data ingestion
2. **Slack/Teams Notifications** - Alert on critical issues
3. **Grafana Dashboards** - Performance visualization
4. **JIRA Integration** - Automated ticket creation for edge cases

## 📚 **Additional Resources**

### **Related Documentation**
- [Main Claim Detector README](../README.md)
- [API Documentation](../api/README.md)
- [Rules Engine Guide](../rules_engine/README.md)
- [ML Detector Guide](../ml_detector/README.md)

### **Example Scripts**
- [Concierge Demo](concierge_example.py) - Complete workflow demonstration
- [Feedback Pipeline](feedback_training_pipeline.py) - Training automation
- [Claims Logger](claims_logger.py) - Data management

### **Database Queries**
```sql
-- Get all edge cases for review
SELECT * FROM claims_feedback 
WHERE edge_case_tag IS NOT NULL 
ORDER BY retraining_priority DESC;

-- Get training-ready data
SELECT * FROM claims_training_data 
WHERE training_label IS NOT NULL;

-- Monitor model performance
SELECT 
    amazon_status,
    COUNT(*) as count,
    AVG(model_confidence) as avg_confidence
FROM claims_feedback 
GROUP BY amazon_status;
```

---

## 🎉 **Congratulations!**

You now have a **production-ready, continuously learning FBA Claims Detection System** that:

✅ **Detects claims** using advanced ML  
✅ **Tracks outcomes** through complete lifecycle  
✅ **Learns from feedback** automatically  
✅ **Adapts to changes** in Amazon policies  
✅ **Improves continuously** over time  

**Next Steps:**
1. **Deploy** the Concierge system
2. **Start logging** real claims
3. **Monitor** performance metrics
4. **Review** edge cases regularly
5. **Watch** your model get smarter every day!

Your Claim Detector is no longer just a prototype - it's a living, breathing AI system that grows with your business! 🚀


