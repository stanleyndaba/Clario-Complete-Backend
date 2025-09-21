"""
Encryption Service
Phase 6: AES-256 encryption for all sensitive data with secure key management
"""

import os
import base64
import json
import hashlib
from typing import Dict, Any, Optional, Union
from datetime import datetime, timedelta
import logging
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
import secrets

from src.common.config import settings
from src.common.db_postgresql import DatabaseManager

logger = logging.getLogger(__name__)

class EncryptionService:
    """Service for AES-256 encryption and secure key management"""
    
    def __init__(self):
        self.db = DatabaseManager()
        # Use env master key if available; else avoid DB writes on init
        try:
            self.master_key = self._get_or_create_master_key()
        except Exception:
            # Fallback: derive ephemeral master key from CRYPTO_SECRET to avoid startup failure
            logger.warning("Using ephemeral master key (no DB). Set ENCRYPTION_MASTER_KEY or configure DB.")
            secret = settings.CRYPTO_SECRET.encode('utf-8')
            pad = (32 - len(secret) % 32) % 32
            raw = (secret + b'0' * pad)[:32]
            self.master_key = base64.urlsafe_b64encode(raw)
        self.key_rotation_days = 90  # Rotate keys every 90 days
        self.encryption_algorithm = "AES-256-GCM"
        
    def encrypt_data(self, data: Union[str, Dict[str, Any]], key_id: Optional[str] = None) -> Dict[str, Any]:
        """Encrypt data using AES-256-GCM"""
        try:
            # Convert data to bytes
            if isinstance(data, dict):
                data_bytes = json.dumps(data, sort_keys=True).encode('utf-8')
            else:
                data_bytes = str(data).encode('utf-8')
            
            # Get encryption key
            encryption_key = self._get_encryption_key(key_id)
            
            # Generate random IV
            iv = os.urandom(12)  # 96-bit IV for GCM
            
            # Create cipher
            cipher = Cipher(
                algorithms.AES(encryption_key),
                modes.GCM(iv),
                backend=default_backend()
            )
            encryptor = cipher.encryptor()
            
            # Encrypt data
            ciphertext = encryptor.update(data_bytes) + encryptor.finalize()
            
            # Get authentication tag
            tag = encryptor.tag
            
            # Create encrypted data structure
            encrypted_data = {
                "ciphertext": base64.b64encode(ciphertext).decode('utf-8'),
                "iv": base64.b64encode(iv).decode('utf-8'),
                "tag": base64.b64encode(tag).decode('utf-8'),
                "algorithm": self.encryption_algorithm,
                "key_id": key_id or "default",
                "encrypted_at": datetime.utcnow().isoformat() + "Z"
            }
            
            return encrypted_data
            
        except Exception as e:
            logger.error(f"Failed to encrypt data: {e}")
            raise
    
    def decrypt_data(self, encrypted_data: Dict[str, Any]) -> Union[str, Dict[str, Any]]:
        """Decrypt data using AES-256-GCM"""
        try:
            # Extract components
            ciphertext = base64.b64decode(encrypted_data["ciphertext"])
            iv = base64.b64decode(encrypted_data["iv"])
            tag = base64.b64decode(encrypted_data["tag"])
            key_id = encrypted_data.get("key_id", "default")
            
            # Get decryption key
            decryption_key = self._get_encryption_key(key_id)
            
            # Create cipher
            cipher = Cipher(
                algorithms.AES(decryption_key),
                modes.GCM(iv, tag),
                backend=default_backend()
            )
            decryptor = cipher.decryptor()
            
            # Decrypt data
            decrypted_bytes = decryptor.update(ciphertext) + decryptor.finalize()
            
            # Try to parse as JSON, fallback to string
            try:
                return json.loads(decrypted_bytes.decode('utf-8'))
            except json.JSONDecodeError:
                return decrypted_bytes.decode('utf-8')
                
        except Exception as e:
            logger.error(f"Failed to decrypt data: {e}")
            raise
    
    def encrypt_file(self, file_path: str, output_path: str, key_id: Optional[str] = None) -> Dict[str, Any]:
        """Encrypt a file and save to output path"""
        try:
            with open(file_path, 'rb') as f:
                file_data = f.read()
            
            # Get encryption key
            encryption_key = self._get_encryption_key(key_id)
            
            # Generate random IV
            iv = os.urandom(12)
            
            # Create cipher
            cipher = Cipher(
                algorithms.AES(encryption_key),
                modes.GCM(iv),
                backend=default_backend()
            )
            encryptor = cipher.encryptor()
            
            # Encrypt file data
            ciphertext = encryptor.update(file_data) + encryptor.finalize()
            tag = encryptor.tag
            
            # Write encrypted file
            with open(output_path, 'wb') as f:
                f.write(iv + tag + ciphertext)
            
            return {
                "success": True,
                "output_path": output_path,
                "key_id": key_id or "default",
                "encrypted_at": datetime.utcnow().isoformat() + "Z"
            }
            
        except Exception as e:
            logger.error(f"Failed to encrypt file {file_path}: {e}")
            raise
    
    def decrypt_file(self, encrypted_file_path: str, output_path: str, key_id: Optional[str] = None) -> Dict[str, Any]:
        """Decrypt a file and save to output path"""
        try:
            with open(encrypted_file_path, 'rb') as f:
                encrypted_data = f.read()
            
            # Extract IV, tag, and ciphertext
            iv = encrypted_data[:12]
            tag = encrypted_data[12:28]
            ciphertext = encrypted_data[28:]
            
            # Get decryption key
            decryption_key = self._get_encryption_key(key_id)
            
            # Create cipher
            cipher = Cipher(
                algorithms.AES(decryption_key),
                modes.GCM(iv, tag),
                backend=default_backend()
            )
            decryptor = cipher.decryptor()
            
            # Decrypt file data
            decrypted_data = decryptor.update(ciphertext) + decryptor.finalize()
            
            # Write decrypted file
            with open(output_path, 'wb') as f:
                f.write(decrypted_data)
            
            return {
                "success": True,
                "output_path": output_path,
                "key_id": key_id or "default",
                "decrypted_at": datetime.utcnow().isoformat() + "Z"
            }
            
        except Exception as e:
            logger.error(f"Failed to decrypt file {encrypted_file_path}: {e}")
            raise
    
    def _get_or_create_master_key(self) -> bytes:
        """Get or create master encryption key"""
        try:
            # Try to get from environment
            master_key = os.getenv('ENCRYPTION_MASTER_KEY')
            if master_key:
                return base64.b64decode(master_key)
            
            # Try to get from database
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT key_value FROM encryption_keys 
                        WHERE key_type = 'master' AND status = 'active'
                        ORDER BY created_at DESC LIMIT 1
                    """)
                    
                    result = cursor.fetchone()
                    if result:
                        return base64.b64decode(result[0])
            
            # Generate new master key
            master_key = Fernet.generate_key()
            
            # Store in database
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO encryption_keys 
                        (id, key_type, key_value, status, created_at, expires_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (
                        str(uuid.uuid4()), 'master', base64.b64encode(master_key).decode('utf-8'),
                        'active', datetime.utcnow(), datetime.utcnow() + timedelta(days=365)
                    ))
            
            return master_key
            
        except Exception as e:
            logger.error(f"Failed to get or create master key: {e}")
            raise
    
    def _get_encryption_key(self, key_id: Optional[str] = None) -> bytes:
        """Get encryption key by ID"""
        try:
            key_id = key_id or "default"
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT key_value FROM encryption_keys 
                        WHERE id = %s AND status = 'active' AND expires_at > NOW()
                    """, (key_id,))
                    
                    result = cursor.fetchone()
                    if result:
                        return base64.b64decode(result[0])
            
            # Generate new key if not found
            return self._generate_new_key(key_id)
            
        except Exception as e:
            logger.error(f"Failed to get encryption key {key_id}: {e}")
            raise
    
    def _generate_new_key(self, key_id: str) -> bytes:
        """Generate new encryption key"""
        try:
            # Generate random key
            key = os.urandom(32)  # 256-bit key
            
            # Store in database
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO encryption_keys 
                        (id, key_type, key_value, status, created_at, expires_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (
                        key_id, 'data', base64.b64encode(key).decode('utf-8'),
                        'active', datetime.utcnow(), datetime.utcnow() + timedelta(days=self.key_rotation_days)
                    ))
            
            return key
            
        except Exception as e:
            logger.error(f"Failed to generate new key {key_id}: {e}")
            raise
    
    def rotate_keys(self) -> Dict[str, Any]:
        """Rotate encryption keys"""
        try:
            rotated_keys = []
            
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Get keys that need rotation
                    cursor.execute("""
                        SELECT id, key_type FROM encryption_keys 
                        WHERE status = 'active' AND expires_at <= NOW() + INTERVAL '7 days'
                    """)
                    
                    keys_to_rotate = cursor.fetchall()
                    
                    for key_id, key_type in keys_to_rotate:
                        # Generate new key
                        new_key = os.urandom(32)
                        
                        # Mark old key as rotated
                        cursor.execute("""
                            UPDATE encryption_keys 
                            SET status = 'rotated', rotated_at = NOW()
                            WHERE id = %s
                        """, (key_id,))
                        
                        # Create new key
                        new_key_id = f"{key_id}_rotated_{int(datetime.utcnow().timestamp())}"
                        cursor.execute("""
                            INSERT INTO encryption_keys 
                            (id, key_type, key_value, status, created_at, expires_at, rotated_from)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """, (
                            new_key_id, key_type, base64.b64encode(new_key).decode('utf-8'),
                            'active', datetime.utcnow(), 
                            datetime.utcnow() + timedelta(days=self.key_rotation_days),
                            key_id
                        ))
                        
                        rotated_keys.append({
                            "old_key_id": key_id,
                            "new_key_id": new_key_id,
                            "key_type": key_type
                        })
            
            return {
                "success": True,
                "rotated_keys": rotated_keys,
                "rotated_at": datetime.utcnow().isoformat() + "Z"
            }
            
        except Exception as e:
            logger.error(f"Failed to rotate keys: {e}")
            raise
    
    def get_key_status(self) -> Dict[str, Any]:
        """Get status of all encryption keys"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT id, key_type, status, created_at, expires_at, rotated_from
                        FROM encryption_keys 
                        ORDER BY created_at DESC
                    """)
                    
                    keys = []
                    for row in cursor.fetchall():
                        keys.append({
                            "id": str(row[0]),
                            "key_type": row[1],
                            "status": row[2],
                            "created_at": row[3].isoformat() + "Z",
                            "expires_at": row[4].isoformat() + "Z" if row[4] else None,
                            "rotated_from": str(row[5]) if row[5] else None
                        })
                    
                    return {
                        "total_keys": len(keys),
                        "active_keys": len([k for k in keys if k["status"] == "active"]),
                        "expired_keys": len([k for k in keys if k["status"] == "expired"]),
                        "rotated_keys": len([k for k in keys if k["status"] == "rotated"]),
                        "keys": keys
                    }
                    
        except Exception as e:
            logger.error(f"Failed to get key status: {e}")
            raise

# Global instance
encryption_service = EncryptionService()
