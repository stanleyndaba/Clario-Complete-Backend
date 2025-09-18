# FBA Refund Predictor - System Management Makefile
# Provides easy commands for development, testing, and deployment

.PHONY: help install start stop restart status logs clean test build deploy monitor

# Default target
help:
	@echo "FBA Refund Predictor - System Management"
	@echo "========================================"
	@echo ""
	@echo "Available commands:"
	@echo "  install     - Install dependencies for all services"
	@echo "  start       - Start all services with Docker Compose"
	@echo "  stop        - Stop all services"
	@echo "  restart     - Restart all services"
	@echo "  status      - Show status of all services"
	@echo "  logs        - Show logs from all services"
	@echo "  logs-follow - Follow logs from all services"
	@echo "  clean       - Clean up containers, volumes, and images"
	@echo "  test        - Run all tests"
	@echo "  test-unit   - Run unit tests only"
	@echo "  test-integration - Run integration tests only"
	@echo "  build       - Build all service images"
	@echo "  deploy      - Deploy to production (requires env setup)"
	@echo "  monitor     - Open monitoring dashboards"
	@echo "  db-reset    - Reset database and run migrations"
	@echo "  db-migrate  - Run database migrations"
	@echo "  db-backup   - Create database backup"
	@echo "  db-restore  - Restore database from backup"
	@echo "  ml-train    - Train ML model"
	@echo "  ml-evaluate - Evaluate ML model performance"
	@echo "  ml-deploy   - Deploy new ML model"
	@echo "  backup      - Create full system backup"
	@echo "  restore     - Restore system from backup"
	@echo "  update      - Update all services to latest versions"
	@echo "  health      - Check health of all services"
	@echo "  scale       - Scale specific services"
	@echo ""

# Installation
install:
	@echo "Installing dependencies for all services..."
	@cd "cost-documentation-module" && npm install
	@cd "refund-engine" && npm install
	@cd "mcde" && pip install -r requirements.txt
	@cd "FBA Refund Predictor" && pip install -r requirements.txt
	@echo "✅ All dependencies installed successfully!"

# Docker operations
start:
	@echo "Starting FBA Refund Predictor system..."
	docker-compose up -d
	@echo "✅ System started! Access services at:"
	@echo "   - API Gateway: http://localhost"
	@echo "   - Grafana: http://localhost:3002 (admin/admin)"
	@echo "   - Prometheus: http://localhost:9090"

stop:
	@echo "Stopping FBA Refund Predictor system..."
	docker-compose down
	@echo "✅ System stopped!"

restart:
	@echo "Restarting FBA Refund Predictor system..."
	docker-compose restart
	@echo "✅ System restarted!"

status:
	@echo "Service Status:"
	docker-compose ps

logs:
	@echo "Recent logs from all services:"
	docker-compose logs --tail=50

logs-follow:
	@echo "Following logs from all services (Ctrl+C to stop):"
	docker-compose logs -f

# Cleanup
clean:
	@echo "Cleaning up system..."
	docker-compose down -v --remove-orphans
	docker system prune -f
	docker volume prune -f
	@echo "✅ Cleanup completed!"

# Testing
test: test-unit test-integration
	@echo "✅ All tests completed!"

test-unit:
	@echo "Running unit tests..."
	@cd "FBA Refund Predictor" && python -m pytest tests/ -v --cov=src --cov-report=html
	@cd "cost-documentation-module" && npm test
	@cd "refund-engine" && npm test
	@echo "✅ Unit tests completed!"

test-integration:
	@echo "Running integration tests..."
	docker-compose -f docker-compose.test.yml up --abort-on-container-exit
	@echo "✅ Integration tests completed!"

# Building and deployment
build:
	@echo "Building all service images..."
	docker-compose build --no-cache
	@echo "✅ All images built successfully!"

deploy:
	@echo "Deploying to production..."
	@if [ -z "$(ENV)" ]; then echo "Error: ENV variable not set. Use: make deploy ENV=production"; exit 1; fi
	docker-compose -f docker-compose.$(ENV).yml up -d
	@echo "✅ Deployed to $(ENV) environment!"

# Monitoring
monitor:
	@echo "Opening monitoring dashboards..."
	@if command -v xdg-open > /dev/null; then \
		xdg-open http://localhost:3002; \
		xdg-open http://localhost:9090; \
	elif command -v open > /dev/null; then \
		open http://localhost:3002; \
		open http://localhost:9090; \
	else \
		echo "Please open manually:"; \
		echo "  - Grafana: http://localhost:3002"; \
		echo "  - Prometheus: http://localhost:9090"; \
	fi

# Database operations
db-reset:
	@echo "Resetting database..."
	docker-compose down -v
	docker-compose up -d postgres
	@echo "Waiting for database to be ready..."
	@sleep 10
	docker-compose exec postgres psql -U postgres -d fba_refund_predictor -f /docker-entrypoint-initdb.d/init-db.sql
	@echo "✅ Database reset completed!"

db-migrate:
	@echo "Running database migrations..."
	docker-compose exec postgres psql -U postgres -d fba_refund_predictor -f /docker-entrypoint-initdb.d/init-db.sql
	@echo "✅ Migrations completed!"

db-backup:
	@echo "Creating database backup..."
	@mkdir -p backups
	docker-compose exec postgres pg_dump -U postgres fba_refund_predictor > backups/backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "✅ Backup created in backups/ directory!"

db-restore:
	@if [ -z "$(FILE)" ]; then echo "Error: FILE variable not set. Use: make db-restore FILE=backup_file.sql"; exit 1; fi
	@echo "Restoring database from $(FILE)..."
	docker-compose exec -T postgres psql -U postgres -d fba_refund_predictor < backups/$(FILE)
	@echo "✅ Database restored from $(FILE)!"

# ML operations
ml-train:
	@echo "Training ML model..."
	@cd "FBA Refund Predictor" && python -m src.model.train
	@echo "✅ Model training completed!"

ml-evaluate:
	@echo "Evaluating ML model..."
	@cd "FBA Refund Predictor" && python -m src.model.evaluate
	@echo "✅ Model evaluation completed!"

ml-deploy:
	@echo "Deploying ML model..."
	@cd "FBA Refund Predictor" && python -m src.model.deploy
	@echo "✅ Model deployed!"

# System operations
backup:
	@echo "Creating full system backup..."
	@mkdir -p backups
	@tar -czf backups/system_backup_$(shell date +%Y%m%d_%H%M%S).tar.gz \
		--exclude=node_modules \
		--exclude=__pycache__ \
		--exclude=.git \
		--exclude=backups \
		.
	@echo "✅ System backup created!"

restore:
	@if [ -z "$(FILE)" ]; then echo "Error: FILE variable not set. Use: make restore FILE=backup_file.tar.gz"; exit 1; fi
	@echo "Restoring system from $(FILE)..."
	@tar -xzf backups/$(FILE)
	@echo "✅ System restored from $(FILE)!"

update:
	@echo "Updating all services..."
	git pull origin main
	docker-compose pull
	docker-compose build --no-cache
	docker-compose up -d
	@echo "✅ System updated!"

health:
	@echo "Checking system health..."
	@curl -s http://localhost/health || echo "❌ API Gateway: Unhealthy"
	@curl -s http://localhost:8001/health || echo "❌ FBA Predictor: Unhealthy"
	@curl -s http://localhost:3001/health || echo "❌ Cost Docs API: Unhealthy"
	@curl -s http://localhost:8000/health || echo "❌ MCDE Service: Unhealthy"
	@curl -s http://localhost:3000/health || echo "❌ Refund Engine: Unhealthy"
	@echo "✅ Health check completed!"

scale:
	@if [ -z "$(SERVICE)" ] || [ -z "$(REPLICAS)" ]; then \
		echo "Error: SERVICE and REPLICAS variables not set."; \
		echo "Use: make scale SERVICE=fba-predictor REPLICAS=3"; \
		exit 1; \
	fi
	@echo "Scaling $(SERVICE) to $(REPLICAS) replicas..."
	docker-compose up -d --scale $(SERVICE)=$(REPLICAS)
	@echo "✅ $(SERVICE) scaled to $(REPLICAS) replicas!"

# Development helpers
dev-start:
	@echo "Starting development environment..."
	docker-compose up -d postgres redis minio
	@echo "✅ Infrastructure services started!"
	@echo "Run services locally:"
	@echo "  - Cost Docs API: cd cost-documentation-module && npm run dev"
	@echo "  - Refund Engine: cd refund-engine && npm run dev"
	@echo "  - FBA Predictor: cd 'FBA Refund Predictor' && python -m uvicorn src.api.main:app --reload"

dev-stop:
	@echo "Stopping development environment..."
	docker-compose stop postgres redis minio
	@echo "✅ Infrastructure services stopped!"

# Utility functions
check-deps:
	@echo "Checking dependencies..."
	@command -v docker >/dev/null 2>&1 || { echo "❌ Docker not installed"; exit 1; }
	@command -v docker-compose >/dev/null 2>&1 || { echo "❌ Docker Compose not installed"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "⚠️  Node.js not installed (needed for local dev)"; }
	@command -v python3 >/dev/null 2>&1 || { echo "⚠️  Python3 not installed (needed for local dev)"; }
	@echo "✅ Dependencies check completed!"

# Quick actions
quick-test:
	@echo "Running quick system test..."
	@make start
	@sleep 30
	@make health
	@make test-unit
	@echo "✅ Quick test completed!"

# Production helpers
prod-backup:
	@echo "Creating production backup..."
	@make backup
	@make db-backup
	@echo "✅ Production backup completed!"

prod-deploy:
	@echo "Deploying to production..."
	@make deploy ENV=production
	@make health
	@echo "✅ Production deployment completed!"

# Show system info
info:
	@echo "FBA Refund Predictor System Information"
	@echo "======================================="
	@echo "Version: 1.0.0"
	@echo "Status: $(shell docker-compose ps --format 'table {{.Name}}\t{{.Status}}' | grep -v 'NAME')"
	@echo "Services:"
	@docker-compose ps --format '  - {{.Name}}: {{.Status}}'
	@echo ""
	@echo "Ports:"
	@echo "  - API Gateway: 80"
	@echo "  - Cost Docs API: 3001"
	@echo "  - MCDE Service: 8000"
	@echo "  - FBA Predictor: 8001"
	@echo "  - Refund Engine: 3000"
	@echo "  - Grafana: 3002"
	@echo "  - Prometheus: 9090"
	@echo "  - MinIO: 9000/9001"

