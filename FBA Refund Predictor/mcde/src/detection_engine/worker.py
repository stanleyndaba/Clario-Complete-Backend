import asyncio
import logging
from typing import Dict, Any, List
from datetime import datetime
import time

import psycopg2
from psycopg2.extras import RealDictCursor
import boto3

from .types import (
    DetectionJob, DetectionResult, RuleInput, RuleContext,
    Threshold, WhitelistItem, RuleType, AnomalySeverity
)
from .rules import ALL_RULES
from .evidence import EvidenceBuilder


class DetectionWorker:
    def __init__(
        self,
        db_config: Dict[str, Any],
        s3_config: Dict[str, Any],
        worker_config: Dict[str, Any]
    ):
        self.db_config = db_config
        self.s3_config = s3_config
        self.worker_config = worker_config
        
        # Initialize S3 client
        self.s3_client = boto3.client(
            's3',
            aws_access_key_id=s3_config['access_key_id'],
            aws_secret_access_key=s3_config['secret_access_key'],
            region_name=s3_config['region']
        )
        
        # Initialize evidence builder
        self.evidence_builder = EvidenceBuilder(
            self.s3_client,
            s3_config['bucket_name'],
            s3_config['region']
        )
        
        self.is_running = False
        self.active_workers = 0
        self.logger = logging.getLogger(__name__)

    async def start(self):
        """Start the detection worker."""
        if self.is_running:
            self.logger.info("Detection worker is already running")
            return

        self.is_running = True
        self.logger.info("Starting detection worker...")

        while self.is_running:
            try:
                if self.active_workers < self.worker_config['max_concurrency']:
                    job = await self._get_next_job()
                    
                    if job:
                        self.active_workers += 1
                        asyncio.create_task(
                            self._process_job(job).finally(
                                lambda: setattr(self, 'active_workers', self.active_workers - 1)
                            )
                        )
                    else:
                        # No jobs available, wait before polling again
                        await asyncio.sleep(self.worker_config['poll_interval_ms'] / 1000)
                else:
                    # Max concurrency reached, wait before checking again
                    await asyncio.sleep(self.worker_config['poll_interval_ms'] / 1000)
            except Exception as e:
                self.logger.error(f"Error in detection worker main loop: {e}")
                await asyncio.sleep(self.worker_config['poll_interval_ms'] / 1000)

    async def stop(self):
        """Stop the detection worker."""
        self.is_running = False
        self.logger.info("Stopping detection worker...")
        
        # Wait for active workers to complete
        while self.active_workers > 0:
            await asyncio.sleep(1)
        
        self.logger.info("Detection worker stopped")

    async def _get_next_job(self) -> DetectionJob:
        """Get the next available detection job from the database."""
        try:
            with self._get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    # Get next available job with priority ordering
                    cur.execute("""
                        SELECT id, seller_id, sync_id, status, priority, attempts, 
                               last_error, created_at, updated_at
                        FROM "DetectionJob"
                        WHERE status = 'PENDING'
                        ORDER BY 
                            CASE priority
                                WHEN 'CRITICAL' THEN 4
                                WHEN 'HIGH' THEN 3
                                WHEN 'NORMAL' THEN 2
                                WHEN 'LOW' THEN 1
                            END DESC,
                            created_at ASC
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    """)
                    
                    job_data = cur.fetchone()
                    if job_data:
                        # Mark job as processing
                        cur.execute("""
                            UPDATE "DetectionJob"
                            SET status = 'PROCESSING', updated_at = NOW()
                            WHERE id = %s
                        """, (job_data['id'],))
                        
                        conn.commit()
                        
                        return DetectionJob(
                            id=job_data['id'],
                            seller_id=job_data['seller_id'],
                            sync_id=job_data['sync_id'],
                            status=job_data['status'],
                            priority=job_data['priority'],
                            attempts=job_data['attempts'],
                            last_error=job_data['last_error'],
                            created_at=job_data['created_at'],
                            updated_at=job_data['updated_at']
                        )
                    
                    return None
        except Exception as e:
            self.logger.error(f"Error getting next job: {e}")
            return None

    async def _process_job(self, job: DetectionJob):
        """Process a detection job."""
        self.logger.info(f"Processing detection job: {job.id} for seller {job.seller_id}, sync {job.sync_id}")

        try:
            # Fetch input data (this would come from your sync system)
            input_data = await self._fetch_input_data(job.seller_id, job.sync_id)
            
            # Fetch thresholds and whitelist
            thresholds, whitelist = await asyncio.gather(
                self._fetch_thresholds(job.seller_id),
                self._fetch_whitelist(job.seller_id)
            )

            # Create rule context
            context = RuleContext(
                seller_id=job.seller_id,
                sync_id=job.sync_id,
                thresholds=thresholds,
                whitelist=whitelist
            )

            # Create rule input
            rule_input = RuleInput(
                seller_id=job.seller_id,
                sync_id=job.sync_id,
                data=input_data
            )

            # Run all rules
            all_anomalies = []
            
            for rule in ALL_RULES:
                try:
                    anomalies = rule.apply(rule_input, context)
                    all_anomalies.extend(anomalies)
                except Exception as e:
                    self.logger.error(f"Error applying rule {rule.rule_type}: {e}")

            # Process anomalies and build evidence
            results = []
            
            for anomaly in all_anomalies:
                try:
                    # Check if result already exists (idempotency)
                    existing_result = await self._check_existing_result(
                        job.seller_id, anomaly.rule_type, anomaly.dedupe_hash
                    )

                    if existing_result:
                        self.logger.info(f"Skipping duplicate result for {anomaly.rule_type} with hash {anomaly.dedupe_hash}")
                        continue

                    # Build evidence
                    evidence_artifact = await self.evidence_builder.build_evidence(
                        anomaly,
                        job.seller_id,
                        job.sync_id,
                        input_data,
                        thresholds,
                        whitelist
                    )

                    # Create detection result
                    result = await self._create_detection_result(
                        job.id, anomaly, evidence_artifact
                    )

                    results.append(result)
                    self.logger.info(f"Created detection result: {result.id} for {anomaly.rule_type}")
                except Exception as e:
                    self.logger.error(f"Error processing anomaly for {anomaly.rule_type}: {e}")

            # Mark job as completed
            await self._mark_job_completed(job.id)
            self.logger.info(f"Detection job {job.id} completed successfully with {len(results)} results")

        except Exception as e:
            self.logger.error(f"Error processing detection job {job.id}: {e}")
            
            # Check if we should retry
            if job.attempts < self.worker_config['max_retries']:
                await self._mark_job_failed(job.id, str(e))
                self.logger.info(f"Job {job.id} marked for retry (attempt {job.attempts + 1}/{self.worker_config['max_retries']})")
            else:
                await self._mark_job_failed(job.id, f"Max retries exceeded: {e}")
                self.logger.info(f"Job {job.id} failed permanently after {self.worker_config['max_retries']} attempts")

    async def _fetch_input_data(self, seller_id: str, sync_id: str) -> Dict[str, Any]:
        """Fetch input data for detection (mock implementation)."""
        # This would integrate with your existing sync system
        # For now, return mock data structure
        return {
            "inventory": [
                {
                    "sku": "SKU001",
                    "asin": "B001234567",
                    "units": 5,
                    "value": 25.0,
                    "vendor": "Vendor A"
                }
            ],
            "totalUnits": 100,
            "totalValue": 1000.0,
            "fees": [
                {
                    "feeType": "FBA_FEE",
                    "amount": 15.0,
                    "sku": "SKU001",
                    "asin": "B001234567",
                    "vendor": "Vendor A",
                    "shipmentId": "SHIP001"
                }
            ],
            "expectedFees": {
                "FBA_FEE": 12.0
            },
            "totalRevenue": 2000.0,
            "damagedStock": [
                {
                    "sku": "SKU002",
                    "asin": "B001234568",
                    "units": 2,
                    "value": 10.0,
                    "vendor": "Vendor B",
                    "damageType": "DAMAGED",
                    "damageReason": "Shipping damage"
                }
            ],
            "totalInventory": 100,
            "totalInventoryValue": 1000.0
        }

    async def _fetch_thresholds(self, seller_id: str) -> List[Threshold]:
        """Fetch thresholds from database."""
        try:
            with self._get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT id, seller_id, rule_type, operator, value, active
                        FROM "DetectionThreshold"
                        WHERE (seller_id IS NULL OR seller_id = %s) AND active = true
                    """, (seller_id,))
                    
                    rows = cur.fetchall()
                    return [
                        Threshold(
                            id=row['id'],
                            seller_id=row['seller_id'],
                            rule_type=RuleType(row['rule_type']),
                            operator=row['operator'],
                            value=row['value'],
                            active=row['active']
                        )
                        for row in rows
                    ]
        except Exception as e:
            self.logger.error(f"Error fetching thresholds: {e}")
            return []

    async def _fetch_whitelist(self, seller_id: str) -> List[WhitelistItem]:
        """Fetch whitelist from database."""
        try:
            with self._get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT id, seller_id, scope, value, reason, active
                        FROM "DetectionWhitelist"
                        WHERE seller_id = %s AND active = true
                    """, (seller_id,))
                    
                    rows = cur.fetchall()
                    return [
                        WhitelistItem(
                            id=row['id'],
                            seller_id=row['seller_id'],
                            scope=row['scope'],
                            value=row['value'],
                            reason=row['reason'],
                            active=row['active']
                        )
                        for row in rows
                    ]
        except Exception as e:
            self.logger.error(f"Error fetching whitelist: {e}")
            return []

    async def _check_existing_result(
        self, seller_id: str, rule_type: RuleType, dedupe_hash: str
    ) -> bool:
        """Check if a detection result already exists."""
        try:
            with self._get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT id FROM "DetectionResult"
                        WHERE seller_id = %s AND rule_type = %s AND dedupe_hash = %s
                    """, (seller_id, rule_type.value, dedupe_hash))
                    
                    return cur.fetchone() is not None
        except Exception as e:
            self.logger.error(f"Error checking existing result: {e}")
            return False

    async def _create_detection_result(
        self, job_id: str, anomaly, evidence_artifact
    ) -> DetectionResult:
        """Create a detection result in the database."""
        try:
            with self._get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        INSERT INTO "DetectionResult" (
                            seller_id, sync_id, rule_type, severity, score, summary,
                            evidence_json, evidence_s3_url, dedupe_hash, detection_job_id
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id, created_at
                    """, (
                        anomaly.seller_id,
                        anomaly.sync_id,
                        anomaly.rule_type.value,
                        anomaly.severity.value,
                        anomaly.score,
                        anomaly.summary,
                        json.dumps(evidence_artifact.evidence_json),
                        evidence_artifact.evidence_s3_url,
                        evidence_artifact.dedupe_hash,
                        job_id
                    ))
                    
                    result = cur.fetchone()
                    conn.commit()
                    
                    return DetectionResult(
                        id=result['id'],
                        seller_id=anomaly.seller_id,
                        sync_id=anomaly.sync_id,
                        rule_type=anomaly.rule_type,
                        severity=anomaly.severity,
                        score=anomaly.score,
                        summary=anomaly.summary,
                        evidence_json=evidence_artifact.evidence_json,
                        evidence_s3_url=evidence_artifact.evidence_s3_url,
                        dedupe_hash=evidence_artifact.dedupe_hash,
                        detection_job_id=job_id,
                        created_at=result['created_at']
                    )
        except Exception as e:
            self.logger.error(f"Error creating detection result: {e}")
            raise

    async def _mark_job_completed(self, job_id: str):
        """Mark a job as completed."""
        try:
            with self._get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE "DetectionJob"
                        SET status = 'COMPLETED', updated_at = NOW()
                        WHERE id = %s
                    """, (job_id,))
                    conn.commit()
        except Exception as e:
            self.logger.error(f"Error marking job completed: {e}")

    async def _mark_job_failed(self, job_id: str, error: str):
        """Mark a job as failed."""
        try:
            with self._get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE "DetectionJob"
                        SET status = 'FAILED', last_error = %s, attempts = attempts + 1, updated_at = NOW()
                        WHERE id = %s
                    """, (error, job_id))
                    conn.commit()
        except Exception as e:
            self.logger.error(f"Error marking job failed: {e}")

    def _get_db_connection(self):
        """Get a database connection."""
        return psycopg2.connect(
            host=self.db_config['host'],
            port=self.db_config['port'],
            database=self.db_config['database'],
            user=self.db_config['user'],
            password=self.db_config['password']
        )

