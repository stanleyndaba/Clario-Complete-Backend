#!/usr/bin/env python3
"""
Evidence Matching Engine Test Suite
Tests Phase 3 of Evidence Validator - Hybrid matching engine
"""

import asyncio
import httpx
import json
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any

# Test configuration
BASE_URL = "http://localhost:8000"
TEST_USER_ID = "test_user_123"

class EvidenceMatchingTester:
    """Test suite for Evidence Matching Engine"""
    
    def __init__(self):
        self.base_url = BASE_URL
        self.session = httpx.AsyncClient()
        self.test_results = []
    
    async def run_all_tests(self):
        """Run all Evidence Matching tests"""
        print("🧪 Starting Evidence Matching Engine Tests...")
        print("=" * 60)
        
        # Test 1: API Endpoints Discovery
        await self.test_api_endpoints_discovery()
        
        # Test 2: Matching Engine Module Imports
        await self.test_matching_engine_imports()
        
        # Test 3: Database Schema Validation
        await self.test_database_schema_validation()
        
        # Test 4: Auto-Submit Service
        await self.test_auto_submit_service()
        
        # Test 5: Smart Prompts Service
        await self.test_smart_prompts_service()
        
        # Test 6: Matching Worker
        await self.test_matching_worker()
        
        # Test 7: Feature Flags and Configuration
        await self.test_feature_flags()
        
        # Test 8: Metrics and Monitoring
        await self.test_metrics_monitoring()
        
        # Print results
        self.print_test_results()
    
    async def test_api_endpoints_discovery(self):
        """Test 1: Verify all Evidence Matching API endpoints exist"""
        print("🔍 Test 1: API Endpoints Discovery")
        
        expected_endpoints = [
            "POST /api/internal/evidence/auto-submit",
            "POST /api/internal/events/smart-prompts/{prompt_id}/answer",
            "GET /api/internal/evidence/smart-prompts",
            "POST /api/internal/evidence/smart-prompts/{prompt_id}/dismiss",
            "POST /api/internal/evidence/matching/start",
            "GET /api/internal/evidence/matching/jobs/{job_id}",
            "GET /api/internal/evidence/matching/metrics",
            "GET /api/internal/evidence/auto-submit/metrics",
            "POST /api/internal/evidence/matching/run",
            "GET /api/internal/evidence/disputes"
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
    
    async def test_matching_engine_imports(self):
        """Test 2: Test matching engine module imports"""
        print("📦 Test 2: Matching Engine Module Imports")
        
        try:
            # Test matching engine
            from src.evidence.matching_engine import EvidenceMatchingEngine
            matching_engine = EvidenceMatchingEngine()
            print("  ✅ Matching engine imported successfully")
            
            # Test auto-submit service
            from src.evidence.auto_submit_service import AutoSubmitService
            auto_submit_service = AutoSubmitService()
            print("  ✅ Auto-submit service imported successfully")
            
            # Test smart prompts service
            from src.evidence.smart_prompts_service import SmartPromptsService
            smart_prompts_service = SmartPromptsService()
            print("  ✅ Smart prompts service imported successfully")
            
            # Test matching worker
            from src.evidence.matching_worker import EvidenceMatchingWorker
            matching_worker = EvidenceMatchingWorker()
            print("  ✅ Matching worker imported successfully")
            
            self.test_results.append(("Matching Engine Module Imports", "PASS", "All matching engine modules imported successfully"))
            
        except Exception as e:
            self.test_results.append(("Matching Engine Module Imports", "FAIL", f"Import error: {str(e)}"))
        
        print()
    
    async def test_database_schema_validation(self):
        """Test 3: Validate database schema for Evidence Matching"""
        print("🗄️ Test 3: Database Schema Validation")
        
        try:
            from src.common.db_postgresql import DatabaseManager
            
            # Initialize database manager
            db = DatabaseManager()
            
            # Check if matching tables exist
            with db._get_connection() as conn:
                with conn.cursor() as cursor:
                    # Check dispute_cases table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'dispute_cases'
                        );
                    """)
                    disputes_exists = cursor.fetchone()[0]
                    
                    # Check dispute_evidence_links table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'dispute_evidence_links'
                        );
                    """)
                    links_exists = cursor.fetchone()[0]
                    
                    # Check smart_prompts table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'smart_prompts'
                        );
                    """)
                    prompts_exists = cursor.fetchone()[0]
                    
                    # Check evidence_matching_jobs table
                    cursor.execute("""
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'evidence_matching_jobs'
                        );
                    """)
                    jobs_exists = cursor.fetchone()[0]
                    
                    tables_exist = [disputes_exists, links_exists, prompts_exists, jobs_exists]
                    table_names = ["dispute_cases", "dispute_evidence_links", "smart_prompts", "evidence_matching_jobs"]
                    
                    if all(tables_exist):
                        self.test_results.append(("Database Schema Validation", "PASS", "All matching engine tables exist"))
                    else:
                        missing_tables = [name for exists, name in zip(tables_exist, table_names) if not exists]
                        self.test_results.append(("Database Schema Validation", "FAIL", f"Missing tables: {missing_tables}"))
                        
        except Exception as e:
            self.test_results.append(("Database Schema Validation", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_auto_submit_service(self):
        """Test 4: Test auto-submit service functionality"""
        print("🚀 Test 4: Auto-Submit Service")
        
        try:
            from src.evidence.auto_submit_service import AutoSubmitService
            from src.api.schemas import AutoSubmitRequest
            
            auto_submit_service = AutoSubmitService()
            
            # Test service initialization
            if auto_submit_service:
                self.test_results.append(("Auto-Submit Service", "PASS", "Auto-submit service initialized successfully"))
            else:
                self.test_results.append(("Auto-Submit Service", "FAIL", "Failed to initialize auto-submit service"))
                
        except Exception as e:
            self.test_results.append(("Auto-Submit Service", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_smart_prompts_service(self):
        """Test 5: Test smart prompts service functionality"""
        print("💬 Test 5: Smart Prompts Service")
        
        try:
            from src.evidence.smart_prompts_service import SmartPromptsService
            
            smart_prompts_service = SmartPromptsService()
            
            # Test service initialization
            if smart_prompts_service:
                self.test_results.append(("Smart Prompts Service", "PASS", "Smart prompts service initialized successfully"))
            else:
                self.test_results.append(("Smart Prompts Service", "FAIL", "Failed to initialize smart prompts service"))
                
        except Exception as e:
            self.test_results.append(("Smart Prompts Service", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_matching_worker(self):
        """Test 6: Test matching worker functionality"""
        print("⚙️ Test 6: Matching Worker")
        
        try:
            from src.evidence.matching_worker import evidence_matching_worker
            
            # Test worker initialization
            if evidence_matching_worker:
                self.test_results.append(("Matching Worker", "PASS", "Matching worker initialized successfully"))
            else:
                self.test_results.append(("Matching Worker", "FAIL", "Failed to initialize matching worker"))
                
        except Exception as e:
            self.test_results.append(("Matching Worker", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_feature_flags(self):
        """Test 7: Test feature flags and configuration"""
        print("🚩 Test 7: Feature Flags and Configuration")
        
        try:
            from src.common.config import settings
            
            # Test feature flags
            auto_submit_flag = settings.FEATURE_FLAG_EV_AUTO_SUBMIT
            smart_prompts_flag = settings.FEATURE_FLAG_EV_SMART_PROMPTS
            
            # Test confidence thresholds
            auto_threshold = settings.EVIDENCE_CONFIDENCE_AUTO
            prompt_threshold = settings.EVIDENCE_CONFIDENCE_PROMPT
            
            if isinstance(auto_submit_flag, bool) and isinstance(smart_prompts_flag, bool):
                if 0.0 <= auto_threshold <= 1.0 and 0.0 <= prompt_threshold <= 1.0:
                    if auto_threshold > prompt_threshold:
                        self.test_results.append(("Feature Flags and Configuration", "PASS", 
                            f"Feature flags and thresholds configured correctly (auto: {auto_threshold}, prompt: {prompt_threshold})"))
                    else:
                        self.test_results.append(("Feature Flags and Configuration", "FAIL", 
                            "Auto-submit threshold should be higher than smart prompt threshold"))
                else:
                    self.test_results.append(("Feature Flags and Configuration", "FAIL", 
                        "Confidence thresholds should be between 0.0 and 1.0"))
            else:
                self.test_results.append(("Feature Flags and Configuration", "FAIL", 
                    "Feature flags should be boolean values"))
                
        except Exception as e:
            self.test_results.append(("Feature Flags and Configuration", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    async def test_metrics_monitoring(self):
        """Test 8: Test metrics and monitoring functionality"""
        print("📊 Test 8: Metrics and Monitoring")
        
        try:
            from src.evidence.matching_worker import evidence_matching_worker
            
            # Test metrics retrieval
            metrics = await evidence_matching_worker.get_user_metrics(TEST_USER_ID, 30)
            
            if isinstance(metrics, dict) and 'evidence_match_rate' in metrics:
                self.test_results.append(("Metrics and Monitoring", "PASS", 
                    f"Metrics system working - match rate: {metrics['evidence_match_rate']:.2f}"))
            else:
                self.test_results.append(("Metrics and Monitoring", "FAIL", "Failed to retrieve metrics"))
                
        except Exception as e:
            self.test_results.append(("Metrics and Monitoring", "FAIL", f"Exception: {str(e)}"))
        
        print()
    
    def print_test_results(self):
        """Print test results summary"""
        print("=" * 60)
        print("🧪 Evidence Matching Engine Test Results")
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
            print("🎉 All tests passed! Evidence Matching Engine is ready for production.")
        else:
            print("⚠️  Some tests failed. Please review and fix issues before deployment.")
        
        print("=" * 60)

async def main():
    """Main test runner"""
    tester = EvidenceMatchingTester()
    await tester.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())

