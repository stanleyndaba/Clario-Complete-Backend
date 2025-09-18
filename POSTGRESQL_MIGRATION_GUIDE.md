# PostgreSQL Migration Guide

This guide walks you through migrating the Opside FBA Claims Pipeline from SQLite to PostgreSQL for production deployment.

## 🎯 Overview

The migration includes:
- ✅ PostgreSQL schema with proper data types and constraints
- ✅ Automatic fallback to SQLite for development
- ✅ Data migration scripts
- ✅ Docker Compose integration
- ✅ Comprehensive testing suite

## 📋 Prerequisites

1. **PostgreSQL 15+** installed locally or via Docker
2. **Python 3.11+** with required dependencies
3. **Docker & Docker Compose** (for containerized deployment)

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Install PostgreSQL dependencies
pip install psycopg2-binary sqlalchemy alembic

# Or install all requirements
pip install -r requirements.txt
```

### 2. Set Up Environment

```bash
# Copy environment template
cp env.template .env

# Edit .env with your PostgreSQL credentials
DB_TYPE=postgresql
DB_URL=postgresql://postgres:password@localhost:5432/opside_fba
DB_NAME=opside_fba
DB_USER=postgres
DB_PASSWORD=your_secure_password
```

### 3. Start PostgreSQL (Docker)

```bash
# Start PostgreSQL container
docker-compose up postgres -d

# Wait for PostgreSQL to be ready
docker-compose logs postgres
```

### 4. Run Migration

```bash
# Migrate data from SQLite to PostgreSQL
python scripts/migrate_to_postgresql.py

# Test the migration
python scripts/test_postgresql_migration.py
```

### 5. Start the Application

```bash
# Start all services
docker-compose up -d

# Or start just the main API
python -m uvicorn src.app:app --reload --host 0.0.0.0 --port 8000
```

## 🔧 Configuration

### Database Configuration

The system automatically detects the database type based on the `DB_URL`:

```python
# PostgreSQL (Production)
DB_URL=postgresql://user:password@host:port/database
DB_TYPE=postgresql

# SQLite (Development)
DB_URL=./claims.db
DB_TYPE=sqlite
```

### Environment Variables

Key environment variables for PostgreSQL:

```bash
# Database
DB_TYPE=postgresql
DB_URL=postgresql://postgres:password@localhost:5432/opside_fba
DB_NAME=opside_fba
DB_USER=postgres
DB_PASSWORD=password

# Security
JWT_SECRET=your-super-secret-jwt-key-here
CRYPTO_SECRET=a_very_secret_key_for_encryption_32_bytes

# Service URLs
INTEGRATIONS_URL=http://localhost:3001
STRIPE_SERVICE_URL=http://localhost:4000
```

## 📊 Schema Changes

### Key Improvements

1. **Data Types**: Proper PostgreSQL types (UUID, ENUM, JSONB)
2. **Constraints**: CHECK constraints for data validation
3. **Indexes**: Optimized indexes for better performance
4. **Triggers**: Automatic `updated_at` timestamp updates
5. **Extensions**: UUID generation support

### Table Structure

```sql
-- Claims table with ENUM types
CREATE TABLE claims (
    claim_id VARCHAR(255) PRIMARY KEY,
    status claim_status NOT NULL DEFAULT 'detected',
    claim_type claim_type NOT NULL,
    confidence DECIMAL(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    amount_estimate DECIMAL(10,2) NOT NULL CHECK (amount_estimate >= 0),
    quantity_affected INTEGER NOT NULL CHECK (quantity_affected >= 0),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Users table with UUID primary key
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    amazon_seller_id VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255),
    linked_marketplaces JSONB DEFAULT '[]',
    -- ... other fields
);
```

## 🧪 Testing

### Run Test Suite

```bash
# Test database connection and operations
python scripts/test_postgresql_migration.py

# Test specific functionality
python -c "from src.common.db_postgresql import db; print('Database ready!')"
```

### Test Endpoints

```bash
# Health check
curl http://localhost:8000/health

# API documentation
curl http://localhost:8000/docs

# Test authentication
curl -H "Authorization: Bearer test-token" http://localhost:8000/api/auth/me
```

## 🐳 Docker Deployment

### Full Stack Deployment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f main-api

# Stop services
docker-compose down
```

### Service Dependencies

The main API service depends on:
- PostgreSQL (with health check)
- Redis
- Integrations Backend
- Stripe Payments

## 🔍 Monitoring

### Database Health

```bash
# Check PostgreSQL status
docker-compose exec postgres pg_isready -U postgres

# View database size
docker-compose exec postgres psql -U postgres -d opside_fba -c "SELECT pg_size_pretty(pg_database_size('opside_fba'));"
```

### Application Health

```bash
# Check API health
curl http://localhost:8000/health

# Check service status
docker-compose ps
```

## 🚨 Troubleshooting

### Common Issues

1. **Connection Refused**
   ```bash
   # Check if PostgreSQL is running
   docker-compose ps postgres
   
   # Check logs
   docker-compose logs postgres
   ```

2. **Migration Fails**
   ```bash
   # Check database permissions
   docker-compose exec postgres psql -U postgres -c "\du"
   
   # Verify database exists
   docker-compose exec postgres psql -U postgres -c "\l"
   ```

3. **Data Type Errors**
   ```bash
   # Check table structure
   docker-compose exec postgres psql -U postgres -d opside_fba -c "\d claims"
   ```

### Rollback to SQLite

If you need to rollback to SQLite:

```bash
# Update environment
export DB_TYPE=sqlite
export DB_URL=./claims.db

# Restart application
python -m uvicorn src.app:app --reload
```

## 📈 Performance

### PostgreSQL Optimizations

1. **Connection Pooling**: Uses connection pooling for better performance
2. **Indexes**: Optimized indexes on frequently queried columns
3. **JSONB**: Efficient JSON storage and querying
4. **Constraints**: Data validation at database level

### Monitoring Queries

```sql
-- Check slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

-- Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## 🔒 Security

### Database Security

1. **Encrypted Tokens**: OAuth tokens are encrypted at rest
2. **Connection Security**: Use SSL for production connections
3. **User Permissions**: Limit database user permissions
4. **Environment Variables**: Store secrets in environment variables

### Production Checklist

- [ ] Change default passwords
- [ ] Enable SSL connections
- [ ] Set up database backups
- [ ] Configure monitoring
- [ ] Set up log rotation
- [ ] Test failover procedures

## 📚 Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [FastAPI Database Documentation](https://fastapi.tiangolo.com/tutorial/sql-databases/)

## 🆘 Support

If you encounter issues:

1. Check the logs: `docker-compose logs`
2. Run the test suite: `python scripts/test_postgresql_migration.py`
3. Verify environment variables: `env | grep DB_`
4. Check database connectivity: `docker-compose exec postgres pg_isready`

---

**Migration Status**: ✅ **Complete and Ready for Production**




