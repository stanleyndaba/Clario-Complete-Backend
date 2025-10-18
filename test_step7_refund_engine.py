"""
Step 7 Refund Engine Test - SANDBOX ONLY
Tests the complete claim filing workflow
"""

import asyncio
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.acg.filer import file_claim
from src.common.schemas import ClaimPacket
from datetime import datetime

async def test_step_7_refund_engine():
    "Test complete Step 7 refund engine workflow"
    print("🧪 TESTING STEP 7 REFUND ENGINE (SANDBOX ONLY)")
    
    # Create a test claim packet
    test_claim = ClaimPacket(
        claim_id="test-claim-001",
        order_id="123-4567890-1234567",
        asin="B08N5WRWNW",
        sku="TEST-SKU-001",
        claim_type="lost_inventory",
        amount_claimed=150.00,
        currency="USD",
        invoice_number="INV-2024-001",
        invoice_date="2024-01-15",
        supporting_documents=[
            {
                "document_type": "invoice",
                "document_id": "doc_001",
                "filename": "invoice_001.pdf"
            }
        ],
        evidence_summary="Inventory lost during FBA inbound shipment",
        seller_notes="Test claim for sandbox validation"
    )
    
    print(f"📦 Test Claim: {test_claim.claim_type} for ")
    print("🔄 Filing claim via Refund Engine...")
    
    try:
        # This should use the mock/sandbox adapter
        result = file_claim(test_claim.claim_id)
        
        print(f"✅ RESULT: {result.status}")
        print(f"📄 Message: {result.message}")
        if result.amazon_case_id:
            print(f"🎯 Amazon Case ID: {result.amazon_case_id}")
            
        # Verify it's using sandbox/mock
        if "MOCK" in result.message or "SANDBOX" in result.message:
            print("🔒 SECURITY: Operating in safe sandbox/mock mode")
        else:
            print("⚠️  WARNING: Check environment configuration")
            
        return result.success
        
    except Exception as e:
        print(f"❌ ERROR: {str(e)}")
        return False

if __name__ == "__main__":
    success = asyncio.run(test_step_7_refund_engine())
    if success:
        print("\n🎉 STEP 7 REFUND ENGINE: OPERATIONAL")
        print("   Ready for end-to-end sandbox testing")
    else:
        print("\n💥 STEP 7 REFUND ENGINE: NEEDS ATTENTION")
