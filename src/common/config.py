import os
from pydantic import BaseModel
from urllib.parse import urlparse
from urllib.parse import parse_qsl
from dotenv import load_dotenv

# Load .env file
load_dotenv()

class Settings(BaseModel):
    # Database configuration
    # Prefer DATABASE_URL if present (Render/Heroku style), fallback to DB_URL
    DB_URL: str = os.getenv("DATABASE_URL") or os.getenv("DB_URL", "postgresql://postgres:password@localhost:5432/opside_fba")
    DB_TYPE: str = os.getenv("DB_TYPE", "postgresql")  # postgresql or sqlite
    AUTO_FILE_THRESHOLD: float = float(os.getenv("AUTO_FILE_THRESHOLD", "0.75"))
    ENV: str = os.getenv("ENV", "dev")
    
    # Frontend configuration / CORS
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    FRONTEND_URLS: str | None = os.getenv("FRONTEND_URLS")
    CORS_ALLOW_ORIGINS: str | None = os.getenv("CORS_ALLOW_ORIGINS")
    ALLOWED_ORIGINS: str | None = os.getenv("ALLOWED_ORIGINS")
    ALLOWED_ORIGIN_REGEX: str | None = os.getenv("ALLOWED_ORIGIN_REGEX")
    
    # Amazon OAuth configuration
    # Use AMAZON_SPAPI_CLIENT_ID as fallback if AMAZON_CLIENT_ID not set (for consistency)
    _amazon_client_id = os.getenv("AMAZON_CLIENT_ID") or os.getenv("AMAZON_SPAPI_CLIENT_ID", "")
    AMAZON_CLIENT_ID: str = _amazon_client_id
    _amazon_client_secret = os.getenv("AMAZON_CLIENT_SECRET") or os.getenv("AMAZON_SPAPI_CLIENT_SECRET", "")
    AMAZON_CLIENT_SECRET: str = _amazon_client_secret
    AMAZON_REDIRECT_URI: str = os.getenv("AMAZON_REDIRECT_URI", "http://localhost:8000/api/auth/amazon/callback")
    
    # Evidence Sources OAuth configuration
    GMAIL_CLIENT_ID: str = os.getenv("GMAIL_CLIENT_ID", "")
    GMAIL_CLIENT_SECRET: str = os.getenv("GMAIL_CLIENT_SECRET", "")
    GMAIL_REDIRECT_URI: str = os.getenv("GMAIL_REDIRECT_URI", "http://localhost:8000/api/auth/callback/gmail")
    
    OUTLOOK_CLIENT_ID: str = os.getenv("OUTLOOK_CLIENT_ID", "")
    OUTLOOK_CLIENT_SECRET: str = os.getenv("OUTLOOK_CLIENT_SECRET", "")
    OUTLOOK_REDIRECT_URI: str = os.getenv("OUTLOOK_REDIRECT_URI", "http://localhost:8000/api/auth/callback/outlook")
    
    GDRIVE_CLIENT_ID: str = os.getenv("GDRIVE_CLIENT_ID", "")
    GDRIVE_CLIENT_SECRET: str = os.getenv("GDRIVE_CLIENT_SECRET", "")
    GDRIVE_REDIRECT_URI: str = os.getenv("GDRIVE_REDIRECT_URI", "http://localhost:8000/api/auth/callback/gdrive")
    
    DROPBOX_CLIENT_ID: str = os.getenv("DROPBOX_CLIENT_ID", "")
    DROPBOX_CLIENT_SECRET: str = os.getenv("DROPBOX_CLIENT_SECRET", "")
    DROPBOX_REDIRECT_URI: str = os.getenv("DROPBOX_REDIRECT_URI", "http://localhost:8000/api/auth/callback/dropbox")
    
    # Evidence Matching Engine settings
    EVIDENCE_CONFIDENCE_AUTO: float = float(os.getenv("EVIDENCE_CONFIDENCE_AUTO", "0.85"))
    EVIDENCE_CONFIDENCE_PROMPT: float = float(os.getenv("EVIDENCE_CONFIDENCE_PROMPT", "0.5"))
    FEATURE_FLAG_EV_AUTO_SUBMIT: bool = os.getenv("FEATURE_FLAG_EV_AUTO_SUBMIT", "True").lower() == "true"
    FEATURE_FLAG_EV_SMART_PROMPTS: bool = os.getenv("FEATURE_FLAG_EV_SMART_PROMPTS", "True").lower() == "true"
    
    # Security configuration
    JWT_SECRET: str = os.getenv("JWT_SECRET", "fallback_dev_secret_only_never_use_in_prod")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRES_IN_MINUTES: int = int(os.getenv("JWT_EXPIRES_IN_MINUTES", "10080"))  # 7 days
    # Prefer ENCRYPTION_MASTER_KEY if provided (fallback to CRYPTO_SECRET)
    ENCRYPTION_MASTER_KEY: str | None = os.getenv("ENCRYPTION_MASTER_KEY")
    CRYPTO_SECRET: str = os.getenv("CRYPTO_SECRET", "insecure-dev-key-change")
    
    # Service URLs
    INTEGRATIONS_URL: str = os.getenv("INTEGRATIONS_URL", "http://localhost:3001")
    INTEGRATIONS_API_KEY: str = os.getenv("INTEGRATIONS_API_KEY", "")
    STRIPE_SERVICE_URL: str = os.getenv("STRIPE_SERVICE_URL", "http://localhost:4000")
    STRIPE_INTERNAL_API_KEY: str = os.getenv("STRIPE_INTERNAL_API_KEY", "")
    COST_DOC_SERVICE_URL: str = os.getenv("COST_DOC_SERVICE_URL", "http://localhost:3003")
    REFUND_ENGINE_URL: str = os.getenv("REFUND_ENGINE_URL", "http://localhost:3002")
    MCDE_URL: str = os.getenv("MCDE_URL", "http://localhost:8000")
    
    # S3 / Object Storage configuration
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "")
    S3_ACCESS_KEY: str = os.getenv("S3_ACCESS_KEY", "")
    S3_SECRET_KEY: str = os.getenv("S3_SECRET_KEY", "")
    S3_REGION: str = os.getenv("S3_REGION", "us-east-1")

    # Amazon SP-API configuration
    # Use AMAZON_CLIENT_ID as fallback if AMAZON_SPAPI_CLIENT_ID not set (for consistency)
    AMAZON_SPAPI_BASE_URL: str = os.getenv("AMAZON_SPAPI_BASE_URL", "https://sellingpartnerapi-na.amazon.com")
    _spapi_client_id = os.getenv("AMAZON_SPAPI_CLIENT_ID") or os.getenv("AMAZON_CLIENT_ID", "")
    AMAZON_SPAPI_CLIENT_ID: str = _spapi_client_id
    _spapi_client_secret = os.getenv("AMAZON_SPAPI_CLIENT_SECRET") or os.getenv("AMAZON_CLIENT_SECRET", "")
    AMAZON_SPAPI_CLIENT_SECRET: str = _spapi_client_secret
    AMAZON_SPAPI_REFRESH_TOKEN: str = os.getenv("AMAZON_SPAPI_REFRESH_TOKEN", "")
    
    @property
    def is_postgresql(self) -> bool:
        """Check if using PostgreSQL database"""
        url = (self.DB_URL or "").lower()
        return self.DB_TYPE.lower() == "postgresql" or url.startswith("postgresql://") or url.startswith("postgres://")
    
    @property
    def is_sqlite(self) -> bool:
        """Check if using SQLite database"""
        return self.DB_TYPE.lower() == "sqlite" or self.DB_URL.endswith(".db")
    
    def get_database_config(self) -> dict:
        """Get database configuration based on type"""
        if self.is_postgresql:
            # Return DSN so options like sslmode are preserved end-to-end
            return {"dsn": self.DB_URL}
        else:
            return {"database": self.DB_URL}

settings = Settings()

# Normalize encryption secret preference
if settings.ENCRYPTION_MASTER_KEY:
    settings.CRYPTO_SECRET = settings.ENCRYPTION_MASTER_KEY

