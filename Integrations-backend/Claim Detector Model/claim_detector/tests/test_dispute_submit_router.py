import base64
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.filing import router as filing_router
from src.filing import seller_central_adapter


def build_client():
    app = FastAPI()
    app.include_router(filing_router.disputes_router)
    return TestClient(app)


def test_submit_dispute_accepts_multipart_and_preserves_binary_files():
    client = build_client()
    manifest = [
        {"id": "doc-1", "filename": "invoice.pdf", "content_type": "application/pdf", "doc_type": "invoice", "categories": ["invoice"]},
        {"id": "doc-2", "filename": "pod.png", "content_type": "image/png", "doc_type": "shipping", "categories": ["proof_of_delivery"]},
    ]
    response = client.post(
        "/api/v1/disputes/submit",
        data={
            "dispute_id": "case-1",
            "user_id": "seller-1",
            "order_id": "ORDER-123",
            "shipment_id": "SHIP-123",
            "asin": "B000TEST01",
            "sku": "SKU-TEST-01",
            "claim_type": "missing_inbound_shipment",
            "quantity": "3",
            "amount_claimed": "42.5",
            "currency": "USD",
            "confidence_score": "0.95",
            "subject": "Verified subject",
            "body": "Verified body",
            "attachment_manifest": json.dumps(manifest),
        },
        files=[
            ("attachments", ("invoice.pdf", b"%PDF-1.4 test invoice", "application/pdf")),
            ("attachments", ("pod.png", b"\x89PNG\r\nproof", "image/png")),
        ],
    )

    assert response.status_code == 501
    data = response.json()["data"]
    assert data["request_mode"] == "multipart"
    assert data["request_contract"]["subject"] == "Verified subject"
    assert data["request_contract"]["body"] == "Verified body"
    assert data["attachments"][0]["filename"] == "invoice.pdf"
    assert data["attachments"][0]["content_type"] == "application/pdf"
    assert data["attachments"][0]["size_bytes"] > 0
    assert len(data["attachments"][0]["sha256"]) == 64
    assert data["attachments"][1]["filename"] == "pod.png"
    assert data["attachments"][1]["content_type"] == "image/png"


def test_submit_dispute_accepts_json_base64_and_preserves_fields():
    client = build_client()
    file_bytes = b"%PDF-1.4 evidence body"
    response = client.post(
        "/api/v1/disputes/submit",
        json={
            "dispute_id": "case-2",
            "user_id": "seller-2",
            "order_id": "ORDER-456",
            "shipment_id": "SHIP-456",
            "asin": "B000TEST02",
            "sku": "SKU-TEST-02",
            "claim_type": "fc_damage",
            "quantity": 5,
            "amount_claimed": 99.99,
            "currency": "USD",
            "confidence_score": 0.88,
            "subject": "Node subject",
            "body": "Node body",
            "attachment_manifest": [{"id": "doc-1"}],
            "evidence_documents": [
                {
                    "id": "doc-1",
                    "filename": "evidence.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(file_bytes),
                    "doc_type": "invoice",
                    "categories": ["invoice"],
                    "file_bytes_base64": base64.b64encode(file_bytes).decode("ascii"),
                }
            ],
        },
    )

    assert response.status_code == 501
    data = response.json()["data"]
    contract = data["request_contract"]
    assert data["request_mode"] == "json_base64"
    assert contract["shipment_id"] == "SHIP-456"
    assert contract["quantity"] == 5
    assert contract["order_id"] == "ORDER-456"
    assert contract["currency"] == "USD"
    assert contract["confidence_score"] == 0.88
    assert contract["subject"] == "Node subject"
    assert contract["body"] == "Node body"
    assert contract["attachment_manifest"] == [{"id": "doc-1"}]
    assert data["attachments"][0]["filename"] == "evidence.pdf"
    assert data["attachments"][0]["content_type"] == "application/pdf"
    assert data["attachments"][0]["size_bytes"] == len(file_bytes)


def test_submit_dispute_rejects_text_only_pseudo_attachments():
    client = build_client()
    response = client.post(
        "/api/v1/disputes/submit",
        json={
            "dispute_id": "case-3",
            "user_id": "seller-3",
            "claim_type": "generic",
            "quantity": 1,
            "amount_claimed": 1.0,
            "currency": "USD",
            "subject": "Subject",
            "body": "Body",
            "evidence_documents": [
                {
                    "id": "doc-1",
                    "filename": "fake.pdf",
                    "content_type": "application/pdf",
                    "extracted_text": "I am not a real file"
                }
            ],
        },
    )

    assert response.status_code == 422
    assert "file_bytes_base64" in response.json()["detail"]


def test_submit_dispute_success_semantics_are_honest(monkeypatch):
    client = build_client()

    def attempted_only(_parsed):
        return {
            "accepted_by_python": True,
            "packaged_for_submission": True,
            "downstream_submission_attempted": True,
            "downstream_submission_confirmed": False,
            "status": "downstream_submission_attempted",
            "submission_id": "attempt-1",
            "amazon_case_id": None,
            "error": "Downstream attempt failed"
        }

    monkeypatch.setattr(filing_router, "perform_downstream_submission", attempted_only)
    response = client.post(
        "/api/v1/disputes/submit",
        json={
            "dispute_id": "case-4",
            "user_id": "seller-4",
            "claim_type": "generic",
            "quantity": 1,
            "amount_claimed": 10,
            "currency": "USD",
            "subject": "Subject",
            "body": "Body",
            "evidence_documents": [
                {
                    "id": "doc-1",
                    "filename": "real.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 4,
                    "file_bytes_base64": base64.b64encode(b"real").decode("ascii"),
                }
            ],
        },
    )

    assert response.status_code == 502
    attempted = response.json()["data"]
    assert attempted["accepted_by_python"] is True
    assert attempted["packaged_for_submission"] is True
    assert attempted["downstream_submission_attempted"] is True
    assert attempted["downstream_submission_confirmed"] is False

    def confirmed(_parsed):
        return {
            "accepted_by_python": True,
            "packaged_for_submission": True,
            "downstream_submission_attempted": True,
            "downstream_submission_confirmed": True,
            "status": "downstream_submission_confirmed",
            "submission_id": "confirmed-1",
            "amazon_case_id": "AMZ-123",
            "error": None
        }

    monkeypatch.setattr(filing_router, "perform_downstream_submission", confirmed)
    response = client.post(
        "/api/v1/disputes/submit",
        json={
            "dispute_id": "case-5",
            "user_id": "seller-5",
            "claim_type": "generic",
            "quantity": 2,
            "amount_claimed": 11,
            "currency": "USD",
            "subject": "Subject",
            "body": "Body",
            "evidence_documents": [
                {
                    "id": "doc-1",
                    "filename": "real.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 4,
                    "file_bytes_base64": base64.b64encode(b"real").decode("ascii"),
                }
            ],
        },
    )

    assert response.status_code == 200
    confirmed_data = response.json()["data"]
    assert confirmed_data["downstream_submission_attempted"] is True
    assert confirmed_data["downstream_submission_confirmed"] is True
    assert confirmed_data["amazon_case_id"] == "AMZ-123"


def test_seller_central_adapter_materializes_real_files_and_preserves_message(monkeypatch, tmp_path):
    file_bytes = b"%PDF-1.4 binary payload"
    parsed = filing_router._parse_json_request(
        {
            "dispute_id": "case-6",
            "user_id": "seller-6",
            "order_id": "ORDER-600",
            "shipment_id": "SHIP-600",
            "asin": "B000TEST06",
            "sku": "SKU-TEST-06",
            "claim_type": "missing_inbound_shipment",
            "quantity": 4,
            "amount_claimed": 123.45,
            "currency": "USD",
            "confidence_score": 0.91,
            "subject": "Verified seller-central subject",
            "body": "Verified seller-central body",
            "attachment_manifest": [{"id": "doc-1"}],
            "evidence_documents": [
                {
                    "id": "doc-1",
                    "filename": "invoice.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(file_bytes),
                    "doc_type": "invoice",
                    "categories": ["invoice", "reference"],
                    "file_bytes_base64": base64.b64encode(file_bytes).decode("ascii"),
                },
                {
                    "id": "doc-2",
                    "filename": "pod.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(file_bytes),
                    "doc_type": "shipping",
                    "categories": ["proof_of_delivery", "shipping"],
                    "file_bytes_base64": base64.b64encode(file_bytes).decode("ascii"),
                },
                {
                    "id": "doc-3",
                    "filename": "inventory.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(file_bytes),
                    "doc_type": "inventory",
                    "categories": ["inventory"],
                    "file_bytes_base64": base64.b64encode(file_bytes).decode("ascii"),
                },
            ],
        }
    )

    script_path = tmp_path / "sellerCentralSubmit.js"
    script_path.write_text("// test stub", encoding="utf-8")

    monkeypatch.setenv("SELLER_CENTRAL_ADAPTER_ENABLED", "true")
    monkeypatch.setenv("SELLER_CENTRAL_CASE_URL", "https://sellercentral.example.com/case")
    monkeypatch.setenv("SELLER_CENTRAL_SESSION_PATH", str(tmp_path / "session.json"))
    (tmp_path / "session.json").write_text(json.dumps({"cookies": []}), encoding="utf-8")
    monkeypatch.setenv("SELLER_CENTRAL_SELECTOR_MAP", json.dumps({
        "subject": "#subject",
        "body": "#body",
        "attachmentInput": "#attachments",
        "submit": "#submit"
    }))

    monkeypatch.setattr(seller_central_adapter, "_script_path", lambda: script_path)
    monkeypatch.setattr(seller_central_adapter.shutil, "which", lambda _name: "node")

    captured = {}

    def fake_run(input_payload, working_dir):
        captured["payload"] = input_payload
        captured["working_dir"] = working_dir
        for attachment in input_payload["attachments"]:
            file_path = Path(attachment["path"])
            assert file_path.exists()
            assert file_path.read_bytes() == file_bytes
        return {
            "downstream_submission_attempted": True,
            "downstream_submission_confirmed": False,
            "external_case_id": None,
            "status": "submission_attempted",
            "raw_response_or_trace": {"url": "https://sellercentral.example.com/case"},
            "failure_reason": "No visible confirmation yet",
            "submission_id": "sc-test-1",
        }

    monkeypatch.setattr(seller_central_adapter, "_run_browser_script", fake_run)

    result = seller_central_adapter.submit_to_seller_central(parsed)

    assert result["downstream_submission_attempted"] is True
    assert result["downstream_submission_confirmed"] is False
    assert result["status"] == "submission_attempted"
    assert captured["payload"]["subject"] == "Verified seller-central subject"
    assert captured["payload"]["body"] == "Verified seller-central body"
    assert captured["payload"]["shipment_id"] == "SHIP-600"
    assert captured["payload"]["quantity"] == 4
    assert len(captured["payload"]["attachments"]) == 3


def test_seller_central_adapter_fails_truthfully_without_session(monkeypatch, tmp_path):
    file_bytes = b"file"
    parsed = filing_router._parse_json_request(
        {
            "dispute_id": "case-7",
            "user_id": "seller-7",
            "shipment_id": "SHIP-700",
            "claim_type": "missing_inbound_shipment",
            "quantity": 1,
            "amount_claimed": 50,
            "currency": "USD",
            "subject": "Subject",
            "body": "Body",
            "evidence_documents": [
                {
                    "id": "doc-1",
                    "filename": "invoice.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(file_bytes),
                    "doc_type": "invoice",
                    "categories": ["invoice", "reference"],
                    "file_bytes_base64": base64.b64encode(file_bytes).decode("ascii"),
                },
                {
                    "id": "doc-2",
                    "filename": "pod.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(file_bytes),
                    "doc_type": "shipping",
                    "categories": ["proof_of_delivery", "shipping"],
                    "file_bytes_base64": base64.b64encode(file_bytes).decode("ascii"),
                },
                {
                    "id": "doc-3",
                    "filename": "inventory.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(file_bytes),
                    "doc_type": "inventory",
                    "categories": ["inventory"],
                    "file_bytes_base64": base64.b64encode(file_bytes).decode("ascii"),
                },
            ],
        }
    )

    script_path = tmp_path / "sellerCentralSubmit.js"
    script_path.write_text("// test stub", encoding="utf-8")

    monkeypatch.setenv("SELLER_CENTRAL_ADAPTER_ENABLED", "true")
    monkeypatch.setenv("SELLER_CENTRAL_CASE_URL", "https://sellercentral.example.com/case")
    monkeypatch.setenv("SELLER_CENTRAL_SELECTOR_MAP", json.dumps({
        "subject": "#subject",
        "body": "#body",
        "attachmentInput": "#attachments",
        "submit": "#submit"
    }))
    monkeypatch.delenv("SELLER_CENTRAL_SESSION_PATH", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_COOKIES_JSON", raising=False)
    monkeypatch.setattr(seller_central_adapter, "_script_path", lambda: script_path)
    monkeypatch.setattr(seller_central_adapter.shutil, "which", lambda _name: "node")

    result = seller_central_adapter.submit_to_seller_central(parsed)

    assert result["status"] == "failed"
    assert result["downstream_submission_attempted"] is False
    assert "session" in (result["failure_reason"] or "").lower()


def test_seller_central_readiness_reports_missing_config(monkeypatch):
    monkeypatch.delenv("SELLER_CENTRAL_SESSION_PATH", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_COOKIES_JSON", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_CASE_URL", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_DRY_RUN_PRE_SUBMIT", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_SELECTOR_MAP", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_SUBJECT_SELECTOR", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_BODY_SELECTOR", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_ATTACHMENT_SELECTOR", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_SUBMIT_SELECTOR", raising=False)
    monkeypatch.delenv("SELLER_CENTRAL_CONTINUE_SELECTORS", raising=False)
    monkeypatch.setattr(seller_central_adapter.shutil, "which", lambda _name: "node")

    readiness = seller_central_adapter.get_seller_central_readiness()

    assert readiness["ready"] is False
    assert "SELLER_CENTRAL_CASE_URL" in readiness["missing"]
    assert "SELLER_CENTRAL_SESSION_PATH or SELLER_CENTRAL_COOKIES_JSON" in readiness["missing"]
    assert "SELLER_CENTRAL_DRY_RUN_PRE_SUBMIT=true" in readiness["missing"]
    assert "selector:subject" in readiness["missing"]
    assert "selector:continueButtons" in readiness["missing"]


def test_seller_central_readiness_reports_ready_when_config_present(monkeypatch, tmp_path):
    session_path = tmp_path / "seller-session.json"
    session_path.write_text(json.dumps({"cookies": []}), encoding="utf-8")

    monkeypatch.setenv("SELLER_CENTRAL_SESSION_PATH", str(session_path))
    monkeypatch.setenv("SELLER_CENTRAL_CASE_URL", "https://sellercentral.example.com/support")
    monkeypatch.setenv("SELLER_CENTRAL_DRY_RUN_PRE_SUBMIT", "true")
    monkeypatch.setenv(
        "SELLER_CENTRAL_SELECTOR_MAP",
        json.dumps({
            "subject": "#subject",
            "body": "#body",
            "attachmentInput": "#attachments",
            "continueButtons": ["#continue"],
            "submit": "#submit",
        }),
    )
    monkeypatch.setattr(seller_central_adapter.shutil, "which", lambda _name: "node")
    monkeypatch.setattr(seller_central_adapter, "_script_path", lambda: session_path)

    readiness = seller_central_adapter.get_seller_central_readiness()

    assert readiness["ready"] is True
    assert readiness["session_source_present"] is True
    assert readiness["case_url_present"] is True
    assert readiness["selector_config_present"] is True
    assert readiness["dry_run_enabled"] is True
