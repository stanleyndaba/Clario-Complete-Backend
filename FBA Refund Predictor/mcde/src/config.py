from pydantic_settings import BaseSettings
from pydantic import Field, validator
from typing import Optional, List
import os

class DatabaseSettings(BaseSettings):
    url: str = Field(default=os.getenv('DATABASE_URL', 'sqlite:///./mcde.db'))
    
    class Config:
        env_prefix = 'database_'

class DocumentSettings(BaseSettings):
    supported_formats: List[str] = Field(default=['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif'])
    max_file_size: int = Field(default=50_000_000)  # 50MB
    upload_dir: str = Field(default='./uploads')
    dpi: int = Field(default=300)
    resize_width: int = Field(default=1600)
    resize_height: int = Field(default=1200)
    ocr_confidence_threshold: float = Field(default=0.7)
    ocr_timeout: int = Field(default=30)
    ocr_config: str = Field(default="--oem 3 --psm 6")
    ocr_language: str = Field(default="eng")
    
    class Config:
        env_prefix = 'document_'

class RefundEngineSettings(BaseSettings):
    base_url: str = Field(default=os.getenv('REFUND_ENGINE_URL', 'http://localhost:8000'))
    timeout: int = Field(default=30)
    retry_attempts: int = Field(default=3)
    api_key: str = Field(default=os.getenv('REFUND_ENGINE_API_KEY', 'demo-key'))
    
    class Config:
        env_prefix = 'refund_engine_'

class ApiSettings(BaseSettings):
    host: str = Field(default='0.0.0.0')
    port: int = Field(default=10000)
    
    class Config:
        env_prefix = 'api_'

class Settings(BaseSettings):
    database: DatabaseSettings = DatabaseSettings()
    document: DocumentSettings = DocumentSettings()
    refund_engine: RefundEngineSettings = RefundEngineSettings()
    api: ApiSettings = ApiSettings()
    debug: bool = Field(default=False)

settings = Settings()
