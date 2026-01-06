# MCDE Makefile
# Manufacturing Cost Document Engine

.PHONY: help install test lint format clean build run worker test-detection

help: ## Show this help message
	@echo "MCDE - Manufacturing Cost Document Engine"
	@echo ""
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	pip install -r requirements.txt
	pip install -e .

test: ## Run all tests
	pytest tests/ -v --cov=src --cov-report=html --cov-report=term-missing

test-detection: ## Run detection engine tests
	pytest tests/test_rules.py -v --cov=src/detection_engine --cov-report=html --cov-report=term-missing

lint: ## Run linting
	flake8 src/ tests/
	mypy src/

format: ## Format code with black
	black src/ tests/
	isort src/ tests/

clean: ## Clean build artifacts
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info/
	rm -rf .pytest_cache/
	rm -rf htmlcov/
	find . -type f -name "*.pyc" -delete
	find . -type d -name "__pycache__" -delete

build: ## Build package
	python setup.py build

run: ## Run the API server
	uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

worker: ## Run the detection worker
	python -m src.detection_engine.worker

worker-config: ## Validate worker configuration
	python -m src.detection_engine.worker --dry-run

setup-dev: ## Setup development environment
	pip install -r requirements.txt
	pip install -e .
	pre-commit install

docker-build: ## Build Docker image
	docker build -t mcde:latest .

docker-run: ## Run Docker container
	docker run -p 8000:8000 mcde:latest

docker-test: ## Run tests in Docker
	docker run mcde:latest pytest tests/ -v 