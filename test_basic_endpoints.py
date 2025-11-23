import requests
import json

# Test the basic endpoints on the deployed app
BASE_URL = "https://opside-node-api-woco.onrender.com"

def test_endpoint(endpoint, method="GET"):
    url = f"{BASE_URL}{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url, timeout=10)
        elif method == "POST":
            response = requests.post(url, timeout=10)
        
        print(f"{method} {endpoint}: {response.status_code}")
        if response.status_code == 200:
            print(f"  ✓ Response: {response.json()}")
        else:
            print(f"  ✗ Error: {response.text}")
        return response.status_code == 200
    except Exception as e:
        print(f"{method} {endpoint}: ERROR - {e}")
        return False

if __name__ == "__main__":
    print("Testing basic endpoints on simplified app...")
    
    # Test core endpoints
    endpoints = [
        "/",
        "/integrations", 
        "/health",
        "/cors/debug",
        "/api/services/status"
    ]
    
    results = {}
    for endpoint in endpoints:
        results[endpoint] = test_endpoint(endpoint)
    
    print(f"\nResults: {sum(results.values())}/{len(results)} endpoints working")
    
    if all(results.values()):
        print("✓ All basic endpoints working! The issue was with one of the routers.")
    else:
        print("✗ Still having issues with basic endpoints.")