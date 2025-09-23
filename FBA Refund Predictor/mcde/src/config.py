from pydantic_settings import BaseSettings
from pydantic import Field, validator
from typing import Optional
import os

class DatabaseSettings(BaseSettings):
    url: str = Field(default=os.getenv('DATABASE_URL', 'sqlite:///./mcde.db'))
    
    class Config:
        env_prefix = 'database_'

class ApiSettings(BaseSettings):
    host: str = Field(default='0.0.0.0')
    port: int = Field(default=10000)
    
    class Config:
        env_prefix = 'api_'

class Settings(BaseSettings):
    database: DatabaseSettings = DatabaseSettings()
    api: ApiSettings = ApiSettings()
    debug: bool = Field(default=False)

settings = Settings()
