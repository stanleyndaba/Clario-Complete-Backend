import sqlite3
import json
from typing import Dict, Any, Optional, List
from datetime import datetime
from src.common.schemas import ClaimDetection, ValidationResult, FilingResult, ClaimPacket
from src.common.config import settings
import os
import tempfile
import json

class DatabaseManager:
    def __init__(self, db_url: str = None):
        # Allow disabling DB entirely for CORS testing
        if os.getenv("DISABLE_DB", "").lower() in ("true", "1", "yes"):
            self.db_url = None
            return

        # Use provided path or env; if it looks like a DSN (contains "://") or is empty, use a safe writable file
        raw_url = db_url or settings.DB_URL or ""
        if "://" in raw_url or not raw_url or raw_url == ":memory:":
            # Prefer working directory, then system temp
            try:
                cwd = os.getcwd()
                self.db_url = os.path.join(cwd, 'claims.db')
            except Exception:
                self.db_url = os.path.join(tempfile.gettempdir(), 'claims.db')
        else:
            self.db_url = raw_url
        try:
            # Ensure directory exists and writable for SQLite
            db_dir = os.path.dirname(self.db_url) if self.db_url else None
            if db_dir:
                try:
                    os.makedirs(db_dir, exist_ok=True)
                except Exception:
                    pass
            self._init_db()
        except Exception as e:
            print(f"SQLite init failed: {e}")
            # Last resort: force /tmp path
            self.db_url = os.path.join(tempfile.gettempdir(), 'claims.db')
            try:
                self._init_db()
            except Exception as e2:
                print(f"SQLite init failed (forced /tmp): {e2}")
    
    def _init_db(self):
        """Initialize database with tables if they don't exist"""
        with sqlite3.connect(self.db_url) as conn:
            with open('src/migrations/001_init.sql', 'r') as f:
                # Use IF NOT EXISTS for table and index creation
                sql_content = f.read()
                # Replace CREATE TABLE with CREATE TABLE IF NOT EXISTS
                sql_content = sql_content.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
                # Replace CREATE UNIQUE INDEX with CREATE UNIQUE INDEX IF NOT EXISTS
                sql_content = sql_content.replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ')
                conn.executescript(sql_content)
            # Ensure user-related tables exist
            conn.executescript(
                """
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

                -- Audit events for claim timeline transparency
                CREATE TABLE IF NOT EXISTS audit_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id TEXT NOT NULL,
                  claim_id TEXT NOT NULL,
                  action TEXT NOT NULL,
                  title TEXT,
                  message TEXT,
                  document_ids TEXT,
                  metadata TEXT,
                  actor TEXT,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_audit_events_user_claim ON audit_events (user_id, claim_id, created_at);
                """
            )
            # Attempt to add Stripe columns if migrating existing DB
            try:
                conn.execute("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE users ADD COLUMN stripe_account_id TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE users ADD COLUMN last_sync_attempt_at DATETIME")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE users ADD COLUMN last_sync_completed_at DATETIME")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE users ADD COLUMN last_sync_job_id TEXT")
            except Exception:
                pass
    
    def _get_connection(self):
        return sqlite3.connect(self.db_url)
    
    def upsert_claim(self, claim: ClaimDetection):
        """Insert or update a claim in the database"""
        with self._get_connection() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO claims 
                (claim_id, status, claim_type, confidence, amount_estimate, quantity_affected, metadata, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                claim.claim_id,
                'detected',
                claim.claim_type,
                claim.confidence,
                claim.amount_estimate,
                claim.quantity_affected,
                json.dumps(claim.metadata.dict()),
                datetime.utcnow().isoformat()
            ))
            conn.commit()
    
    def idempotency_exists(self, key: str) -> bool:
        """Check if an idempotency key already exists"""
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT 1 FROM idempotency_keys WHERE key = ?", (key,))
            return cursor.fetchone() is not None
    
    def save_idempotency(self, key: str, claim_id: str):
        """Save an idempotency key with its associated claim_id"""
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO idempotency_keys (key, claim_id, created_at)
                VALUES (?, ?, ?)
            """, (key, claim_id, datetime.utcnow().isoformat()))
            conn.commit()
    
    def load_claim(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Load a claim from the database"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT claim_id, status, claim_type, confidence, amount_estimate, 
                       quantity_affected, metadata, created_at, updated_at
                FROM claims WHERE claim_id = ?
            """, (claim_id,))
            row = cursor.fetchone()
            if row:
                return {
                    'claim_id': row[0],
                    'status': row[1],
                    'claim_type': row[2],
                    'confidence': row[3],
                    'amount_estimate': row[4],
                    'quantity_affected': row[5],
                    'metadata': json.loads(row[6]),
                    'created_at': row[7],
                    'updated_at': row[8]
                }
            return None
    
    def save_validation(self, claim_id: str, result: ValidationResult):
        """Save a validation result to the database"""
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO validations 
                (claim_id, compliant, ml_validity_score, missing_evidence, reasons, auto_file_ready, confidence_calibrated)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                claim_id,
                int(result.compliant),
                result.ml_validity_score,
                json.dumps(result.missing_evidence),
                json.dumps(result.reasons),
                int(result.auto_file_ready),
                result.confidence_calibrated
            ))
            conn.commit()
    
    def update_claim_status(self, claim_id: str, status: str):
        """Update the status of a claim"""
        with self._get_connection() as conn:
            conn.execute("""
                UPDATE claims SET status = ?, updated_at = ?
                WHERE claim_id = ?
            """, (status, datetime.utcnow().isoformat(), claim_id))
            conn.commit()
    
    def load_latest_validation(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Load the most recent validation for a claim"""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT claim_id, compliant, ml_validity_score, missing_evidence, 
                       reasons, auto_file_ready, confidence_calibrated, created_at
                FROM validations 
                WHERE claim_id = ? 
                ORDER BY created_at DESC 
                LIMIT 1
            """, (claim_id,))
            row = cursor.fetchone()
            if row:
                return {
                    'claim_id': row[0],
                    'compliant': bool(row[1]),
                    'ml_validity_score': row[2],
                    'missing_evidence': json.loads(row[3]),
                    'reasons': json.loads(row[4]),
                    'auto_file_ready': bool(row[5]),
                    'confidence_calibrated': row[6],
                    'created_at': row[7]
                }
            return None
    
    def fetch_evidence_links(self, claim_id: str) -> Dict[str, str]:
        """Fetch evidence links for a claim (stub implementation for mock)"""
        # This would typically query your evidence storage system
        # For now, return empty dict as specified in the user's request
        return {}

    # ---------------- User/Profile management ---------------- #

    def get_user_by_seller_id(self, seller_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT id, amazon_seller_id, company_name, linked_marketplaces, created_at, last_login FROM users WHERE amazon_seller_id = ?",
                (seller_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return {
                'id': row[0],
                'amazon_seller_id': row[1],
                'company_name': row[2],
                'linked_marketplaces': json.loads(row[3]) if row[3] else [],
                'created_at': row[4],
                'last_login': row[5]
            }

    def upsert_user_profile(self, seller_id: str, company_name: str, marketplaces: list[str]) -> str:
        """Create or update user by seller_id. Returns user_id."""
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT id FROM users WHERE amazon_seller_id = ?", (seller_id,))
            row = cursor.fetchone()
            user_id = row[0] if row else f"usr_{seller_id}"
            if row:
                conn.execute(
                    "UPDATE users SET company_name = ?, linked_marketplaces = ?, last_login = ? WHERE amazon_seller_id = ?",
                    (
                        company_name,
                        json.dumps(marketplaces),
                        datetime.utcnow().isoformat(),
                        seller_id,
                    )
                )
            else:
                conn.execute(
                    "INSERT INTO users (id, amazon_seller_id, company_name, linked_marketplaces, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        user_id,
                        seller_id,
                        company_name,
                        json.dumps(marketplaces),
                        datetime.utcnow().isoformat(),
                        datetime.utcnow().isoformat(),
                    )
                )
            conn.commit()
            return user_id

    def save_stripe_customer_id(self, user_id: str, customer_id: str):
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE users SET stripe_customer_id = ?, last_login = ? WHERE id = ?",
                (customer_id, datetime.utcnow().isoformat(), user_id)
            )
            conn.commit()

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT id, amazon_seller_id, company_name, linked_marketplaces, stripe_customer_id, stripe_account_id, last_sync_attempt_at, last_sync_completed_at, last_sync_job_id, created_at, last_login FROM users WHERE id = ?",
                (user_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return {
                'id': row[0],
                'amazon_seller_id': row[1],
                'company_name': row[2],
                'linked_marketplaces': json.loads(row[3]) if row[3] else [],
                'stripe_customer_id': row[4],
                'stripe_account_id': row[5],
                'last_sync_attempt_at': row[6],
                'last_sync_completed_at': row[7],
                'last_sync_job_id': row[8],
                'created_at': row[9],
                'last_login': row[10]
            }

    def record_sync_attempt(self, user_id: str, job_id: str | None):
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE users SET last_sync_attempt_at = ?, last_sync_job_id = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), job_id, user_id)
            )
            conn.commit()

    def record_sync_completed(self, user_id: str):
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE users SET last_sync_completed_at = ? WHERE id = ?",
                (datetime.utcnow().isoformat(), user_id)
            )
            conn.commit()

    def save_oauth_refresh_token(self, user_id: str, provider: str, encrypted_refresh_token: str):
        with self._get_connection() as conn:
            # Upsert style
            cursor = conn.execute(
                "SELECT id FROM oauth_tokens WHERE user_id = ? AND provider = ?",
                (user_id, provider)
            )
            row = cursor.fetchone()
            if row:
                conn.execute(
                    "UPDATE oauth_tokens SET encrypted_refresh_token = ?, updated_at = ? WHERE id = ?",
                    (encrypted_refresh_token, datetime.utcnow().isoformat(), row[0])
                )
            else:
                conn.execute(
                    "INSERT INTO oauth_tokens (user_id, provider, encrypted_refresh_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, provider, encrypted_refresh_token, datetime.utcnow().isoformat(), datetime.utcnow().isoformat())
                )
            conn.commit()
    
    def save_filing(self, claim_id: str, result: FilingResult, packet: ClaimPacket):
        """Save a filing result to the database"""
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO filings 
                (claim_id, amazon_case_id, status, message, packet)
                VALUES (?, ?, ?, ?, ?)
            """, (
                claim_id,
                result.amazon_case_id,
                result.status,
                result.message,
                json.dumps(packet.dict())
            ))
            conn.commit()
    
    def get_claim_status(self, claim_id: str) -> Optional[Dict[str, Any]]:
        """Get the current status and history of a claim"""
        claim = self.load_claim(claim_id)
        if not claim:
            return None
        
        # Get validation history
        with self._get_connection() as conn:
            cursor = conn.execute("""
                SELECT compliant, ml_validity_score, auto_file_ready, confidence_calibrated, created_at
                FROM validations 
                WHERE claim_id = ? 
                ORDER BY created_at DESC
            """, (claim_id,))
            validations = []
            for row in cursor.fetchall():
                validations.append({
                    'compliant': bool(row[0]),
                    'ml_validity_score': row[1],
                    'auto_file_ready': bool(row[2]),
                    'confidence_calibrated': row[3],
                    'created_at': row[4]
                })
            
            # Get filing history
            cursor = conn.execute("""
                SELECT amazon_case_id, status, message, created_at
                FROM filings 
                WHERE claim_id = ? 
                ORDER BY created_at DESC
            """, (claim_id,))
            filings = []
            for row in cursor.fetchall():
                filings.append({
                    'amazon_case_id': row[0],
                    'status': row[1],
                    'message': row[2],
                    'created_at': row[3]
                })
        
        return {
            'claim': claim,
            'validations': validations,
            'filings': filings
        }

    # ---------------- Audit events (Notifications & Transparency) ---------------- #

    def add_audit_event(
        self,
        user_id: str,
        claim_id: str,
        action: str,
        title: Optional[str] = None,
        message: Optional[str] = None,
        document_ids: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        actor: Optional[str] = None,
        created_at: Optional[str] = None,
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO audit_events (
                  user_id, claim_id, action, title, message, document_ids, metadata, actor, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    claim_id,
                    action,
                    title,
                    message,
                    json.dumps(document_ids or []),
                    json.dumps(metadata or {}),
                    actor,
                    created_at or datetime.utcnow().isoformat(),
                ),
            )
            conn.commit()

    def get_audit_events_for_claim(self, user_id: str, claim_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, user_id, claim_id, action, title, message, document_ids, metadata, actor, created_at
                FROM audit_events
                WHERE user_id = ? AND claim_id = ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (user_id, claim_id, limit),
            )
            rows = cursor.fetchall()
            results: List[Dict[str, Any]] = []
            for row in rows:
                results.append(
                    {
                        'id': row[0],
                        'user_id': row[1],
                        'claim_id': row[2],
                        'action': row[3],
                        'title': row[4],
                        'message': row[5],
                        'document_ids': json.loads(row[6]) if row[6] else [],
                        'metadata': json.loads(row[7]) if row[7] else {},
                        'actor': row[8],
                        'created_at': row[9],
                    }
                )
            return results

# Global database instance (optional)
db = None
try:
    if os.getenv("DISABLE_DB", "").lower() not in ("true", "1", "yes"):
        db = DatabaseManager()
    else:
        print("DatabaseManager disabled by DISABLE_DB env var")
except Exception as e:
    print(f"DatabaseManager disabled: {e}")
    db = None

