-- Migration: Create referral_invites table
-- Purpose: Store seller referral invitations

CREATE TABLE IF NOT EXISTS referral_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id TEXT NOT NULL,  -- User who sent the invite
    invitee_email TEXT NOT NULL,  -- Email of the person being invited
    referral_link TEXT NOT NULL,  -- The referral signup link
    message TEXT,  -- Custom message from referrer
    status TEXT NOT NULL DEFAULT 'sent',  -- sent, opened, clicked, signed_up, resent
    email_sent_at TIMESTAMPTZ,  -- When the email was actually delivered
    opened_at TIMESTAMPTZ,  -- When they opened the email (if tracked)
    clicked_at TIMESTAMPTZ,  -- When they clicked the link
    signed_up_at TIMESTAMPTZ,  -- When they completed signup
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_referral_invites_referrer_id ON referral_invites(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_invites_invitee_email ON referral_invites(invitee_email);
CREATE INDEX IF NOT EXISTS idx_referral_invites_status ON referral_invites(status);
CREATE INDEX IF NOT EXISTS idx_referral_invites_created_at ON referral_invites(created_at);

-- Comments
COMMENT ON TABLE referral_invites IS 'Stores seller referral invitations for the referral program';
COMMENT ON COLUMN referral_invites.referrer_id IS 'User ID of the seller who sent the invitation';
COMMENT ON COLUMN referral_invites.status IS 'Invitation status: sent, opened, clicked, signed_up, resent';
