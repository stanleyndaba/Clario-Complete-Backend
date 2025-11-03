"""
Test Service Router - Consolidated Test Runner Service
Routes from test-service
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
from datetime import datetime
import subprocess
import sys
import logging

logger = logging.getLogger(__name__)

# Create router
test_service_router = APIRouter(prefix="/api/v1/tests", tags=["Test Service"])

# Test files mapping
TEST_FILES = {
    "api_endpoints": "test_api_endpoints.py",
    "baseline_models": "test_baseline_models.py", 
    "document_parser": "test_document_parser.py",
    "evidence_matching": "test_evidence_matching.py",
    "evidence_validator": "test_evidence_validator.py",
    "zero_effort_evidence": "test_zero_effort_evidence.py",
    "evidence_prompts_proof_packets": "tests/test_evidence_prompts_proof_packets.py",
    "integration_acg": "tests/test_integration_acg.py",
    "analytics": "tests/analytics/test_analytics.py",
    "features": "tests/features/test_features.py",
    "security": "tests/security/test_security.py"
}

@test_service_router.get("/health")
async def health_check():
    """Health check endpoint for Test Service."""
    return {
        "status": "healthy",
        "service": "Test Service",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "available_tests": list(TEST_FILES.keys())
    }

@test_service_router.get("")
async def list_tests():
    """List all available test suites."""
    return {
        "success": True,
        "data": {
            "test_suites": list(TEST_FILES.keys()),
            "total_tests": len(TEST_FILES)
        }
    }

@test_service_router.post("/run/{test_name}")
async def run_test(test_name: str):
    """Run a specific test suite."""
    if test_name not in TEST_FILES:
        raise HTTPException(status_code=404, detail=f"Test '{test_name}' not found")
    
    test_file = TEST_FILES[test_name]
    
    try:
        logger.info(f"Running test: {test_name} ({test_file})")
        
        # Run the test
        result = subprocess.run(
            [sys.executable, "-m", "pytest", test_file, "-v", "--tb=short"],
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        return {
            "success": result.returncode == 0,
            "test_name": test_name,
            "test_file": test_file,
            "return_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "test_name": test_name,
            "error": "Test timed out after 5 minutes",
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Test execution failed: {e}")
        return {
            "success": False,
            "test_name": test_name,
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }

@test_service_router.post("/run-all")
async def run_all_tests():
    """Run all test suites."""
    results = {}
    
    for test_name in TEST_FILES.keys():
        try:
            result = await run_test(test_name)
            results[test_name] = result
        except Exception as e:
            results[test_name] = {
                "success": False,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
    
    # Calculate summary
    total_tests = len(results)
    passed_tests = sum(1 for r in results.values() if r.get("success", False))
    failed_tests = total_tests - passed_tests
    
    return {
        "success": failed_tests == 0,
        "summary": {
            "total_tests": total_tests,
            "passed": passed_tests,
            "failed": failed_tests,
            "success_rate": f"{(passed_tests/total_tests)*100:.1f}%"
        },
        "results": results,
        "timestamp": datetime.utcnow().isoformat()
    }

@test_service_router.get("/status")
async def get_test_status():
    """Get test service status."""
    return {
        "service": "Test Service",
        "status": "active",
        "available_tests": len(TEST_FILES),
        "test_files": TEST_FILES,
        "timestamp": datetime.utcnow().isoformat()
    }

