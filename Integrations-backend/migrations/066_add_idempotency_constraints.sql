-- 066: Add idempotency constraints for CSV upsert
-- Prevents duplicate inventory_ledger_events when the same CSV is uploaded multiple times.
-- Uses reference_id (Amazon's receipt/transaction ID) instead of quantity,
-- because two shipments of the same quantity CAN arrive on the same day.

-- Step 1: Remove existing duplicate rows (keep only the newest per natural key).
-- This cleans up the damage caused by the old .insert() bug.
DELETE FROM inventory_ledger_events
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, fnsku, event_type, event_date, reference_id) id
    FROM inventory_ledger_events
    ORDER BY user_id, fnsku, event_type, event_date, reference_id, created_at DESC
);

-- Step 2: Now that duplicates are gone, add the unique constraint.
ALTER TABLE inventory_ledger_events
  ADD CONSTRAINT uq_ledger_event
  UNIQUE (user_id, fnsku, event_type, event_date, reference_id);
