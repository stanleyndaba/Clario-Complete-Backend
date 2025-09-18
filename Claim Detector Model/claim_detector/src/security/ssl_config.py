"""
SSL/HTTPS configuration for the Claim Detector Model
"""
import os
from pathlib import Path
from typing import Optional, Tuple
import ssl
import logging

logger = logging.getLogger(__name__)

class SSLConfig:
    """SSL configuration for HTTPS"""
    
    def __init__(self):
        self.ssl_certfile = os.getenv("SSL_CERTFILE", "./ssl/cert.pem")
        self.ssl_keyfile = os.getenv("SSL_KEYFILE", "./ssl/key.pem")
        self.https_enabled = os.getenv("HTTPS_ENABLED", "false").lower() == "true"
        
        # Validate SSL configuration
        self._validate_ssl_config()
    
    def _validate_ssl_config(self):
        """Validate SSL certificate and key files"""
        if not self.https_enabled:
            return
        
        cert_path = Path(self.ssl_certfile)
        key_path = Path(self.ssl_keyfile)
        
        if not cert_path.exists():
            logger.warning(f"SSL certificate not found: {self.ssl_certfile}")
            self.https_enabled = False
        
        if not key_path.exists():
            logger.warning(f"SSL key not found: {self.ssl_keyfile}")
            self.https_enabled = False
        
        if not self.https_enabled:
            logger.info("HTTPS disabled - using HTTP only")
    
    def get_ssl_context(self) -> Optional[ssl.SSLContext]:
        """Get SSL context for HTTPS"""
        if not self.https_enabled:
            return None
        
        try:
            ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
            ssl_context.load_cert_chain(
                certfile=self.ssl_certfile,
                keyfile=self.ssl_keyfile
            )
            
            # Configure SSL context
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            
            logger.info("SSL context created successfully")
            return ssl_context
            
        except Exception as e:
            logger.error(f"Error creating SSL context: {e}")
            self.https_enabled = False
            return None
    
    def get_uvicorn_ssl_config(self) -> Optional[Tuple[str, str]]:
        """Get SSL configuration for Uvicorn"""
        if not self.https_enabled:
            return None
        
        cert_path = Path(self.ssl_certfile)
        key_path = Path(self.ssl_keyfile)
        
        if cert_path.exists() and key_path.exists():
            return (str(cert_path), str(key_path))
        
        return None
    
    def create_self_signed_cert(self, output_dir: str = "./ssl"):
        """Create self-signed certificate for development"""
        try:
            from cryptography import x509
            from cryptography.x509.oid import NameOID
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import rsa
            from datetime import datetime, timedelta
            
            # Create output directory
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)
            
            # Generate private key
            private_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048,
            )
            
            # Create certificate
            subject = issuer = x509.Name([
                x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
                x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "CA"),
                x509.NameAttribute(NameOID.LOCALITY_NAME, "San Francisco"),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Claim Detector"),
                x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
            ])
            
            cert = x509.CertificateBuilder().subject_name(
                subject
            ).issuer_name(
                issuer
            ).public_key(
                private_key.public_key()
            ).serial_number(
                x509.random_serial_number()
            ).not_valid_before(
                datetime.utcnow()
            ).not_valid_after(
                datetime.utcnow() + timedelta(days=365)
            ).add_extension(
                x509.SubjectAlternativeName([
                    x509.DNSName("localhost"),
                    x509.IPAddress("127.0.0.1"),
                ]),
                critical=False,
            ).sign(private_key, hashes.SHA256())
            
            # Save certificate and private key
            cert_path = output_path / "cert.pem"
            key_path = output_path / "key.pem"
            
            with open(cert_path, "wb") as f:
                f.write(cert.public_bytes(serialization.Encoding.PEM))
            
            with open(key_path, "wb") as f:
                f.write(private_key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.NoEncryption()
                ))
            
            logger.info(f"Self-signed certificate created: {cert_path}")
            logger.info(f"Private key created: {key_path}")
            
            # Update configuration
            self.ssl_certfile = str(cert_path)
            self.ssl_keyfile = str(key_path)
            self.https_enabled = True
            
        except ImportError:
            logger.error("cryptography library not available. Install with: pip install cryptography")
        except Exception as e:
            logger.error(f"Error creating self-signed certificate: {e}")
    
    def get_https_url(self, host: str, port: int) -> str:
        """Get HTTPS URL for the service"""
        if self.https_enabled:
            return f"https://{host}:{port}"
        return f"http://{host}:{port}"
    
    def is_https_enabled(self) -> bool:
        """Check if HTTPS is enabled"""
        return self.https_enabled

# Global SSL configuration instance
ssl_config = SSLConfig()
