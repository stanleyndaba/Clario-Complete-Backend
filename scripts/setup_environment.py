#!/usr/bin/env python3
"""
Environment Variables Setup Script
Generates secure environment variables and validates configuration
"""

import os
import secrets
import string
import base64
from datetime import datetime
from pathlib import Path
from cryptography.fernet import Fernet

def generate_secure_key(length=32):
    """Generate a secure random key"""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def generate_jwt_secret():
    """Generate a secure JWT secret"""
    return secrets.token_urlsafe(64)

def generate_crypto_secret():
    """Generate a secure encryption key"""
    return Fernet.generate_key().decode()

def generate_api_key():
    """Generate a secure API key"""
    return secrets.token_urlsafe(32)

def validate_environment():
    """Validate current environment variables"""
    print("🔍 Validating environment variables...")
    
    required_vars = [
        'DB_URL', 'JWT_SECRET', 'CRYPTO_SECRET', 'AMAZON_CLIENT_ID', 
        'AMAZON_CLIENT_SECRET', 'STRIPE_SERVICE_URL'
    ]
    
    missing_vars = []
    weak_vars = []
    
    for var in required_vars:
        value = os.getenv(var)
        if not value:
            missing_vars.append(var)
        elif var in ['JWT_SECRET', 'CRYPTO_SECRET'] and 'change-in-production' in value:
            weak_vars.append(var)
    
    if missing_vars:
        print(f"❌ Missing required variables: {', '.join(missing_vars)}")
        return False
    
    if weak_vars:
        print(f"⚠️  Weak default values detected: {', '.join(weak_vars)}")
        return False
    
    print("✅ Environment validation passed")
    return True

def create_environment_files():
    """Create environment files for different environments"""
    
    # Generate secure values
    jwt_secret = generate_jwt_secret()
    crypto_secret = generate_crypto_secret()
    integrations_api_key = generate_api_key()
    stripe_internal_key = generate_api_key()
    
    # Development environment
    dev_env = f"""# Development Environment Variables
# Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

# Database Configuration
DB_TYPE=postgresql
DB_URL=postgresql://postgres:password@localhost:5432/opside_fba_dev
DB_NAME=opside_fba_dev
DB_USER=postgres
DB_PASSWORD=password

# Application Configuration
ENV=development
FRONTEND_URL=http://localhost:3000

# Amazon OAuth Configuration (REQUIRED - Get from Amazon Developer Console)
AMAZON_CLIENT_ID=your-amazon-client-id
AMAZON_CLIENT_SECRET=your-amazon-client-secret
AMAZON_REDIRECT_URI=http://localhost:8000/api/auth/amazon/callback

# Security Configuration (AUTO-GENERATED)
JWT_SECRET={jwt_secret}
JWT_ALGORITHM=HS256
JWT_EXPIRES_IN_MINUTES=10080
CRYPTO_SECRET={crypto_secret}

# Service URLs
INTEGRATIONS_URL=http://localhost:3001
INTEGRATIONS_API_KEY={integrations_api_key}
STRIPE_SERVICE_URL=http://localhost:4000
STRIPE_INTERNAL_API_KEY={stripe_internal_key}

# Service Ports
INTEGRATIONS_PORT=3001
PAYMENTS_PORT=4000
COST_DOC_PORT=3003
REFUND_ENGINE_PORT=3002

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Stripe Configuration (REQUIRED - Get from Stripe Dashboard)
PAYMENTS_STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
PAYMENTS_STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
PAYMENTS_STRIPE_CLIENT_ID=ca_your_stripe_client_id
PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID=acct_your_platform_account_id
PAYMENTS_STRIPE_API_VERSION=2023-10-16
PAYMENTS_STRIPE_PRICE_ID=price_your_price_id
PAYMENTS_STRIPE_LIVE_MODE=false
PAYMENTS_JWT_SECRET={jwt_secret}

# Integrations Backend Configuration (REQUIRED - Get from Supabase)
INTEGRATIONS_SUPABASE_URL=your-supabase-url
INTEGRATIONS_SUPABASE_ANON_KEY=your-supabase-anon-key
INTEGRATIONS_SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
INTEGRATIONS_JWT_SECRET={jwt_secret}
INTEGRATIONS_RATE_LIMIT_WINDOW_MS=900000
INTEGRATIONS_RATE_LIMIT_MAX_REQUESTS=100

# Cost Documentation Configuration
COST_DOC_DATABASE_URL=postgresql://postgres:password@postgres:5432/opside_fba
COST_DOC_JWT_SECRET={jwt_secret}
COST_DOC_REDIS_URL=redis://redis:6379

# Refund Engine Configuration
REFUND_ENGINE_JWT_SECRET={jwt_secret}
REFUND_ENGINE_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000
REFUND_ENGINE_RATE_LIMIT_WINDOW_MS=900000
REFUND_ENGINE_RATE_LIMIT_MAX_REQUESTS=100
REFUND_ENGINE_ML_API_BASE_URL=http://mcde:8000

# ML Service Configuration
MCDE_CORS_ORIGINS=http://localhost:3000,http://localhost:8000
"""

    # Production environment
    prod_env = f"""# Production Environment Variables
# Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
# WARNING: Update all placeholder values before deployment!

# Database Configuration
DB_TYPE=postgresql
DB_URL=postgresql://postgres:CHANGE_ME@your-db-host:5432/opside_fba_prod
DB_NAME=opside_fba_prod
DB_USER=postgres
DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD

# Application Configuration
ENV=production
FRONTEND_URL=https://your-frontend-domain.com

# Amazon OAuth Configuration (REQUIRED)
AMAZON_CLIENT_ID=your-production-amazon-client-id
AMAZON_CLIENT_SECRET=your-production-amazon-client-secret
AMAZON_REDIRECT_URI=https://your-api-domain.com/api/auth/amazon/callback

# Security Configuration (AUTO-GENERATED)
JWT_SECRET={jwt_secret}
JWT_ALGORITHM=HS256
JWT_EXPIRES_IN_MINUTES=10080
CRYPTO_SECRET={crypto_secret}

# Service URLs
INTEGRATIONS_URL=https://your-integrations-domain.com
INTEGRATIONS_API_KEY={integrations_api_key}
STRIPE_SERVICE_URL=https://your-stripe-domain.com
STRIPE_INTERNAL_API_KEY={stripe_internal_key}

# Service Ports
INTEGRATIONS_PORT=3001
PAYMENTS_PORT=4000
COST_DOC_PORT=3003
REFUND_ENGINE_PORT=3002

# Redis Configuration
REDIS_URL=redis://your-redis-host:6379

# Stripe Configuration (REQUIRED)
PAYMENTS_STRIPE_SECRET_KEY=sk_live_your_live_stripe_secret_key
PAYMENTS_STRIPE_WEBHOOK_SECRET=whsec_your_live_webhook_secret
PAYMENTS_STRIPE_CLIENT_ID=ca_your_live_stripe_client_id
PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID=acct_your_live_platform_account_id
PAYMENTS_STRIPE_API_VERSION=2023-10-16
PAYMENTS_STRIPE_PRICE_ID=price_your_live_price_id
PAYMENTS_STRIPE_LIVE_MODE=true
PAYMENTS_JWT_SECRET={jwt_secret}

# Integrations Backend Configuration (REQUIRED)
INTEGRATIONS_SUPABASE_URL=https://your-project.supabase.co
INTEGRATIONS_SUPABASE_ANON_KEY=your-production-supabase-anon-key
INTEGRATIONS_SUPABASE_SERVICE_ROLE_KEY=your-production-supabase-service-role-key
INTEGRATIONS_JWT_SECRET={jwt_secret}
INTEGRATIONS_RATE_LIMIT_WINDOW_MS=900000
INTEGRATIONS_RATE_LIMIT_MAX_REQUESTS=100

# Cost Documentation Configuration
COST_DOC_DATABASE_URL=postgresql://postgres:CHANGE_ME@your-db-host:5432/opside_fba_prod
COST_DOC_JWT_SECRET={jwt_secret}
COST_DOC_REDIS_URL=redis://your-redis-host:6379

# Refund Engine Configuration
REFUND_ENGINE_JWT_SECRET={jwt_secret}
REFUND_ENGINE_ALLOWED_ORIGINS=https://your-frontend-domain.com,https://your-api-domain.com
REFUND_ENGINE_RATE_LIMIT_WINDOW_MS=900000
REFUND_ENGINE_RATE_LIMIT_MAX_REQUESTS=100
REFUND_ENGINE_ML_API_BASE_URL=https://your-ml-domain.com

# ML Service Configuration
MCDE_CORS_ORIGINS=https://your-frontend-domain.com,https://your-api-domain.com
"""

    # Write files
    with open('.env.development', 'w') as f:
        f.write(dev_env)
    
    with open('.env.production', 'w') as f:
        f.write(prod_env)
    
    print("✅ Environment files created:")
    print("  - .env.development")
    print("  - .env.production")

def create_env_validation_script():
    """Create environment validation script"""
    
    validation_script = '''#!/usr/bin/env python3
"""
Environment Variables Validation Script
Run this before deploying to ensure all required variables are set
"""

import os
import sys
from pathlib import Path

def validate_environment():
    """Validate environment variables"""
    print("🔍 Validating environment variables...")
    
    # Required variables
    required_vars = {
        'DB_URL': 'Database connection URL',
        'JWT_SECRET': 'JWT signing secret',
        'CRYPTO_SECRET': 'Encryption secret',
        'AMAZON_CLIENT_ID': 'Amazon OAuth client ID',
        'AMAZON_CLIENT_SECRET': 'Amazon OAuth client secret',
        'STRIPE_SERVICE_URL': 'Stripe service URL'
    }
    
    # Critical security variables
    security_vars = {
        'JWT_SECRET': 'your-secret-key-change-in-production',
        'CRYPTO_SECRET': 'insecure-dev-key-change'
    }
    
    missing_vars = []
    weak_vars = []
    
    for var, description in required_vars.items():
        value = os.getenv(var)
        if not value:
            missing_vars.append(f"{var} ({description})")
        elif var in security_vars and security_vars[var] in value:
            weak_vars.append(f"{var} ({description})")
    
    if missing_vars:
        print("❌ Missing required variables:")
        for var in missing_vars:
            print(f"   - {var}")
        return False
    
    if weak_vars:
        print("⚠️  Weak default values detected:")
        for var in weak_vars:
            print(f"   - {var}")
        return False
    
    print("✅ All environment variables are properly configured")
    return True

def check_database_connection():
    """Check database connection"""
    print("\\n🔍 Checking database connection...")
    
    try:
        from src.common.config import settings
        from src.common.db_postgresql import DatabaseManager
        
        db = DatabaseManager()
        print(f"✅ Connected to {settings.DB_TYPE} database")
        return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False

def main():
    """Main validation function"""
    print("Environment Variables Validation")
    print("=" * 40)
    
    env_ok = validate_environment()
    db_ok = check_database_connection()
    
    if env_ok and db_ok:
        print("\\n🎉 Environment validation passed!")
        return 0
    else:
        print("\\n❌ Environment validation failed!")
        return 1

if __name__ == "__main__":
    sys.exit(main())
'''
    
    with open('scripts/validate_environment.py', 'w') as f:
        f.write(validation_script)
    
    # Make it executable
    os.chmod('scripts/validate_environment.py', 0o755)
    
    print("✅ Environment validation script created: scripts/validate_environment.py")

def create_docker_env_files():
    """Create Docker-specific environment files"""
    
    # Docker Compose environment
    docker_env = """# Docker Compose Environment Variables
# This file is used by docker-compose.yml

# Database Configuration
DB_NAME=opside_fba
DB_USER=postgres
DB_PASSWORD=secure_docker_password

# Application Configuration
ENV=production
FRONTEND_URL=http://localhost:3000

# Amazon OAuth Configuration
AMAZON_CLIENT_ID=your-amazon-client-id
AMAZON_CLIENT_SECRET=your-amazon-client-secret
AMAZON_REDIRECT_URI=http://localhost:8000/api/auth/amazon/callback

# Security Configuration
JWT_SECRET=your-super-secret-jwt-key-here
CRYPTO_SECRET=your-super-secret-crypto-key-here

# Service URLs
INTEGRATIONS_URL=http://integrations-backend:3001
INTEGRATIONS_API_KEY=your-integrations-api-key
STRIPE_SERVICE_URL=http://stripe-payments:4000
STRIPE_INTERNAL_API_KEY=your-stripe-internal-api-key

# Service Ports
INTEGRATIONS_PORT=3001
PAYMENTS_PORT=4000
COST_DOC_PORT=3003
REFUND_ENGINE_PORT=3002

# Redis Configuration
REDIS_URL=redis://redis:6379

# Stripe Configuration
PAYMENTS_STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
PAYMENTS_STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
PAYMENTS_STRIPE_CLIENT_ID=ca_your_stripe_client_id
PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID=acct_your_platform_account_id
PAYMENTS_STRIPE_API_VERSION=2023-10-16
PAYMENTS_STRIPE_PRICE_ID=price_your_price_id
PAYMENTS_STRIPE_LIVE_MODE=false
PAYMENTS_JWT_SECRET=your-payments-jwt-secret

# Integrations Backend Configuration
INTEGRATIONS_SUPABASE_URL=your-supabase-url
INTEGRATIONS_SUPABASE_ANON_KEY=your-supabase-anon-key
INTEGRATIONS_SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
INTEGRATIONS_JWT_SECRET=your-integrations-jwt-secret
INTEGRATIONS_RATE_LIMIT_WINDOW_MS=900000
INTEGRATIONS_RATE_LIMIT_MAX_REQUESTS=100

# Cost Documentation Configuration
COST_DOC_DATABASE_URL=postgresql://postgres:secure_docker_password@postgres:5432/opside_fba
COST_DOC_JWT_SECRET=your-cost-doc-jwt-secret
COST_DOC_REDIS_URL=redis://redis:6379

# Refund Engine Configuration
REFUND_ENGINE_JWT_SECRET=your-refund-engine-jwt-secret
REFUND_ENGINE_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000
REFUND_ENGINE_RATE_LIMIT_WINDOW_MS=900000
REFUND_ENGINE_RATE_LIMIT_MAX_REQUESTS=100
REFUND_ENGINE_ML_API_BASE_URL=http://mcde:8000

# ML Service Configuration
MCDE_CORS_ORIGINS=http://localhost:3000,http://localhost:8000
"""
    
    with open('.env.docker', 'w') as f:
        f.write(docker_env)
    
    print("✅ Docker environment file created: .env.docker")

def main():
    """Main setup function"""
    print("🔧 Environment Variables Setup")
    print("=" * 40)
    
    # Create scripts directory if it doesn't exist
    Path('scripts').mkdir(exist_ok=True)
    
    # Create environment files
    create_environment_files()
    create_docker_env_files()
    create_env_validation_script()
    
    print("\n📋 Next Steps:")
    print("1. Copy .env.development to .env for local development")
    print("2. Update Amazon OAuth credentials in .env")
    print("3. Update Stripe credentials in .env")
    print("4. Update Supabase credentials in .env")
    print("5. Run validation: python scripts/validate_environment.py")
    print("6. For production, use .env.production as template")
    
    print("\n🔒 Security Notes:")
    print("- Never commit .env files to version control")
    print("- Use strong, unique passwords for production")
    print("- Rotate secrets regularly")
    print("- Use environment-specific configurations")

if __name__ == "__main__":
    main()
