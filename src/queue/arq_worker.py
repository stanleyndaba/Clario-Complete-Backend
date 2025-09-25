"""
ARQ worker for evidence ingestion and backfill scheduling
"""

import asyncio
import logging
from datetime import datetime, timedelta
from arq import cron
from arq.connections import RedisSettings

from src.common.config import settings
from src.evidence.ingestion_service import EvidenceIngestionService

logger = logging.getLogger(__name__)


async def ingest_source(ctx, source_id: str, user_id: str) -> str:
    service: EvidenceIngestionService = ctx['service']
    # Start and run a single ingestion job for source with retries
    job_id = await service._start_ingestion_job(source_id, user_id)  # noqa: internal, acceptable for worker
    logger.info(f"arq.ingest queued job_id={job_id} source_id={source_id} user_id={user_id}")
    # Retry policy
    max_attempts = 5
    delay = 1.0
    attempts = 0
    while attempts < max_attempts:
        try:
            await service._process_ingestion_job(job_id)
            return job_id
        except Exception as e:
            attempts += 1
            logger.warning(f"ingest attempt {attempts} failed for job {job_id}: {e}")
            await asyncio.sleep(delay)
            delay *= 2
    # DLQ write
    try:
        with service.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO evidence_dlq (job_id, source_id, user_id, error, payload)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (job_id, source_id, user_id, "max attempts exceeded", {})
                )
        try:
            from src.api.metrics import DLQ_TOTAL
            DLQ_TOTAL.inc()
        except Exception:
            pass
    except Exception as e:
        logger.error(f"Failed to write to DLQ for job {job_id}: {e}")
    return job_id


async def periodic_backfill(ctx) -> None:
    """Periodic scan scheduling across connected sources (last sync > 6 hours)."""
    service: EvidenceIngestionService = ctx['service']
    try:
        with service.db._get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, user_id FROM evidence_sources
                    WHERE status = 'connected'
                    AND (last_sync_at IS NULL OR last_sync_at < NOW() - COALESCE((metadata->>'backfill_interval_hours')::interval, '6 hours'::interval))
                    LIMIT 200
                    """
                )
                rows = cursor.fetchall() or []
                for r in rows:
                    source_id = str(r[0])
                    user_id = str(r[1])
                    await ctx['job'].enqueue_job('ingest_source', source_id, user_id)
    except Exception as e:
        logger.error(f"periodic_backfill scheduling failed: {e}")


class WorkerSettings:
    functions = [ingest_source]
    cron_jobs = [
        cron(periodic_backfill, minute={0, 15, 30, 45}),
    ]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)

    on_start = 'startup'
    on_stop = 'shutdown'


async def startup(ctx) -> None:
    ctx['service'] = EvidenceIngestionService()
    logger.info("ARQ worker started")


async def shutdown(ctx) -> None:
    logger.info("ARQ worker stopped")

