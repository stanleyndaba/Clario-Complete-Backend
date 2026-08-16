ALTER TABLE audit_intents
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_intents_idempotency_key
  ON audit_intents(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
