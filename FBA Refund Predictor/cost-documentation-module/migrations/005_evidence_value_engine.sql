-- Extend Claim + add EvidenceLink and ProofBundle (append-only)

ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "anomaly_score" DOUBLE PRECISION;
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "claim_type" TEXT;
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "proof_bundle_id" TEXT;

CREATE TABLE IF NOT EXISTS "ProofBundle" (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  hash TEXT NOT NULL,
  timestamp TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProofBundle_hash_idx" ON "ProofBundle"(hash);
CREATE INDEX IF NOT EXISTS "ProofBundle_actor_idx" ON "ProofBundle"(actor_id);

CREATE TABLE IF NOT EXISTS "EvidenceLink" (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  ocr_text TEXT NOT NULL,
  ner_entities JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EvidenceLink_claim_id_idx" ON "EvidenceLink"(claim_id);

ALTER TABLE "Claim" ADD CONSTRAINT "Claim_proof_bundle_id_fkey" FOREIGN KEY ("proof_bundle_id") REFERENCES "ProofBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only triggers for ProofBundle
CREATE OR REPLACE FUNCTION forbid_update_delete_proofbundle() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ProofBundle is append-only; % not allowed', TG_OP;
END;$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proofbundle_no_update ON "ProofBundle";
CREATE TRIGGER trg_proofbundle_no_update BEFORE UPDATE ON "ProofBundle" FOR EACH ROW EXECUTE FUNCTION forbid_update_delete_proofbundle();
DROP TRIGGER IF EXISTS trg_proofbundle_no_delete ON "ProofBundle";
CREATE TRIGGER trg_proofbundle_no_delete BEFORE DELETE ON "ProofBundle" FOR EACH ROW EXECUTE FUNCTION forbid_update_delete_proofbundle();


