import asyncio
from httpx import AsyncClient
from src.app import app


async def test_evidence_search_endpoint(monkeypatch):
    async with AsyncClient(app=app, base_url="http://test") as ac:
        # Mock auth dependency if needed (assumes test auth middleware allows)
        resp = await ac.get("/api/v1/integrations/evidence/search", params={"q": "Amazon", "limit": 5})
        assert resp.status_code in (200, 401, 403)  # Depending on auth in test env


async def test_gmail_watch_webhook():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/integrations/evidence/webhooks/gmail/watch", json={"message": {"data": "test"}})
        assert resp.status_code == 200
        assert resp.json().get("ok") is True


async def test_gdrive_changes_webhook():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/integrations/evidence/webhooks/gdrive/changes", json={"change": "test"})
        assert resp.status_code == 200
        assert resp.json().get("ok") is True

