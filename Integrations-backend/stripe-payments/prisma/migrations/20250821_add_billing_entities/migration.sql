-- Create StripeCustomer
CREATE TABLE IF NOT EXISTS "StripeCustomer" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL UNIQUE,
  "stripeCustomerId" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "StripeCustomer_stripeCustomerId_idx" ON "StripeCustomer" ("stripeCustomerId");

-- Create StripeSubscription
CREATE TABLE IF NOT EXISTS "StripeSubscription" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "stripeSubscriptionId" TEXT NOT NULL UNIQUE,
  "stripeCustomerId" TEXT NOT NULL,
  "priceId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "currentPeriodStart" TIMESTAMP WITH TIME ZONE,
  "currentPeriodEnd" TIMESTAMP WITH TIME ZONE,
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT FALSE,
  "canceledAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "StripeSubscription_userId_idx" ON "StripeSubscription" ("userId");
CREATE INDEX IF NOT EXISTS "StripeSubscription_stripeCustomerId_idx" ON "StripeSubscription" ("stripeCustomerId");

-- Create StripeInvoice
CREATE TABLE IF NOT EXISTS "StripeInvoice" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "stripeInvoiceId" TEXT NOT NULL UNIQUE,
  "stripeCustomerId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "amountDueCents" INTEGER NOT NULL DEFAULT 0,
  "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
  "hostedInvoiceUrl" TEXT,
  "invoicePdf" TEXT,
  "paymentIntentId" TEXT,
  "chargeId" TEXT,
  "issuedAt" TIMESTAMP WITH TIME ZONE,
  "periodStart" TIMESTAMP WITH TIME ZONE,
  "periodEnd" TIMESTAMP WITH TIME ZONE,
  "metadata" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "StripeInvoice_userId_idx" ON "StripeInvoice" ("userId");
CREATE INDEX IF NOT EXISTS "StripeInvoice_stripeCustomerId_idx" ON "StripeInvoice" ("stripeCustomerId");
CREATE INDEX IF NOT EXISTS "StripeInvoice_status_idx" ON "StripeInvoice" ("status");
CREATE INDEX IF NOT EXISTS "StripeInvoice_createdAt_idx" ON "StripeInvoice" ("createdAt");

-- Backfill relationship on existing StripeTransaction
ALTER TABLE "StripeTransaction"
  ADD COLUMN IF NOT EXISTS "stripeInvoiceId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePaymentMethodId" TEXT;

CREATE INDEX IF NOT EXISTS "StripeTransaction_stripeInvoiceId_idx" ON "StripeTransaction" ("stripeInvoiceId");
CREATE INDEX IF NOT EXISTS "StripeTransaction_stripeCustomerId_idx" ON "StripeTransaction" ("stripeCustomerId");







