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
    # Start and run a single ingestion job for source
    job_id = await service._start_ingestion_job(source_id, user_id)  # noqa: internal, acceptable for worker
    logger.info(f"arq.ingest queued job_id={job_id} source_id={source_id} user_id={user_id}")
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
                    AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '6 hours')
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

