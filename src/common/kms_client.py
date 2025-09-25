"""
Simple KMS client abstraction (placeholder). In production, back with AWS KMS, GCP KMS, or Vault Transit.
"""
from typing import Optional
import base64

class KMSClient:
    def __init__(self, endpoint: Optional[str], key_id: Optional[str]):
        self.endpoint = endpoint
        self.key_id = key_id

    def encrypt(self, plaintext: bytes, key_id_override: Optional[str] = None) -> bytes:
        # Placeholder: echo with base64. Replace with real KMS call.
        return base64.urlsafe_b64encode(plaintext)

    def decrypt(self, ciphertext: bytes, key_id_override: Optional[str] = None) -> bytes:
        # Placeholder: decode base64
        return base64.urlsafe_b64decode(ciphertext)

