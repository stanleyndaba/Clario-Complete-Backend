"""
Storage abstraction service for Evidence & Value Engine
Supports both Supabase and S3 backends
"""
import os
import logging
from typing import Dict, Any, Optional, Union
from pathlib import Path
import tempfile
from datetime import datetime, timedelta
import boto3
from botocore.exceptions import ClientError
import requests
from supabase import create_client, Client
from PIL import Image
import io

logger = logging.getLogger(__name__)

class StorageService:
    """Storage service abstraction for file storage"""
    
    def __init__(self):
        self.backend = os.getenv('STORAGE_BACKEND', 'supabase').lower()
        self.supabase_client = None
        self.s3_client = None
        
        if self.backend == 'supabase':
            self._init_supabase()
        elif self.backend == 's3':
            self._init_s3()
        else:
            raise ValueError(f"Unsupported storage backend: {self.backend}")
    
    def _init_supabase(self):
        """Initialize Supabase client"""
        supabase_url = os.getenv('SUPABASE_URL')
        supabase_key = os.getenv('SUPABASE_SERVICE_KEY')
        
        if not supabase_url or not supabase_key:
            raise ValueError("Supabase credentials not configured")
        
        self.supabase_client = create_client(supabase_url, supabase_key)
        logger.info("Supabase storage initialized")
    
    def _init_s3(self):
        """Initialize S3 client"""
        aws_region = os.getenv('AWS_REGION', 'us-east-1')
        aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
        aws_secret_key = os.getenv('AWS_SECRET_ACCESS_KEY')
        self.bucket_name = os.getenv('S3_BUCKET_NAME')
        
        if not aws_access_key or not aws_secret_key or not self.bucket_name:
            raise ValueError("S3 credentials not configured")
        
        self.s3_client = boto3.client(
            's3',
            region_name=aws_region,
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key
        )
        logger.info(f"S3 storage initialized for bucket: {self.bucket_name}")
    
    def upload(self, file_data: Union[bytes, str], metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Upload file to storage
        
        Args:
            file_data: File content as bytes or file path
            metadata: File metadata including seller_id, mime_type, filename
            
        Returns:
            Dict with storage_url and other upload details
        """
        try:
            if self.backend == 'supabase':
                return self._upload_to_supabase(file_data, metadata)
            elif self.backend == 's3':
                return self._upload_to_s3(file_data, metadata)
        except Exception as e:
            logger.error(f"Upload failed: {e}")
            raise
    
    def _upload_to_supabase(self, file_data: Union[bytes, str], metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Upload to Supabase storage"""
        seller_id = metadata['seller_id']
        filename = metadata['filename']
        mime_type = metadata['mime_type']
        
        # Create folder path: evidence/{seller_id}/{timestamp}_{filename}
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        folder_path = f"evidence/{seller_id}"
        file_path = f"{folder_path}/{timestamp}_{filename}"
        
        # Convert file_data to bytes if it's a path
        if isinstance(file_data, str):
            with open(file_data, 'rb') as f:
                file_bytes = f.read()
        else:
            file_bytes = file_data
        
        # Upload to Supabase
        result = self.supabase_client.storage.from_('evidence').upload(
            path=file_path,
            file=file_bytes,
            file_options={'content-type': mime_type}
        )
        
        # Get public URL
        storage_url = self.supabase_client.storage.from_('evidence').get_public_url(file_path)
        
        return {
            'storage_url': storage_url,
            'file_path': file_path,
            'bytes': len(file_bytes),
            'mime_type': mime_type,
            'uploaded_at': datetime.now().isoformat()
        }
    
    def _upload_to_s3(self, file_data: Union[bytes, str], metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Upload to S3 storage"""
        seller_id = metadata['seller_id']
        filename = metadata['filename']
        mime_type = metadata['mime_type']
        
        # Create S3 key
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        s3_key = f"evidence/{seller_id}/{timestamp}_{filename}"
        
        # Convert file_data to bytes if it's a path
        if isinstance(file_data, str):
            with open(file_data, 'rb') as f:
                file_bytes = f.read()
        else:
            file_bytes = file_data
        
        # Upload to S3
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=s3_key,
            Body=file_bytes,
            ContentType=mime_type,
            Metadata={
                'seller_id': seller_id,
                'uploaded_at': datetime.now().isoformat()
            }
        )
        
        storage_url = f"s3://{self.bucket_name}/{s3_key}"
        
        return {
            'storage_url': storage_url,
            's3_key': s3_key,
            'bytes': len(file_bytes),
            'mime_type': mime_type,
            'uploaded_at': datetime.now().isoformat()
        }
    
    def get_signed_url(self, storage_url: str, expires_in: int = 300) -> str:
        """
        Get signed URL for file access
        
        Args:
            storage_url: Storage URL from upload
            expires_in: Expiration time in seconds (default: 5 minutes)
            
        Returns:
            Signed URL for temporary access
        """
        try:
            if self.backend == 'supabase':
                return self._get_supabase_signed_url(storage_url, expires_in)
            elif self.backend == 's3':
                return self._get_s3_signed_url(storage_url, expires_in)
        except Exception as e:
            logger.error(f"Failed to generate signed URL: {e}")
            raise
    
    def _get_supabase_signed_url(self, storage_url: str, expires_in: int) -> str:
        """Get Supabase signed URL"""
        # Extract file path from storage URL
        file_path = storage_url.split('/')[-2] + '/' + storage_url.split('/')[-1]
        
        # Create signed URL
        signed_url = self.supabase_client.storage.from_('evidence').create_signed_url(
            path=file_path,
            expires_in=expires_in
        )
        
        return signed_url
    
    def _get_s3_signed_url(self, storage_url: str, expires_in: int) -> str:
        """Get S3 signed URL"""
        # Extract S3 key from storage URL
        s3_key = storage_url.replace(f"s3://{self.bucket_name}/", "")
        
        # Generate presigned URL
        signed_url = self.s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': self.bucket_name, 'Key': s3_key},
            ExpiresIn=expires_in
        )
        
        return signed_url
    
    def delete(self, storage_url: str) -> bool:
        """
        Delete file from storage
        
        Args:
            storage_url: Storage URL from upload
            
        Returns:
            True if deletion successful
        """
        try:
            if self.backend == 'supabase':
                return self._delete_from_supabase(storage_url)
            elif self.backend == 's3':
                return self._delete_from_s3(storage_url)
        except Exception as e:
            logger.error(f"Deletion failed: {e}")
            return False
    
    def _delete_from_supabase(self, storage_url: str) -> bool:
        """Delete from Supabase storage"""
        try:
            # Extract file path from storage URL
            file_path = storage_url.split('/')[-2] + '/' + storage_url.split('/')[-1]
            
            # Delete from Supabase
            self.supabase_client.storage.from_('evidence').remove([file_path])
            return True
        except Exception as e:
            logger.error(f"Supabase deletion failed: {e}")
            return False
    
    def _delete_from_s3(self, storage_url: str) -> bool:
        """Delete from S3 storage"""
        try:
            # Extract S3 key from storage URL
            s3_key = storage_url.replace(f"s3://{self.bucket_name}/", "")
            
            # Delete from S3
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=s3_key)
            return True
        except Exception as e:
            logger.error(f"S3 deletion failed: {e}")
            return False
    
    def validate_file(self, file_data: bytes, mime_type: str, max_size_mb: int = 50) -> Dict[str, Any]:
        """
        Validate uploaded file
        
        Args:
            file_data: File content as bytes
            mime_type: File MIME type
            max_size_mb: Maximum file size in MB
            
        Returns:
            Dict with validation results
        """
        validation_result = {
            'is_valid': True,
            'errors': [],
            'warnings': []
        }
        
        # Check file size
        file_size_mb = len(file_data) / (1024 * 1024)
        if file_size_mb > max_size_mb:
            validation_result['is_valid'] = False
            validation_result['errors'].append(f"File size {file_size_mb:.2f}MB exceeds limit of {max_size_mb}MB")
        
        # Check MIME type
        allowed_types = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg']
        if mime_type not in allowed_types:
            validation_result['is_valid'] = False
            validation_result['errors'].append(f"Unsupported file type: {mime_type}")
        
        # Check if file is corrupted
        try:
            if mime_type.startswith('image/'):
                Image.open(io.BytesIO(file_data))
            elif mime_type == 'application/pdf':
                # Basic PDF validation - check header
                if not file_data.startswith(b'%PDF'):
                    validation_result['is_valid'] = False
                    validation_result['errors'].append("Invalid PDF file")
        except Exception as e:
            validation_result['is_valid'] = False
            validation_result['errors'].append(f"File corruption detected: {str(e)}")
        
        return validation_result
