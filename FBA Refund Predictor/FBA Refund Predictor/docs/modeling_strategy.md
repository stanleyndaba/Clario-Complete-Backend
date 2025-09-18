# Modeling Strategy

## Overview

The FBA Refund Success Predictor uses a multi-stage modeling approach:

1. **Baseline Models**: Logistic Regression for interpretability
2. **Gradient Boosting**: LightGBM for performance
3. **Transformer Models**: For text embeddings
4. **Ensemble**: Stacking for final predictions

## Feature Engineering

- Numerical features: Standard scaling
- Categorical features: Target encoding
- Text features: Transformer embeddings
- Temporal features: Time-based aggregations

## Model Selection

- Cross-validation with stratified sampling
- Hyperparameter optimization via Optuna
- Model calibration for probability estimates
- Explainability analysis with SHAP

## Active Learning

- Uncertainty sampling for new data
- Human feedback integration
- Incremental retraining pipeline 