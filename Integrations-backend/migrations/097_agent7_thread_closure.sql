-- Migration: 097_agent7_thread_closure
-- Purpose: give Agent 7 an owned Amazon support thread with linked case messages and email-driven case state.

ALTER TABLE dispute_cases
  ADD COLUMN IF NOT EXISTS case_state TEXT
    CHECK (
      case_state IS NULL
      OR case_state IN ('unlinked', 'pending', 'needs_evidence', 'approved', 'rejected', 'paid')
    );

DO $$
DECLARE
  has_dispute_case_write_trigger BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'dispute_cases'::regclass
      AND tgname = 'enforce_tenant_active_dispute_cases'
      AND NOT tgisinternal
  ) INTO has_dispute_case_write_trigger;

  IF has_dispute_case_write_trigger THEN
    EXECUTE 'ALTER TABLE dispute_cases DISABLE TRIGGER enforce_tenant_active_dispute_cases';
  END IF;

  UPDATE dispute_cases
  SET amazon_case_id = NULLIF(BTRIM(COALESCE(amazon_case_id, provider_case_id, '')), '')
  WHERE COALESCE(NULLIF(BTRIM(amazon_case_id), ''), NULLIF(BTRIM(provider_case_id), '')) IS NOT NULL
    AND (amazon_case_id IS NULL OR BTRIM(amazon_case_id) = '');

  WITH duplicate_amazon_cases AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY BTRIM(amazon_case_id)
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
      ) AS duplicate_rank
    FROM dispute_cases
    WHERE amazon_case_id IS NOT NULL
      AND BTRIM(amazon_case_id) <> ''
  )
  UPDATE dispute_cases dc
  SET
    amazon_case_id = NULL,
    case_state = 'unlinked',
    updated_at = NOW()
  FROM duplicate_amazon_cases dup
  WHERE dc.id = dup.id
    AND dup.duplicate_rank > 1;

  UPDATE dispute_cases
  SET case_state = CASE
    WHEN amazon_case_id IS NULL OR BTRIM(amazon_case_id) = '' THEN 'unlinked'
    ELSE COALESCE(case_state, 'pending')
  END
  WHERE case_state IS NULL
     OR (
       case_state <> 'unlinked'
       AND (amazon_case_id IS NULL OR BTRIM(amazon_case_id) = '')
     );

  IF has_dispute_case_write_trigger THEN
    EXECUTE 'ALTER TABLE dispute_cases ENABLE TRIGGER enforce_tenant_active_dispute_cases';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    IF has_dispute_case_write_trigger THEN
      BEGIN
        EXECUTE 'ALTER TABLE dispute_cases ENABLE TRIGGER enforce_tenant_active_dispute_cases';
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;
    RAISE;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_cases_amazon_case_id_truth
  ON dispute_cases ((BTRIM(amazon_case_id)))
  WHERE amazon_case_id IS NOT NULL
    AND BTRIM(amazon_case_id) <> '';

CREATE TABLE IF NOT EXISTS case_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  amazon_case_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gmail'
    CHECK (provider IN ('gmail')),
  provider_message_id TEXT NOT NULL,
  provider_thread_id TEXT,
  message_identifier TEXT,
  in_reply_to TEXT,
  reference_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  direction TEXT NOT NULL
    CHECK (direction IN ('inbound', 'outbound')),
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  sender TEXT,
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  received_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  state_signal TEXT
    CHECK (
      state_signal IS NULL
      OR state_signal IN ('pending', 'needs_evidence', 'approved', 'rejected', 'paid')
    ),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_case_messages_provider_message
  ON case_messages(tenant_id, provider, provider_message_id);

CREATE INDEX IF NOT EXISTS idx_case_messages_case_created
  ON case_messages(dispute_case_id, COALESCE(received_at, sent_at, created_at) ASC);

CREATE INDEX IF NOT EXISTS idx_case_messages_amazon_case_id
  ON case_messages(tenant_id, amazon_case_id, COALESCE(received_at, sent_at, created_at) DESC);

CREATE TABLE IF NOT EXISTS unmatched_case_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  amazon_case_id TEXT,
  provider TEXT NOT NULL DEFAULT 'gmail'
    CHECK (provider IN ('gmail')),
  provider_message_id TEXT NOT NULL,
  provider_thread_id TEXT,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  sender TEXT,
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  received_at TIMESTAMPTZ,
  failure_reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_unmatched_case_messages_provider_message
  ON unmatched_case_messages(tenant_id, provider, provider_message_id);

CREATE INDEX IF NOT EXISTS idx_unmatched_case_messages_case_lookup
  ON unmatched_case_messages(tenant_id, amazon_case_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS update_case_messages_updated_at ON case_messages;
    CREATE TRIGGER update_case_messages_updated_at
      BEFORE UPDATE ON case_messages
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON COLUMN dispute_cases.case_state IS 'Amazon thread-owned Agent 7 case state. unlinked when no canonical amazon_case_id exists.';
COMMENT ON TABLE case_messages IS 'Canonical Amazon support thread messages linked to dispute cases.';
COMMENT ON TABLE unmatched_case_messages IS 'Inbound Amazon-support emails that could not be linked to a dispute case without guessing.';
