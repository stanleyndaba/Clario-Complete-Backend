#!/usr/bin/env python3
"""
Test Amazon SP-API Connection
This script tests the Amazon SP-API connection and fetches real data to prove it's working.
"""

import asyncio
import os
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))

from src.integrations.amazon_spapi_service import amazon_spapi_service
import json

async def main():
    print("🧪 Testing Amazon SP-API Connection\n")
    print("=" * 60)
    
    # Check environment variables
    print("\n📋 Checking Environment Variables...")
    base_url = os.getenv("AMAZON_SPAPI_BASE_URL", "Not set")
    client_id = os.getenv("AMAZON_SPAPI_CLIENT_ID", "Not set")
    client_secret = os.getenv("AMAZON_SPAPI_CLIENT_SECRET", "Not set")
    refresh_token = os.getenv("AMAZON_SPAPI_REFRESH_TOKEN", "Not set")
    
    print(f"  Base URL: {base_url}")
    print(f"  Client ID: {'✅ Set' if client_id != 'Not set' else '❌ Missing'}")
    print(f"  Client Secret: {'✅ Set' if client_secret != 'Not set' else '❌ Missing'}")
    print(f"  Refresh Token: {'✅ Set' if refresh_token != 'Not set' else '❌ Missing'}")
    
    if client_id == "Not set" or client_secret == "Not set" or refresh_token == "Not set":
        print("\n❌ ERROR: Missing required Amazon SP-API credentials!")
        print("   Please set AMAZON_SPAPI_CLIENT_ID, AMAZON_SPAPI_CLIENT_SECRET, and AMAZON_SPAPI_REFRESH_TOKEN")
        return
    
    print("\n" + "=" * 60)
    print("\n🔌 Testing Connection...\n")
    
    # Test 1: Connection Test
    print("1️⃣ Running Full Connection Test...")
    try:
        result = await amazon_spapi_service.test_connection()
        
        if result.get("success"):
            print("   ✅ Connection Test PASSED!")
            print(f"   Environment: {'Sandbox' if result.get('is_sandbox') else 'Production'}")
            print(f"   Base URL: {result.get('base_url')}")
            print(f"   Token Status: {result.get('token_status')}")
            
            sellers_info = result.get("sellers_info", {})
            if sellers_info.get("success"):
                seller = sellers_info.get("seller_info", {})
                print(f"\n   📊 Seller Information:")
                print(f"      Seller ID: {seller.get('seller_id', 'N/A')}")
                print(f"      Seller Name: {seller.get('seller_name', 'N/A')}")
                print(f"      Marketplaces: {sellers_info.get('total_marketplaces', 0)}")
                
                for mp in sellers_info.get("marketplaces", [])[:3]:
                    print(f"        - {mp.get('name', 'Unknown')} ({mp.get('id', 'N/A')})")
            
            inventory_test = result.get("inventory_test", {})
            if inventory_test.get("success"):
                print(f"\n   📦 Inventory Test:")
                print(f"      Total Items: {inventory_test.get('total_items', 0)}")
                print(f"      ✅ Inventory API Access: WORKING")
            else:
                print(f"\n   📦 Inventory Test:")
                print(f"      ⚠️  Inventory API: {inventory_test.get('error', 'No access or no data')}")
                if inventory_test.get("optional"):
                    print(f"      (This is optional - you may not have inventory permissions)")
            
            print("\n" + "=" * 60)
            print("\n2️⃣ Testing Sellers API Directly...")
            
            # Test 2: Sellers Info
            sellers_result = await amazon_spapi_service.get_sellers_info()
            if sellers_result.get("success"):
                print("   ✅ Sellers API: WORKING")
                print(f"   Response includes {sellers_result.get('total_marketplaces', 0)} marketplace(s)")
                print(f"\n   Raw Response Preview:")
                raw = sellers_result.get("raw_response", {})
                print(f"   {json.dumps(raw, indent=2)[:500]}...")
            else:
                print(f"   ❌ Sellers API: FAILED")
                print(f"   Error: {sellers_result.get('error')}")
            
            print("\n" + "=" * 60)
            print("\n3️⃣ Testing Inventory API Directly...")
            
            # Test 3: Inventory
            try:
                inventory_result = await amazon_spapi_service.get_inventory_summaries()
                if inventory_result.get("success"):
                    print("   ✅ Inventory API: WORKING")
                    print(f"   Total Items Found: {inventory_result.get('total_items', 0)}")
                    summaries = inventory_result.get("inventory_summaries", [])
                    if summaries:
                        print(f"\n   Sample Items (first {min(3, len(summaries))}):")
                        for item in summaries[:3]:
                            print(f"      - SKU: {item.get('sellerSku', 'N/A')}, ASIN: {item.get('asin', 'N/A')}")
                else:
                    print(f"   ⚠️  Inventory API: {inventory_result.get('error', 'No access')}")
            except Exception as inv_error:
                print(f"   ⚠️  Inventory API: {str(inv_error)}")
                print("   (This may be normal if you don't have inventory permissions)")
            
            print("\n" + "=" * 60)
            print("\n✅ ALL TESTS COMPLETED!")
            print("\n🎉 Amazon SP-API is connected and working with REAL DATA!")
            print("\nSummary:")
            print(f"  ✅ Token Refresh: WORKING")
            print(f"  ✅ Sellers API: {'WORKING' if sellers_info.get('success') else 'FAILED'}")
            print(f"  {'✅' if inventory_test.get('success') else '⚠️ '} Inventory API: {'WORKING' if inventory_test.get('success') else 'Limited or No Access'}")
            
        else:
            print("   ❌ Connection Test FAILED!")
            print(f"   Error: {result.get('error')}")
            print(f"   Details: {result.get('details')}")
            return
            
    except Exception as e:
        print(f"   ❌ Connection Test FAILED with exception!")
        print(f"   Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return

if __name__ == "__main__":
    asyncio.run(main())
