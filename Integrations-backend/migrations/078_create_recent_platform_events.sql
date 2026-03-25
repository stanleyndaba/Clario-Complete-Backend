BEGIN;

CREATE TABLE IF NOT EXISTS recent_platform_events (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id UUID NULL,
    tenant_slug TEXT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NULL,
    entity_id TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recent_platform_events_user_created
    ON recent_platform_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recent_platform_events_user_tenant_slug_created
    ON recent_platform_events(user_id, tenant_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recent_platform_events_user_tenant_id_created
    ON recent_platform_events(user_id, tenant_id, created_at DESC);

COMMENT ON TABLE recent_platform_events IS 'Bounded durable replay buffer for canonical SSE events.';

COMMIT;
