-- RLS Policies for Evidence & Value Engine
-- Ensures append-only writes to ProofBundle, EvidenceLink, and Claim tables

-- 1. Enable RLS on tables
ALTER TABLE "ProofBundle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Claim" ENABLE ROW LEVEL SECURITY;

-- 2. ProofBundle: Insert only, no updates/deletes
CREATE POLICY "proof_bundle_insert_only" ON "ProofBundle"
    FOR INSERT WITH CHECK (true);

CREATE POLICY "proof_bundle_select_own" ON "ProofBundle"
    FOR SELECT USING (true);

-- Deny updates and deletes
CREATE POLICY "proof_bundle_no_updates" ON "ProofBundle"
    FOR UPDATE USING (false);

CREATE POLICY "proof_bundle_no_deletes" ON "ProofBundle"
    FOR DELETE USING (false);

-- 3. EvidenceLink: Insert only, no updates/deletes
CREATE POLICY "evidence_link_insert_only" ON "EvidenceLink"
    FOR INSERT WITH CHECK (true);

CREATE POLICY "evidence_link_select_own" ON "EvidenceLink"
    FOR SELECT USING (true);

-- Deny updates and deletes
CREATE POLICY "evidence_link_no_updates" ON "EvidenceLink"
    FOR UPDATE USING (false);

CREATE POLICY "evidence_link_no_deletes" ON "EvidenceLink"
    FOR DELETE USING (false);

-- 4. Claim: Insert and select, limited updates (status only), no deletes
CREATE POLICY "claim_insert_only" ON "Claim"
    FOR INSERT WITH CHECK (true);

CREATE POLICY "claim_select_own" ON "Claim"
    FOR SELECT USING (true);

-- Allow only status updates, no other field modifications
CREATE POLICY "claim_status_update_only" ON "Claim"
    FOR UPDATE USING (true)
    WITH CHECK (
        -- Only allow updating status field
        (SELECT COUNT(*) FROM jsonb_object_keys(to_jsonb(NEW.*) - to_jsonb(OLD.*))) = 1
        AND 
        (to_jsonb(NEW.*) - to_jsonb(OLD.*)) ? 'status'
    );

-- Deny deletes
CREATE POLICY "claim_no_deletes" ON "Claim"
    FOR DELETE USING (false);

-- 5. Create function to check if RLS is working
CREATE OR REPLACE FUNCTION check_rls_enforcement()
RETURNS TABLE (
    table_name text,
    rls_enabled boolean,
    policies_count integer,
    insert_policy text,
    update_policy text,
    delete_policy text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'ProofBundle'::text as table_name,
        (SELECT relrowsecurity FROM pg_class WHERE relname = 'ProofBundle') as rls_enabled,
        (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'ProofBundle') as policies_count,
        (SELECT policyname FROM pg_policies WHERE tablename = 'ProofBundle' AND cmd = 'INSERT') as insert_policy,
        (SELECT policyname FROM pg_policies WHERE tablename = 'ProofBundle' AND cmd = 'UPDATE') as update_policy,
        (SELECT policyname FROM pg_policies WHERE tablename = 'ProofBundle' AND cmd = 'DELETE') as delete_policy
    UNION ALL
    SELECT 
        'EvidenceLink'::text as table_name,
        (SELECT relrowsecurity FROM pg_class WHERE relname = 'EvidenceLink') as rls_enabled,
        (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'EvidenceLink') as policies_count,
        (SELECT policyname FROM pg_policies WHERE tablename = 'EvidenceLink' AND cmd = 'INSERT') as insert_policy,
        (SELECT policyname FROM pg_policies WHERE tablename = 'EvidenceLink' AND cmd = 'UPDATE') as update_policy,
        (SELECT policyname FROM pg_policies WHERE tablename = 'EvidenceLink' AND cmd = 'DELETE') as delete_policy
    UNION ALL
    SELECT 
        'Claim'::text as table_name,
        (SELECT relrowsecurity FROM pg_class WHERE relname = 'Claim') as rls_enabled,
        (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'Claim') as policies_count,
        (SELECT policyname FROM pg_policies WHERE tablename = 'Claim' AND cmd = 'INSERT') as insert_policy,
        (SELECT policyname FROM pg_policies WHERE tablename = 'Claim' AND cmd = 'UPDATE') as update_policy,
        (SELECT policyname FROM pg_policies WHERE tablename = 'Claim' AND cmd = 'DELETE') as delete_policy;
END;
$$ LANGUAGE plpgsql;

-- 6. Test RLS enforcement
-- Run this to verify policies are working:
-- SELECT * FROM check_rls_enforcement();

-- 7. Manual test queries (run as authenticated user)
-- These should succeed:
-- INSERT INTO "ProofBundle" (claim_id, payload, content_hash, created_at, created_by) VALUES (...);
-- INSERT INTO "EvidenceLink" (claim_id, link_type, link_value, created_by) VALUES (...);
-- INSERT INTO "Claim" (claimNumber, userId, status, amount, anomaly_score, claim_type, proof_bundle_id) VALUES (...);

-- These should fail:
-- UPDATE "ProofBundle" SET payload = '{}' WHERE id = 'some-id';  -- Should fail
-- DELETE FROM "ProofBundle" WHERE id = 'some-id';                -- Should fail
-- UPDATE "EvidenceLink" SET link_value = 'new-value' WHERE id = 'some-id';  -- Should fail
-- DELETE FROM "EvidenceLink" WHERE id = 'some-id';                          -- Should fail
-- UPDATE "Claim" SET amount = 999 WHERE id = 'some-id';         -- Should fail (not status)
-- DELETE FROM "Claim" WHERE id = 'some-id';                     -- Should fail

-- 8. Status update should work:
-- UPDATE "Claim" SET status = 'approved' WHERE id = 'some-id';  -- Should succeed
