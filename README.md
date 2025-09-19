# Opside Backend - FBA Refund Prediction System

A comprehensive backend system for Amazon FBA refund prediction, evidence collection, and automated dispute submission.

## 🚀 Features

### Core Engines
- **FBA Refund Predictor**: Machine learning models for predicting refund eligibility
- **Evidence Matching Engine**: Automated evidence collection and validation
- **Document Parser Pipeline**: OCR and document processing capabilities
- **Zero Effort Evidence**: Automated evidence generation system
- **Cost Documentation Module**: Comprehensive cost tracking and documentation

### Integrations
- **Amazon SP-API Integration**: Complete Amazon Seller Partner API integration
- **Stripe Payments**: Payment processing and payout management
- **Gmail Integration**: Email-based evidence collection
- **Supabase Database**: Scalable database backend

### Advanced Features
- **Feature Flags & Canary Deployment**: Safe feature rollouts
- **Analytics & Monitoring**: Comprehensive system monitoring
- **Security & Encryption**: End-to-end data protection
- **WebSocket Support**: Real-time updates and notifications

## 📁 Project Structure

```
├── src/                          # Main Python backend
│   ├── api/                      # API endpoints
│   ├── evidence/                 # Evidence collection & matching
│   ├── ml_detector/             # Machine learning models
│   ├── integrations/            # External service integrations
│   └── security/                # Security & encryption
├── FBA Refund Predictor/        # ML prediction models
├── Integrations-backend/        # Node.js integration services
├── stripe-payments/             # Payment processing service
├── evidence-engine/             # Evidence processing engine
└── Claim Detector Model/        # Claim detection algorithms
```

## 🛠️ Technology Stack

- **Backend**: Python (FastAPI), Node.js (Express/TypeScript)
- **Database**: PostgreSQL, Supabase
- **ML/AI**: scikit-learn, transformers, joblib
- **Integrations**: Amazon SP-API, Stripe, Gmail API
- **Deployment**: Docker, Fly.io, Render
- **Monitoring**: Prometheus, Grafana

## 🚀 Quick Start

### Prerequisites
- Python 3.9+
- Node.js 18+
- PostgreSQL
- Docker (optional)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-github-repo-url>
   cd opside-backend
   ```

2. **Set up environment variables**
   ```bash
   cp env.template .env
   # Edit .env with your configuration
   ```

3. **Install Python dependencies**
```bash
pip install -r requirements.txt
```

4. **Install Node.js dependencies**
```bash
   cd Integrations-backend
   npm install
   cd ../stripe-payments
   npm install
```

5. **Run database migrations**
```bash
   python scripts/migrate_to_postgresql.py
   ```

6. **Start the services**
   ```bash
   # Start main API
   python src/app.py
   
   # Start integrations backend
   cd Integrations-backend
   npm start
   
   # Start payment service
   cd ../stripe-payments
   npm start
   ```

## 📊 API Documentation

### Main API Endpoints
- `GET /health` - Health check
- `POST /api/evidence/match` - Evidence matching
- `POST /api/detections/predict` - Refund prediction
- `POST /api/integrations/amazon/sync` - Amazon data sync

### Integration Endpoints
- `POST /api/amazon/oauth` - Amazon OAuth setup
- `POST /api/stripe/webhook` - Stripe webhook handler
- `GET /api/sync/status` - Sync status monitoring

## 🔧 Configuration

### Environment Variables
See `ENVIRONMENT_VARIABLES_GUIDE.md` for complete configuration details.

Key variables:
- `DATABASE_URL` - PostgreSQL connection string
- `AMAZON_CLIENT_ID` - Amazon SP-API credentials
- `STRIPE_SECRET_KEY` - Stripe API key
- `SUPABASE_URL` - Supabase project URL

## 🚀 Deployment

### Using Render (Recommended)
1. Connect your GitHub repository to Render
2. Use the provided `render.yaml` configuration
3. Set environment variables in Render dashboard

### Using Fly.io
1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run deployment script: `./deploy.ps1`

### Using Docker
```bash
docker-compose up -d
```

## 📈 Monitoring

- **Health Checks**: Built-in health monitoring
- **Analytics**: Comprehensive usage analytics
- **Alerts**: Automated alerting system
- **Logs**: Centralized logging with structured output

## 🔒 Security

- **Data Encryption**: End-to-end encryption for sensitive data
- **Access Control**: Role-based access control
- **Audit Logging**: Comprehensive audit trails
- **API Security**: Rate limiting and authentication

## 📝 Documentation

- [Deployment Guide](DEPLOYMENT_GUIDE.md)
- [Environment Variables](ENVIRONMENT_VARIABLES_GUIDE.md)
- [API Contracts](API_CONTRACTS.md)
- [Security Implementation](SECURITY_IMPLEMENTATION_COMPLETE.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is proprietary software. All rights reserved.

## 🆘 Support

For support and questions:
- Create an issue in this repository
- Check the documentation in the `/docs` folder
- Review the implementation guides

---

**Note**: This repository uses Git LFS for large files. Make sure to install Git LFS before cloning:
```bash
git lfs install
```