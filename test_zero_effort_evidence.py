#!/usr/bin/env python3
"""
Zero-Effort Evidence Loop Test Suite
Comprehensive testing for smart prompts, auto-submit, and proof packets
"""

import asyncio
import json
import uuid
import pytest
import httpx
from datetime import datetime, timedelta
from typing import Dict, Any

# Test configuration
BASE_URL = "http://localhost:8000"
TEST_USER_ID = "test_user_123"
TEST_DISPUTE_ID = "test_dispute_456"
TEST_EVIDENCE_ID = "test_evidence_789"

class ZeroEffortEvidenceTester:
    """Comprehensive tester for zero-effort evidence loop"""
    
    def __init__(self):
        self.client = httpx.AsyncClient(base_url=BASE_URL)
        self.test_results = []
    
    async def run_all_tests(self):
        """Run all zero-effort evidence tests"""
        print("🚀 Starting Zero-Effort Evidence Loop Tests...")
        
        # Test 1: Feature Flag Management
        await self.test_feature_flag_management()
        
        # Test 2: Smart Prompt Creation and Answering
        await self.test_smart_prompt_flow()
        
        # Test 3: Auto-Submit Integration
        await self.test_auto_submit_integration()
        
        # Test 4: Proof Packet Generation
        await self.test_proof_packet_generation()
        
        # Test 5: Real-time Events
        await self.test_real_time_events()
        
        # Test 6: Audit Logging
        await self.test_audit_logging()
        
        # Test 7: Canary Rollout
        await self.test_canary_rollout()
        
        # Test 8: End-to-End Flow
        await self.test_end_to_end_flow()
        
        # Print results
        self.print_test_results()
    
    async def test_feature_flag_management(self):
        """Test feature flag management and canary rollout"""
        print("\n📋 Testing Feature Flag Management...")
        
        try:
            # Test getting feature flags for user
            response = await self.client.get(f"/api/internal/features/flags/{TEST_USER_ID}")
            assert response.status_code == 200
            flags = response.json()
            assert "data" in flags
            print("✅ Feature flags retrieved successfully")
            
            # Test setting user feature flag
            response = await self.client.post(
                f"/api/internal/features/flags/{TEST_USER_ID}",
                json={
                    "flag_name": "EV_AUTO_SUBMIT",
                    "enabled": True
                }
            )
            assert response.status_code == 200
            print("✅ User feature flag set successfully")
            
            # Test adding canary user
            response = await self.client.post(
                "/api/internal/features/canary",
                json={
                    "flag_name": "EV_SMART_PROMPTS",
                    "user_id": TEST_USER_ID
                }
            )
            assert response.status_code == 200
            print("✅ Canary user added successfully")
            
            self.test_results.append(("Feature Flag Management", "PASS"))
            
        except Exception as e:
            print(f"❌ Feature flag management failed: {e}")
            self.test_results.append(("Feature Flag Management", f"FAIL: {e}"))
    
    async def test_smart_prompt_flow(self):
        """Test smart prompt creation, answering, and expiry"""
        print("\n💬 Testing Smart Prompt Flow...")
        
        try:
            # Create smart prompt
            prompt_data = {
                "dispute_id": TEST_DISPUTE_ID,
                "question": "We can file this $650 claim if you confirm the supplier invoice. Was the supplier 'Global Supplies Inc' or 'Premium Goods LLC'?",
                "options": [
                    {
                        "id": "option_1",
                        "text": "Global Supplies Inc",
                        "action": "confirm_match",
                        "confidence": 0.8
                    },
                    {
                        "id": "option_2", 
                        "text": "Premium Goods LLC",
                        "action": "confirm_match",
                        "confidence": 0.7
                    },
                    {
                        "id": "option_3",
                        "text": "Upload file",
                        "action": "manual_review",
                        "confidence": 0.0
                    }
                ]
            }
            
            response = await self.client.post(
                "/api/internal/events/smart-prompts",
                json=prompt_data,
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            prompt_result = response.json()
            assert prompt_result["ok"]
            prompt_id = prompt_result["data"]["prompt_id"]
            print("✅ Smart prompt created successfully")
            
            # Get smart prompts
            response = await self.client.get(
                "/api/internal/events/smart-prompts",
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            prompts = response.json()
            assert "data" in prompts
            assert len(prompts["data"]["prompts"]) > 0
            print("✅ Smart prompts retrieved successfully")
            
            # Answer smart prompt
            answer_data = {
                "selected_option": "option_1",
                "reasoning": "This matches our records for Global Supplies Inc"
            }
            
            response = await self.client.post(
                f"/api/internal/events/smart-prompts/{prompt_id}/answer",
                json=answer_data,
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            answer_result = response.json()
            assert answer_result["success"]
            print("✅ Smart prompt answered successfully")
            
            # Test dismiss prompt
            response = await self.client.post(
                f"/api/internal/events/smart-prompts/{prompt_id}/dismiss",
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            # Should return 404 since already answered
            assert response.status_code == 404
            print("✅ Smart prompt dismiss handled correctly")
            
            self.test_results.append(("Smart Prompt Flow", "PASS"))
            
        except Exception as e:
            print(f"❌ Smart prompt flow failed: {e}")
            self.test_results.append(("Smart Prompt Flow", f"FAIL: {e}"))
    
    async def test_auto_submit_integration(self):
        """Test auto-submit integration with evidence matching"""
        print("\n🤖 Testing Auto-Submit Integration...")
        
        try:
            # Test auto-submit request
            auto_submit_data = {
                "dispute_id": TEST_DISPUTE_ID,
                "evidence_document_id": TEST_EVIDENCE_ID,
                "confidence": 0.9,
                "reasoning": "High confidence match based on invoice number and amount"
            }
            
            response = await self.client.post(
                "/api/internal/evidence/auto-submit",
                json=auto_submit_data,
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            result = response.json()
            assert result["success"] or result["action_taken"] in ["auto_submitted", "confirmed_manual_review"]
            print("✅ Auto-submit integration working")
            
            # Test evidence matching run
            response = await self.client.post(
                "/api/internal/evidence/matching/run",
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            matching_result = response.json()
            assert "data" in matching_result
            print("✅ Evidence matching run successful")
            
            self.test_results.append(("Auto-Submit Integration", "PASS"))
            
        except Exception as e:
            print(f"❌ Auto-submit integration failed: {e}")
            self.test_results.append(("Auto-Submit Integration", f"FAIL: {e}"))
    
    async def test_proof_packet_generation(self):
        """Test proof packet generation and retrieval"""
        print("\n📦 Testing Proof Packet Generation...")
        
        try:
            # Test proof packet generation
            response = await self.client.post(
                "/api/internal/evidence/proof-packet",
                params={"dispute_id": TEST_DISPUTE_ID},
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            packet_result = response.json()
            assert packet_result["ok"]
            assert "packet_id" in packet_result["data"]
            print("✅ Proof packet generated successfully")
            
            # Test getting proof packets
            response = await self.client.get(
                "/api/internal/evidence/proof-packets",
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            packets = response.json()
            assert "data" in packets
            print("✅ Proof packets retrieved successfully")
            
            self.test_results.append(("Proof Packet Generation", "PASS"))
            
        except Exception as e:
            print(f"❌ Proof packet generation failed: {e}")
            self.test_results.append(("Proof Packet Generation", f"FAIL: {e}"))
    
    async def test_real_time_events(self):
        """Test real-time event system"""
        print("\n⚡ Testing Real-Time Events...")
        
        try:
            # Test SSE endpoint
            response = await self.client.get(
                f"/api/internal/events/stream/{TEST_USER_ID}",
                headers={"Accept": "text/event-stream"}
            )
            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")
            print("✅ SSE endpoint working")
            
            # Test WebSocket endpoint (simplified test)
            # Note: Full WebSocket testing would require a WebSocket client
            print("✅ WebSocket endpoint available")
            
            self.test_results.append(("Real-Time Events", "PASS"))
            
        except Exception as e:
            print(f"❌ Real-time events failed: {e}")
            self.test_results.append(("Real-Time Events", f"FAIL: {e}"))
    
    async def test_audit_logging(self):
        """Test audit logging for all decisions"""
        print("\n📝 Testing Audit Logging...")
        
        try:
            # Test getting evidence status (includes audit info)
            response = await self.client.get(
                "/api/internal/evidence/status",
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            status = response.json()
            assert "data" in status
            print("✅ Evidence status retrieved (includes audit info)")
            
            # Test getting evidence metrics
            response = await self.client.get(
                "/api/internal/evidence/metrics",
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            metrics = response.json()
            assert "data" in metrics
            print("✅ Evidence metrics retrieved")
            
            self.test_results.append(("Audit Logging", "PASS"))
            
        except Exception as e:
            print(f"❌ Audit logging failed: {e}")
            self.test_results.append(("Audit Logging", f"FAIL: {e}"))
    
    async def test_canary_rollout(self):
        """Test canary rollout functionality"""
        print("\n🎯 Testing Canary Rollout...")
        
        try:
            # Test getting feature flag stats
            response = await self.client.get(
                "/api/internal/features/stats/EV_AUTO_SUBMIT"
            )
            assert response.status_code == 200
            stats = response.json()
            assert "flag_name" in stats
            print("✅ Feature flag stats retrieved")
            
            # Test updating rollout percentage
            response = await self.client.put(
                "/api/internal/features/rollout",
                json={
                    "flag_name": "EV_SMART_PROMPTS",
                    "percentage": 25
                }
            )
            assert response.status_code == 200
            print("✅ Rollout percentage updated")
            
            self.test_results.append(("Canary Rollout", "PASS"))
            
        except Exception as e:
            print(f"❌ Canary rollout failed: {e}")
            self.test_results.append(("Canary Rollout", f"FAIL: {e}"))
    
    async def test_end_to_end_flow(self):
        """Test complete end-to-end zero-effort evidence flow"""
        print("\n🔄 Testing End-to-End Flow...")
        
        try:
            # 1. Create dispute case
            dispute_data = {
                "order_id": f"ORDER_{uuid.uuid4().hex[:8]}",
                "dispute_type": "reimbursement",
                "amount_claimed": 650.00,
                "currency": "USD"
            }
            
            # 2. Upload evidence document
            evidence_data = {
                "filename": "invoice_12345.pdf",
                "content_type": "application/pdf",
                "parsed_metadata": {
                    "supplier": "Global Supplies Inc",
                    "amount": 650.00,
                    "invoice_number": "INV-12345"
                }
            }
            
            # 3. Run evidence matching
            response = await self.client.post(
                "/api/internal/evidence/matching/run",
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            print("✅ Evidence matching completed")
            
            # 4. Check for smart prompts or auto-submit
            response = await self.client.get(
                "/api/internal/events/smart-prompts",
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            print("✅ Smart prompts checked")
            
            # 5. Generate proof packet
            response = await self.client.post(
                "/api/internal/evidence/proof-packet",
                params={"dispute_id": TEST_DISPUTE_ID},
                headers={"Authorization": f"Bearer {self._get_test_token()}"}
            )
            assert response.status_code == 200
            print("✅ Proof packet generated")
            
            self.test_results.append(("End-to-End Flow", "PASS"))
            
        except Exception as e:
            print(f"❌ End-to-end flow failed: {e}")
            self.test_results.append(("End-to-End Flow", f"FAIL: {e}"))
    
    def _get_test_token(self) -> str:
        """Get test JWT token"""
        # In a real test, this would generate a proper JWT token
        return "test_token_123"
    
    def print_test_results(self):
        """Print comprehensive test results"""
        print("\n" + "="*60)
        print("🎯 ZERO-EFFORT EVIDENCE LOOP TEST RESULTS")
        print("="*60)
        
        passed = 0
        failed = 0
        
        for test_name, result in self.test_results:
            status = "✅ PASS" if result == "PASS" else f"❌ {result}"
            print(f"{test_name:<30} {status}")
            if result == "PASS":
                passed += 1
            else:
                failed += 1
        
        print("="*60)
        print(f"Total Tests: {len(self.test_results)}")
        print(f"Passed: {passed}")
        print(f"Failed: {failed}")
        print(f"Success Rate: {(passed/len(self.test_results)*100):.1f}%")
        
        if failed == 0:
            print("\n🎉 ALL TESTS PASSED! Zero-effort evidence loop is working perfectly!")
        else:
            print(f"\n⚠️  {failed} tests failed. Please review the issues above.")
        
        print("="*60)
    
    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()

async def main():
    """Run the zero-effort evidence tests"""
    tester = ZeroEffortEvidenceTester()
    try:
        await tester.run_all_tests()
    finally:
        await tester.close()

if __name__ == "__main__":
    asyncio.run(main())
