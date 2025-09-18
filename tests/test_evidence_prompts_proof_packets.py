"""
Unit Tests for Evidence Prompts & Proof Packets
Phase 4: Smart Prompts & Proof Packets for Evidence Validator
"""

import pytest
import asyncio
import json
from datetime import datetime, timedelta
from unittest.mock import Mock, patch, AsyncMock
from fastapi.testclient import TestClient

from src.api.schemas import (
    SmartPromptRequest, SmartPromptAnswer, AuditAction, 
    PromptStatus, PacketStatus
)
from src.evidence.smart_prompt_service_v2 import SmartPromptServiceV2
from src.evidence.proof_packet_worker import ProofPacketWorker
from src.websocket.websocket_manager import WebSocketManager

class TestSmartPromptServiceV2:
    """Test cases for Smart Prompt Service V2"""
    
    @pytest.fixture
    def service(self):
        """Create service instance with mocked dependencies"""
        service = SmartPromptServiceV2()
        service.db = Mock()
        service.websocket_manager = Mock()
        return service
    
    @pytest.fixture
    def mock_request(self):
        """Create mock smart prompt request"""
        return SmartPromptRequest(
            claim_id="test-claim-123",
            question="Is this invoice related to your Amazon order?",
            options=[
                {"id": "yes", "text": "Yes", "action": "confirm_evidence"},
                {"id": "no", "text": "No", "action": "reject_evidence"}
            ],
            expiry_hours=24,
            metadata={"source": "test"}
        )
    
    @pytest.mark.asyncio
    async def test_create_smart_prompt_success(self, service, mock_request):
        """Test successful smart prompt creation"""
        # Mock database operations
        service.db._get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value.execute = Mock()
        
        # Mock audit logging
        service._log_audit_event = AsyncMock()
        
        # Mock WebSocket broadcasting
        service._broadcast_prompt_event = AsyncMock()
        
        # Execute
        result = await service.create_smart_prompt(
            request=mock_request,
            user_id="test-user-123",
            ip_address="192.168.1.1",
            user_agent="test-agent"
        )
        
        # Assertions
        assert result.prompt_id is not None
        assert result.claim_id == "test-claim-123"
        assert result.question == mock_request.question
        assert result.status == PromptStatus.PENDING
        assert result.expires_at is not None
        
        # Verify audit logging was called
        service._log_audit_event.assert_called_once()
        
        # Verify WebSocket broadcasting was called
        service._broadcast_prompt_event.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_answer_smart_prompt_success(self, service):
        """Test successful smart prompt answering"""
        # Mock prompt data
        mock_prompt = {
            "id": "test-prompt-123",
            "claim_id": "test-claim-123",
            "user_id": "test-user-123",
            "question": "Test question?",
            "options": [
                {"id": "yes", "text": "Yes", "action": "confirm_evidence"},
                {"id": "no", "text": "No", "action": "reject_evidence"}
            ],
            "status": "pending",
            "expires_at": (datetime.utcnow() + timedelta(hours=1)).isoformat() + "Z"
        }
        
        # Mock database operations
        service._get_smart_prompt = AsyncMock(return_value=mock_prompt)
        service._update_prompt_answer = AsyncMock()
        service._process_prompt_action = AsyncMock(return_value={
            "action": "evidence_confirmed",
            "message": "Evidence confirmed and linked to claim"
        })
        
        # Mock audit logging and broadcasting
        service._log_audit_event = AsyncMock()
        service._broadcast_prompt_event = AsyncMock()
        
        # Create answer
        answer = SmartPromptAnswer(
            selected_option="yes",
            reasoning="This invoice matches my order"
        )
        
        # Execute
        result = await service.answer_smart_prompt(
            prompt_id="test-prompt-123",
            answer=answer,
            user_id="test-user-123"
        )
        
        # Assertions
        assert result.success is True
        assert result.prompt_id == "test-prompt-123"
        assert result.action_taken == "evidence_confirmed"
        
        # Verify database update was called
        service._update_prompt_answer.assert_called_once()
        
        # Verify audit logging was called
        service._log_audit_event.assert_called_once()
        
        # Verify WebSocket broadcasting was called
        service._broadcast_prompt_event.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_answer_smart_prompt_expired(self, service):
        """Test answering an expired smart prompt"""
        # Mock expired prompt
        mock_prompt = {
            "id": "test-prompt-123",
            "claim_id": "test-claim-123",
            "user_id": "test-user-123",
            "question": "Test question?",
            "options": [],
            "status": "pending",
            "expires_at": (datetime.utcnow() - timedelta(hours=1)).isoformat() + "Z"
        }
        
        service._get_smart_prompt = AsyncMock(return_value=mock_prompt)
        
        answer = SmartPromptAnswer(selected_option="yes")
        
        # Execute
        result = await service.answer_smart_prompt(
            prompt_id="test-prompt-123",
            answer=answer,
            user_id="test-user-123"
        )
        
        # Assertions
        assert result.success is False
        assert result.action_taken == "expired"
        assert "expired" in result.message.lower()
    
    @pytest.mark.asyncio
    async def test_cleanup_expired_prompts(self, service):
        """Test cleanup of expired prompts"""
        # Mock database operations
        mock_cursor = Mock()
        mock_cursor.fetchall.return_value = [
            ("prompt-1", "claim-1", "user-1"),
            ("prompt-2", "claim-2", "user-2")
        ]
        mock_cursor.rowcount = 2
        
        service.db._get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
        
        # Mock audit logging and broadcasting
        service._log_audit_event = AsyncMock()
        service._broadcast_prompt_event = AsyncMock()
        
        # Execute
        result = await service.cleanup_expired_prompts()
        
        # Assertions
        assert result == 2
        
        # Verify audit logging was called for each expired prompt
        assert service._log_audit_event.call_count == 2
        
        # Verify WebSocket broadcasting was called for each expired prompt
        assert service._broadcast_prompt_event.call_count == 2

class TestProofPacketWorker:
    """Test cases for Proof Packet Worker"""
    
    @pytest.fixture
    def worker(self):
        """Create worker instance with mocked dependencies"""
        worker = ProofPacketWorker()
        worker.db = Mock()
        worker.s3_manager = Mock()
        worker.bucket_name = "test-bucket"
        return worker
    
    @pytest.fixture
    def mock_packet_data(self):
        """Create mock proof packet data"""
        return {
            "claim_id": "test-claim-123",
            "user_id": "test-user-123",
            "claim_details": {
                "id": "test-claim-123",
                "order_id": "ORDER-123",
                "dispute_type": "lost_inventory",
                "amount_claimed": 100.00,
                "currency": "USD"
            },
            "evidence_documents": [
                {
                    "id": "doc-1",
                    "filename": "invoice.pdf",
                    "content_type": "application/pdf",
                    "download_url": "s3://bucket/doc-1.pdf"
                }
            ],
            "evidence_matches": [],
            "prompts": [],
            "payout_details": {
                "amount": 100.00,
                "currency": "USD",
                "payout_date": "2025-01-07T00:00:00Z"
            }
        }
    
    @pytest.mark.asyncio
    async def test_generate_proof_packet_success(self, worker, mock_packet_data):
        """Test successful proof packet generation"""
        # Mock database operations
        worker._create_proof_packet_record = AsyncMock(return_value="packet-123")
        worker._collect_claim_data = AsyncMock(return_value=mock_packet_data)
        worker._generate_pdf_summary = AsyncMock(return_value="s3://bucket/packet-123/summary.pdf")
        worker._generate_zip_archive = AsyncMock(return_value="s3://bucket/packet-123/proof_packet.zip")
        worker._update_proof_packet_record = AsyncMock()
        worker._log_audit_event = AsyncMock()
        
        # Execute
        result = await worker.generate_proof_packet(
            claim_id="test-claim-123",
            user_id="test-user-123",
            payout_details=mock_packet_data["payout_details"]
        )
        
        # Assertions
        assert result["success"] is True
        assert result["packet_id"] == "packet-123"
        assert "pdf_url" in result
        assert "zip_url" in result
        assert "generated_at" in result
        
        # Verify all methods were called
        worker._create_proof_packet_record.assert_called_once()
        worker._collect_claim_data.assert_called_once()
        worker._generate_pdf_summary.assert_called_once()
        worker._generate_zip_archive.assert_called_once()
        worker._update_proof_packet_record.assert_called_once()
        worker._log_audit_event.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_generate_proof_packet_failure(self, worker):
        """Test proof packet generation failure"""
        # Mock database operations
        worker._create_proof_packet_record = AsyncMock(return_value="packet-123")
        worker._collect_claim_data = AsyncMock(side_effect=Exception("Database error"))
        worker._update_proof_packet_record = AsyncMock()
        worker._log_audit_event = AsyncMock()
        
        # Execute
        result = await worker.generate_proof_packet(
            claim_id="test-claim-123",
            user_id="test-user-123"
        )
        
        # Assertions
        assert result["success"] is False
        assert "error" in result
        assert "Database error" in result["error"]
        
        # Verify error handling
        worker._update_proof_packet_record.assert_called_once()
        worker._log_audit_event.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_proof_packet_url_success(self, worker):
        """Test successful proof packet URL retrieval"""
        # Mock database query
        mock_cursor = Mock()
        mock_cursor.fetchone.return_value = ("s3://bucket/packet-123.zip", "completed")
        worker.db._get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
        
        # Mock S3 operations
        worker.s3_manager.generate_presigned_url = AsyncMock(return_value="https://signed-url.com")
        worker._log_audit_event = AsyncMock()
        
        # Execute
        result = await worker.get_proof_packet_url(
            claim_id="test-claim-123",
            user_id="test-user-123",
            hours_valid=24
        )
        
        # Assertions
        assert result == "https://signed-url.com"
        
        # Verify S3 operations
        worker.s3_manager.generate_presigned_url.assert_called_once()
        worker._log_audit_event.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_proof_packet_url_not_found(self, worker):
        """Test proof packet URL retrieval when packet not found"""
        # Mock database query returning None
        mock_cursor = Mock()
        mock_cursor.fetchone.return_value = None
        worker.db._get_connection.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = mock_cursor
        
        # Execute
        result = await worker.get_proof_packet_url(
            claim_id="test-claim-123",
            user_id="test-user-123"
        )
        
        # Assertions
        assert result is None

class TestWebSocketManager:
    """Test cases for WebSocket Manager"""
    
    @pytest.fixture
    def manager(self):
        """Create WebSocket manager instance"""
        return WebSocketManager()
    
    @pytest.fixture
    def mock_websocket(self):
        """Create mock WebSocket connection"""
        websocket = Mock()
        websocket.accept = AsyncMock()
        websocket.send_text = AsyncMock()
        websocket.receive_text = AsyncMock()
        return websocket
    
    def test_connect_and_disconnect(self, manager, mock_websocket):
        """Test WebSocket connection and disconnection"""
        user_id = "test-user-123"
        
        # Test connection
        asyncio.run(manager.connect(mock_websocket, user_id))
        
        assert user_id in manager.active_connections
        assert mock_websocket in manager.active_connections[user_id]
        assert mock_websocket in manager.connection_metadata
        
        # Test disconnection
        manager.disconnect(mock_websocket)
        
        assert user_id not in manager.active_connections
        assert mock_websocket not in manager.connection_metadata
    
    @pytest.mark.asyncio
    async def test_broadcast_to_user(self, manager, mock_websocket):
        """Test broadcasting to a specific user"""
        user_id = "test-user-123"
        
        # Connect user
        await manager.connect(mock_websocket, user_id)
        
        # Broadcast message
        await manager.broadcast_to_user(user_id, "test.event", {"message": "test"})
        
        # Verify message was sent
        mock_websocket.send_text.assert_called()
        call_args = mock_websocket.send_text.call_args[0][0]
        message = json.loads(call_args)
        assert message["event"] == "test.event"
        assert message["data"]["message"] == "test"
    
    @pytest.mark.asyncio
    async def test_handle_client_message_ping(self, manager, mock_websocket):
        """Test handling ping message from client"""
        user_id = "test-user-123"
        
        # Connect user
        await manager.connect(mock_websocket, user_id)
        
        # Mock ping message
        mock_websocket.receive_text.return_value = json.dumps({"type": "ping"})
        
        # Handle message
        await manager._handle_client_message(mock_websocket, user_id, {"type": "ping"})
        
        # Verify pong response
        mock_websocket.send_text.assert_called()
        call_args = mock_websocket.send_text.call_args[0][0]
        message = json.loads(call_args)
        assert message["event"] == "pong"
    
    def test_get_connection_count(self, manager, mock_websocket):
        """Test getting connection count"""
        user_id = "test-user-123"
        
        # Initially no connections
        assert manager.get_connection_count() == 0
        
        # Connect user
        asyncio.run(manager.connect(mock_websocket, user_id))
        
        # Should have 1 connection
        assert manager.get_connection_count() == 1
        
        # Disconnect
        manager.disconnect(mock_websocket)
        
        # Should have 0 connections
        assert manager.get_connection_count() == 0

class TestIntegration:
    """Integration tests for the complete flow"""
    
    @pytest.mark.asyncio
    async def test_complete_prompt_flow(self):
        """Test complete smart prompt flow from creation to answer"""
        # This would test the complete flow:
        # 1. Create smart prompt
        # 2. Answer prompt
        # 3. Generate proof packet
        # 4. Verify audit logging
        # 5. Verify WebSocket events
        
        # Implementation would go here
        pass
    
    @pytest.mark.asyncio
    async def test_prompt_expiry_cleanup(self):
        """Test automatic cleanup of expired prompts"""
        # This would test:
        # 1. Create prompts with short expiry
        # 2. Wait for expiry
        # 3. Run cleanup
        # 4. Verify prompts are marked as expired
        # 5. Verify WebSocket events are sent
        
        # Implementation would go here
        pass
    
    @pytest.mark.asyncio
    async def test_proof_packet_generation_after_payout(self):
        """Test proof packet generation after payout confirmation"""
        # This would test:
        # 1. Create claim with evidence
        # 2. Simulate payout confirmation
        # 3. Trigger proof packet generation
        # 4. Verify PDF and ZIP are created
        # 5. Verify S3 upload
        # 6. Verify audit logging
        
        # Implementation would go here
        pass

if __name__ == "__main__":
    pytest.main([__file__])
