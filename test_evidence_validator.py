#!/usr/bin/env python3
"""
Evidence Validator (EV) Phase 1 Test Suite
Tests secure ingestion connectors for Gmail, Outlook, Drive, Dropbox
"""

import asyncio
import httpx
import json
import uuid
from datetime import datetime
from typing import Dict, Any

# Test configuration
BASE_URL = "http://localhost:8000"
TEST_USER_ID = "test_user_123"

class EvidenceValidatorTester:
    """Test suite for Evidence Validator Phase 1"""
    
    def __init__(self):
        self.base_url = BASE_URL
        self.session = httpx.AsyncClient()
        self.test_results = []
    
    async def run_all_tests(self):
        """Run all Evidence Validator tests"""
        print("🧪 Starting Evidence Validator Phase 1 Tests...")
        print("=" * 60)
        
        # Test 1: API Endpoints Discovery
        await self.test_api_endpoints_discovery()
        
        # Test 2: OAuth Connector Factory
        await self.test_oauth_connector_factory()
        
        # Test 3: Evidence Source Connection (Mock)
        await self.test_evidence_source_connection()
        
        # Test 4: Evidence Source Listing
        await self.test_evidence_source_listing()
        
        # Test 5: Evidence Document Listing
        await self.test_evidence_document_listing()
        
        # Test 6: Evidence Source Disconnection
        await self.test_evidence_source_disconnection()
        
        # Test 7: Database Schema Validation
        await self.test_database_schema_validation()
        
        # Print results
        self.print_test_results()
    
    async def test_api_endpoints_discovery(self):
        """Test 1: Verify all Evidence Validator API endpoints exist"""
        print("🔍 Test 1: API Endpoints Discovery")
        
        expected_endpoints = [
            "POST /api/v1/integrations/evidence/sources",
            "GET /api/v1/integrations/evidence/sources",
            "DELETE /api/v1/integrations/evidence/sources/{source_id}",
            "GET /api/v1/integrations/evidence/sources/{source_id}/documents",
            "GET /api/v1/integrations/evidence/documents",
            "GET /api/v1/integrations/evidence/sources/{source_id}/ingestion-jobs",
            "POST /api/v1/integrations/evidence/sources/{source_id}/sync"
        ]
        
        try:
            # Get OpenAPI schema
            response = await self.session.get(f"{self.base_url}/openapi.json")
            if response.status_code == 200:
                schema = response.json()
                paths = schema.get("paths", {})
                
                found_endpoints = []
                missing_endpoints = []
                
                for endpoint in expected_endpoints:
                    method, path = endpoint.split(" ", 1)
                    if path in paths and method.lower() in paths[path]:
                        found_endpoints.append(endpoint)
                    else:
                        missing_endpoints.append(endpoint)
                
                if len(found_endpoints) == len(expected_endpoints):
                    self.test_results.append(("API Endpoints Discovery", "PASS", f"All {len(expected_endpoints)} endpoints found"))
                else:
                    self.test_results.append(("API Endpoints Discovery", "FAIL", 
                        f"Found {len(found_endpoints)}/{len(expected_endpoints)} endpoints. Missing: {missing_endpoints}"))
            else:
                self.test_results.append(("API Endpoints Discovery", "FAIL", f"Failed to get OpenAPI schema: {response.status_code}"))
                
        except Exception as e:
            self.test_results.append(("API Endpoints Discovery", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_oauth_connector_factory(self):
        """Test 2: Test OAuth connector factory function"""
        print("🔧 Test 2: OAuth Connector Factory")
        
        try:
            # Test imports
            from src.evidence.oauth_connectors import get_connector
            
            # Test each provider
            providers = ["gmail", "outlook", "gdrive", "dropbox"]
            valid_connectors = 0
            
            for provider in providers:
                try:
                    connector = get_connector(provider, "test_id", "test_secret", "http://test.com/callback")
                    if connector:
                        valid_connectors += 1
                        print(f"  ✅ {provider} connector created successfully")
                    else:
                        print(f"  ❌ {provider} connector creation failed")
                except Exception as e:
                    print(f"  ❌ {provider} connector error: {e}")
            
            if valid_connectors == len(providers):
                self.test_results.append(("OAuth Connector Factory", "PASS", f"All {len(providers)} connectors created successfully"))
            else:
                self.test_results.append(("OAuth Connector Factory", "FAIL", f"Only {valid_connectors}/{len(providers)} connectors created"))
                
        except Exception as e:
            self.test_results.append(("OAuth Connector Factory", "FAIL", f"Import error: {str(e)}"))
        
        print()
    
    async def test_evidence_source_connection(self):
        """Test 3: Test evidence source connection (mock)"""
        print("🔗 Test 3: Evidence Source Connection (Mock)")
        
        try:
            # Test with mock OAuth code
            test_data = {
                "provider": "gmail",
                "oauth_code": "mock_oauth_code_123"
            }
            
            response = await self.session.post(
                f"{self.base_url}/api/v1/integrations/evidence/sources",
                json=test_data,
                headers={"Authorization": f"Bearer mock_jwt_token"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if "status" in data and "provider" in data and "account" in data:
                    self.test_results.append(("Evidence Source Connection", "PASS", "Connection endpoint responds correctly"))
                else:
                    self.test_results.append(("Evidence Source Connection", "FAIL", "Invalid response format"))
            else:
                self.test_results.append(("Evidence Source Connection", "FAIL", f"HTTP {response.status_code}: {response.text}"))
                
        except Exception as e:
            self.test_results.append(("Evidence Source Connection", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_evidence_source_listing(self):
        """Test 4: Test evidence source listing"""
        print("📋 Test 4: Evidence Source Listing")
        
        try:
            response = await self.session.get(
                f"{self.base_url}/api/v1/integrations/evidence/sources",
                headers={"Authorization": f"Bearer mock_jwt_token"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if "sources" in data and "total" in data:
                    self.test_results.append(("Evidence Source Listing", "PASS", "Listing endpoint responds correctly"))
                else:
                    self.test_results.append(("Evidence Source Listing", "FAIL", "Invalid response format"))
            else:
                self.test_results.append(("Evidence Source Listing", "FAIL", f"HTTP {response.status_code}: {response.text}"))
                
        except Exception as e:
            self.test_results.append(("Evidence Source Listing", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_evidence_document_listing(self):
        """Test 5: Test evidence document listing"""
        print("📄 Test 5: Evidence Document Listing")
        
        try:
            # Test all documents endpoint
            response = await self.session.get(
                f"{self.base_url}/api/v1/integrations/evidence/documents",
                headers={"Authorization": f"Bearer mock_jwt_token"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if "documents" in data and "total" in data and "pagination" in data:
                    self.test_results.append(("Evidence Document Listing", "PASS", "Document listing endpoint responds correctly"))
                else:
                    self.test_results.append(("Evidence Document Listing", "FAIL", "Invalid response format"))
            else:
                self.test_results.append(("Evidence Document Listing", "FAIL", f"HTTP {response.status_code}: {response.text}"))
                
        except Exception as e:
            self.test_results.append(("Evidence Document Listing", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_evidence_source_disconnection(self):
        """Test 6: Test evidence source disconnection"""
        print("🔌 Test 6: Evidence Source Disconnection")
        
        try:
            # Test with mock source ID
            mock_source_id = str(uuid.uuid4())
            
            response = await self.session.delete(
                f"{self.base_url}/api/v1/integrations/evidence/sources/{mock_source_id}",
                headers={"Authorization": f"Bearer mock_jwt_token"}
            )
            
            # Should return 404 for non-existent source, but endpoint should exist
            if response.status_code in [200, 404]:
                self.test_results.append(("Evidence Source Disconnection", "PASS", "Disconnection endpoint responds correctly"))
            else:
                self.test_results.append(("Evidence Source Disconnection", "FAIL", f"HTTP {response.status_code}: {response.text}"))
                
        except Exception as e:
            self.test_results.append(("Evidence Source Disconnection", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_database_schema_validation(self):
        """Test 7: Validate database schema for Evidence Validator"""
        print("🗄️ Test 7: Database Schema Validation")
        
        try:
            from src.common.db_postgresql import DatabaseManager
            
            # Initialize database manager
            db = DatabaseManager()
            
            # Check if evidence tables exist
            with db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Check evidence_sources table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'evidence_sources'
                        );
                    """)
                    sources_exists = cursor.fetchone()[0]
                    
                    # Check evidence_documents table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'evidence_documents'
                        );
                    """)
                    documents_exists = cursor.fetchone()[0]
                    
                    # Check evidence_ingestion_jobs table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'evidence_ingestion_jobs'
                        );
                    """)
                    jobs_exists = cursor.fetchone()[0]
                    
                    # Check evidence_matches table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'evidence_matches'
                        );
                    """)
                    matches_exists = cursor.fetchone()[0]
                    
                    tables_exist = [sources_exists, documents_exists, jobs_exists, matches_exists]
                    table_names = ["evidence_sources", "evidence_documents", "evidence_ingestion_jobs", "evidence_matches"]
                    
                    if all(tables_exist):
                        self.test_results.append(("Database Schema Validation", "PASS", "All evidence tables exist"))
                    else:
                        missing_tables = [name for exists, name in zip(tables_exist, table_names) if not exists]
                        self.test_results.append(("Database Schema Validation", "FAIL", f"Missing tables: {missing_tables}"))
                        
        except Exception as e:
            self.test_results.append(("Database Schema Validation", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    def print_test_results(self):
        """Print test results summary"""
        print("=" * 60)
        print("🧪 Evidence Validator Phase 1 Test Results")
        print("=" * 60)
        
        passed = sum(1 for _, status, _ in self.test_results if status == "PASS")
        total = len(self.test_results)
        
        for test_name, status, message in self.test_results:
            status_icon = "✅" if status == "PASS" else "❌"
            print(f"{status_icon} {test_name}: {status}")
            print(f"   {message}")
            print()
        
        print("=" * 60)
        print(f"📊 Summary: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 All tests passed! Evidence Validator Phase 1 is ready for production.")
        else:
            print("⚠️  Some tests failed. Please review and fix issues before deployment.")
        
        print("=" * 60)

async def main():
    """Main test runner"""
    tester = EvidenceValidatorTester()
    await tester.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())
