"""
Simple JSON-based persistence for MCDE artifacts.
Creates lightweight 'tables' as directories under data/db.
"""
import json
import os
from pathlib import Path
from typing import Any, Dict
from datetime import datetime

BASE_DIR = Path("data/db")
INVOICES_DIR = BASE_DIR / "mcde_invoices"
PARSED_ITEMS_DIR = BASE_DIR / "mcde_parsed_items"
CLAIM_METADATA_DIR = BASE_DIR / "mcde_claim_metadata"

for d in [INVOICES_DIR, PARSED_ITEMS_DIR, CLAIM_METADATA_DIR]:
    d.mkdir(parents=True, exist_ok=True)


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def persist_invoice(document_id: str, data: Dict[str, Any]) -> None:
    record = {**data, "document_id": document_id, "updated_at": datetime.utcnow().isoformat()}
    _write_json(INVOICES_DIR / f"{document_id}.json", record)


def persist_parsed_items(document_id: str, data: Dict[str, Any]) -> None:
    record = {**data, "document_id": document_id, "updated_at": datetime.utcnow().isoformat()}
    _write_json(PARSED_ITEMS_DIR / f"{document_id}.json", record)


def persist_claim_metadata(claim_id: str, data: Dict[str, Any]) -> None:
    record = {**data, "claim_id": claim_id, "updated_at": datetime.utcnow().isoformat()}
    _write_json(CLAIM_METADATA_DIR / f"{claim_id}.json", record)


def load_claim_metadata(claim_id: str) -> Dict[str, Any]:
    path = CLAIM_METADATA_DIR / f"{claim_id}.json"
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)



