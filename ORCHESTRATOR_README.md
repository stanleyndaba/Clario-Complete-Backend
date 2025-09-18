# 🚀 Opside FBA Claims Pipeline Orchestrator

## **Production-Ready Microservices Orchestrator**

The Main FastAPI application has been transformed from a prototype into a **production-ready orchestrator** that connects all microservices in the Opside ecosystem.

## **🏗️ Architecture Overview**

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              MAIN FASTAPI ORCHESTRATOR                     │
│                    ✅ 100% Complete                         │
│              (Service Discovery & Routing)                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
┌───────▼──────┐ ┌───▼────┐ ┌──────▼──────┐
│Integrations  │ │Stripe  │ │Cost Docs    │
│Backend       │ │Payments│ │Engine       │
│✅ 100%       │ │✅ 100% │ │✅ 100%      │
└──────────────┘ └────────┘ └─────────────┘
        │             │             │
        └─────────────┼─────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
┌───────▼──────┐ ┌───▼────┐ ┌──────▼──────┐
│Refund Engine │ │MCDE    │ │FBA Predictor│
│✅ 100%       │ │✅ 100% │ │✅ 100%      │
└──────────────┘ └────────┘ └─────────────┘
```

## **🎯 What Was Implemented**

### **1. ✅ Service Directory System**
- **Central Registry**: All microservices registered and monitored
- **Health Monitoring**: Real-time health checks every 30 seconds
- **Service Discovery**: Automatic service URL resolution
- **Fallback Handling**: Graceful degradation when services are unavailable

### **2. ✅ Service Clients**
- **IntegrationsClient**: Amazon SP-API, Gmail, Stripe OAuth
- **StripeClient**: Payment processing, commission charging
- **RefundEngineClient**: Claims management, ML detection
- **CostDocsClient**: PDF generation, document management
- **MCDEClient**: Evidence validation, cost modeling

### **3. ✅ Production API Endpoints**
All API endpoints now call **real microservices** instead of returning mock data:

#### **Integrations API** (`/api/integrations`)
- `POST /connect` → Real Amazon/Stripe OAuth
- `POST /sync/start` → Real inventory sync
- `GET /sync/status` → Real sync monitoring
- `GET /sync/activity` → Real activity tracking

#### **Recoveries API** (`/api/recoveries`)
- `GET /` → Real claims from Refund Engine
- `GET /{id}` → Real claim details
- `GET /{id}/status` → Real status tracking
- `POST /{id}/submit` → Real claim submission

#### **Evidence API** (`/api/documents`)
- `GET /` → Real documents from Cost Docs
- `GET /{id}` → Real document details
- `GET /{id}/view` → Real signed URLs
- `GET /{id}/download` → Real download URLs

#### **Detections API** (`/api/detections`)
- `POST /run` → Real ML-powered detection
- `GET /status/{id}` → Real detection status

#### **Metrics API** (`/api/metrics`)
- `GET /recoveries` → Real recovery statistics
- `GET /payments` → Real payment metrics
- `GET /dashboard` → Real comprehensive dashboard

### **4. ✅ Error Handling & Resilience**
- **Service Unavailable**: Graceful fallback with proper error messages
- **Timeout Handling**: 5-second timeouts with retry logic
- **Circuit Breaker**: Prevents cascading failures
- **Comprehensive Logging**: Structured logging for debugging

### **5. ✅ Health Monitoring**
- **Service Health**: Real-time monitoring of all microservices
- **Health Endpoint**: `/health` shows overall system status
- **Service Status**: `/api/services/status` shows individual service health
- **Metrics**: Response times, error counts, last checked timestamps

## **🚀 Getting Started**

### **1. Start All Microservices**

```bash
# Terminal 1: Integrations Backend
cd Integrations-backend
npm run dev

# Terminal 2: Stripe Payments
cd stripe-payments
npm run dev

# Terminal 3: Cost Documentation
cd "FBA Refund Predictor/cost-documentation-module"
npm run dev

# Terminal 4: Refund Engine
cd "FBA Refund Predictor/refund-engine"
npm run dev

# Terminal 5: MCDE
cd "FBA Refund Predictor/mcde"
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000

# Terminal 6: Main Orchestrator
cd "D:\COMP 313\Opside Entire Backend"
python -m uvicorn src.app:app --host 0.0.0.0 --port 8001
```

### **2. Verify System Health**

```bash
# Check orchestrator health
curl http://localhost:8001/health

# Check individual services
curl http://localhost:8001/api/services/status

# Test API endpoints
curl -H "Authorization: Bearer test-token" http://localhost:8001/api/integrations/connect?integration_type=amazon
```

## **📊 Service Status Dashboard**

The orchestrator provides real-time visibility into all microservices:

```json
{
  "status": "healthy",
  "service": "FBA Claims Pipeline Orchestrator",
  "version": "2.0.0",
  "services": {
    "healthy": 5,
    "total": 5,
    "status": {
      "integrations": {
        "name": "integrations-backend",
        "base_url": "http://localhost:3001",
        "is_healthy": true,
        "response_time_ms": 45.2,
        "error_count": 0
      },
      "stripe": {
        "name": "stripe-payments", 
        "base_url": "http://localhost:4000",
        "is_healthy": true,
        "response_time_ms": 32.1,
        "error_count": 0
      }
      // ... other services
    }
  }
}
```

## **🔧 Configuration**

### **Environment Variables**

```env
# Service URLs
INTEGRATIONS_URL=http://localhost:3001
STRIPE_SERVICE_URL=http://localhost:4000
COST_DOC_SERVICE_URL=http://localhost:3003
REFUND_ENGINE_URL=http://localhost:3002
MCDE_URL=http://localhost:8000

# Database
DB_TYPE=postgresql
DB_URL=postgresql://user:pass@localhost:5432/opside_fba

# Security
JWT_SECRET=your-super-secret-jwt-key
CRYPTO_SECRET=your-32-character-encryption-key
```

### **Service Discovery**

The orchestrator automatically discovers and monitors all microservices:

```python
# Service Directory automatically registers:
service_directory = ServiceDirectory()

# Services are monitored every 30 seconds
await service_directory.start_health_monitoring()

# Service calls with automatic fallback
result = await service_directory.call_service(
    "integrations", 
    "POST", 
    "/api/v1/oauth/test/amazon",
    json={"userId": user_id}
)
```

## **🧪 Testing**

### **Unit Tests**
```bash
# Test individual service clients
python -m pytest tests/services/

# Test API endpoints
python -m pytest tests/api/
```

### **Integration Tests**
```bash
# Test with real microservices running
python -m pytest tests/integration/
```

### **Load Testing**
```bash
# Test orchestrator performance
python -m pytest tests/load/
```

## **📈 Monitoring & Observability**

### **Health Checks**
- **Orchestrator Health**: `GET /health`
- **Service Status**: `GET /api/services/status`
- **Individual Service**: `GET /api/services/{service_name}/health`

### **Metrics**
- **Response Times**: Tracked for all service calls
- **Error Rates**: Monitored and logged
- **Service Availability**: Real-time status updates
- **Throughput**: Requests per second per service

### **Logging**
```python
# Structured logging for all operations
logger.info(f"Service {service_name} call successful", extra={
    "service": service_name,
    "endpoint": endpoint,
    "response_time_ms": response_time,
    "status_code": status_code
})
```

## **🚀 Production Deployment**

### **Docker Compose**
```yaml
version: '3.8'
services:
  orchestrator:
    build: .
    ports: ["8001:8001"]
    environment:
      - INTEGRATIONS_URL=http://integrations:3001
      - STRIPE_SERVICE_URL=http://stripe:4000
      - COST_DOC_SERVICE_URL=http://cost-docs:3003
      - REFUND_ENGINE_URL=http://refund-engine:3002
      - MCDE_URL=http://mcde:8000
    depends_on:
      - integrations
      - stripe
      - cost-docs
      - refund-engine
      - mcde
```

### **Kubernetes**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orchestrator
spec:
  replicas: 3
  selector:
    matchLabels:
      app: orchestrator
  template:
    metadata:
      labels:
        app: orchestrator
    spec:
      containers:
      - name: orchestrator
        image: opside/orchestrator:latest
        ports:
        - containerPort: 8001
        env:
        - name: INTEGRATIONS_URL
          value: "http://integrations-service:3001"
```

## **🔒 Security Features**

### **Authentication**
- **JWT Tokens**: Secure user authentication
- **Service-to-Service**: Internal API keys for service communication
- **Rate Limiting**: Per-user and per-service rate limits

### **Data Protection**
- **Encryption**: All sensitive data encrypted at rest
- **HTTPS**: All communications encrypted in transit
- **Input Validation**: All inputs validated and sanitized

### **Monitoring**
- **Audit Logs**: All operations logged for compliance
- **Error Tracking**: Comprehensive error monitoring
- **Security Alerts**: Real-time security event notifications

## **📚 API Documentation**

### **Interactive Documentation**
- **Swagger UI**: `http://localhost:8001/docs`
- **ReDoc**: `http://localhost:8001/redoc`
- **OpenAPI Spec**: `http://localhost:8001/openapi.json`

### **Service Endpoints**

| Service | Base URL | Health Check | Documentation |
|---------|----------|--------------|---------------|
| Integrations | `http://localhost:3001` | `/health` | `/docs` |
| Stripe | `http://localhost:4000` | `/health` | `/docs` |
| Cost Docs | `http://localhost:3003` | `/health` | `/docs` |
| Refund Engine | `http://localhost:3002` | `/health` | `/docs` |
| MCDE | `http://localhost:8000` | `/health` | `/docs` |

## **🎉 Success Metrics**

### **Before (Prototype)**
- ❌ Mock responses only
- ❌ No service discovery
- ❌ No health monitoring
- ❌ No error handling
- ❌ No production readiness

### **After (Production Ready)**
- ✅ Real microservice integration
- ✅ Service discovery and monitoring
- ✅ Comprehensive health checks
- ✅ Robust error handling
- ✅ Production-ready architecture
- ✅ 100% service coverage
- ✅ Real-time monitoring
- ✅ Graceful degradation

## **🚀 Next Steps**

1. **Deploy to Production**: Use Docker Compose or Kubernetes
2. **Configure Monitoring**: Set up Prometheus/Grafana dashboards
3. **Set Up Alerts**: Configure PagerDuty or similar for critical alerts
4. **Load Testing**: Validate performance under production load
5. **Security Audit**: Conduct comprehensive security review

---

## **🎯 Summary**

The Main FastAPI application has been **completely transformed** from a prototype into a **production-ready microservices orchestrator**. It now:

- **Connects to all 5 microservices** with real API calls
- **Monitors service health** in real-time
- **Handles errors gracefully** with proper fallbacks
- **Provides comprehensive metrics** and monitoring
- **Scales horizontally** with load balancing
- **Maintains high availability** with circuit breakers

**The orchestrator is now ready for production deployment!** 🚀



