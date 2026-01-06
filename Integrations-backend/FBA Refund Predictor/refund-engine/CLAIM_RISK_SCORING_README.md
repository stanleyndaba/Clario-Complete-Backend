# Claim Risk Scoring Logic - OpSide Certainty Engine

## Overview

The Claim Risk Scoring Logic is a machine learning-powered component of the OpSide Certainty Engine that predicts claim success probability and refund timeline for e-commerce recovery claims. This system uses ML models to assess the likelihood of claim acceptance and estimate processing time based on claim characteristics.

## Features

- **Success Probability Prediction**: ML-based scoring (0-1) indicating claim acceptance likelihood
- **Refund Timeline Estimation**: Prediction of days until refund processing
- **Risk Level Categorization**: Automatic classification into Low/Medium/High risk
- **Batch Processing**: Efficient scoring of multiple claims simultaneously
- **Model Training**: Synthetic data generation and model training capabilities
- **Transaction Logging**: Full audit trail of all scoring activities

## Architecture

### Components

1. **Python ML Service** (`certainty_engine.py`)
   - Logistic Regression for success probability
   - Linear Regression for refund timeline
   - Feature preprocessing and encoding
   - Model persistence (.pkl files)

2. **TypeScript Integration Service** (`claimRiskScoringService.ts`)
   - Python process communication
   - Input validation and error handling
   - TypeScript interfaces and types

3. **API Controller** (`claimRiskController.ts`)
   - REST API endpoints
   - Authentication and authorization
   - Request/response handling

4. **Database Integration**
   - Certainty scores persistence
   - Transaction journal logging
   - Audit trail maintenance

## API Endpoints

### Core Scoring

#### `POST /api/v1/claims/score`
Score a single claim for risk assessment.

**Request Body:**
```json
{
  "discrepancy_type": "missing_refund",
  "discrepancy_size": 150.0,
  "days_outstanding": 45,
  "marketplace": "amazon",
  "historical_payout_rate": 0.75
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "certainty_score_id": "certainty-score-123",
    "risk_assessment": {
      "success_probability": 0.85,
      "refund_timeline_days": 12.5,
      "confidence_score": 0.8,
      "risk_level": "High",
      "model_version": "1.0.0",
      "features_used": ["discrepancy_type", "discrepancy_size", "days_outstanding", "marketplace", "historical_payout_rate"]
    },
    "claim_features": { ... },
    "timestamp": "2024-01-15T10:30:00Z"
  },
  "message": "Claim risk assessment completed successfully"
}
```

#### `POST /api/v1/claims/batch-score`
Score multiple claims in a single request (max 100).

**Request Body:**
```json
{
  "claims": [
    {
      "discrepancy_type": "missing_refund",
      "discrepancy_size": 150.0,
      "days_outstanding": 45,
      "marketplace": "amazon",
      "historical_payout_rate": 0.75
    },
    {
      "discrepancy_type": "late_shipment",
      "discrepancy_size": 75.0,
      "days_outstanding": 30,
      "marketplace": "shopify",
      "historical_payout_rate": 0.60
    }
  ]
}
```

### Model Management

#### `POST /api/v1/claims/train-models`
Train the ML models with synthetic data.

**Request Body:**
```json
{
  "n_samples": 10000
}
```

#### `GET /api/v1/claims/model-info`
Get information about the trained models.

#### `GET /api/v1/claims/check-environment`
Check if Python environment is available.

#### `GET /api/v1/claims/sample`
Get a sample claim for testing.

## Input Features

### Required Fields

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `discrepancy_type` | string | Type of claim discrepancy | One of: missing_refund, late_shipment, damaged_item, wrong_item, overcharge, duplicate_charge |
| `discrepancy_size` | number | Claim amount in dollars | > 0 |
| `days_outstanding` | number | Days since claim event | >= 0 |
| `marketplace` | string | E-commerce platform | One of: amazon, shopify, stripe, ebay, walmart, etsy |
| `historical_payout_rate` | number | Historical success rate | 0-1 |

### Feature Engineering

The ML models use the following preprocessing:

1. **Categorical Encoding**: Label encoding for discrepancy_type and marketplace
2. **Feature Scaling**: StandardScaler for numerical features
3. **Missing Value Handling**: Default values for unseen categories

## Output Predictions

### Success Probability
- **Range**: 0.0 - 1.0
- **Interpretation**: Higher values indicate greater likelihood of claim acceptance
- **Model**: Logistic Regression

### Refund Timeline
- **Range**: 1-90 days
- **Interpretation**: Estimated days until refund processing
- **Model**: Linear Regression

### Risk Level
- **Low**: success_probability < 0.3
- **Medium**: 0.3 ≤ success_probability < 0.7
- **High**: success_probability ≥ 0.7

## ML Models

### Model Types
- **Success Probability**: Logistic Regression (scikit-learn)
- **Refund Timeline**: Linear Regression (scikit-learn)

### Training Data
- **Source**: Synthetic data generation
- **Size**: Configurable (default: 10,000 samples)
- **Features**: Realistic claim characteristics with business logic

### Model Persistence
- **Format**: Python pickle (.pkl) files
- **Location**: `models/` directory
- **Files**:
  - `success_probability_model.pkl`
  - `refund_timeline_model.pkl`
  - `label_encoders.pkl`
  - `feature_scaler.pkl`

## Setup and Installation

### Prerequisites
- Node.js 18+
- Python 3.8+
- Required Python packages (see requirements.txt)

### Installation

1. **Install Python Dependencies:**
```bash
pip install -r requirements.txt
```

2. **Install Node.js Dependencies:**
```bash
npm install
```

3. **Train Initial Models:**
```bash
# Via API
curl -X POST http://localhost:3000/api/v1/claims/train-models \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"n_samples": 10000}'

# Or directly via Python
python src/services/certainty_engine.py
```

### Environment Variables
```bash
# API Configuration
API_BASE_URL=http://localhost:3000
API_TOKEN=your-jwt-token

# Python Environment
PYTHONPATH=src/services
```

## Testing

### Unit Tests
```bash
npm run test:claim-risk
```

### Integration Tests
```bash
npm run test:claim-risk-integration
```

### Manual Testing
```bash
node test-claim-risk-scoring.js
```

### Test Coverage
- Input validation
- ML model scoring
- API endpoint functionality
- Error handling
- Batch processing
- Transaction logging

## Performance

### Benchmarks
- **Single Claim**: ~50-100ms
- **Batch (100 claims)**: ~2-5 seconds
- **Model Loading**: ~200ms (first request)
- **Training (10k samples)**: ~30-60 seconds

### Optimization
- Model caching in memory
- Batch processing for multiple claims
- Async Python process communication
- Efficient feature preprocessing

## Monitoring and Logging

### Transaction Journal
All scoring activities are logged with:
- Claim features used
- Prediction results
- Model version
- Timestamp and actor
- SHA256 hash for integrity

### Metrics
- Success probability accuracy
- Timeline prediction RMSE
- Model confidence scores
- Processing latency
- Error rates

## Error Handling

### Common Errors
1. **Python Environment**: Missing dependencies
2. **Model Training**: Insufficient data
3. **Invalid Input**: Missing or invalid features
4. **Authentication**: Missing or invalid JWT token

### Graceful Degradation
- Fallback to deterministic scoring if ML models fail
- Detailed error messages for debugging
- Partial results for batch processing with errors

## Security

### Authentication
- JWT token required for all endpoints
- User context logged in transactions

### Input Validation
- Strict type checking
- Range validation for numerical values
- Enum validation for categorical values

### Data Protection
- No sensitive data in logs
- Secure model file storage
- Audit trail for all operations

## Future Enhancements

### Model Improvements
- XGBoost for better performance
- Feature importance analysis
- Model explainability (SHAP)
- A/B testing framework

### Additional Features
- Real-time model updates
- Custom model training
- Model versioning
- Performance monitoring dashboard

### Integration
- Real-time scoring webhooks
- Batch job processing
- Model serving optimization
- Multi-tenant support

## Troubleshooting

### Common Issues

1. **Python Environment Not Available**
   ```bash
   # Check Python installation
   python --version
   
   # Install dependencies
   pip install -r requirements.txt
   ```

2. **Models Not Trained**
   ```bash
   # Train models via API
   curl -X POST /api/v1/claims/train-models
   ```

3. **Invalid Input Features**
   - Check field names and types
   - Validate value ranges
   - Ensure all required fields present

4. **Performance Issues**
   - Monitor Python process memory
   - Check model file sizes
   - Optimize batch sizes

### Debug Mode
Enable detailed logging:
```bash
DEBUG=1 npm run dev
```

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review test cases for examples
3. Examine transaction logs for errors
4. Contact the development team

## License

MIT License - see LICENSE file for details.




