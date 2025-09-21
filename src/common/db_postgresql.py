"""
PostgreSQL Database Manager for Opside FBA Claims Pipeline
Supports both PostgreSQL and SQLite with automatic fallback
"""

import json
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime
from src.common.schemas import ClaimDetection, ValidationResult, FilingResult, ClaimPacket
from src.common.config import settings
import os
import tempfile
from cryptography.fernet import Fernet

# Database connection imports
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import SimpleConnectionPool
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

try:
    import sqlite3
    SQLITE_AVAILABLE = True
except ImportError:
    SQLITE_AVAILABLE = False

# Initialize Fernet for encryption
def _get_fernet() -> Fernet:
    raw = settings.CRYPTO_SECRET.encode('utf-8')
    if len(raw) < 32:
        raw = raw.ljust(32, b'=')
    elif len(raw) > 32:
        raw = raw[:32]
    
    # Ensure the key is properly base64 encoded
    import base64
    try:
        key = base64.urlsafe_b64encode(raw)
        return Fernet(key)
    except Exception:
        # Fallback: generate a proper key
        from cryptography.fernet import Fernet
        return Fernet(Fernet.generate_key())

_fernet = _get_fernet()

class DatabaseManager:
    def __init__(self, db_url: str = None):
        self.db_url = db_url or settings.DB_URL
        self.is_postgresql = settings.is_postgresql
        self.connection_pool = None
        # Allow disabling DB entirely
        if os.getenv("DISABLE_DB", "").lower() in ("true", "1", "yes"):
            print("Database initialization disabled by DISABLE_DB env var")
            self.connection_pool = None
        else:
            try:
                self._init_db()
            except Exception as e:
                print(f"Database initialization failed: {e}")
                print("Continuing without database...")
                self.connection_pool = None
    
    def _init_db(self):
        """Initialize database with appropriate connection method"""
        if self.is_postgresql and PSYCOPG2_AVAILABLE:
            self._init_postgresql()
        elif SQLITE_AVAILABLE:
            self._init_sqlite()
        else:
            raise RuntimeError("No database driver available. Install psycopg2 for PostgreSQL or sqlite3 for SQLite.")
    
    def _init_postgresql(self):
        """Initialize PostgreSQL connection pool"""
        try:
            config = settings.get_database_config()
            self.connection_pool = SimpleConnectionPool(
                minconn=1,
                maxconn=10,
                **config
            )
            # Test connection and run migrations
            with self._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Check if tables exist, if not run migration
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'claims'
                        );
                    """)
                    if not cursor.fetchone()[0]:
                        self._run_postgresql_migration()
            print("✅ PostgreSQL connection established")
        except Exception as e:
            print(f"PostgreSQL initialization failed: {e}")
            if SQLITE_AVAILABLE:
                print("Falling back to SQLite...")
                self.is_postgresql = False
                self._init_sqlite()
            else:
                raise
    
    def _init_sqlite(self):
        """Initialize SQLite database (fallback)"""
        try:
            # If DB_URL looks like a postgres URL or is empty, use a safe writable SQLite file path
            db_path = self.db_url or ""
            if db_path.startswith("postgres://") or db_path.startswith("postgresql://") or not db_path or db_path == ":memory:":
                try:
                    cwd = os.getcwd()
                    db_path = os.path.join(cwd, 'claims.db')
                except Exception:
                    db_path = os.path.join(tempfile.gettempdir(), 'claims.db')

            with sqlite3.connect(db_path) as conn:
                with open('src/migrations/001_init.sql', 'r') as f:
                    sql_content = f.read()
                    sql_content = sql_content.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
                    sql_content = sql_content.replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ')
                    conn.executescript(sql_content)
                
                # Add user-related tables if not exists
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY,
                        amazon_seller_id TEXT UNIQUE NOT NULL,
                        company_name TEXT,
                        linked_marketplaces TEXT,
                        stripe_customer_id TEXT,
                        stripe_account_id TEXT,
                        last_sync_attempt_at DATETIME,
                        last_sync_completed_at DATETIME,
                        last_sync_job_id TEXT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        last_login DATETIME
                    );

                    CREATE TABLE IF NOT EXISTS oauth_tokens (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT NOT NULL,
                        provider TEXT NOT NULL,
                        encrypted_refresh_token TEXT NOT NULL,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_id, provider)
                    );
                """)
                conn.commit()
            print(f"✅ SQLite database initialized at {db_path}")
        except Exception as e:
            print(f"SQLite initialization failed: {e}")
            raise
    
    def _run_postgresql_migration(self):
        """Run PostgreSQL migration script"""
        with self._get_connection() as conn:
            with conn.cursor() as cursor:
                # Run initial migration
                with open('src/migrations/002_postgresql_init.sql', 'r') as f:
                    migration_sql = f.read()
                    cursor.execute(migration_sql)
                
                # Run evidence validator migration
                with open('src/migrations/003_evidence_validator.sql', 'r') as f:
                    migration_sql = f.read()
                    cursor.execute(migration_sql)
                
                # Run document parser migration
                with open('src/migrations/004_document_parser.sql', 'r') as f:
                    migration_sql = f.read()
                    cursor.execute(migration_sql)
                
                # Run evidence matching migration
                with open('src/migrations/005_evidence_matching.sql', 'r') as f:
                    migration_sql = f.read()
                    cursor.execute(migration_sql)
                
                # Run zero-effort evidence migration
                with open('src/migrations/006_zero_effort_evidence.sql', 'r') as f:
                    migration_sql = f.read()
                    cursor.execute(migration_sql)
                
                conn.commit()
    
    def _get_connection(self):
        """Get database connection"""
        if self.is_postgresql and self.connection_pool:
            return self.connection_pool.getconn()
        else:
            return sqlite3.connect(self.db_url)
    
    def _return_connection(self, conn):
        """Return connection to pool (PostgreSQL only)"""
        if self.is_postgresql and self.connection_pool:
            self.connection_pool.putconn(conn)
    
    def _execute_query(self, query: str, params: tuple = (), fetch: bool = False, fetch_one: bool = False):
        """Execute query with proper connection handling"""
        if self.is_postgresql:
            with self._get_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute(query, params)
                    if fetch:
                        return cursor.fetchall() if not fetch_one else cursor.fetchone()
                    conn.commit()
        else:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params)
                if fetch:
                    columns = [description[0] for description in cursor.description]
                    rows = cursor.fetchall() if not fetch_one else cursor.fetchone()
                    if fetch_one and rows:
                        return dict(zip(columns, rows))
                    elif fetch:
                        return [dict(zip(columns, row)) for row in rows]
                conn.commit()
    
    # Claim management methods
    def upsert_claim(self, claim: ClaimDetection):
        """Insert or update a claim in the database"""
        query = """
            INSERT INTO claims 
            (claim_id, status, claim_type, confidence, amount_estimate, quantity_affected, metadata, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (claim_id) DO UPDATE SET
                status = EXCLUDED.status,
                claim_type = EXCLUDED.claim_type,
                confidence = EXCLUDED.confidence,
                amount_estimate = EXCLUDED.amount_estimate,
                quantity_affected = EXCLUDED.quantity_affected,
                metadata = EXCLUDED.metadata,
                updated_at = EXCLUDED.updated_at
        """ if self.is_postgresql else """
            INSERT OR REPLACE INTO claims 
            (claim_id, status, claim_type, confidence, amount_estimate, quantity_affected, metadata, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
        
        params = (
            claim.claim_id,
            'detected',
            claim.claim_type,
            claim.confidence,
            claim.amount_estimate,
            claim.quantity_affected,
            json.dumps(claim.metadata.dict()) if hasattr(claim.metadata, 'dict') else json.dumps(claim.metadata),
            datetime.utcnow().isoformat()
        )
        
        self._execute_query(query, params)
    
    def load_claim(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Load a claim from the database"""
        query = """
            SELECT claim_id, status, claim_type, confidence, amount_estimate, 
                   quantity_affected, metadata, created_at, updated_at
            FROM claims WHERE claim_id = %s
        """ if self.is_postgresql else """
            SELECT claim_id, status, claim_type, confidence, amount_estimate, 
                   quantity_affected, metadata, created_at, updated_at
            FROM claims WHERE claim_id = ?
        """
        
        result = self._execute_query(query, (claim_id,), fetch=True, fetch_one=True)
        if result:
            if self.is_postgresql:
                result['metadata'] = json.loads(result['metadata']) if isinstance(result['metadata'], str) else result['metadata']
            else:
                result['metadata'] = json.loads(result['metadata'])
        return result
    
    def save_validation(self, claim_id: str, result: ValidationResult):
        """Save a validation result to the database"""
        query = """
            INSERT INTO validations 
            (claim_id, compliant, ml_validity_score, missing_evidence, reasons, auto_file_ready, confidence_calibrated)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """ if self.is_postgresql else """
            INSERT INTO validations 
            (claim_id, compliant, ml_validity_score, missing_evidence, reasons, auto_file_ready, confidence_calibrated)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        
        params = (
            claim_id,
            result.compliant,
            result.ml_validity_score,
            json.dumps(result.missing_evidence),
            json.dumps(result.reasons),
            result.auto_file_ready,
            result.confidence_calibrated
        )
        
        self._execute_query(query, params)
    
    def update_claim_status(self, claim_id: str, status: str):
        """Update the status of a claim"""
        query = """
            UPDATE claims SET status = %s, updated_at = %s
            WHERE claim_id = %s
        """ if self.is_postgresql else """
            UPDATE claims SET status = ?, updated_at = ?
            WHERE claim_id = ?
        """
        
        self._execute_query(query, (status, datetime.utcnow().isoformat(), claim_id))
    
    # User management methods
    def upsert_user(self, user_id: str, amazon_seller_id: str, company_name: str, marketplaces: List[str]):
        """Create or update user profile"""
        if self.is_postgresql:
            query = """
                INSERT INTO users (id, amazon_seller_id, company_name, linked_marketplaces, last_login)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT(amazon_seller_id) DO UPDATE SET
                    company_name = EXCLUDED.company_name,
                    linked_marketplaces = EXCLUDED.linked_marketplaces,
                    last_login = EXCLUDED.last_login
            """
            params = (user_id, amazon_seller_id, company_name, json.dumps(marketplaces), datetime.utcnow().isoformat() + "Z")
        else:
            query = """
                INSERT OR REPLACE INTO users (id, amazon_seller_id, company_name, linked_marketplaces, last_login)
                VALUES (?, ?, ?, ?, ?)
            """
            params = (user_id, amazon_seller_id, company_name, json.dumps(marketplaces), datetime.utcnow().isoformat())
        
        self._execute_query(query, params)
    
    def get_user_by_amazon_seller_id(self, amazon_seller_id: str) -> Optional[Dict[str, Any]]:
        """Get user by Amazon Seller ID"""
        query = "SELECT * FROM users WHERE amazon_seller_id = %s" if self.is_postgresql else "SELECT * FROM users WHERE amazon_seller_id = ?"
        result = self._execute_query(query, (amazon_seller_id,), fetch=True, fetch_one=True)
        
        if result and not self.is_postgresql:
            # Convert SQLite result to dict format
            columns = ['id', 'amazon_seller_id', 'company_name', 'linked_marketplaces', 'stripe_customer_id', 'stripe_account_id', 'last_sync_attempt_at', 'last_sync_completed_at', 'last_sync_job_id', 'created_at', 'last_login']
            result = dict(zip(columns, result))
        
        if result and 'linked_marketplaces' in result:
            try:
                result['linked_marketplaces'] = json.loads(result['linked_marketplaces']) if isinstance(result['linked_marketplaces'], str) else result['linked_marketplaces']
            except (json.JSONDecodeError, TypeError):
                result['linked_marketplaces'] = []
        
        return result
    
    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by internal ID"""
        query = "SELECT * FROM users WHERE id = %s" if self.is_postgresql else "SELECT * FROM users WHERE id = ?"
        result = self._execute_query(query, (user_id,), fetch=True, fetch_one=True)
        
        if result and not self.is_postgresql:
            columns = ['id', 'amazon_seller_id', 'company_name', 'linked_marketplaces', 'stripe_customer_id', 'stripe_account_id', 'last_sync_attempt_at', 'last_sync_completed_at', 'last_sync_job_id', 'created_at', 'last_login']
            result = dict(zip(columns, result))
        
        if result and 'linked_marketplaces' in result:
            try:
                result['linked_marketplaces'] = json.loads(result['linked_marketplaces']) if isinstance(result['linked_marketplaces'], str) else result['linked_marketplaces']
            except (json.JSONDecodeError, TypeError):
                result['linked_marketplaces'] = []
        
        return result
    
    def save_oauth_token(self, user_id: str, provider: str, encrypted_refresh_token: str, expires_at: datetime):
        """Save or update OAuth refresh token"""
        if self.is_postgresql:
            query = """
                INSERT INTO oauth_tokens (user_id, provider, encrypted_refresh_token, expires_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT(user_id, provider) DO UPDATE SET
                    encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
                    expires_at = EXCLUDED.expires_at,
                    updated_at = NOW()
            """
            params = (user_id, provider, encrypted_refresh_token, expires_at.isoformat() + "Z")
        else:
            query = """
                INSERT OR REPLACE INTO oauth_tokens (user_id, provider, encrypted_refresh_token, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            """
            params = (user_id, provider, encrypted_refresh_token, datetime.utcnow().isoformat(), datetime.utcnow().isoformat())
        
        self._execute_query(query, params)
    
    def get_oauth_token(self, user_id: str, provider: str) -> Optional[str]:
        """Retrieve and decrypt OAuth refresh token"""
        query = "SELECT encrypted_refresh_token FROM oauth_tokens WHERE user_id = %s AND provider = %s" if self.is_postgresql else "SELECT encrypted_refresh_token FROM oauth_tokens WHERE user_id = ? AND provider = ?"
        result = self._execute_query(query, (user_id, provider), fetch=True, fetch_one=True)
        
        if result:
            encrypted_token = result['encrypted_refresh_token'] if self.is_postgresql else result[0]
            return _fernet.decrypt(encrypted_token.encode('utf-8')).decode('utf-8')
        return None
    
    def save_stripe_customer_id(self, user_id: str, customer_id: str):
        """Save Stripe customer ID to user profile"""
        query = """
            UPDATE users SET stripe_customer_id = %s, last_login = %s
            WHERE id = %s
        """ if self.is_postgresql else """
            UPDATE users SET stripe_customer_id = ?, last_login = ?
            WHERE id = ?
        """
        
        self._execute_query(query, (customer_id, datetime.utcnow().isoformat() + "Z", user_id))
    
    def record_sync_attempt(self, user_id: str, job_id: Optional[str] = None):
        """Record a sync attempt for a user"""
        query = """
            UPDATE users SET last_sync_attempt_at = %s, last_sync_job_id = %s
            WHERE id = %s
        """ if self.is_postgresql else """
            UPDATE users SET last_sync_attempt_at = ?, last_sync_job_id = ?
            WHERE id = ?
        """
        
        self._execute_query(query, (datetime.utcnow().isoformat() + "Z", job_id, user_id))
    
    def record_sync_completed(self, user_id: str):
        """Record a successful sync completion for a user"""
        query = """
            UPDATE users SET last_sync_completed_at = %s
            WHERE id = %s
        """ if self.is_postgresql else """
            UPDATE users SET last_sync_completed_at = ?
            WHERE id = ?
        """
        
        self._execute_query(query, (datetime.utcnow().isoformat() + "Z", user_id))
    
    # Idempotency methods
    def idempotency_exists(self, key: str) -> bool:
        """Check if an idempotency key already exists"""
        query = "SELECT 1 FROM idempotency_keys WHERE key = %s" if self.is_postgresql else "SELECT 1 FROM idempotency_keys WHERE key = ?"
        result = self._execute_query(query, (key,), fetch=True, fetch_one=True)
        return result is not None
    
    def save_idempotency(self, key: str, claim_id: str):
        """Save an idempotency key with its associated claim_id"""
        query = """
            INSERT INTO idempotency_keys (key, claim_id, created_at)
            VALUES (%s, %s, %s)
        """ if self.is_postgresql else """
            INSERT INTO idempotency_keys (key, claim_id, created_at)
            VALUES (?, ?, ?)
        """
        
        self._execute_query(query, (key, claim_id, datetime.utcnow().isoformat()))
    
    def close(self):
        """Close database connections"""
        if self.connection_pool:
            self.connection_pool.closeall()

# Global database instance
try:
    if os.getenv("DISABLE_DB", "").lower() in ("true", "1", "yes"):
        print("Database manager disabled by DISABLE_DB env var")
        db = None
    else:
        db = DatabaseManager()
except Exception as e:
    print(f"Database manager disabled due to init error: {e}")
    db = None
