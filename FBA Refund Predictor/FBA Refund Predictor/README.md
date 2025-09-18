# OpSide Refund Success Predictor

World-class, 10x certainty ML system for predicting refund claim success with enterprise-grade accuracy and trustworthiness. Delivers certainty in capital and decision-making for OpSide's operations.

## Project Structure

- `data/` - Raw and processed data
- `notebooks/` - Jupyter notebooks for exploration
- `src/` - Source code (preprocessing, modeling, inference, API)
- `models/` - Saved models
- `scripts/` - Shell scripts for automation
- `tests/` - Unit and integration tests
- `docs/` - Documentation
- `logs/` - Log files

## Setup

```bash
make install
```

## Training

```bash
./scripts/train_model.sh
```

## Running API

```bash
./scripts/run_api.sh
```

## API Endpoint

- `POST /predict-success` - Predict refund success

## Configuration

Edit `config.yaml` for parameters.

## Logging

Uses Loguru for robust logging. Logs are stored in `logs/`.

## CI/CD Ready

Structure supports local and pipeline-based training and deployment.

## What You Need to Do Next

1. **Add your historical refund claim data** → `data/raw/`
2. **Implement actual preprocessing logic** → Fill `preprocessing.py`
3. **Write model training code** → Inside `train.py`
4. **Enhance API predictions** → Inside `predict.py` & `main.py`
5. **Run training** → `make train`
6. **Start the API** → `make run-api`
7. **Commit to GitHub** → Push scaffold to version control
8. **(Optional) Add CI/CD** for automated testing and Docker builds 