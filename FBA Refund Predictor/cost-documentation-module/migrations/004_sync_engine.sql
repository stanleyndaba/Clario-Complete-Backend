-- Sync & Cross-Check Engine schema

CREATE TABLE IF NOT EXISTS "RawPayloadArchive" (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  s3_key TEXT
);
CREATE INDEX IF NOT EXISTS "RawPayloadArchive_source_idx" ON "RawPayloadArchive"(source);
CREATE INDEX IF NOT EXISTS "RawPayloadArchive_entity_id_idx" ON "RawPayloadArchive"(entity_id);
CREATE INDEX IF NOT EXISTS "RawPayloadArchive_fetched_at_idx" ON "RawPayloadArchive"(fetched_at);

CREATE TABLE IF NOT EXISTS "SnapshotState" (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  state JSONB NOT NULL,
  hash TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT snapshot_unique UNIQUE(entity_id, source)
);
CREATE INDEX IF NOT EXISTS "SnapshotState_hash_idx" ON "SnapshotState"(hash);

CREATE TABLE IF NOT EXISTS "DiscrepancyStatus" (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  is_in_sync BOOLEAN NOT NULL DEFAULT TRUE,
  diff_summary JSONB,
  last_checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT discrepancy_unique UNIQUE(entity_id, source)
);
CREATE INDEX IF NOT EXISTS "DiscrepancyStatus_is_in_sync_idx" ON "DiscrepancyStatus"(is_in_sync);
CREATE INDEX IF NOT EXISTS "DiscrepancyStatus_last_checked_at_idx" ON "DiscrepancyStatus"(last_checked_at);


