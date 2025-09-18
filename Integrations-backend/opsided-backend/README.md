# Opsided Backend

A production-ready backend architecture for Opside's Integrations Hub with two microservices sharing a Postgres database and common code.

## Architecture Overview

```
opsided-backend/
├── docker-compose.yml          # Multi-service orchestration
├── shared/                     # Shared code between services
│   ├── db/                     # Database connection & migrations
│   ├── models/                 # Data models (User, Claim, Inventory)
│   ├── utils/                  # Shared utilities (logger, encryption)
│   └── types/                  # TypeScript type definitions
├── integration-backend/        # Service 1: OAuth & API integrations
│   ├── src/
│   │   ├── controllers/        # Request handlers
│   │   ├── routes/            # API route definitions
│   │   ├── services/          # Business logic
│   │   └── middleware/        # Authentication & validation
│   └── Dockerfile
└── smart-inventory-sync/      # Service 2: Inventory synchronization
    ├── src/
    │   ├── controllers/        # Sync operation handlers
    │   ├── routes/            # Sync API routes
    │   ├── services/          # Sync business logic
    │   └── jobs/              # Background job scheduler
    └── Dockerfile
```

## Services

### 1. Integration Backend (Port 3001)
- **Purpose**: Handle OAuth flows and API integrations
- **Features**:
  - Amazon SP-API integration
  - Gmail API integration
  - Stripe API integration
  - JWT authentication
  - Token management with encryption
  - Claims and reimbursement processing

### 2. Smart Inventory Sync (Port 3002)
- **Purpose**: Inventory synchronization and discrepancy detection
- **Features**:
  - Automated inventory sync
  - Discrepancy detection
  - Inventory reconciliation
  - Background job scheduling
  - Real-time sync status monitoring

## Shared Components

### Database Models
- **User**: User management with roles
- **Claim**: Claims and reimbursement tracking
- **Inventory**: Inventory items with SKU tracking

### Utilities
- **Logger**: Winston-based logging with file and console output
- **Encryption**: AES-256-CBC token encryption
- **Constants**: Application constants and configuration

### Database
- **Connection**: Knex.js PostgreSQL connection
- **Migrations**: Database schema migrations
- **Health Checks**: Database connectivity monitoring

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- PostgreSQL 15+ (for local development)

## Quick Start

### Using Docker Compose (Recommended)

1. **Clone and navigate to the project**:
   ```bash
   cd opsided-backend
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start all services**:
   ```bash
   docker-compose up -d
   ```

4. **Verify services are running**:
   ```bash
   # Check service status
   docker-compose ps
   
   # Check logs
   docker-compose logs -f
   ```

5. **Access the services**:
   - Integration Backend: http://localhost:3001
   - Smart Inventory Sync: http://localhost:3002
   - Database: localhost:5432

### Local Development

1. **Install dependencies for both services**:
   ```bash
   cd integration-backend && npm install
   cd ../smart-inventory-sync && npm install
   ```

2. **Set up the database**:
   ```bash
   # Start PostgreSQL
   docker run -d --name opsided-postgres \
     -e POSTGRES_DB=opsided_db \
     -e POSTGRES_USER=opsided_user \
     -e POSTGRES_PASSWORD=opsided_password \
     -p 5432:5432 \
     postgres:15-alpine
   ```

3. **Run database migrations**:
   ```bash
   # Run migrations (implement as needed)
   npm run migrate
   ```

4. **Start the services**:
   ```bash
   # Terminal 1: Integration Backend
   cd integration-backend
   npm run dev
   
   # Terminal 2: Smart Inventory Sync
   cd smart-inventory-sync
   npm run dev
   ```

## API Endpoints

### Integration Backend (Port 3001)

#### Authentication
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/logout` - User logout
- `POST /api/v1/auth/refresh` - Refresh JWT token

#### Amazon Integration
- `GET /api/v1/amazon/auth` - Initiate OAuth
- `GET /api/v1/amazon/callback` - OAuth callback
- `GET /api/v1/amazon/claims` - Fetch claims
- `GET /api/v1/amazon/inventory` - Fetch inventory
- `GET /api/v1/amazon/fees` - Fetch fees

#### Gmail Integration
- `GET /api/v1/gmail/auth` - Initiate OAuth
- `GET /api/v1/gmail/callback` - OAuth callback
- `GET /api/v1/gmail/emails` - Fetch emails
- `GET /api/v1/gmail/search` - Search emails

#### Stripe Integration
- `GET /api/v1/stripe/auth` - Initiate OAuth
- `GET /api/v1/stripe/callback` - OAuth callback
- `GET /api/v1/stripe/transactions` - Fetch transactions
- `GET /api/v1/stripe/account` - Get account info

### Smart Inventory Sync (Port 3002)

#### Sync Operations
- `POST /api/v1/sync/start` - Start manual sync
- `GET /api/v1/sync/status/:userId` - Get sync status
- `GET /api/v1/sync/discrepancies/:userId` - Get discrepancies
- `POST /api/v1/sync/reconcile/:userId` - Reconcile inventory

#### Job Management
- `GET /api/v1/jobs/status` - Get job status
- `POST /api/v1/jobs/sync` - Trigger sync job
- `POST /api/v1/jobs/discrepancies` - Trigger discrepancy detection

## Environment Variables

### Required Variables
```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=opsided_db
DB_USER=opsided_user
DB_PASSWORD=opsided_password

# Security
JWT_SECRET=your-super-secret-jwt-key
ENCRYPTION_KEY=your-32-character-encryption-key

# API Credentials
AMAZON_CLIENT_ID=your-amazon-client-id
AMAZON_CLIENT_SECRET=your-amazon-client-secret
STRIPE_CLIENT_ID=your-stripe-client-id
STRIPE_CLIENT_SECRET=your-stripe-client-secret
GMAIL_CLIENT_ID=your-gmail-client-id
GMAIL_CLIENT_SECRET=your-gmail-client-secret
```

## Development

### Project Structure
```
opsided-backend/
├── shared/                     # Shared code
│   ├── db/connection.ts       # Database connection
│   ├── models/                # Data models
│   ├── utils/                 # Utilities
│   └── types/                 # TypeScript types
├── integration-backend/        # Service 1
│   ├── src/
│   │   ├── controllers/       # Request handlers
│   │   ├── routes/           # API routes
│   │   ├── services/         # Business logic
│   │   └── middleware/       # Middleware
│   └── package.json
└── smart-inventory-sync/      # Service 2
    ├── src/
    │   ├── controllers/       # Sync handlers
    │   ├── routes/           # Sync routes
    │   ├── services/         # Sync logic
    │   └── jobs/             # Background jobs
    └── package.json
```

### Adding New Features

1. **Shared Models**: Add to `shared/models/`
2. **Shared Utilities**: Add to `shared/utils/`
3. **API Endpoints**: Add controllers and routes to appropriate service
4. **Background Jobs**: Add to `smart-inventory-sync/src/jobs/`

### Testing

```bash
# Run tests for integration-backend
cd integration-backend
npm test

# Run tests for smart-inventory-sync
cd smart-inventory-sync
npm test

# Run all tests
npm run test:all
```

### Database Migrations

```bash
# Create migration
npm run migrate:make -- create_users_table

# Run migrations
npm run migrate

# Rollback migrations
npm run migrate:rollback
```

## Production Deployment

### Docker Deployment
```bash
# Build and deploy
docker-compose -f docker-compose.prod.yml up -d

# Scale services
docker-compose up -d --scale integration-backend=3
docker-compose up -d --scale smart-inventory-sync=2
```

### Environment Configuration
1. Set `NODE_ENV=production`
2. Configure production database
3. Set secure JWT and encryption keys
4. Configure API credentials
5. Set up monitoring and logging

## Monitoring & Health Checks

### Health Check Endpoints
- Integration Backend: `GET /health`
- Smart Inventory Sync: `GET /health`

### Logging
- Logs are written to `logs/` directory
- Console output in development
- Structured JSON logging in production

### Background Jobs
- Inventory sync runs every 6 hours
- Discrepancy detection runs every 2 hours
- Job status available via API

## Security Features

- **JWT Authentication**: Secure token-based auth
- **Token Encryption**: AES-256-CBC encryption for sensitive tokens
- **Rate Limiting**: Request rate limiting
- **CORS Protection**: Cross-origin request protection
- **Helmet Security**: HTTP security headers
- **Input Validation**: Request validation middleware

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support and questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

## Changelog

### v1.0.0
- Initial release
- Two-service architecture
- Shared database and code
- OAuth integrations
- Background job scheduling
- Production-ready configuration 