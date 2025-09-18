"""
OAuth 2.0 Connectors for Evidence Sources
Implements secure OAuth flows for Gmail, Outlook, Google Drive, and Dropbox
"""

import httpx
import json
import base64
from typing import Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
from urllib.parse import urlencode, parse_qs
import logging

logger = logging.getLogger(__name__)

class OAuthConnector:
    """Base OAuth 2.0 connector"""
    
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
    
    async def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        """Exchange authorization code for access and refresh tokens"""
        raise NotImplementedError
    
    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh access token using refresh token"""
        raise NotImplementedError
    
    async def revoke_token(self, token: str) -> bool:
        """Revoke access or refresh token"""
        raise NotImplementedError
    
    async def get_user_info(self, access_token: str) -> Dict[str, Any]:
        """Get user account information"""
        raise NotImplementedError

class GmailConnector(OAuthConnector):
    """Gmail OAuth 2.0 connector"""
    
    OAUTH_BASE_URL = "https://accounts.google.com"
    API_BASE_URL = "https://gmail.googleapis.com"
    SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
    
    async def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        """Exchange Gmail authorization code for tokens"""
        async with httpx.AsyncClient() as client:
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": self.redirect_uri
            }
            
            response = await client.post(
                f"{self.OAUTH_BASE_URL}/o/oauth2/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            response.raise_for_status()
            return response.json()
    
    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh Gmail access token"""
        async with httpx.AsyncClient() as client:
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }
            
            response = await client.post(
                f"{self.OAUTH_BASE_URL}/o/oauth2/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            response.raise_for_status()
            return response.json()
    
    async def revoke_token(self, token: str) -> bool:
        """Revoke Gmail token"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.OAUTH_BASE_URL}/o/oauth2/revoke",
                    params={"token": token}
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to revoke Gmail token: {e}")
            return False
    
    async def get_user_info(self, access_token: str) -> Dict[str, Any]:
        """Get Gmail user profile"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.API_BASE_URL}/gmail/v1/users/me/profile",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            response.raise_for_status()
            return response.json()
    
    def get_auth_url(self, state: str) -> str:
        """Generate Gmail OAuth authorization URL"""
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.SCOPES),
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "state": state
        }
        return f"{self.OAUTH_BASE_URL}/o/oauth2/v2/auth?{urlencode(params)}"

class OutlookConnector(OAuthConnector):
    """Outlook (Microsoft Graph) OAuth 2.0 connector"""
    
    OAUTH_BASE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0"
    API_BASE_URL = "https://graph.microsoft.com"
    SCOPES = ["https://graph.microsoft.com/Mail.Read"]
    
    async def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        """Exchange Outlook authorization code for tokens"""
        async with httpx.AsyncClient() as client:
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": self.redirect_uri,
                "scope": " ".join(self.SCOPES)
            }
            
            response = await client.post(
                f"{self.OAUTH_BASE_URL}/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            response.raise_for_status()
            return response.json()
    
    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh Outlook access token"""
        async with httpx.AsyncClient() as client:
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "scope": " ".join(self.SCOPES)
            }
            
            response = await client.post(
                f"{self.OAUTH_BASE_URL}/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            response.raise_for_status()
            return response.json()
    
    async def revoke_token(self, token: str) -> bool:
        """Revoke Outlook token"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.OAUTH_BASE_URL}/token",
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "token": token
                    }
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to revoke Outlook token: {e}")
            return False
    
    async def get_user_info(self, access_token: str) -> Dict[str, Any]:
        """Get Outlook user profile"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.API_BASE_URL}/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            response.raise_for_status()
            return response.json()
    
    def get_auth_url(self, state: str) -> str:
        """Generate Outlook OAuth authorization URL"""
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.SCOPES),
            "response_type": "code",
            "response_mode": "query",
            "state": state
        }
        return f"{self.OAUTH_BASE_URL}/authorize?{urlencode(params)}"

class GoogleDriveConnector(OAuthConnector):
    """Google Drive OAuth 2.0 connector"""
    
    OAUTH_BASE_URL = "https://accounts.google.com"
    API_BASE_URL = "https://www.googleapis.com"
    SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
    
    async def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        """Exchange Google Drive authorization code for tokens"""
        async with httpx.AsyncClient() as client:
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": self.redirect_uri
            }
            
            response = await client.post(
                f"{self.OAUTH_BASE_URL}/o/oauth2/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            response.raise_for_status()
            return response.json()
    
    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh Google Drive access token"""
        async with httpx.AsyncClient() as client:
            data = {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }
            
            response = await client.post(
                f"{self.OAUTH_BASE_URL}/o/oauth2/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            response.raise_for_status()
            return response.json()
    
    async def revoke_token(self, token: str) -> bool:
        """Revoke Google Drive token"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.OAUTH_BASE_URL}/o/oauth2/revoke",
                    params={"token": token}
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to revoke Google Drive token: {e}")
            return False
    
    async def get_user_info(self, access_token: str) -> Dict[str, Any]:
        """Get Google Drive user profile"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.API_BASE_URL}/drive/v3/about",
                params={"fields": "user"},
                headers={"Authorization": f"Bearer {access_token}"}
            )
            response.raise_for_status()
            return response.json()
    
    def get_auth_url(self, state: str) -> str:
        """Generate Google Drive OAuth authorization URL"""
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.SCOPES),
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "state": state
        }
        return f"{self.OAUTH_BASE_URL}/o/oauth2/v2/auth?{urlencode(params)}"

class DropboxConnector(OAuthConnector):
    """Dropbox OAuth 2.0 connector"""
    
    OAUTH_BASE_URL = "https://www.dropbox.com/oauth2"
    API_BASE_URL = "https://api.dropboxapi.com"
    SCOPES = ["files.metadata.read", "files.content.read"]
    
    async def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        """Exchange Dropbox authorization code for tokens"""
        async with httpx.AsyncClient() as client:
            data = {
                "code": code,
                "grant_type": "authorization_code",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "redirect_uri": self.redirect_uri
            }
            
            response = await client.post(
                f"{self.OAUTH_BASE_URL}/token",
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            response.raise_for_status()
            return response.json()
    
    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh Dropbox access token"""
        # Dropbox doesn't use refresh tokens, tokens are long-lived
        # Return the same refresh token as access token
        return {
            "access_token": refresh_token,
            "token_type": "bearer",
            "expires_in": 14400  # 4 hours
        }
    
    async def revoke_token(self, token: str) -> bool:
        """Revoke Dropbox token"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.API_BASE_URL}/2/auth/token/revoke",
                    headers={"Authorization": f"Bearer {token}"}
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to revoke Dropbox token: {e}")
            return False
    
    async def get_user_info(self, access_token: str) -> Dict[str, Any]:
        """Get Dropbox user profile"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.API_BASE_URL}/2/users/get_current_account",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            response.raise_for_status()
            return response.json()
    
    def get_auth_url(self, state: str) -> str:
        """Generate Dropbox OAuth authorization URL"""
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "state": state
        }
        return f"{self.OAUTH_BASE_URL}/authorize?{urlencode(params)}"

def get_connector(provider: str, client_id: str, client_secret: str, redirect_uri: str) -> OAuthConnector:
    """Factory function to get the appropriate OAuth connector"""
    connectors = {
        "gmail": GmailConnector,
        "outlook": OutlookConnector,
        "gdrive": GoogleDriveConnector,
        "dropbox": DropboxConnector
    }
    
    if provider not in connectors:
        raise ValueError(f"Unsupported provider: {provider}")
    
    return connectors[provider](client_id, client_secret, redirect_uri)
