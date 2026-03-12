-- 066: Add idempotency constraints for CSV upsert
-- Prevents duplicate inventory_ledger_events when the same CSV is uploaded multiple times.
-- Uses reference_id (Amazon's receipt/transaction ID) instead of quantity,
-- because two shipments of the same quantity CAN arrive on the same day.

-- Unique constraint on inventory_ledger_events for upsert conflict resolution
ALTER TABLE inventory_ledger_events
  ADD CONSTRAINT uq_ledger_event
  UNIQUE (user_id, fnsku, event_type, event_date, reference_id);
