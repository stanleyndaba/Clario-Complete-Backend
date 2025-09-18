# Concierge Feedback Update System

## Overview

The **Concierge Feedback Update System** transforms the Amazon FBA Claim Detector from a passive observer into a **continuous learning system** that improves with every Amazon rejection. This system automatically captures, analyzes, and learns from rejection feedback to strengthen both the Rules Engine and ML Model.

## 🎯 Key Features

### 1. **Rejection Logger**
- Captures every rejected claim with SKU/ASIN, claim type, and Amazon's exact rejection reason
- Automatically normalizes Amazon's varied rejection text into standard categories
- Assigns feedback tags: `fixable` (AI missed something) or `unclaimable` (policy change)

### 2. **Reason Normalizer**
- Maps Amazon's rejection text into standard categories:
  - "Policy not claimable"
  - "Documentation missing" 
  - "Timeframe expired"
  - "Evidence insufficient"
  - "Format error"
- Provides confidence scoring for normalization accuracy

### 3. **Feedback Tagging**
- **Fixable**: AI missed documentation, wrong formatting, incomplete claim → Push back into training data
- **Unclaimable**: Policy change, past deadline → Update rules to prevent future filing

### 4. **Knowledge Base Sync**
- Updates Claim Playbook library with successful claim templates
- Stores edge cases with success/failure patterns
- Maintains evolving repository of claim strategies

### 5. **Detector Feedback Loop**
- **Rule Engine Updates**: Automatically blocks unclaimable claims
- **Model Retraining**: Retrains with new features from fixable rejections
- **Continuous Learning**: Every rejection strengthens the system

## 🏗️ System Architecture

```
Amazon Rejection → Rejection Logger → Reason Normalizer → Feedback Tagging
                                                              ↓
Knowledge Base ← Knowledge Base Sync ← Detector Feedback Loop ←
                                                              ↓
Rules Engine ← Rule Updates ← Unclaimable Patterns
                                                              ↓
ML Model ← Model Retraining ← Fixable Patterns
```

## 📁 File Structure

```
src/feedback_loop/
├── claim_rejections_schema.sql          # Enhanced database schema
├── rejection_logger.py                   # Rejection logging & normalization
├── knowledge_base_sync.py               # Knowledge base management
├── detector_feedback_loop.py            # Main feedback processing system
├── concierge_update_example.py          # Complete demonstration
└── CONCIERGE_UPDATE_README.md           # This file
```

## 🚀 Quick Start

### 1. Initialize Components

```python
from rejection_logger import RejectionLogger
from knowledge_base_sync import KnowledgeBaseSync
from detector_feedback_loop import DetectorFeedbackLoop

# Initialize components
rejection_logger = RejectionLogger()
knowledge_base_sync = KnowledgeBaseSync()
feedback_loop = DetectorFeedbackLoop(
    rejection_logger=rejection_logger,
    knowledge_base_sync=knowledge_base_sync
)
```

### 2. Log a Rejection

```python
# Log a new rejection
rejection_id = rejection_logger.log_rejection(
    claim_id="CLM-123",
    amazon_rejection_reason="Documentation missing. Please provide proof of delivery.",
    sku="SKU-12345",
    asin="B08N5WRWNW",
    claim_type="lost",
    claim_amount=45.99,
    claim_text="Item was lost during inbound shipment.",
    model_prediction=True,
    model_confidence=0.87
)
```

### 3. Process Feedback

```python
# Process the rejection feedback
result = feedback_loop.process_rejection_feedback(rejection_id)

# Check what happened
if result.get('rule_updates'):
    print(f"Rules updated: {len(result['rule_updates'])}")
if result.get('model_retrained'):
    print("Model was retrained")
if result.get('knowledge_base_updated'):
    print("Knowledge base updated")
```

### 4. Batch Processing

```python
# Process multiple rejections at once
batch_result = feedback_loop.batch_process_rejections(max_rejections=50)
```

## 🔧 Core Components

### RejectionLogger

**Purpose**: Captures and normalizes rejection data

**Key Methods**:
- `log_rejection()`: Log a new rejection with automatic normalization
- `get_fixable_rejections()`: Retrieve fixable rejections for training
- `get_unclaimable_patterns()`: Get patterns for rule updates
- `get_rejection_analytics()`: Generate analytics on rejection patterns

**Example**:
```python
# Log rejection with automatic normalization
rejection_id = rejection_logger.log_rejection(
    claim_id="CLM-123",
    amazon_rejection_reason="Documentation missing. Please provide proof of delivery.",
    sku="SKU-12345",
    claim_type="lost",
    claim_amount=45.99
)

# Get analytics
analytics = rejection_logger.get_rejection_analytics()
print(f"Total rejections: {analytics['total_rejections']}")
print(f"Fixable: {analytics['fixable_count']}")
print(f"Unclaimable: {analytics['unclaimable_count']}")
```

### KnowledgeBaseSync

**Purpose**: Manages successful templates and edge cases

**Key Methods**:
- `update_successful_template()`: Add/update successful claim template
- `update_edge_case()`: Add/update edge case pattern
- `find_matching_template()`: Find template for similar claim
- `get_edge_cases()`: Retrieve edge cases for claim type

**Example**:
```python
# Update successful template
template_id = knowledge_base_sync.update_successful_template(
    claim_type="lost",
    claim_text="Item lost with proper documentation",
    evidence_used=["tracking_proof", "invoice"],
    template_name="Lost Item Template"
)

# Update edge case
edge_case_id = knowledge_base_sync.update_edge_case(
    claim_type="damaged",
    description="Items older than 18 months not eligible",
    is_success=False,
    special_requirements="Check item age before filing"
)
```

### DetectorFeedbackLoop

**Purpose**: Orchestrates the complete feedback processing workflow

**Key Methods**:
- `process_rejection_feedback()`: Process single rejection
- `batch_process_rejections()`: Process multiple rejections
- `analyze_rejection_patterns()`: Analyze patterns and suggest improvements
- `_update_rules_for_unclaimable()`: Update rules for unclaimable patterns
- `_retrain_model_with_fixable_rejections()`: Retrain model with fixable data

**Example**:
```python
# Process single rejection
result = feedback_loop.process_rejection_feedback(rejection_id)

# Analyze patterns
analysis = feedback_loop.analyze_rejection_patterns()
for rec in analysis['recommendations']:
    print(f"{rec['priority']}: {rec['message']}")

# Batch processing
batch_result = feedback_loop.batch_process_rejections(max_rejections=50)
```

## 📊 Database Schema

### Core Tables

#### `claim_rejections`
Stores detailed rejection information with normalized reasons and feedback tags.

```sql
CREATE TABLE claim_rejections (
    id UUID PRIMARY KEY,
    claim_id VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    asin VARCHAR(20),
    claim_type VARCHAR(100) NOT NULL,
    claim_amount DECIMAL(10,2),
    claim_text TEXT NOT NULL,
    amazon_rejection_reason TEXT NOT NULL,
    normalized_reason VARCHAR(100),
    reason_category VARCHAR(50),
    feedback_tag VARCHAR(50) NOT NULL, -- 'fixable' or 'unclaimable'
    model_prediction BOOLEAN,
    model_confidence DECIMAL(5,4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `rejection_reason_mapping`
Maps Amazon rejection text to normalized categories.

```sql
CREATE TABLE rejection_reason_mapping (
    id UUID PRIMARY KEY,
    amazon_pattern TEXT NOT NULL,
    normalized_reason VARCHAR(100) NOT NULL,
    reason_category VARCHAR(50) NOT NULL,
    confidence_score DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `claim_templates`
Stores successful claim templates.

```sql
CREATE TABLE claim_templates (
    id UUID PRIMARY KEY,
    claim_type VARCHAR(100) NOT NULL,
    template_name VARCHAR(255),
    claim_text TEXT NOT NULL,
    evidence_required JSONB,
    success_rate DECIMAL(5,4),
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `claim_edge_cases`
Stores edge cases with success/failure patterns.

```sql
CREATE TABLE claim_edge_cases (
    id UUID PRIMARY KEY,
    claim_type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    success_patterns JSONB,
    failure_patterns JSONB,
    special_requirements TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🔄 Workflow Examples

### Scenario 1: Fixable Rejection

**Input**: Amazon rejects claim due to missing documentation

**Process**:
1. **Log Rejection**: Capture with `feedback_tag = 'fixable'`
2. **Normalize**: Map to "Documentation Missing" category
3. **Update Knowledge**: Add edge case for documentation requirements
4. **Retrain Model**: Use rejection as training data with new features
5. **Result**: Model learns to detect documentation requirements

### Scenario 2: Unclaimable Rejection

**Input**: Amazon rejects claim due to policy change (18-month rule)

**Process**:
1. **Log Rejection**: Capture with `feedback_tag = 'unclaimable'`
2. **Normalize**: Map to "Policy Not Claimable" category
3. **Update Rules**: Add rule to block similar claims automatically
4. **Result**: Future similar claims are blocked before submission

### Scenario 3: Batch Processing

**Input**: Multiple rejections from weekly batch

**Process**:
1. **Batch Log**: Log all rejections with automatic normalization
2. **Pattern Analysis**: Identify common patterns across rejections
3. **System Updates**: Update rules and knowledge base based on patterns
4. **Model Retraining**: Retrain if sufficient fixable rejections
5. **Result**: System learns from batch of rejections efficiently

## 📈 Performance Monitoring

### Key Metrics

- **Rejection Rate**: Percentage of claims rejected by Amazon
- **Fixable vs Unclaimable**: Distribution of rejection types
- **Model Accuracy**: How well model predicts claimability
- **Rule Effectiveness**: How well rules prevent unclaimable submissions
- **Knowledge Base Growth**: Number of templates and edge cases

### Analytics Dashboard

```python
# Get comprehensive analytics
analytics = feedback_loop.analyze_rejection_patterns()

print(f"📊 Rejection Analytics:")
print(f"   Total Rejections: {analytics['total_rejections']}")
print(f"   Fixable: {analytics['fixable_count']} ({analytics['fixable_count']/analytics['total_rejections']*100:.1f}%)")
print(f"   Unclaimable: {analytics['unclaimable_count']} ({analytics['unclaimable_count']/analytics['total_rejections']*100:.1f}%)")
print(f"   Model Misses: {analytics['model_misses']}")

print(f"\n💡 Recommendations:")
for rec in analytics['recommendations']:
    print(f"   {rec['priority'].upper()}: {rec['message']}")
```

## 🛠️ Configuration

### Thresholds

```python
# Configure feedback loop thresholds
feedback_loop.retraining_threshold = 10        # Min rejections for retraining
feedback_loop.rule_update_threshold = 3        # Min pattern count for rule update
feedback_loop.accuracy_improvement_threshold = 0.02  # Min improvement to save model
```

### Normalization Patterns

```python
# Add custom normalization patterns
rejection_logger.normalizer.add_pattern(
    amazon_pattern="Item is older than 18 months",
    normalized_reason="Policy Not Claimable",
    reason_category="timeframe",
    confidence_score=0.95
)
```

## 🚨 Error Handling

### Common Issues

1. **Database Connection**: Ensure database is accessible
2. **Model Trainer**: Verify model trainer is properly configured
3. **Memory Usage**: Monitor memory usage during batch processing
4. **Data Validation**: Validate rejection data before processing

### Error Recovery

```python
try:
    result = feedback_loop.process_rejection_feedback(rejection_id)
except Exception as e:
    logger.error(f"Error processing rejection: {e}")
    # Implement retry logic or manual review
```

## 🔮 Future Enhancements

### Planned Features

1. **Real-time Processing**: Process rejections as they arrive
2. **Advanced Analytics**: Machine learning for pattern discovery
3. **Integration APIs**: Connect with Amazon APIs for automatic data
4. **Dashboard UI**: Web interface for monitoring and management
5. **A/B Testing**: Test different rule configurations
6. **Predictive Analytics**: Predict rejection likelihood before submission

### Extensibility

The system is designed for easy extension:

- **Custom Normalizers**: Add domain-specific normalization logic
- **Custom Rules**: Implement custom rule types
- **Custom Analytics**: Add specialized analytics modules
- **Custom Integrations**: Connect with external systems

## 📚 API Reference

### RejectionLogger API

```python
class RejectionLogger:
    def log_rejection(self, claim_id: str, amazon_rejection_reason: str, **kwargs) -> str
    def get_fixable_rejections(self, priority_min: int = 1) -> List[Dict]
    def get_unclaimable_patterns(self) -> List[Dict]
    def get_rejection_analytics(self) -> Dict
    def human_tag_rejection(self, rejection_id: str, feedback_tag: str, notes: str) -> bool
```

### KnowledgeBaseSync API

```python
class KnowledgeBaseSync:
    def update_successful_template(self, claim_type: str, claim_text: str, **kwargs) -> str
    def update_edge_case(self, claim_type: str, description: str, **kwargs) -> str
    def find_matching_template(self, claim_type: str, claim_text: str) -> Optional[Dict]
    def get_edge_cases(self, claim_type: str) -> List[Dict]
```

### DetectorFeedbackLoop API

```python
class DetectorFeedbackLoop:
    def process_rejection_feedback(self, rejection_tracking_id: str) -> Dict
    def batch_process_rejections(self, max_rejections: int = 50) -> Dict
    def analyze_rejection_patterns(self) -> Dict
```

## 🤝 Contributing

### Development Setup

1. **Clone Repository**: Get the latest code
2. **Install Dependencies**: Install required packages
3. **Run Tests**: Ensure all tests pass
4. **Run Demo**: Execute the demonstration script
5. **Submit Changes**: Create pull request with improvements

### Testing

```bash
# Run the complete demo
python concierge_update_example.py

# Run individual components
python rejection_logger.py
python knowledge_base_sync.py
python detector_feedback_loop.py
```

## 📞 Support

### Getting Help

1. **Documentation**: Review this README and code comments
2. **Examples**: Run the demonstration script
3. **Issues**: Report bugs or feature requests
4. **Community**: Join discussions and share experiences

### Troubleshooting

**Common Issues**:
- **Import Errors**: Ensure all components are in the same directory
- **Database Errors**: Check database connection and schema
- **Memory Issues**: Reduce batch size for large datasets
- **Performance Issues**: Monitor and optimize processing thresholds

---

## 🎯 Summary

The **Concierge Feedback Update System** transforms every Amazon rejection into an opportunity to improve the Claim Detector. By automatically capturing, analyzing, and learning from rejection feedback, the system continuously evolves to:

- **Prevent Future Rejections**: Update rules to block unclaimable claims
- **Improve Detection**: Retrain models with fixable rejection patterns
- **Build Knowledge**: Maintain evolving repository of successful strategies
- **Adapt to Changes**: Automatically adjust to Amazon's policy updates

**Result**: A self-improving system that gets stronger with every rejection, ensuring maximum claim success rates while minimizing false positives.

---

*The Concierge is now actively learning from every Amazon rejection! 🚀*

