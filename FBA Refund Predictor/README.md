# FBA Refund Predictor - Complete ML System

A production-ready, enterprise-grade machine learning system for predicting Amazon FBA (Fulfillment by Amazon) refund success with automatic cost document processing, cost estimation, and intelligent refund workflow management.

## 🚀 System Overview

The FBA Refund Predictor is a comprehensive ML-powered system that automatically:
- **Processes cost documents** (invoices, shipping receipts, etc.)
- **Extracts cost information** using OCR and AI
- **Predicts refund success probability** using ensemble ML models
- **Manages refund workflows** with intelligent prioritization
- **Provides real-time monitoring** and analytics

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Nginx Gateway  │    │   Monitoring    │
│   / Dashboard   │◄──►│   (Load Balancer)│◄──►│   (Grafana)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────────────┐
              │              API Services               │
              ├─────────────────────────────────────────┤
              │  Cost Docs API  │  MCDE Service        │
              │  (Node.js)      │  (Python/FastAPI)    │
              ├─────────────────────────────────────────┤
              │  FBA Predictor  │  Refund Engine       │
              │  (Python)       │  (Node.js)           │
              └─────────────────────────────────────────┘
                              │
                              ▼
              ┌─────────────────────────────────────────┐
              │              Infrastructure             │
              ├─────────────────────────────────────────┤
              │  PostgreSQL    │  Redis     │  MinIO    │
              │  (Database)    │  (Cache)   │  (S3)     │
              └─────────────────────────────────────────┘
```

## 📋 Prerequisites

- **Docker & Docker Compose** (v20.10+)
- **Node.js** 18+ (for local development)
- **Python** 3.10+ (for local development)
- **PostgreSQL** 15+ (for local development)
- **Redis** 7+ (for local development)

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone <repository-url>
cd FBA-Refund-Predictor
```

### 2. Environment Configuration

```bash
# Copy environment templates
cp cost-documentation-module/env.example cost-documentation-module/.env
cp refund-engine/env.example refund-engine/.env

# Edit environment files with your configuration
# See individual service READMEs for required variables
```

### 3. Start All Services

```bash
# Start the entire system
docker-compose up -d

# View logs
docker-compose logs -f

# Check service status
docker-compose ps
```

### 4. Access Services

- **API Gateway**: http://localhost
- **Cost Docs API**: http://localhost:3001
- **MCDE Service**: http://localhost:8000
- **FBA Predictor**: http://localhost:8001
- **Refund Engine**: http://localhost:3000
- **Grafana Dashboard**: http://localhost:3002 (admin/admin)
- **Prometheus**: http://localhost:9090
- **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin)

## 🔧 Service Details

### Cost Documentation Module
- **Purpose**: Document upload, storage, and metadata management
- **Tech Stack**: Node.js, Express, PostgreSQL, S3/MinIO
- **Key Features**: File versioning, audit logging, search capabilities
- **Port**: 3001

### MCDE Service (Cost Estimation)
- **Purpose**: OCR processing and cost extraction from documents
- **Tech Stack**: Python, FastAPI, Tesseract, ML models
- **Key Features**: Document analysis, cost validation, compliance checking
- **Port**: 8000

### FBA Refund Predictor (ML Service)
- **Purpose**: ML model for predicting refund success probability
- **Tech Stack**: Python, FastAPI, Scikit-learn, XGBoost
- **Key Features**: Ensemble models, uncertainty quantification, active learning
- **Port**: 8001

### Refund Engine
- **Purpose**: Refund workflow management and processing
- **Tech Stack**: Node.js, Express, PostgreSQL, Redis
- **Key Features**: Claim processing, discrepancy detection, ledger management
- **Port**: 3000

## 📊 Monitoring & Observability

### Prometheus Metrics
All services expose Prometheus metrics at `/metrics` endpoints:
- HTTP request counts and latencies
- ML model performance metrics
- Database connection pools
- Cache hit rates
- Custom business metrics

### Grafana Dashboards
Pre-configured dashboards for:
- **System Health**: Service uptime and performance
- **ML Model Performance**: Accuracy, predictions, feature importance
- **Business Metrics**: Claims processed, refund amounts, success rates
- **Infrastructure**: Database, cache, and storage metrics

### Logging
Centralized logging with structured JSON format:
- Application logs with correlation IDs
- Error tracking and alerting
- Audit trails for compliance
- Performance monitoring

## 🔄 ML Pipeline

### Model Training
```bash
# Train new model
cd "FBA Refund Predictor"
python -m src.model.train

# Evaluate model performance
python -m src.model.evaluate

# Deploy model
python -m src.model.deploy
```

### Active Learning
The system continuously improves through:
- **Feedback Collection**: Agent decisions on refunds
- **Model Retraining**: Automatic retraining on new data
- **Performance Monitoring**: Drift detection and alerting
- **A/B Testing**: New model versions vs. production

### Feature Engineering
- **Claim Features**: Amount, customer history, product category
- **Document Features**: OCR text, cost patterns, compliance flags
- **Temporal Features**: Days since purchase, seasonal patterns
- **Customer Features**: Historical success rates, claim frequency

## 🧪 Testing

### Run All Tests
```bash
# Unit tests
cd "FBA Refund Predictor"
pytest tests/ -v --cov=src --cov-report=html

# Integration tests
docker-compose -f docker-compose.test.yml up --abort-on-container-exit

# API tests
cd refund-engine
npm test

cd cost-documentation-module
npm test
```

### Test Coverage
- **Unit Tests**: 90%+ coverage
- **Integration Tests**: All service interactions
- **API Tests**: Endpoint validation and error handling
- **Load Tests**: Performance under stress

## 🚀 Production Deployment

### Environment Variables
```bash
# Production environment
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://host:6379
JWT_SECRET=very-secure-secret
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

### Scaling
```bash
# Scale specific services
docker-compose up -d --scale fba-predictor=3
docker-compose up -d --scale cost-docs-api=2

# Load balancer configuration
# Edit nginx/nginx.conf for multiple instances
```

### Health Checks
```bash
# Service health
curl http://localhost/health

# Individual service health
curl http://localhost:8001/health
curl http://localhost:3001/health
curl http://localhost:8000/health
curl http://localhost:3000/health
```

## 🔒 Security Features

- **JWT Authentication**: Secure token-based access
- **Role-Based Access Control**: Different permission levels
- **Rate Limiting**: Protection against abuse
- **Input Validation**: Comprehensive request sanitization
- **Audit Logging**: Complete operation tracking
- **HTTPS Enforcement**: Secure communication
- **CORS Protection**: Configurable cross-origin policies

## 📈 Performance & Optimization

### Caching Strategy
- **Redis**: Session data, ML predictions, API responses
- **Database**: Query result caching, connection pooling
- **CDN**: Static asset delivery (for production)

### Database Optimization
- **Indexing**: Strategic indexes on frequently queried columns
- **Partitioning**: Time-based partitioning for large tables
- **Connection Pooling**: Efficient database connection management
- **Query Optimization**: Optimized SQL with explain plans

### ML Model Optimization
- **Model Quantization**: Reduced memory footprint
- **Batch Processing**: Efficient inference for multiple predictions
- **Async Processing**: Non-blocking prediction requests
- **Model Caching**: Pre-computed predictions for common cases

## 🛠️ Development

### Local Development
```bash
# Start only required services
docker-compose up -d postgres redis minio

# Run services locally
cd cost-documentation-module && npm run dev
cd refund-engine && npm run dev
cd "FBA Refund Predictor" && python -m uvicorn src.api.main:app --reload
```

### Code Quality
```bash
# Python linting and formatting
cd "FBA Refund Predictor"
black src/
flake8 src/
mypy src/

# Node.js linting
cd cost-documentation-module
npm run lint

cd refund-engine
npm run lint
```

### Database Migrations
```bash
# Run migrations
docker-compose exec postgres psql -U postgres -d fba_refund_predictor -f /docker-entrypoint-initdb.d/init-db.sql

# Reset database
docker-compose down -v
docker-compose up -d postgres
```

## 📚 API Documentation

### Swagger/OpenAPI
- **Cost Docs API**: http://localhost:3001/docs
- **MCDE Service**: http://localhost:8000/docs
- **FBA Predictor**: http://localhost:8001/docs
- **Refund Engine**: http://localhost:3000/docs

### Postman Collections
Import the provided Postman collections for:
- Complete API testing
- Example requests and responses
- Environment configuration
- Automated testing workflows

## 🔍 Troubleshooting

### Common Issues

#### Service Won't Start
```bash
# Check logs
docker-compose logs <service-name>

# Check dependencies
docker-compose ps

# Restart service
docker-compose restart <service-name>
```

#### Database Connection Issues
```bash
# Check PostgreSQL status
docker-compose exec postgres pg_isready

# Check connection from service
docker-compose exec <service-name> ping postgres
```

#### ML Model Loading Issues
```bash
# Check model files
docker-compose exec fba-predictor ls -la /app/models/

# Check model loading logs
docker-compose logs fba-predictor
```

### Performance Issues
```bash
# Check resource usage
docker stats

# Check database performance
docker-compose exec postgres psql -U postgres -d fba_refund_predictor -c "SELECT * FROM pg_stat_activity;"

# Check Redis memory
docker-compose exec redis redis-cli info memory
```

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch
3. **Make** your changes
4. **Add** tests for new functionality
5. **Ensure** all tests pass
6. **Submit** a pull request

### Development Guidelines
- Follow existing code style and patterns
- Add comprehensive tests for new features
- Update documentation for API changes
- Use conventional commit messages
- Include performance considerations

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

### Getting Help
- **Documentation**: Check this README and service-specific docs
- **Issues**: Create GitHub issues for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Email**: Contact the development team

### Emergency Contacts
- **System Admin**: For production issues
- **ML Team**: For model performance issues
- **DevOps**: For infrastructure problems

## 🎯 Roadmap

### Phase 1 (Current)
- ✅ Core ML pipeline implementation
- ✅ Service integration and monitoring
- ✅ Basic dashboard and reporting
- ✅ Production deployment setup

### Phase 2 (Next)
- 🔄 Advanced ML models (Deep Learning, NLP)
- 🔄 Real-time streaming predictions
- 🔄 Advanced analytics and insights
- 🔄 Mobile app for agents

### Phase 3 (Future)
- 📋 Multi-language support
- 📋 Advanced compliance features
- 📋 Integration with external systems
- 📋 AI-powered customer support

---

**Built with ❤️ by the OpSide Development Team**

*For questions or support, please refer to the documentation or create an issue in the repository.*

