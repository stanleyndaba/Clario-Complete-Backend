-- Webhook channel state for Drive (and future providers)

CREATE TABLE IF NOT EXISTS evidence_webhook_channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider evidence_provider NOT NULL,
    channel_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    channel_token TEXT,
    source_id UUID NOT NULL REFERENCES evidence_sources(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_webhook_channel_id
ON evidence_webhook_channels(channel_id);

CREATE INDEX IF NOT EXISTS idx_evidence_webhook_provider
ON evidence_webhook_channels(provider);

