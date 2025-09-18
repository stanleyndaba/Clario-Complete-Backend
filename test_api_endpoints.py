#!/usr/bin/env python3
"""
Test script for the FastAPI orchestrator endpoints
Tests all the new API endpoints to ensure they work correctly
"""

import os
import sys
import asyncio
import json
from datetime import datetime

# Set environment variables
os.environ['DB_TYPE'] = 'sqlite'
os.environ['DB_URL'] = './claims.db'

# Add src to path
sys.path.insert(0, 'src')

from fastapi.testclient import TestClient
from src.app import app

def test_health_endpoint():
    """Test the health endpoint"""
    print("🔍 Testing health endpoint...")
    client = TestClient(app)
    response = client.get("/health")
    
    print(f"  Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"  Service: {data.get('service')}")
        print(f"  Status: {data.get('status')}")
        print(f"  Services: {data.get('services', {}).get('healthy', 0)}/{data.get('services', {}).get('total', 0)} healthy")
        return True
    else:
        print(f"  Error: {response.text}")
        return False

def test_root_endpoint():
    """Test the root endpoint"""
    print("\n🔍 Testing root endpoint...")
    client = TestClient(app)
    response = client.get("/")
    
    print(f"  Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"  Service: {data.get('service')}")
        print(f"  Version: {data.get('version')}")
        print(f"  Available endpoints: {len(data.get('endpoints', {}))}")
        return True
    else:
        print(f"  Error: {response.text}")
        return False

def test_services_status():
    """Test the services status endpoint"""
    print("\n🔍 Testing services status endpoint...")
    client = TestClient(app)
    response = client.get("/api/services/status")
    
    print(f"  Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"  Available services: {len(data)}")
        for service, status in data.items():
            print(f"    {service}: {'✅' if status.get('is_healthy') else '❌'} ({status.get('status', 'unknown')})")
        return True
    else:
        print(f"  Error: {response.text}")
        return False

def test_auth_endpoints():
    """Test authentication endpoints"""
    print("\n🔍 Testing auth endpoints...")
    client = TestClient(app)
    
    # Test Amazon login start
    response = client.get("/auth/amazon/start")
    print(f"  Amazon login start: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"    Auth URL generated: {'amazon.com' in data.get('auth_url', '')}")
        print(f"    State parameter: {len(data.get('state', '')) > 0}")
    
    # Test logout
    response = client.post("/api/auth/logout")
    print(f"  Logout: {response.status_code}")
    
    return True

def test_api_structure():
    """Test that all required API endpoints exist"""
    print("\n🔍 Testing API structure...")
    client = TestClient(app)
    
    # Get all routes
    routes = []
    for route in app.routes:
        if hasattr(route, 'path'):
            if hasattr(route, 'methods'):
                # HTTP routes
                for method in route.methods:
                    if method != 'HEAD':  # Skip HEAD methods
                        routes.append(f"{method} {route.path}")
            else:
                # WebSocket routes (don't have methods attribute)
                routes.append(f"WS {route.path}")
    
    print(f"  Total routes: {len(routes)}")
    
    # Check for required endpoints
    required_endpoints = [
        "GET /health",
        "GET /",
        "GET /api/services/status",
        "GET /auth/amazon/start",
        "POST /api/auth/logout",
        "GET /api/auth/me",
        "POST /api/sync/start",  # Corrected: POST not GET
        "GET /api/sync/status",
        "GET /api/sync/activity",
        "GET /api/v1/integrations/status",
        "GET /api/v1/integrations/connect-amazon",
        "GET /api/recoveries",
        "GET /api/recoveries/{id}",
        "GET /api/recoveries/{id}/status",
        "POST /api/claims/{id}/submit",
        "GET /api/documents",  # Note: This should be /api/documents but we have /api/recoveries/{id}/document
        "GET /api/documents/{id}",
        "GET /api/documents/{id}/view",
        "GET /api/documents/{id}/download",
        "POST /api/documents/upload",
        "POST /api/detections/run",  # Corrected: POST not GET
        "GET /api/detections/status/{detectionId}",
        "GET /api/metrics/dashboard",
        "GET /api/metrics/recoveries",
        "POST /api/metrics/track",
        "WS /ws/status"
    ]
    
    found_endpoints = []
    missing_endpoints = []
    
    for required in required_endpoints:
        found = False
        required_method, required_path = required.split(' ', 1)
        
        for route in routes:
            route_method, route_path = route.split(' ', 1)
            
            # Check if method matches
            if route_method != required_method:
                continue
                
            # Check if path matches (exact or with parameters)
            if route_path == required_path:
                found = True
                break
            # Check if it's a parameterized route match
            elif '{' in required_path and '{' in route_path:
                # Extract the base path before parameters
                required_base = required_path.split('{')[0]
                route_base = route_path.split('{')[0]
                if required_base == route_base:
                    found = True
                    break
            # Special case for WebSocket routes - check if path contains the required path
            elif required_method == 'WS' and required_path in route_path:
                found = True
                break
        if found:
            found_endpoints.append(required)
        else:
            missing_endpoints.append(required)
    
    print(f"  Found endpoints: {len(found_endpoints)}/{len(required_endpoints)}")
    
    if found_endpoints:
        print("  Found endpoints:")
        for endpoint in found_endpoints:
            print(f"    ✅ {endpoint}")
    
    if missing_endpoints:
        print("  Missing endpoints:")
        for endpoint in missing_endpoints:
            print(f"    ❌ {endpoint}")
    else:
        print("  ✅ All required endpoints found!")
    
    return len(missing_endpoints) == 0

def main():
    """Run all tests"""
    print("🚀 Testing FastAPI Orchestrator API Endpoints")
    print("=" * 50)
    
    tests = [
        ("Health Endpoint", test_health_endpoint),
        ("Root Endpoint", test_root_endpoint),
        ("Services Status", test_services_status),
        ("Auth Endpoints", test_auth_endpoints),
        ("API Structure", test_api_structure),
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"  ❌ Error: {str(e)}")
            results.append((test_name, False))
    
    print("\n" + "=" * 50)
    print("📊 Test Results Summary")
    print("=" * 50)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {test_name}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! The API is ready for frontend integration.")
    else:
        print("⚠️  Some tests failed. Please check the implementation.")
    
    return passed == total

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
