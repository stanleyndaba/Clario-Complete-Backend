-- Unified parsed metadata view for evidence documents
-- Provides a single source of truth for matching by coalescing parsed_metadata with a mapped form of extracted_data

CREATE OR REPLACE VIEW evidence_documents_unified AS
SELECT
  ed.id,
  ed.user_id,
  COALESCE(
    ed.parsed_metadata,
    jsonb_strip_nulls(
      jsonb_build_object(
        'invoice_number', to_jsonb(ed.extracted_data->>'order_ids') -> 0,
        'total_amount', NULL,
        'invoice_date', NULL
      )
    )
  ) AS parsed_metadata_unified,
  COALESCE(ed.parser_confidence, 0.5) AS parser_confidence
FROM evidence_documents ed;

