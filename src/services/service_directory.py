"""
Service Directory - Central registry for all microservices
"""

import httpx
import asyncio
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from datetime import datetime, timedelta
import logging
from src.common.config import settings

logger = logging.getLogger(__name__)

@dataclass
class ServiceInfo:
    """Information about a microservice"""
    name: str
    base_url: str
    health_endpoint: str
    is_healthy: bool = False
    last_checked: Optional[datetime] = None
    response_time_ms: Optional[float] = None
    error_count: int = 0
    last_error: Optional[str] = None

class ServiceDirectory:
    """Central registry and health monitoring for all microservices"""

    def __init__(self):
        self.services: Dict[str, ServiceInfo] = {}
        self._http_client = httpx.AsyncClient(timeout=10.0)
        self._health_check_interval = 60  # Reduce frequency to avoid rate limiting
        self._max_errors = 3

        # Register all microservices
        self._register_services()

    def _register_services(self):
        """Register all microservices with their endpoints"""
        self.services = {
            "integrations": ServiceInfo(
                name="integrations-backend",
                base_url=settings.INTEGRATIONS_URL,
                health_endpoint="/health"
            ),
            "stripe": ServiceInfo(
                name="stripe-payments",
                base_url=settings.STRIPE_SERVICE_URL,
                health_endpoint="/"  # Will test multiple endpoints
            ),
            "cost-docs": ServiceInfo(
                name="cost-documentation",
                base_url=settings.COST_DOC_SERVICE_URL,
                health_endpoint="/"
            ),
            "refund-engine": ServiceInfo(
                name="refund-engine",
                base_url=settings.REFUND_ENGINE_URL,
                health_endpoint="/"
            ),
            "mcde": ServiceInfo(
                name="mcde",
                base_url=settings.MCDE_URL,
                health_endpoint="/"
            )
        }

    async def check_service_health(self, service_name: str) -> bool:
        """Check health of a specific service with multiple endpoint attempts"""
        if service_name not in self.services:
            logger.error(f"Service {service_name} not found in directory")
            return False

        service = self.services[service_name]
        start_time = datetime.utcnow()

        # List of endpoints to try for health check
        endpoints_to_try = [
            service.health_endpoint,
            "/api/health",
            "/healthz",
            "/status",
            "/api/status",
            "/api/v1/health"
        ]

        for endpoint in endpoints_to_try:
            try:
                response = await self._http_client.get(f"{service.base_url}{endpoint}")
                response_time = (datetime.utcnow() - start_time).total_seconds() * 1000

                # Consider service healthy if we get ANY response (even 404/429)
                # This means the service is running and reachable
                if response.status_code < 500:  # Any non-5xx status means service is running
                    service.is_healthy = True
                    service.last_checked = datetime.utcnow()
                    service.response_time_ms = response_time
                    service.error_count = 0
                    service.last_error = f"Endpoint {endpoint} returned {response.status_code}"
                    logger.info(f"Service {service_name} is reachable via {endpoint} (status: {response.status_code})")
                    return True

            except Exception as e:
                continue  # Try next endpoint

        # If all endpoints failed
        service.is_healthy = False
        service.last_checked = datetime.utcnow()
        service.error_count += 1
        service.last_error = "All health check endpoints failed"
        logger.warning(f"Service {service_name} health check failed: All endpoints failed")
        return False

    # ... rest of the class methods remain the same
    async def check_all_services(self) -> Dict[str, bool]:
        """Check health of all services concurrently"""
        tasks = []
        for service_name in self.services:
            tasks.append(self.check_service_health(service_name))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        health_status = {}
        for i, (service_name, result) in enumerate(zip(self.services.keys(), results)):
            if isinstance(result, Exception):
                health_status[service_name] = False
                logger.error(f"Service {service_name} check failed: {result}")
            else:
                health_status[service_name] = result

        return health_status

    def get_service_url(self, service_name: str) -> Optional[str]:
        """Get the base URL for a service"""
        if service_name in self.services:
            return self.services[service_name].base_url
        return None

    def is_service_healthy(self, service_name: str) -> bool:
        """Check if a service is currently healthy"""
        if service_name in self.services:
            return self.services[service_name].is_healthy
        return False

    def get_service_info(self, service_name: str) -> Optional[ServiceInfo]:
        """Get detailed information about a service"""
        return self.services.get(service_name)

    def get_all_services_status(self) -> Dict[str, Dict[str, Any]]:
        """Get status of all services"""
        status = {}
        for name, service in self.services.items():
            status[name] = {
                "name": service.name,
                "base_url": service.base_url,
                "is_healthy": service.is_healthy,
                "last_checked": service.last_checked.isoformat() if service.last_checked else None,
                "response_time_ms": service.response_time_ms,
                "error_count": service.error_count,
                "last_error": service.last_error
            }
        return status

    async def call_service(self, service_name: str, method: str, endpoint: str, **kwargs) -> Optional[httpx.Response]:
        """Make a call to a specific service"""
        if not self.is_service_healthy(service_name):
            logger.warning(f"Service {service_name} is not healthy, attempting call anyway")

        service_url = self.get_service_url(service_name)
        if not service_url:
            logger.error(f"Service {service_name} not found")
            return None

        full_url = f"{service_url}{endpoint}"

        try:
            if method.upper() == "GET":
                response = await self._http_client.get(full_url, **kwargs)
            elif method.upper() == "POST":
                response = await self._http_client.post(full_url, **kwargs)
            elif method.upper() == "PUT":
                response = await self._http_client.put(full_url, **kwargs)
            elif method.upper() == "DELETE":
                response = await self._http_client.delete(full_url, **kwargs)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")

            return response

        except Exception as e:
            logger.error(f"Failed to call {service_name} at {full_url}: {e}")
            return None

    async def start_health_monitoring(self):
        """Start background health monitoring"""
        while True:
            try:
                await self.check_all_services()
                await asyncio.sleep(self._health_check_interval)
            except Exception as e:
                logger.error(f"Health monitoring error: {e}")
                await asyncio.sleep(30)  # Longer delay on error

    async def close(self):
        """Close the HTTP client"""
        await self._http_client.aclose()

# Global service directory instance
service_directory = ServiceDirectory()
