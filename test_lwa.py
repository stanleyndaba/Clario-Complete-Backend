import os
import requests
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

if __name__ == "__main__":
    print("LWA token OK:", get_lwa_access_token()[:20], "...")
