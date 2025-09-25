from locust import HttpUser, task, between
import os
import random

BASE_URL = os.getenv('BASE_URL', '')
TOKEN = os.getenv('TOKEN', '')
SOURCE_ID = os.getenv('SOURCE_ID', '')

HEADERS = { 'Authorization': f'Bearer {TOKEN}' } if TOKEN else {}

QUERIES = ['Amazon', 'invoice', 'receipt', 'shipment', '123-1234567-1234567']

class EvidenceUser(HttpUser):
    wait_time = between(1, 2)

    @task(3)
    def evidence_metrics(self):
        self.client.get("/api/metrics/evidence", headers=HEADERS, name="metrics")

    @task(5)
    def evidence_search(self):
        q = random.choice(QUERIES)
        self.client.get(f"/api/v1/integrations/evidence/search?q={q}", headers=HEADERS, name="search")

    @task(1)
    def trigger_sync(self):
        if SOURCE_ID:
            self.client.post(f"/api/v1/integrations/evidence/sources/{SOURCE_ID}/sync", headers=HEADERS, name="sync")

