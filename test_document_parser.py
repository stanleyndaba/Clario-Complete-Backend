#!/usr/bin/env python3
"""
Document Parser Pipeline Test Suite
Tests Phase 2 of Evidence Validator - Structured invoice data extraction
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

class DocumentParserTester:
    """Test suite for Document Parser Pipeline"""
    
    def __init__(self):
        self.base_url = BASE_URL
        self.session = httpx.AsyncClient()
        self.test_results = []
    
    async def run_all_tests(self):
        """Run all Document Parser tests"""
        print("🧪 Starting Document Parser Pipeline Tests...")
        print("=" * 60)
        
        # Test 1: API Endpoints Discovery
        await self.test_api_endpoints_discovery()
        
        # Test 2: Parser Module Imports
        await self.test_parser_module_imports()
        
        # Test 3: Database Schema Validation
        await self.test_database_schema_validation()
        
        # Test 4: Parser Job Creation
        await self.test_parser_job_creation()
        
        # Test 5: Document Search Functionality
        await self.test_document_search()
        
        # Test 6: Parser Worker Functionality
        await self.test_parser_worker()
        
        # Test 7: Error Handling and Retry Logic
        await self.test_error_handling()
        
        # Print results
        self.print_test_results()
    
    async def test_api_endpoints_discovery(self):
        """Test 1: Verify all Document Parser API endpoints exist"""
        print("🔍 Test 1: API Endpoints Discovery")
        
        expected_endpoints = [
            "POST /api/v1/evidence/parse/{document_id}",
            "GET /api/v1/evidence/documents/{document_id}",
            "GET /api/v1/evidence/parse/jobs/{job_id}",
            "GET /api/v1/evidence/parse/jobs",
            "GET /api/v1/evidence/documents/search"
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
    
    async def test_parser_module_imports(self):
        """Test 2: Test parser module imports"""
        print("📦 Test 2: Parser Module Imports")
        
        try:
            # Test PDF parser
            from src.parsers.pdf_parser import PDFParser
            pdf_parser = PDFParser()
            print("  ✅ PDF parser imported successfully")
            
            # Test email parser
            from src.parsers.email_parser import EmailParser
            email_parser = EmailParser()
            print("  ✅ Email parser imported successfully")
            
            # Test image parser
            from src.parsers.image_parser import ImageParser
            image_parser = ImageParser()
            print("  ✅ Image parser imported successfully")
            
            # Test parser worker
            from src.parsers.parser_worker import ParserWorker
            parser_worker = ParserWorker()
            print("  ✅ Parser worker imported successfully")
            
            self.test_results.append(("Parser Module Imports", "PASS", "All parser modules imported successfully"))
            
        except Exception as e:
            self.test_results.append(("Parser Module Imports", "FAIL", f"Import error: {str(e)}"))
        
        print()
    
    async def test_database_schema_validation(self):
        """Test 3: Validate database schema for Document Parser"""
        print("🗄️ Test 3: Database Schema Validation")
        
        try:
            from src.common.db_postgresql import DatabaseManager
            
            # Initialize database manager
            db = DatabaseManager()
            
            # Check if parser tables exist
            with db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Check parser_jobs table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'parser_jobs'
                        );
                    """)
                    jobs_exists = cursor.fetchone()[0]
                    
                    # Check parser_job_results table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'parser_job_results'
                        );
                    """)
                    results_exists = cursor.fetchone()[0]
                    
                    # Check if evidence_documents has parser columns
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.columns 
                            WHERE table_schema = 'public' 
                            AND table_name = 'evidence_documents'
                            AND column_name = 'parsed_metadata'
                        );
                    """)
                    parsed_metadata_exists = cursor.fetchone()[0]
                    
                    tables_exist = [jobs_exists, results_exists, parsed_metadata_exists]
                    table_names = ["parser_jobs", "parser_job_results", "evidence_documents.parsed_metadata"]
                    
                    if all(tables_exist):
                        self.test_results.append(("Database Schema Validation", "PASS", "All parser tables and columns exist"))
                    else:
                        missing_tables = [name for exists, name in zip(tables_exist, table_names) if not exists]
                        self.test_results.append(("Database Schema Validation", "FAIL", f"Missing tables/columns: {missing_tables}"))
                        
        except Exception as e:
            self.test_results.append(("Database Schema Validation", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_parser_job_creation(self):
        """Test 4: Test parser job creation"""
        print("🔧 Test 4: Parser Job Creation")
        
        try:
            from src.parsers.parser_worker import parser_worker
            
            # Create a test parser job
            test_document_id = str(uuid.uuid4())
            test_user_id = TEST_USER_ID
            parser_type = "pdf"
            
            job_id = await parser_worker.create_parser_job(test_document_id, test_user_id, parser_type)
            
            if job_id:
                # Check if job was created
                job_status = await parser_worker.get_job_status(job_id)
                if job_status:
                    self.test_results.append(("Parser Job Creation", "PASS", f"Job {job_id} created successfully"))
                else:
                    self.test_results.append(("Parser Job Creation", "FAIL", "Job created but not found in database"))
            else:
                self.test_results.append(("Parser Job Creation", "FAIL", "Failed to create parser job")
                
        except Exception as e:
            self.test_results.append(("Parser Job Creation", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_document_search(self):
        """Test 5: Test document search functionality"""
        print("🔍 Test 5: Document Search Functionality")
        
        try:
            # Test search endpoint
            response = await self.session.get(
                f"{self.base_url}/api/v1/evidence/documents/search",
                headers={"Authorization": f"Bearer mock_jwt_token"},
                params={"supplier": "test", "limit": 10}
            )
            
            if response.status_code == 200:
                data = response.json()
                if "data" in data and "documents" in data["data"]:
                    self.test_results.append(("Document Search Functionality", "PASS", "Search endpoint responds correctly"))
                else:
                    self.test_results.append(("Document Search Functionality", "FAIL", "Invalid response format"))
            else:
                self.test_results.append(("Document Search Functionality", "FAIL", f"HTTP {response.status_code}: {response.text}"))
                
        except Exception as e:
            self.test_results.append(("Document Search Functionality", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_parser_worker(self):
        """Test 6: Test parser worker functionality"""
        print("⚙️ Test 6: Parser Worker Functionality")
        
        try:
            from src.parsers.parser_worker import parser_worker
            
            # Test getting pending jobs
            pending_jobs = await parser_worker._get_pending_jobs()
            if isinstance(pending_jobs, list):
                self.test_results.append(("Parser Worker Functionality", "PASS", f"Parser worker can retrieve {len(pending_jobs)} pending jobs"))
            else:
                self.test_results.append(("Parser Worker Functionality", "FAIL", "Failed to retrieve pending jobs"))
                
        except Exception as e:
            self.test_results.append(("Parser Worker Functionality", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_error_handling(self):
        """Test 7: Test error handling and retry logic"""
        print("🛡️ Test 7: Error Handling and Retry Logic")
        
        try:
            from src.parsers.parser_worker import parser_worker
            
            # Test retry logic
            retry_jobs = await parser_worker._get_retry_jobs()
            if isinstance(retry_jobs, list):
                self.test_results.append(("Error Handling and Retry Logic", "PASS", f"Retry logic working, {len(retry_jobs)} jobs in retry queue"))
            else:
                self.test_results.append(("Error Handling and Retry Logic", "FAIL", "Failed to retrieve retry jobs"))
                
        except Exception as e:
            self.test_results.append(("Error Handling and Retry Logic", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    def print_test_results(self):
        """Print test results summary"""
        print("=" * 60)
        print("🧪 Document Parser Pipeline Test Results")
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
            print("🎉 All tests passed! Document Parser Pipeline is ready for production.")
        else:
            print("⚠️  Some tests failed. Please review and fix issues before deployment.")
        
        print("=" * 60)

async def main():
    """Main test runner"""
    tester = DocumentParserTester()
    await tester.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())
