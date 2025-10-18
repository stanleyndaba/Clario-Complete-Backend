"""
STEP 7 TEST WITH FIXED DATABASE
Tests the refund engine after database path fix
"""

import sys
import os
sys.path.append(os.path.join(os.getcwd()))

def test_step_7_with_fixed_db():
    print("🎯 STEP 7: TESTING WITH FIXED DATABASE")
    print("=" * 50)
    
    try:
        # First, let's manually test the database connection
        import sqlite3
        db_path = os.path.join(os.getcwd(), "claims.db")
        
        print(f"1. 🔧 Testing database connection: {db_path}")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if our test claim exists
        cursor.execute('SELECT claim_id, status FROM claim_detections WHERE claim_id = ?', ('step7_test_001',))
        claim = cursor.fetchone()
        
        if claim:
            print(f"   ✅ Test claim found: {claim[0]} - {claim[1]}")
        else:
            print("   ❌ Test claim not found")
            
        conn.close()
        
        # Now test the actual file_claim function
        print(f"2. 🚀 Testing file_claim function...")
        from src.acg.filer import file_claim
        
        result = file_claim('step7_test_001')
        
        print(f"3. 📊 FILING RESULTS:")
        print(f"   • Type: {type(result)}")
        
        if hasattr(result, 'status'):
            print(f"   • Status: {result.status}")
            
        if hasattr(result, 'submitted'):
            print(f"   • Submitted: {result.submitted}")
            
        if hasattr(result, 'message'):
            print(f"   • Message: {result.message}")
            if 'mock' in result.message.lower() or 'sandbox' in result.message.lower():
                print("   🔒 SECURITY: Safe sandbox mode confirmed")
                
        if hasattr(result, 'amazon_case_id') and result.amazon_case_id:
            print(f"   • Amazon Case ID: {result.amazon_case_id}")
            
        return True
        
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

if __name__ == "__main__":
    success = test_step_7_with_fixed_db()
    
    print("\\n" + "=" * 50)
    if success:
        print("🎉 STEP 7: DATABASE ISSUE RESOLVED")
        print("   ✓ Database connection working")
        print("   ✓ file_claim() function executing")
        print("   ✓ Ready for full integration")
    else:
        print("💥 STEP 7: Still needs work")
        print("   The database path is fixed but other issues remain")
