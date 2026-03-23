"""
Truthful dispute submission router.

This router is the Python-side contract for Node Agent 7 filing handoff.
It accepts the repaired Node payload, reconstructs real binary attachments,
preserves Node's verified subject/body, and only reports downstream filing
success when a real downstream adapter confirms it.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse

from .seller_central_adapter import is_adapter_enabled, submit_to_seller_central

logger = logging.getLogger(__name__)

disputes_router = APIRouter(tags=["Dispute Submission"])


@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    size_bytes: int
    bytes_data: bytes
    sha256: str
    document_id: Optional[str] = None
    doc_type: Optional[str] = None
    categories: Optional[List[str]] = None


@dataclass
class ParsedSubmission:
    request_mode: str
    dispute_id: str
    user_id: str
    order_id: Optional[str]
    shipment_id: Optional[str]
    asin: Optional[str]
    sku: Optional[str]
    claim_type: str
    quantity: int
    amount_claimed: float
    currency: str
    confidence_score: Optional[float]
    subject: str
    body: str
    attachment_manifest: List[Dict[str, Any]]
    metadata: Dict[str, Any]
    attachments: List[ParsedAttachment]


def _parse_json_field(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


def _parse_float(value: Any, field: str, required: bool = False) -> Optional[float]:
    if value in (None, ""):
        if required:
            raise HTTPException(status_code=422, detail=f"Missing required numeric field: {field}")
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid numeric field: {field}") from exc


def _parse_int(value: Any, field: str, required: bool = False, default: Optional[int] = None) -> Optional[int]:
    if value in (None, ""):
        if required and default is None:
            raise HTTPException(status_code=422, detail=f"Missing required integer field: {field}")
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid integer field: {field}") from exc


def _parse_required_string(value: Any, field: str) -> str:
    if value is None:
        raise HTTPException(status_code=422, detail=f"Missing required field: {field}")
    parsed = str(value).strip()
    if not parsed:
        raise HTTPException(status_code=422, detail=f"Missing required field: {field}")
    return parsed


def _build_attachment_summary(attachments: List[ParsedAttachment]) -> List[Dict[str, Any]]:
    return [
        {
            "filename": attachment.filename,
            "content_type": attachment.content_type,
            "size_bytes": attachment.size_bytes,
            "sha256": attachment.sha256,
            "document_id": attachment.document_id,
            "doc_type": attachment.doc_type,
            "categories": attachment.categories or [],
        }
        for attachment in attachments
    ]


async def _parse_multipart_request(request: Request) -> ParsedSubmission:
    form = await request.form()

    attachment_manifest = _parse_json_field(form.get("attachment_manifest"), [])
    metadata = _parse_json_field(form.get("metadata"), {})

    files = form.getlist("attachments")
    parsed_attachments: List[ParsedAttachment] = []

    for index, file_value in enumerate(files):
        if not hasattr(file_value, "read"):
            continue

        file_bytes = await file_value.read()
        if not file_bytes:
            raise HTTPException(status_code=422, detail=f"Attachment {file_value.filename or index} is empty")

        manifest_entry = attachment_manifest[index] if index < len(attachment_manifest) else {}
        sha256 = hashlib.sha256(file_bytes).hexdigest()
        parsed_attachments.append(
            ParsedAttachment(
                filename=file_value.filename or manifest_entry.get("filename") or f"attachment-{index + 1}",
                content_type=file_value.content_type or manifest_entry.get("content_type") or "application/octet-stream",
                size_bytes=len(file_bytes),
                bytes_data=file_bytes,
                sha256=sha256,
                document_id=manifest_entry.get("id"),
                doc_type=manifest_entry.get("doc_type"),
                categories=manifest_entry.get("categories") or [],
            )
        )

    return ParsedSubmission(
        request_mode="multipart",
        dispute_id=_parse_required_string(form.get("dispute_id"), "dispute_id"),
        user_id=_parse_required_string(form.get("user_id"), "user_id"),
        order_id=str(form.get("order_id")).strip() or None if form.get("order_id") is not None else None,
        shipment_id=str(form.get("shipment_id")).strip() or None if form.get("shipment_id") is not None else None,
        asin=str(form.get("asin")).strip() or None if form.get("asin") is not None else None,
        sku=str(form.get("sku")).strip() or None if form.get("sku") is not None else None,
        claim_type=_parse_required_string(form.get("claim_type"), "claim_type"),
        quantity=_parse_int(form.get("quantity"), "quantity", required=True) or 0,
        amount_claimed=_parse_float(form.get("amount_claimed"), "amount_claimed", required=True) or 0.0,
        currency=_parse_required_string(form.get("currency"), "currency"),
        confidence_score=_parse_float(form.get("confidence_score"), "confidence_score", required=False),
        subject=_parse_required_string(form.get("subject"), "subject"),
        body=_parse_required_string(form.get("body"), "body"),
        attachment_manifest=attachment_manifest,
        metadata=metadata,
        attachments=parsed_attachments,
    )


def _parse_json_request(payload: Dict[str, Any]) -> ParsedSubmission:
    attachment_manifest = _parse_json_field(payload.get("attachment_manifest"), [])
    metadata = _parse_json_field(payload.get("metadata"), {})
    evidence_documents = payload.get("evidence_documents") or []

    parsed_attachments: List[ParsedAttachment] = []
    for index, document in enumerate(evidence_documents):
        encoded = document.get("file_bytes_base64")
        if not encoded:
            raise HTTPException(status_code=422, detail=f"Missing file_bytes_base64 for evidence document at index {index}")

        try:
            file_bytes = base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid base64 attachment at index {index}") from exc

        if not file_bytes:
            raise HTTPException(status_code=422, detail=f"Decoded attachment at index {index} is empty")

        parsed_attachments.append(
            ParsedAttachment(
                filename=document.get("filename") or f"attachment-{index + 1}",
                content_type=document.get("content_type") or "application/octet-stream",
                size_bytes=int(document.get("size_bytes") or len(file_bytes)),
                bytes_data=file_bytes,
                sha256=hashlib.sha256(file_bytes).hexdigest(),
                document_id=document.get("id"),
                doc_type=document.get("doc_type"),
                categories=document.get("categories") or [],
            )
        )

    return ParsedSubmission(
        request_mode="json_base64",
        dispute_id=_parse_required_string(payload.get("dispute_id"), "dispute_id"),
        user_id=_parse_required_string(payload.get("user_id"), "user_id"),
        order_id=str(payload.get("order_id")).strip() or None if payload.get("order_id") is not None else None,
        shipment_id=str(payload.get("shipment_id")).strip() or None if payload.get("shipment_id") is not None else None,
        asin=str(payload.get("asin")).strip() or None if payload.get("asin") is not None else None,
        sku=str(payload.get("sku")).strip() or None if payload.get("sku") is not None else None,
        claim_type=_parse_required_string(payload.get("claim_type"), "claim_type"),
        quantity=_parse_int(payload.get("quantity"), "quantity", required=True) or 0,
        amount_claimed=_parse_float(payload.get("amount_claimed"), "amount_claimed", required=True) or 0.0,
        currency=_parse_required_string(payload.get("currency"), "currency"),
        confidence_score=_parse_float(payload.get("confidence_score"), "confidence_score", required=False),
        subject=_parse_required_string(payload.get("subject"), "subject"),
        body=_parse_required_string(payload.get("body"), "body"),
        attachment_manifest=attachment_manifest,
        metadata=metadata,
        attachments=parsed_attachments,
    )


async def parse_submission_request(request: Request) -> ParsedSubmission:
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in content_type:
        parsed = await _parse_multipart_request(request)
    else:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=422, detail="JSON payload must be an object")
        parsed = _parse_json_request(payload)

    if not parsed.attachments:
        raise HTTPException(status_code=422, detail="At least one real attachment is required")

    return parsed


def perform_downstream_submission(parsed: ParsedSubmission) -> Dict[str, Any]:
    """
    Truthful default boundary.

    When the Seller Central adapter is disabled, the endpoint reports an honest
    not-implemented boundary. When enabled, it delegates to the browser
    automation adapter, which preserves the repaired contract and returns real
    attempted/confirmed semantics.
    """
    if is_adapter_enabled():
        return submit_to_seller_central(parsed)

    return {
        "accepted_by_python": True,
        "packaged_for_submission": True,
        "downstream_submission_attempted": False,
        "downstream_submission_confirmed": False,
        "status": "not_implemented",
        "amazon_case_id": None,
        "external_case_id": None,
        "submission_id": f"pkg_{uuid.uuid4().hex[:12]}",
        "failure_reason": "Seller Central browser adapter is disabled.",
        "raw_response_or_trace": None,
        "error": "Seller Central browser adapter is disabled."
    }


def _build_response(parsed: ParsedSubmission, downstream_result: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    data = {
        "submission_id": downstream_result.get("submission_id"),
        "amazon_case_id": downstream_result.get("amazon_case_id"),
        "external_case_id": downstream_result.get("external_case_id"),
        "status": downstream_result.get("status"),
        "accepted_by_python": downstream_result.get("accepted_by_python", False),
        "packaged_for_submission": downstream_result.get("packaged_for_submission", False),
        "pre_submit_path_completed": downstream_result.get("pre_submit_path_completed", False),
        "downstream_submission_attempted": downstream_result.get("downstream_submission_attempted", False),
        "downstream_submission_confirmed": downstream_result.get("downstream_submission_confirmed", False),
        "raw_response_or_trace": downstream_result.get("raw_response_or_trace"),
        "failure_reason": downstream_result.get("failure_reason") or downstream_result.get("error"),
        "request_mode": parsed.request_mode,
        "request_contract": {
            "dispute_id": parsed.dispute_id,
            "user_id": parsed.user_id,
            "order_id": parsed.order_id,
            "shipment_id": parsed.shipment_id,
            "asin": parsed.asin,
            "sku": parsed.sku,
            "claim_type": parsed.claim_type,
            "quantity": parsed.quantity,
            "amount_claimed": parsed.amount_claimed,
            "currency": parsed.currency,
            "confidence_score": parsed.confidence_score,
            "subject": parsed.subject,
            "body": parsed.body,
            "attachment_manifest": parsed.attachment_manifest,
            "metadata": parsed.metadata,
        },
        "attachments": _build_attachment_summary(parsed.attachments),
    }

    confirmed = downstream_result.get("downstream_submission_confirmed", False)
    attempted = downstream_result.get("downstream_submission_attempted", False)
    downstream_status = str(downstream_result.get("status") or "")

    if confirmed:
        return status.HTTP_200_OK, {"ok": True, "data": data}

    if attempted:
        return status.HTTP_502_BAD_GATEWAY, {
            "ok": False,
            "error": downstream_result.get("error") or "Downstream submission attempt failed",
            "data": data,
        }

    if downstream_status == "failed":
        return status.HTTP_424_FAILED_DEPENDENCY, {
            "ok": False,
            "error": downstream_result.get("failure_reason") or downstream_result.get("error") or "Downstream submission failed before the submit attempt",
            "data": data,
        }

    return status.HTTP_501_NOT_IMPLEMENTED, {
        "ok": False,
        "error": downstream_result.get("failure_reason") or downstream_result.get("error") or "Downstream submission is not implemented",
        "data": data,
    }


@disputes_router.post("/api/v1/disputes/submit")
async def submit_dispute(request: Request):
    parsed = await parse_submission_request(request)
    logger.info(
        "Received dispute submission package",
        extra={
            "dispute_id": parsed.dispute_id,
            "user_id": parsed.user_id,
            "request_mode": parsed.request_mode,
            "attachment_count": len(parsed.attachments),
        },
    )

    downstream_result = perform_downstream_submission(parsed)
    status_code, body = _build_response(parsed, downstream_result)
    return JSONResponse(status_code=status_code, content=body)
