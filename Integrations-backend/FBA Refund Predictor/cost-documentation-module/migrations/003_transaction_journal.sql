-- Transaction Journal (append-only) migration

CREATE TABLE IF NOT EXISTS "TransactionJournal" (
    id TEXT PRIMARY KEY,
    tx_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id TEXT NOT NULL,
    hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "TransactionJournal_tx_type_idx" ON "TransactionJournal"(tx_type);
CREATE INDEX IF NOT EXISTS "TransactionJournal_entity_id_idx" ON "TransactionJournal"(entity_id);
CREATE INDEX IF NOT EXISTS "TransactionJournal_actor_id_idx" ON "TransactionJournal"(actor_id);
CREATE INDEX IF NOT EXISTS "TransactionJournal_timestamp_idx" ON "TransactionJournal"(timestamp);

-- Enforce append-only: disallow UPDATE and DELETE
CREATE OR REPLACE FUNCTION forbid_update_delete_transaction_journal()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TransactionJournal is append-only; % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaction_journal_no_update ON "TransactionJournal";
CREATE TRIGGER trg_transaction_journal_no_update
BEFORE UPDATE ON "TransactionJournal"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete_transaction_journal();

DROP TRIGGER IF EXISTS trg_transaction_journal_no_delete ON "TransactionJournal";
CREATE TRIGGER trg_transaction_journal_no_delete
BEFORE DELETE ON "TransactionJournal"
FOR EACH ROW EXECUTE FUNCTION forbid_update_delete_transaction_journal();

COMMENT ON TABLE "TransactionJournal" IS 'Immutable append-only journal of domain transactions.';
COMMENT ON COLUMN "TransactionJournal".hash IS 'sha256(payload + timestamp ISO8601 + actor_id)';


