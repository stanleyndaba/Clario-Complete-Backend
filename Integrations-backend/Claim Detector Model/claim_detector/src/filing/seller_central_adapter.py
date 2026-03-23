"""
Seller Central browser automation adapter.

This adapter is the minimum truthful downstream boundary for the repaired
Python dispute submission contract. It materializes real attachment files,
preserves Node/Python verified subject and body text, and delegates the actual
browser automation to a local Puppeteer script.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def is_adapter_enabled() -> bool:
    return _truthy(os.getenv("SELLER_CENTRAL_ADAPTER_ENABLED"))


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _script_path() -> Path:
    return _repo_root() / "src" / "scripts" / "sellerCentralSubmit.js"


def _collect_categories(parsed_submission: Any) -> List[str]:
    categories: set[str] = set()
    for attachment in getattr(parsed_submission, "attachments", []):
        for category in getattr(attachment, "categories", []) or []:
            categories.add(str(category).strip().lower())
        doc_type = getattr(attachment, "doc_type", None)
        if doc_type:
            categories.add(str(doc_type).strip().lower())
    return sorted(category for category in categories if category)


def _required_categories_for_claim_type(claim_type: str) -> List[List[str]]:
    normalized = (claim_type or "").strip().lower()
    if "inbound" in normalized or "shipment" in normalized:
        return [["invoice", "po"], ["shipping", "proof_of_delivery"], ["inventory", "reference"]]
    if "damage" in normalized or "damaged" in normalized:
        return [["invoice", "po"], ["inventory"]]
    return [["invoice", "po"], ["reference", "inventory", "shipping"]]


def _validate_required_inputs(parsed_submission: Any) -> Tuple[bool, str | None]:
    attachments = getattr(parsed_submission, "attachments", []) or []
    if not attachments:
        return False, "No real attachments were provided to the Seller Central adapter."

    subject = str(getattr(parsed_submission, "subject", "") or "").strip()
    body = str(getattr(parsed_submission, "body", "") or "").strip()
    if not subject:
        return False, "Missing verified subject for Seller Central submission."
    if not body:
        return False, "Missing verified body for Seller Central submission."

    claim_type = str(getattr(parsed_submission, "claim_type", "") or "").strip()
    if not claim_type:
        return False, "Missing claim_type for Seller Central submission."

    shipment_id = str(getattr(parsed_submission, "shipment_id", "") or "").strip()
    order_id = str(getattr(parsed_submission, "order_id", "") or "").strip()
    asin = str(getattr(parsed_submission, "asin", "") or "").strip()
    sku = str(getattr(parsed_submission, "sku", "") or "").strip()

    if ("inbound" in claim_type.lower() or "shipment" in claim_type.lower()) and not shipment_id:
        return False, "shipment_id is required for inbound or shipment-related Seller Central submissions."

    if not any([shipment_id, order_id, asin, sku]):
        return False, "At least one external identifier is required (shipment_id, order_id, asin, or sku)."

    available_categories = set(_collect_categories(parsed_submission))
    missing_groups: List[str] = []
    for group in _required_categories_for_claim_type(claim_type):
        if not any(option in available_categories for option in group):
            missing_groups.append("/".join(group))

    if missing_groups:
        return False, f"Missing required attachment categories for {claim_type}: {', '.join(missing_groups)}."

    return True, None


def _validate_runtime_config() -> Tuple[bool, str | None]:
    if not shutil.which("node"):
        return False, "Node.js is not available for the Seller Central browser adapter."

    script_path = _script_path()
    if not script_path.exists():
        return False, f"Seller Central browser script not found: {script_path}"

    if not os.getenv("SELLER_CENTRAL_CASE_URL"):
        return False, "SELLER_CENTRAL_CASE_URL is not configured."

    if not (os.getenv("SELLER_CENTRAL_SESSION_PATH") or os.getenv("SELLER_CENTRAL_COOKIES_JSON")):
        return False, "Seller Central session is unavailable. Configure SELLER_CENTRAL_SESSION_PATH or SELLER_CENTRAL_COOKIES_JSON."

    if not (os.getenv("SELLER_CENTRAL_SELECTOR_MAP") or os.getenv("SELLER_CENTRAL_SUBJECT_SELECTOR")):
        return False, "Seller Central field selectors are unavailable. Configure SELLER_CENTRAL_SELECTOR_MAP or individual selector variables."

    return True, None


def _write_attachment_files(parsed_submission: Any, temp_dir: Path) -> List[Dict[str, Any]]:
    written: List[Dict[str, Any]] = []
    attachments = getattr(parsed_submission, "attachments", []) or []

    for index, attachment in enumerate(attachments, start=1):
        safe_name = Path(getattr(attachment, "filename", f"attachment-{index}")).name or f"attachment-{index}"
        destination = temp_dir / f"{index:02d}_{safe_name}"
        destination.write_bytes(getattr(attachment, "bytes_data"))
        written.append(
            {
                "path": str(destination),
                "filename": safe_name,
                "content_type": getattr(attachment, "content_type", "application/octet-stream"),
                "size_bytes": getattr(attachment, "size_bytes", destination.stat().st_size),
                "sha256": getattr(attachment, "sha256", None),
                "document_id": getattr(attachment, "document_id", None),
                "doc_type": getattr(attachment, "doc_type", None),
                "categories": getattr(attachment, "categories", []) or [],
            }
        )
    return written


def _build_input_payload(parsed_submission: Any, attachment_files: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "submission_id": f"sc_{uuid.uuid4().hex[:12]}",
        "dispute_id": getattr(parsed_submission, "dispute_id"),
        "user_id": getattr(parsed_submission, "user_id"),
        "claim_type": getattr(parsed_submission, "claim_type"),
        "order_id": getattr(parsed_submission, "order_id"),
        "shipment_id": getattr(parsed_submission, "shipment_id"),
        "asin": getattr(parsed_submission, "asin"),
        "sku": getattr(parsed_submission, "sku"),
        "quantity": getattr(parsed_submission, "quantity"),
        "amount_claimed": getattr(parsed_submission, "amount_claimed"),
        "currency": getattr(parsed_submission, "currency"),
        "confidence_score": getattr(parsed_submission, "confidence_score"),
        "subject": getattr(parsed_submission, "subject"),
        "body": getattr(parsed_submission, "body"),
        "attachment_manifest": getattr(parsed_submission, "attachment_manifest"),
        "metadata": getattr(parsed_submission, "metadata"),
        "attachments": attachment_files,
    }


def _run_browser_script(input_payload: Dict[str, Any], working_dir: Path) -> Dict[str, Any]:
    input_path = working_dir / "seller-central-input.json"
    input_path.write_text(json.dumps(input_payload), encoding="utf-8")

    completed = subprocess.run(
        ["node", str(_script_path()), str(input_path)],
        cwd=str(_repo_root()),
        capture_output=True,
        text=True,
        check=False,
        env=os.environ.copy(),
    )

    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()

    if not stdout:
        return {
            "downstream_submission_attempted": False,
            "downstream_submission_confirmed": False,
            "status": "failed",
            "external_case_id": None,
            "raw_response_or_trace": {"stderr": stderr},
            "failure_reason": "Seller Central browser adapter produced no output.",
        }

    try:
        result = json.loads(stdout)
    except json.JSONDecodeError:
        return {
            "downstream_submission_attempted": False,
            "downstream_submission_confirmed": False,
            "status": "failed",
            "external_case_id": None,
            "raw_response_or_trace": {"stdout": stdout, "stderr": stderr},
            "failure_reason": "Seller Central browser adapter returned non-JSON output.",
        }

    if completed.returncode != 0 and not result.get("failure_reason"):
        result["failure_reason"] = stderr or "Seller Central browser adapter exited with a non-zero status."
        result["status"] = result.get("status") or "failed"

    return result


def submit_to_seller_central(parsed_submission: Any) -> Dict[str, Any]:
    input_ok, input_error = _validate_required_inputs(parsed_submission)
    if not input_ok:
        return {
            "accepted_by_python": True,
            "packaged_for_submission": True,
            "downstream_submission_attempted": False,
            "downstream_submission_confirmed": False,
            "status": "failed",
            "amazon_case_id": None,
            "external_case_id": None,
            "submission_id": f"pkg_{uuid.uuid4().hex[:12]}",
            "raw_response_or_trace": None,
            "failure_reason": input_error,
        }

    runtime_ok, runtime_error = _validate_runtime_config()
    if not runtime_ok:
        return {
            "accepted_by_python": True,
            "packaged_for_submission": True,
            "downstream_submission_attempted": False,
            "downstream_submission_confirmed": False,
            "status": "failed",
            "amazon_case_id": None,
            "external_case_id": None,
            "submission_id": f"pkg_{uuid.uuid4().hex[:12]}",
            "raw_response_or_trace": None,
            "failure_reason": runtime_error,
        }

    with tempfile.TemporaryDirectory(prefix="seller-central-submit-") as temp_dir:
        temp_path = Path(temp_dir)
        attachment_files = _write_attachment_files(parsed_submission, temp_path)
        browser_result = _run_browser_script(_build_input_payload(parsed_submission, attachment_files), temp_path)

    external_case_id = browser_result.get("external_case_id")
    failure_reason = browser_result.get("failure_reason")
    status_value = browser_result.get("status") or (
        "submission_confirmed"
        if browser_result.get("downstream_submission_confirmed")
        else "submission_attempted"
        if browser_result.get("downstream_submission_attempted")
        else "failed"
    )

    return {
        "accepted_by_python": True,
        "packaged_for_submission": True,
        "downstream_submission_attempted": bool(browser_result.get("downstream_submission_attempted")),
        "downstream_submission_confirmed": bool(browser_result.get("downstream_submission_confirmed")),
        "status": status_value,
        "amazon_case_id": external_case_id,
        "external_case_id": external_case_id,
        "submission_id": browser_result.get("submission_id") or f"sc_{uuid.uuid4().hex[:12]}",
        "raw_response_or_trace": browser_result.get("raw_response_or_trace"),
        "failure_reason": failure_reason,
        "error": failure_reason,
    }
