# Makefile for FBA Refund Success Predictor

.PHONY: install lint test train run-api

install:
	pip install -r requirements.txt

lint:
	flake8 src/ tests/

test:
	pytest tests/

train:
	bash scripts/train_model.sh

run-api:
	bash scripts/run_api.sh 