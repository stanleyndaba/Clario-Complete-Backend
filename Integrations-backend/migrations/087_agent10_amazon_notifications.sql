-- Migration: 087_agent10_amazon_notifications
-- Purpose: Durable Amazon notification intake, ownership binding, and routing audit trail

CREATE TABLE IF NOT EXISTS amazon_notification_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id TEXT NOT NULL,
  amazon_subscription_id TEXT,
  amazon_destination_id TEXT,
  marketplace_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_notification_bindings_subscription
  ON amazon_notification_bindings(amazon_subscription_id)
  WHERE amazon_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_notification_bindings_store_seller
  ON amazon_notification_bindings(tenant_id, store_id, seller_id);

CREATE INDEX IF NOT EXISTS idx_amazon_notification_bindings_seller
  ON amazon_notification_bindings(seller_id, tenant_id);

CREATE TABLE IF NOT EXISTS amazon_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  seller_id TEXT,
  source TEXT NOT NULL DEFAULT 'amazon_notifications'
    CHECK (source = 'amazon_notifications'),
  delivery_type TEXT NOT NULL
    CHECK (delivery_type IN ('sns_notification', 'sns_subscription_confirmation', 'sns_unsubscribe_confirmation', 'replay')),
  notification_type TEXT NOT NULL,
  notification_subtype TEXT,
  classification TEXT NOT NULL DEFAULT 'unhandled_notification_type',
  amazon_notification_id TEXT,
  amazon_subscription_id TEXT,
  amazon_destination_id TEXT,
  sns_message_id TEXT,
  sns_topic_arn TEXT,
  dedupe_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'confirmed', 'classified', 'triggered', 'processed', 'quarantined', 'failed')),
  lineage_resolution TEXT,
  triggered_agent TEXT,
  triggered_sync_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_notifications_dedupe
  ON amazon_notifications(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_amazon_notifications_status_received
  ON amazon_notifications(processing_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_notifications_tenant_store_received
  ON amazon_notifications(tenant_id, store_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_notifications_type_received
  ON amazon_notifications(notification_type, classification, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_notifications_subscription
  ON amazon_notifications(amazon_subscription_id, amazon_destination_id, received_at DESC);

COMMENT ON TABLE amazon_notification_bindings IS 'Canonical Amazon notification ownership bindings by tenant/store/seller/subscription.';
COMMENT ON TABLE amazon_notifications IS 'Immutable raw Amazon notification intake history with durable dedupe, routing, and sync linkage.';
