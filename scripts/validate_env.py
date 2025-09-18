#!/usr/bin/env python3
"""
Simple Environment Variables Validation Script
"""

import os
import sys
from pathlib import Path

# Load .env file if it exists
def load_env_file():
    """Load .env file if it exists"""
    env_file = Path('.env')
    if env_file.exists():
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key] = value
        print("✅ Loaded .env file")
    else:
        print("⚠️  No .env file found")

# Load environment file
load_env_file()

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
    print("\n🔍 Checking database connection...")
    
    try:
        from src.common.config import settings
        print(f"✅ Database Type: {settings.DB_TYPE}")
        print(f"✅ Database URL: {settings.DB_URL}")
        return True
    except Exception as e:
        print(f"❌ Database configuration error: {e}")
        return False

def main():
    """Main validation function"""
    print("Environment Variables Validation")
    print("=" * 40)
    
    env_ok = validate_environment()
    db_ok = check_database_connection()
    
    if env_ok and db_ok:
        print("\n🎉 Environment validation passed!")
        return 0
    else:
        print("\n❌ Environment validation failed!")
        return 1

if __name__ == "__main__":
    sys.exit(main())
