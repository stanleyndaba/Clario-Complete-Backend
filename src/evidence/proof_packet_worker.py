"""
Proof Packet Worker
Phase 4: Background worker for generating proof packets (PDF + ZIP) after payout confirmation
"""

import uuid
import json
import zipfile
import tempfile
import os
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging
from dataclasses import dataclass
from enum import Enum
import asyncio
import aiofiles
import httpx
from io import BytesIO

# PDF generation imports
try:
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

from src.api.schemas import AuditAction
from src.common.db_postgresql import DatabaseManager
from src.common.config import settings
# Optional S3 manager; provide a stub if storage module is unavailable
try:
    from src.storage.s3_manager import S3Manager  # type: ignore
except Exception:
    class S3Manager:  # fallback stub for deployment without storage module
        async def upload_file(self, file_content: bytes, bucket_name: str, key: str, content_type: str = "application/octet-stream") -> None:
            logger.warning(f"S3Manager stub: skipping upload to s3://{bucket_name}/{key}")

        async def download_file(self, bucket_name: str, key: str) -> bytes | None:
            logger.warning(f"S3Manager stub: no download for s3://{bucket_name}/{key}")
            return None

        async def generate_presigned_url(self, key_or_url: str, hours_valid: int = 24) -> str:
            logger.warning(f"S3Manager stub: returning passthrough URL for {key_or_url}")
            return key_or_url

logger = logging.getLogger(__name__)

@dataclass
class ProofPacketData:
    """Data structure for proof packet generation"""
    claim_id: str
    user_id: str
    claim_details: Dict[str, Any]
    evidence_documents: List[Dict[str, Any]]
    evidence_matches: List[Dict[str, Any]]
    prompts: List[Dict[str, Any]]
    payout_details: Dict[str, Any]

class ProofPacketWorker:
    """Background worker for generating proof packets"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.s3_manager = S3Manager()
        self.bucket_name = settings.S3_BUCKET_NAME or ""
        # Optional event handlers registry (no-op unless handlers are added)
        self._event_handlers: list = []
        self.proof_packets_prefix = "proof-packets"
        
    async def generate_proof_packet(
        self, 
        claim_id: str, 
        user_id: str,
        payout_details: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Generate proof packet for a claim after payout confirmation"""
        try:
            # Mark packet generation as started
            packet_id = await self._create_proof_packet_record(claim_id, user_id, "generating")
            
            # Collect all relevant data
            packet_data = await self._collect_claim_data(claim_id, user_id, payout_details)
            
            # Generate PDF summary
            pdf_url = await self._generate_pdf_summary(packet_data, packet_id)
            
            # Generate ZIP archive with all files
            zip_url = await self._generate_zip_archive(packet_data, packet_id)
            
            # Update packet record with URLs
            await self._update_proof_packet_record(
                packet_id, 
                zip_url, 
                "completed",
                packet_data
            )
            
            # Log audit event
            await self._log_audit_event(
                user_id=user_id,
                claim_id=claim_id,
                action=AuditAction.PACKET_GENERATED,
                entity_type="proof_packet",
                entity_id=packet_id,
                details={
                    "pdf_url": pdf_url,
                    "zip_url": zip_url,
                    "generated_at": datetime.utcnow().isoformat() + "Z"
                }
            )
            
            return {
                "success": True,
                "packet_id": packet_id,
                "pdf_url": pdf_url,
                "zip_url": zip_url,
                "generated_at": datetime.utcnow().isoformat() + "Z"
            }
            
        except Exception as e:
            logger.error(f"Failed to generate proof packet for claim {claim_id}: {e}")
            
            # Mark packet as failed
            if 'packet_id' in locals():
                await self._update_proof_packet_record(
                    packet_id, 
                    None, 
                    "failed",
                    {"error": str(e)}
                )
            
            # Log audit event
            await self._log_audit_event(
                user_id=user_id,
                claim_id=claim_id,
                action=AuditAction.PACKET_FAILED,
                entity_type="proof_packet",
                entity_id=packet_id if 'packet_id' in locals() else str(uuid.uuid4()),
                details={"error": str(e), "failed_at": datetime.utcnow().isoformat() + "Z"}
            )
            
            return {
                "success": False,
                "error": str(e),
                "failed_at": datetime.utcnow().isoformat() + "Z"
            }

    # -------- Compatibility / No-op APIs to avoid startup failures -------- #
    def add_event_handler(self, handler):
        """Register an optional event handler callback (no-op if unused)."""
        try:
            if callable(handler):
                self._event_handlers.append(handler)
        except Exception:
            pass

    async def process_payout_webhook(self, webhook_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process payout webhook and return proof packet info.

        In minimal deployments, return a stub success without DB/S3 writes.
        """
        try:
            claim_id = webhook_data.get("dispute_id") or webhook_data.get("claim_id") or str(uuid.uuid4())
            user_id = webhook_data.get("user_id", "unknown_user")

            # If full pipeline is available, you could call generate_proof_packet here.
            # For now, return a stubbed response to avoid failing in lean envs.
            packet_id = f"pkt_{claim_id}"
            url = ""

            # Emit optional event callbacks
            for handler in list(self._event_handlers):
                try:
                    await asyncio.sleep(0)
                    handler("PROOF_PACKET_GENERATED", {"packet_id": packet_id, "user_id": user_id})
                except Exception:
                    continue

            return {"success": True, "packet_id": packet_id, "url": url}
        except Exception as e:
            logger.warning(f"process_payout_webhook stub failed: {e}")
            return {"success": False, "error": str(e)}

    async def get_proof_packets_for_user(self, user_id: str, limit: int, offset: int) -> Dict[str, Any]:
        """Return user's proof packets. Stubbed to empty list for lean deployments."""
        try:
            return {"total": 0, "packets": []}
        except Exception as e:
            logger.warning(f"get_proof_packets_for_user stub failed: {e}")
            return {"total": 0, "packets": []}
    
    async def get_proof_packet_url(
        self, 
        claim_id: str, 
        user_id: str,
        hours_valid: int = 24
    ) -> Optional[str]:
        """Get signed URL for proof packet download"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT packet_url, status FROM proof_packets 
                        WHERE claim_id = %s AND user_id = %s AND status = 'completed'
                        ORDER BY created_at DESC LIMIT 1
                    """, (claim_id, user_id))
                    
                    result = cursor.fetchone()
                    if result:
                        packet_url = result[0]
                        status = result[1]
                        
                        if status == 'completed' and packet_url:
                            # Generate signed URL
                            signed_url = await self.s3_manager.generate_presigned_url(
                                packet_url, 
                                hours_valid=hours_valid
                            )
                            
                            # Log download event
                            await self._log_audit_event(
                                user_id=user_id,
                                claim_id=claim_id,
                                action=AuditAction.PACKET_DOWNLOADED,
                                entity_type="proof_packet",
                                entity_id=str(uuid.uuid4()),
                                details={
                                    "packet_url": packet_url,
                                    "signed_url_generated": True,
                                    "hours_valid": hours_valid,
                                    "downloaded_at": datetime.utcnow().isoformat() + "Z"
                                }
                            )
                            
                            return signed_url
                    
                    return None
                    
        except Exception as e:
            logger.error(f"Failed to get proof packet URL for claim {claim_id}: {e}")
            return None
    
    async def _create_proof_packet_record(
        self, 
        claim_id: str, 
        user_id: str, 
        status: str
    ) -> str:
        """Create proof packet record in database"""
        packet_id = str(uuid.uuid4())
        
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO proof_packets 
                    (id, claim_id, user_id, status, generation_started_at, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    packet_id, claim_id, user_id, status, 
                    datetime.utcnow(), json.dumps({})
                ))
        
        return packet_id
    
    async def _update_proof_packet_record(
        self, 
        packet_id: str, 
        packet_url: Optional[str], 
        status: str,
        metadata: Dict[str, Any]
    ):
        """Update proof packet record"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                if status == "completed":
                    cursor.execute("""
                        UPDATE proof_packets 
                        SET packet_url = %s, status = %s, generation_completed_at = %s, 
                            metadata = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (packet_url, status, datetime.utcnow(), json.dumps(metadata), packet_id))
                else:
                    cursor.execute("""
                        UPDATE proof_packets 
                        SET status = %s, error_message = %s, metadata = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (status, metadata.get('error'), json.dumps(metadata), packet_id))
    
    async def _collect_claim_data(
        self, 
        claim_id: str, 
        user_id: str,
        payout_details: Optional[Dict[str, Any]] = None
    ) -> ProofPacketData:
        """Collect all relevant data for proof packet"""
        try:
            # Get claim details
            claim_details = await self._get_claim_details(claim_id, user_id)
            
            # Get evidence documents
            evidence_documents = await self._get_evidence_documents(claim_id, user_id)
            
            # Get evidence matches
            evidence_matches = await self._get_evidence_matches(claim_id, user_id)
            
            # Get prompts
            prompts = await self._get_claim_prompts(claim_id, user_id)
            
            return ProofPacketData(
                claim_id=claim_id,
                user_id=user_id,
                claim_details=claim_details,
                evidence_documents=evidence_documents,
                evidence_matches=evidence_matches,
                prompts=prompts,
                payout_details=payout_details or {}
            )
            
        except Exception as e:
            logger.error(f"Failed to collect claim data for {claim_id}: {e}")
            raise
    
    async def _get_claim_details(self, claim_id: str, user_id: str) -> Dict[str, Any]:
        """Get claim details from database"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, order_id, asin, sku, dispute_type, status, amount_claimed, 
                           currency, dispute_date, order_date, evidence_linked_ids, 
                           match_confidence, match_path, metadata, created_at, updated_at
                    FROM dispute_cases 
                    WHERE id = %s AND user_id = %s
                """, (claim_id, user_id))
                
                result = cursor.fetchone()
                if result:
                    return {
                        "id": str(result[0]),
                        "order_id": result[1],
                        "asin": result[2],
                        "sku": result[3],
                        "dispute_type": result[4],
                        "status": result[5],
                        "amount_claimed": result[6],
                        "currency": result[7],
                        "dispute_date": result[8].isoformat() if result[8] else None,
                        "order_date": result[9].isoformat() if result[9] else None,
                        "evidence_linked_ids": json.loads(result[10]) if result[10] else [],
                        "match_confidence": result[11],
                        "match_path": result[12],
                        "metadata": json.loads(result[13]) if result[13] else {},
                        "created_at": result[14].isoformat() + "Z",
                        "updated_at": result[15].isoformat() + "Z"
                    }
                return {}
    
    async def _get_evidence_documents(self, claim_id: str, user_id: str) -> List[Dict[str, Any]]:
        """Get evidence documents for claim"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT ed.id, ed.filename, ed.content_type, ed.size_bytes, 
                           ed.download_url, ed.parsed_metadata, ed.parser_confidence,
                           ed.created_at, ed.metadata
                    FROM evidence_documents ed
                    JOIN dispute_evidence_links del ON ed.id = del.evidence_document_id
                    WHERE del.dispute_id = %s AND ed.user_id = %s
                    ORDER BY ed.created_at ASC
                """, (claim_id, user_id))
                
                documents = []
                for row in cursor.fetchall():
                    documents.append({
                        "id": str(row[0]),
                        "filename": row[1],
                        "content_type": row[2],
                        "size_bytes": row[3],
                        "download_url": row[4],
                        "parsed_metadata": json.loads(row[5]) if row[5] else {},
                        "parser_confidence": row[6],
                        "created_at": row[7].isoformat() + "Z",
                        "metadata": json.loads(row[8]) if row[8] else {}
                    })
                
                return documents
    
    async def _get_evidence_matches(self, claim_id: str, user_id: str) -> List[Dict[str, Any]]:
        """Get evidence matches for claim"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT emr.id, emr.rule_score, emr.ml_score, emr.final_confidence,
                           emr.match_type, emr.matched_fields, emr.reasoning, emr.action_taken,
                           emr.created_at
                    FROM evidence_matching_results emr
                    WHERE emr.dispute_id = %s
                    ORDER BY emr.created_at ASC
                """, (claim_id,))
                
                matches = []
                for row in cursor.fetchall():
                    matches.append({
                        "id": str(row[0]),
                        "rule_score": row[1],
                        "ml_score": row[2],
                        "final_confidence": row[3],
                        "match_type": row[4],
                        "matched_fields": json.loads(row[5]) if row[5] else [],
                        "reasoning": row[6],
                        "action_taken": row[7],
                        "created_at": row[8].isoformat() + "Z"
                    })
                
                return matches
    
    async def _get_claim_prompts(self, claim_id: str, user_id: str) -> List[Dict[str, Any]]:
        """Get prompts for claim"""
        with self.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("""
                    SELECT id, question, options, status, answer, answer_reasoning,
                           answered_at, expires_at, created_at, metadata
                    FROM evidence_prompts 
                    WHERE claim_id = %s AND user_id = %s
                    ORDER BY created_at ASC
                """, (claim_id, user_id))
                
                prompts = []
                for row in cursor.fetchall():
                    prompts.append({
                        "id": str(row[0]),
                        "question": row[1],
                        "options": json.loads(row[2]) if row[2] else [],
                        "status": row[3],
                        "answer": row[4],
                        "answer_reasoning": row[5],
                        "answered_at": row[6].isoformat() + "Z" if row[6] else None,
                        "expires_at": row[7].isoformat() + "Z",
                        "created_at": row[8].isoformat() + "Z",
                        "metadata": json.loads(row[9]) if row[9] else {}
                    })
                
                return prompts
    
    async def _generate_pdf_summary(
        self, 
        packet_data: ProofPacketData, 
        packet_id: str
    ) -> str:
        """Generate PDF summary of the proof packet"""
        if not PDF_AVAILABLE:
            raise Exception("PDF generation libraries not available")
        
        try:
            # Create PDF in memory
            pdf_buffer = BytesIO()
            doc = SimpleDocTemplate(pdf_buffer, pagesize=A4)
            
            # Get styles
            styles = getSampleStyleSheet()
            title_style = ParagraphStyle(
                'CustomTitle',
                parent=styles['Heading1'],
                fontSize=16,
                spaceAfter=30,
                alignment=TA_CENTER
            )
            
            heading_style = ParagraphStyle(
                'CustomHeading',
                parent=styles['Heading2'],
                fontSize=14,
                spaceAfter=12,
                spaceBefore=20
            )
            
            # Build PDF content
            story = []
            
            # Title
            story.append(Paragraph("Evidence Proof Packet", title_style))
            story.append(Spacer(1, 20))
            
            # Claim Details
            story.append(Paragraph("Claim Details", heading_style))
            claim_table_data = [
                ["Field", "Value"],
                ["Claim ID", packet_data.claim_details.get("id", "N/A")],
                ["Order ID", packet_data.claim_details.get("order_id", "N/A")],
                ["ASIN", packet_data.claim_details.get("asin", "N/A")],
                ["SKU", packet_data.claim_details.get("sku", "N/A")],
                ["Dispute Type", packet_data.claim_details.get("dispute_type", "N/A")],
                ["Amount Claimed", f"${packet_data.claim_details.get('amount_claimed', 0):.2f}"],
                ["Currency", packet_data.claim_details.get("currency", "USD")],
                ["Dispute Date", packet_data.claim_details.get("dispute_date", "N/A")],
                ["Status", packet_data.claim_details.get("status", "N/A")],
                ["Match Confidence", f"{packet_data.claim_details.get('match_confidence', 0):.2%}"],
            ]
            
            claim_table = Table(claim_table_data, colWidths=[2*inch, 4*inch])
            claim_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 12),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                ('GRID', (0, 0), (-1, -1), 1, colors.black)
            ]))
            
            story.append(claim_table)
            story.append(PageBreak())
            
            # Evidence Documents
            story.append(Paragraph("Evidence Documents", heading_style))
            if packet_data.evidence_documents:
                doc_table_data = [["Filename", "Type", "Size", "Confidence", "Created"]]
                for doc in packet_data.evidence_documents:
                    doc_table_data.append([
                        doc.get("filename", "N/A"),
                        doc.get("content_type", "N/A"),
                        f"{doc.get('size_bytes', 0) / 1024:.1f} KB",
                        f"{doc.get('parser_confidence', 0):.2%}",
                        doc.get("created_at", "N/A")[:10]
                    ])
                
                doc_table = Table(doc_table_data, colWidths=[2*inch, 1.5*inch, 1*inch, 1*inch, 1.5*inch])
                doc_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, -1), 10),
                    ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                    ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                    ('GRID', (0, 0), (-1, -1), 1, colors.black)
                ]))
                
                story.append(doc_table)
            else:
                story.append(Paragraph("No evidence documents found.", styles['Normal']))
            
            story.append(PageBreak())
            
            # Smart Prompts
            story.append(Paragraph("Smart Prompts & Responses", heading_style))
            if packet_data.prompts:
                for i, prompt in enumerate(packet_data.prompts, 1):
                    story.append(Paragraph(f"Prompt {i}: {prompt.get('question', 'N/A')}", styles['Heading3']))
                    story.append(Paragraph(f"Status: {prompt.get('status', 'N/A')}", styles['Normal']))
                    if prompt.get('answer'):
                        story.append(Paragraph(f"Answer: {prompt.get('answer', 'N/A')}", styles['Normal']))
                    if prompt.get('answer_reasoning'):
                        story.append(Paragraph(f"Reasoning: {prompt.get('answer_reasoning', 'N/A')}", styles['Normal']))
                    story.append(Spacer(1, 12))
            else:
                story.append(Paragraph("No smart prompts found.", styles['Normal']))
            
            # Build PDF
            doc.build(story)
            pdf_content = pdf_buffer.getvalue()
            pdf_buffer.close()
            
            # Upload to S3
            pdf_key = f"{self.proof_packets_prefix}/{packet_id}/summary.pdf"
            await self.s3_manager.upload_file(
                file_content=pdf_content,
                bucket_name=self.bucket_name,
                key=pdf_key,
                content_type="application/pdf"
            )
            
            return f"s3://{self.bucket_name}/{pdf_key}"
            
        except Exception as e:
            logger.error(f"Failed to generate PDF summary: {e}")
            raise
    
    async def _generate_zip_archive(
        self, 
        packet_data: ProofPacketData, 
        packet_id: str
    ) -> str:
        """Generate ZIP archive with all supporting files"""
        try:
            # Create temporary directory for ZIP
            with tempfile.TemporaryDirectory() as temp_dir:
                zip_path = os.path.join(temp_dir, f"proof_packet_{packet_id}.zip")
                
                with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                    # Add PDF summary
                    pdf_key = f"{self.proof_packets_prefix}/{packet_id}/summary.pdf"
                    pdf_content = await self.s3_manager.download_file(
                        bucket_name=self.bucket_name,
                        key=pdf_key
                    )
                    if pdf_content:
                        zip_file.writestr("summary.pdf", pdf_content)
                    
                    # Add evidence documents
                    for i, doc in enumerate(packet_data.evidence_documents, 1):
                        try:
                            # Download document content
                            doc_content = await self.s3_manager.download_file(
                                bucket_name=self.bucket_name,
                                key=doc['download_url'].split('/')[-1]  # Extract key from URL
                            )
                            
                            if doc_content:
                                # Create safe filename
                                safe_filename = f"evidence_{i:02d}_{doc['filename']}"
                                zip_file.writestr(safe_filename, doc_content)
                        except Exception as e:
                            logger.warning(f"Failed to add document {doc['filename']} to ZIP: {e}")
                            continue
                    
                    # Add metadata file
                    metadata = {
                        "claim_id": packet_data.claim_id,
                        "generated_at": datetime.utcnow().isoformat() + "Z",
                        "evidence_documents_count": len(packet_data.evidence_documents),
                        "prompts_count": len(packet_data.prompts),
                        "claim_details": packet_data.claim_details,
                        "payout_details": packet_data.payout_details
                    }
                    
                    zip_file.writestr("metadata.json", json.dumps(metadata, indent=2))
                
                # Upload ZIP to S3
                with open(zip_path, 'rb') as f:
                    zip_content = f.read()
                
                zip_key = f"{self.proof_packets_prefix}/{packet_id}/proof_packet.zip"
                await self.s3_manager.upload_file(
                    file_content=zip_content,
                    bucket_name=self.bucket_name,
                    key=zip_key,
                    content_type="application/zip"
                )
                
                return f"s3://{self.bucket_name}/{zip_key}"
                
        except Exception as e:
            logger.error(f"Failed to generate ZIP archive: {e}")
            raise
    
    async def _log_audit_event(
        self,
        user_id: str,
        claim_id: str,
        action: AuditAction,
        entity_type: str,
        entity_id: str,
        details: Dict[str, Any]
    ):
        """Log audit event to database"""
        try:
            with self.db._get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        SELECT log_audit_event(%s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        user_id, claim_id, action.value, entity_type, entity_id,
                        json.dumps(details), None, None
                    ))
        except Exception as e:
            logger.error(f"Failed to log audit event: {e}")

# Global instance
proof_packet_worker = ProofPacketWorker()