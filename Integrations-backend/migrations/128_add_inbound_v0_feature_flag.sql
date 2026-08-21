-- P1 Inbound Inspector: leave canonical Fulfillment Inbound v0 disabled until live certification.
-- Modes are operationally explicit: OFF (no read/no detection), SHADOW (read only), ON (claim-capable).
INSERT INTO feature_flags (
  flag_name,
  description,
  flag_type,
  is_enabled,
  rollout_percentage,
  conditions,
  payload,
  metrics,
  auto_expand
)
VALUES (
  'connected_inbound_v0_primary',
  'Uses canonical Amazon Fulfillment Inbound v0 receiving data for supported Inbound Inspector branches only.',
  'feature',
  false,
  0,
  '{}'::jsonb,
  '{"mode":"OFF"}'::jsonb,
  '{}'::jsonb,
  false
)
ON CONFLICT (flag_name) DO UPDATE
SET
  description = EXCLUDED.description,
  flag_type = EXCLUDED.flag_type,
  is_enabled = false,
  rollout_percentage = 0,
  payload = '{"mode":"OFF"}'::jsonb,
  auto_expand = false,
  updated_at = NOW();
