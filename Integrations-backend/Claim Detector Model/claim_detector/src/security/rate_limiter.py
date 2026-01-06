"""
Rate limiting system for the Claim Detector Model
"""
import time
from typing import Dict, Tuple
from collections import defaultdict
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)

# Rate limit configurations
RATE_LIMITS = {
    "default": "1000/minute",
    "predict": "100/minute",
    "batch_predict": "10/minute",
    "feedback": "50/minute",
    "metrics": "200/minute"
}

class CustomRateLimiter:
    """Custom rate limiter with IP-based tracking"""
    
    def __init__(self):
        self.requests = defaultdict(list)
        self.blocked_ips = set()
        self.block_duration = 3600  # 1 hour
    
    def is_allowed(self, ip: str, endpoint: str, limit: int, window: int) -> bool:
        """Check if request is allowed"""
        current_time = time.time()
        
        # Check if IP is blocked
        if ip in self.blocked_ips:
            # Check if block period has expired
            if current_time - self.requests[ip][-1] > self.block_duration:
                self.blocked_ips.remove(ip)
            else:
                return False
        
        # Clean old requests
        self.requests[ip] = [req_time for req_time in self.requests[ip] 
                            if current_time - req_time < window]
        
        # Check rate limit
        if len(self.requests[ip]) >= limit:
            # Block IP if too many requests
            if len(self.requests[ip]) >= limit * 2:
                self.blocked_ips.add(ip)
            return False
        
        # Add current request
        self.requests[ip].append(current_time)
        return True
    
    def get_remaining_requests(self, ip: str, endpoint: str, limit: int, window: int) -> int:
        """Get remaining requests for an IP"""
        current_time = time.time()
        
        # Clean old requests
        self.requests[ip] = [req_time for req_time in self.requests[ip] 
                            if current_time - req_time < window]
        
        return max(0, limit - len(self.requests[ip]))

# Global rate limiter instance
custom_limiter = CustomRateLimiter()

def get_rate_limit_config(endpoint: str) -> Tuple[int, int]:
    """Get rate limit configuration for an endpoint"""
    if endpoint == "predict":
        return 100, 60  # 100 requests per minute
    elif endpoint == "batch_predict":
        return 10, 60   # 10 requests per minute
    elif endpoint == "feedback":
        return 50, 60   # 50 requests per minute
    elif endpoint == "metrics":
        return 200, 60  # 200 requests per minute
    else:
        return 1000, 60  # 1000 requests per minute

def check_rate_limit(ip: str, endpoint: str) -> bool:
    """Check if request is within rate limits"""
    limit, window = get_rate_limit_config(endpoint)
    return custom_limiter.is_allowed(ip, endpoint, limit, window)

def get_remaining_requests(ip: str, endpoint: str) -> int:
    """Get remaining requests for an IP and endpoint"""
    limit, window = get_rate_limit_config(endpoint)
    return custom_limiter.get_remaining_requests(ip, endpoint, limit, window)



