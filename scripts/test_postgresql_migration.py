#!/usr/bin/env python3
"""
Test script to verify PostgreSQL migration and database functionality
"""

import os
import sys
import json
from datetime import datetime

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))

from common.config import settings
from common.db_postgresql import DatabaseManager

def test_database_connection():
    """Test database connection"""
    print("Testing database connection...")
    try:
        db = DatabaseManager()
        print(f"✅ Connected to {settings.DB_TYPE} database: {settings.DB_URL}")
        return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False

def test_schema_creation():
    """Test that all tables exist"""
    print("\nTesting schema creation...")
    try:
        db = DatabaseManager()
        
        # Test table existence
        tables = ['claims', 'validations', 'filings', 'idempotency_keys', 'users', 'oauth_tokens']
        
        for table in tables:
            if db.is_postgresql:
                query = """
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    );
                """
                result = db._execute_query(query, (table,), fetch=True, fetch_one=True)
                exists = result['exists'] if result else False
            else:
                query = "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
                result = db._execute_query(query, (table,), fetch=True, fetch_one=True)
                exists = result is not None
            
            if exists:
                print(f"  ✅ Table '{table}' exists")
            else:
                print(f"  ❌ Table '{table}' missing")
                return False
        
        return True
    except Exception as e:
        print(f"❌ Schema test failed: {e}")
        return False

def test_data_operations():
    """Test basic CRUD operations"""
    print("\nTesting data operations...")
    try:
        db = DatabaseManager()
        
        # Test user operations
        test_user_id = "test_user_123"
        test_seller_id = "A2LXTEST123"
        test_company = "Test Company LLC"
        test_marketplaces = ["ATVPDKIKX0DER", "A1AMZEXAMPLE"]
        
        # Create user
        db.upsert_user(test_user_id, test_seller_id, test_company, test_marketplaces)
        print("  ✅ User created successfully")
        
        # Retrieve user
        user = db.get_user_by_amazon_seller_id(test_seller_id)
        if user and user['amazon_seller_id'] == test_seller_id:
            print("  ✅ User retrieved successfully")
        else:
            print("  ❌ User retrieval failed")
            return False
        
        # Test OAuth token operations
        test_token = "encrypted_test_token_123"
        db.save_oauth_token(test_user_id, "amazon", test_token, datetime.utcnow())
        print("  ✅ OAuth token saved successfully")
        
        # Retrieve token
        retrieved_token = db.get_oauth_token(test_user_id, "amazon")
        if retrieved_token == test_token:
            print("  ✅ OAuth token retrieved successfully")
        else:
            print("  ❌ OAuth token retrieval failed")
            return False
        
        # Test claim operations
        from common.schemas import ClaimDetection, ClaimMetadata
        test_claim = ClaimDetection(
            claim_id="test_claim_123",
            claim_type="lost_inventory",
            confidence=0.85,
            amount_estimate=150.50,
            quantity_affected=3,
            metadata=ClaimMetadata(
                sku="TEST-SKU-123",
                asin="B08TEST123",
                fulfillment_center="JFK8"
            )
        )
        
        db.upsert_claim(test_claim)
        print("  ✅ Claim created successfully")
        
        # Retrieve claim
        claim = db.load_claim("test_claim_123")
        if claim and claim['claim_id'] == "test_claim_123":
            print("  ✅ Claim retrieved successfully")
        else:
            print("  ❌ Claim retrieval failed")
            return False
        
        # Test validation operations
        from common.schemas import ValidationResult
        test_validation = ValidationResult(
            compliant=True,
            ml_validity_score=0.92,
            missing_evidence=[],
            reasons=["Strong evidence of lost inventory"],
            auto_file_ready=True,
            confidence_calibrated=0.88
        )
        
        db.save_validation("test_claim_123", test_validation)
        print("  ✅ Validation saved successfully")
        
        # Test idempotency
        db.save_idempotency("test_key_123", "test_claim_123")
        if db.idempotency_exists("test_key_123"):
            print("  ✅ Idempotency key saved and checked successfully")
        else:
            print("  ❌ Idempotency key test failed")
            return False
        
        return True
    except Exception as e:
        print(f"❌ Data operations test failed: {e}")
        return False

def test_performance():
    """Test database performance with multiple operations"""
    print("\nTesting performance...")
    try:
        db = DatabaseManager()
        
        # Create multiple test users
        start_time = datetime.now()
        for i in range(10):
            user_id = f"perf_test_user_{i}"
            seller_id = f"A2LXPERF{i:03d}"
            company = f"Performance Test Company {i}"
            marketplaces = ["ATVPDKIKX0DER"]
            
            db.upsert_user(user_id, seller_id, company, marketplaces)
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        print(f"  ✅ Created 10 users in {duration:.3f} seconds")
        
        # Test concurrent reads
        start_time = datetime.now()
        for i in range(10):
            seller_id = f"A2LXPERF{i:03d}"
            user = db.get_user_by_amazon_seller_id(seller_id)
            if not user:
                print(f"  ❌ Failed to retrieve user {seller_id}")
                return False
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        print(f"  ✅ Retrieved 10 users in {duration:.3f} seconds")
        
        return True
    except Exception as e:
        print(f"❌ Performance test failed: {e}")
        return False

def cleanup_test_data():
    """Clean up test data"""
    print("\nCleaning up test data...")
    try:
        db = DatabaseManager()
        
        # Clean up test users
        test_users = [f"perf_test_user_{i}" for i in range(10)] + ["test_user_123"]
        for user_id in test_users:
            if db.is_postgresql:
                db._execute_query("DELETE FROM users WHERE id = %s", (user_id,))
            else:
                db._execute_query("DELETE FROM users WHERE id = ?", (user_id,))
        
        # Clean up test claims
        if db.is_postgresql:
            db._execute_query("DELETE FROM claims WHERE claim_id = %s", ("test_claim_123",))
            db._execute_query("DELETE FROM idempotency_keys WHERE key = %s", ("test_key_123",))
        else:
            db._execute_query("DELETE FROM claims WHERE claim_id = ?", ("test_claim_123",))
            db._execute_query("DELETE FROM idempotency_keys WHERE key = ?", ("test_key_123",))
        
        print("  ✅ Test data cleaned up")
        return True
    except Exception as e:
        print(f"❌ Cleanup failed: {e}")
        return False

def main():
    """Main test function"""
    print("PostgreSQL Migration Test Suite")
    print("=" * 50)
    
    tests = [
        ("Database Connection", test_database_connection),
        ("Schema Creation", test_schema_creation),
        ("Data Operations", test_data_operations),
        ("Performance", test_performance),
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        print(f"\n🧪 Running {test_name}...")
        if test_func():
            passed += 1
        else:
            print(f"❌ {test_name} failed")
    
    # Cleanup
    cleanup_test_data()
    
    print("\n" + "=" * 50)
    print(f"Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! PostgreSQL migration is working correctly.")
        return 0
    else:
        print("❌ Some tests failed. Please check the errors above.")
        return 1

if __name__ == "__main__":
    exit(main())

