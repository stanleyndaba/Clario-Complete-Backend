"""
Configuration management for MCDE.
Handles loading and validation of application settings.
"""
import os
from pathlib import Path
from typing import Dict, Any, Optional, List
import yaml
from pydantic import BaseSettings, Field, validator


class DatabaseSettings(BaseSettings):
    """Database configuration settings."""
    url: str = Field(..., env="DATABASE_URL")
    pool_size: int = Field(10, env="DB_POOL_SIZE")
    max_overflow: int = Field(20, env="DB_MAX_OVERFLOW")
    echo: bool = Field(False, env="DB_ECHO")


class RedisSettings(BaseSettings):
    """Redis configuration settings."""
    url: str = Field("redis://localhost:6379", env="REDIS_URL")
    db: int = Field(0, env="REDIS_DB")
    password: Optional[str] = Field(None, env="REDIS_PASSWORD")


class APISettings(BaseSettings):
    """API configuration settings."""
    host: str = Field("0.0.0.0", env="API_HOST")
    port: int = Field(8000, env="API_PORT")
    workers: int = Field(4, env="API_WORKERS")
    timeout: int = Field(300, env="API_TIMEOUT")
    max_upload_size: str = Field("50MB", env="API_MAX_UPLOAD_SIZE")


class DocumentSettings(BaseSettings):
    """Document processing configuration."""
    supported_formats: List[str] = Field(["pdf", "jpg", "jpeg", "png", "tiff"])
    max_file_size: int = Field(52428800)  # 50MB
    ocr_confidence_threshold: float = Field(0.8)
    resize_width: int = Field(1920)
    resize_height: int = Field(1080)
    dpi: int = Field(300)


class RefundEngineSettings(BaseSettings):
    """Refund Engine integration settings."""
    base_url: str = Field(..., env="REFUND_ENGINE_URL")
    timeout: int = Field(30, env="REFUND_ENGINE_TIMEOUT")
    retry_attempts: int = Field(3, env="REFUND_ENGINE_RETRIES")
    api_key: str = Field(..., env="REFUND_ENGINE_API_KEY")


class AmazonAPISettings(BaseSettings):
    """Amazon API integration settings."""
    base_url: str = Field("https://sellingpartnerapi-na.amazon.com")
    region: str = Field("us-east-1", env="AWS_REGION")
    marketplace_id: str = Field("ATVPDKIKX0DER", env="AWS_MARKETPLACE_ID")
    access_key: str = Field(..., env="AWS_ACCESS_KEY_ID")
    secret_key: str = Field(..., env="AWS_SECRET_ACCESS_KEY")
    role_arn: Optional[str] = Field(None, env="AWS_ROLE_ARN")


class SecuritySettings(BaseSettings):
    """Security configuration settings."""
    encryption_key: str = Field(..., env="ENCRYPTION_KEY")
    jwt_secret: str = Field(..., env="JWT_SECRET")
    # Accept comma-separated list in MCDE_CORS_ORIGINS
    cors_origins_raw: str = Field("*", env="MCDE_CORS_ORIGINS")
    cors_origins: List[str] = []
    rate_limit: int = Field(100, env="RATE_LIMIT")


class Settings(BaseSettings):
    """Main application settings."""
    app_name: str = Field("MCDE", env="APP_NAME")
    version: str = Field("1.0.0", env="APP_VERSION")
    environment: str = Field("production", env="ENVIRONMENT")
    debug: bool = Field(False, env="DEBUG")
    
    # Sub-settings
    database: DatabaseSettings = DatabaseSettings()
    redis: RedisSettings = RedisSettings()
    api: APISettings = APISettings()
    document: DocumentSettings = DocumentSettings()
    refund_engine: RefundEngineSettings = RefundEngineSettings()
    amazon_api: AmazonAPISettings = AmazonAPISettings()
    security: SecuritySettings = SecuritySettings()
    
    class Config:
        env_file = ".env"
        case_sensitive = False


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration from YAML file and environment variables.
    
    Args:
        config_path: Path to YAML configuration file
        
    Returns:
        Dictionary with configuration settings
    """
    if config_path is None:
        config_path = "config.yaml"
    
    config = {}
    
    # Load YAML config if file exists
    if Path(config_path).exists():
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
    
    # Override with environment variables
    settings = Settings()
    # Parse CORS origins from comma-separated env into list
    if settings.security.cors_origins == []:
        raw = settings.security.cors_origins_raw
        settings.security.cors_origins = [o.strip() for o in raw.split(",")] if raw else ["*"]
    
    return {
        "app": {
            "name": settings.app_name,
            "version": settings.version,
            "environment": settings.environment,
            "debug": settings.debug,
        },
        "api": settings.api.dict(),
        "database": settings.database.dict(),
        "redis": settings.redis.dict(),
        "document": settings.document.dict(),
        "refund_engine": settings.refund_engine.dict(),
        "amazon_api": settings.amazon_api.dict(),
        "security": settings.security.dict(),
        **config  # Include any additional YAML config
    }


def get_settings() -> Settings:
    """
    Get application settings instance.
    
    Returns:
        Settings instance with all configuration
    """
    return Settings()


# Global settings instance
settings = get_settings() 