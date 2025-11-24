-- Ensure StripeCustomer table exists (in case earlier migration hasn't run)
CREATE TABLE IF NOT EXISTS "StripeCustomer" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER UNIQUE,
  "stripeCustomerId" TEXT UNIQUE,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add externalUserId column for mapping Supabase UUIDs
ALTER TABLE "StripeCustomer"
ADD COLUMN IF NOT EXISTS "externalUserId" TEXT;

-- Backfill existing rows with deterministic legacy values (if any)
UPDATE "StripeCustomer"
SET "externalUserId" = CONCAT('legacy-', "id")
WHERE "externalUserId" IS NULL;

-- Enforce constraints on the new column
ALTER TABLE "StripeCustomer"
ALTER COLUMN "externalUserId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "StripeCustomer_externalUserId_key"
ON "StripeCustomer" ("externalUserId");

-- Allow stripeCustomerId to be null until a real Stripe customer exists
ALTER TABLE "StripeCustomer"
ALTER COLUMN "stripeCustomerId" DROP NOT NULL;

-- Drop the obsolete userId column if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'StripeCustomer' AND column_name = 'userId'
  ) THEN
    ALTER TABLE "StripeCustomer" DROP COLUMN "userId";
  END IF;
END $$;

