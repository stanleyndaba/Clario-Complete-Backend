import requests
import os
from dotenv import load_dotenv

load_dotenv()

def get_lwa_access_token():
    r = requests.post(
        "https://api.amazon.com/auth/o2/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": os.getenv("AMAZON_SPAPI_REFRESH_TOKEN"),
            "client_id": os.getenv("AMAZON_SPAPI_CLIENT_ID"),
            "client_secret": os.getenv("AMAZON_SPAPI_CLIENT_SECRET"),
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()["access_token"]

# Test Amazon SP-API directly
if __name__ == "__main__":
    access_token = get_lwa_access_token()
    print(f"LWA Token: {access_token[:20]}...")

    headers = {"x-amz-access-token": access_token}

    # Test a simple sandbox endpoint (will require SigV4 in real usage)
    response = requests.get(
        "https://sandbox.sellingpartnerapi-na.amazon.com/catalog/2022-04-01/items",
        params={"marketplaceIds": "ATVPDKIKX0DER", "asin": "B000N99BBC"},
        headers=headers,
        timeout=20,
    )
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text[:200]}...")
