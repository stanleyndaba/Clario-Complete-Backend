"""
Simple Step 8 Sandbox Test - No Auth Required
"""
import asyncio
from src.integrations.amazon_spapi_service import AmazonSPAPIService

async def test_sandbox_step8():
    print("🧪 SIMPLE STEP 8 SANDBOX TEST")
    print("Testing with sandbox endpoint...")
    
    service = AmazonSPAPIService()
    
    # Check what base URL is being used
    print(f"Base URL: {service.base_url}")
    
    # Test if it's sandbox
    if "sandbox" in service.base_url:
        print("✅ SANDBOX ENDPOINT CONFIRMED")
        print("🚀 Step 8 is configured for sandbox!")
        return True
    else:
        print("❌ Still using production endpoint")
        return False

if __name__ == "__main__":
    result = asyncio.run(test_sandbox_step8())
    if result:
        print("\n🎉 STEP 8 SANDBOX CONFIGURATION: SUCCESS!")
        print("Next: Set sandbox credentials for full testing")
    else:
        print("\n💥 Need to fix sandbox configuration")
