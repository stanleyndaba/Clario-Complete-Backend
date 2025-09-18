-- Migration: Cost Documentation Module v1.0 → v1.1
-- Add metadata, audit trail, and export functionality

-- Add new columns to GeneratedPDF table
ALTER TABLE "GeneratedPDF" ADD COLUMN "template_version" TEXT DEFAULT '1.0';
ALTER TABLE "GeneratedPDF" ADD COLUMN "content_hash" TEXT;
ALTER TABLE "GeneratedPDF" ADD COLUMN "linked_tx_ids" TEXT[];
ALTER TABLE "GeneratedPDF" ADD COLUMN "status" TEXT DEFAULT 'DRAFT';
ALTER TABLE "GeneratedPDF" ADD COLUMN "locked_at" TIMESTAMP(3);
ALTER TABLE "GeneratedPDF" ADD COLUMN "locked_by" TEXT;
ALTER TABLE "GeneratedPDF" ADD COLUMN "exported_at" TIMESTAMP(3);
ALTER TABLE "GeneratedPDF" ADD COLUMN "exported_by" TEXT;
ALTER TABLE "GeneratedPDF" ADD COLUMN "export_bundle_id" TEXT;

-- Create new indexes
CREATE INDEX "GeneratedPDF_status_idx" ON "GeneratedPDF"("status");
CREATE INDEX "GeneratedPDF_content_hash_idx" ON "GeneratedPDF"("content_hash");
CREATE INDEX "GeneratedPDF_locked_at_idx" ON "GeneratedPDF"("locked_at");
CREATE INDEX "GeneratedPDF_exported_at_idx" ON "GeneratedPDF"("exported_at");

-- Create CostDocAuditLog table
CREATE TABLE "CostDocAuditLog" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "prev_hash" TEXT,
    "new_hash" TEXT,
    "details" JSONB,

    CONSTRAINT "CostDocAuditLog_pkey" PRIMARY KEY ("id")
);

-- Create ExportBundle table
CREATE TABLE "ExportBundle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "s3_key" TEXT NOT NULL,
    "s3_url" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "document_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ExportBundle_pkey" PRIMARY KEY ("id")
);

-- Create ExportBundleItem table
CREATE TABLE "ExportBundleItem" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,

    CONSTRAINT "ExportBundleItem_pkey" PRIMARY KEY ("id")
);

-- Create NotificationLog table
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_data" JSONB NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "is_read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- Create indexes for new tables
CREATE INDEX "CostDocAuditLog_doc_id_idx" ON "CostDocAuditLog"("doc_id");
CREATE INDEX "CostDocAuditLog_event_idx" ON "CostDocAuditLog"("event");
CREATE INDEX "CostDocAuditLog_timestamp_idx" ON "CostDocAuditLog"("timestamp");
CREATE INDEX "CostDocAuditLog_actor_idx" ON "CostDocAuditLog"("actor");

CREATE INDEX "ExportBundle_created_by_idx" ON "ExportBundle"("created_by");
CREATE INDEX "ExportBundle_created_at_idx" ON "ExportBundle"("created_at");
CREATE INDEX "ExportBundle_status_idx" ON "ExportBundle"("status");

CREATE INDEX "ExportBundleItem_bundle_id_idx" ON "ExportBundleItem"("bundle_id");
CREATE INDEX "ExportBundleItem_document_id_idx" ON "ExportBundleItem"("document_id");

CREATE INDEX "NotificationLog_event_type_idx" ON "NotificationLog"("event_type");
CREATE INDEX "NotificationLog_user_id_idx" ON "NotificationLog"("user_id");
CREATE INDEX "NotificationLog_created_at_idx" ON "NotificationLog"("created_at");
CREATE INDEX "NotificationLog_is_read_idx" ON "NotificationLog"("is_read");

-- Add foreign key constraints
ALTER TABLE "CostDocAuditLog" ADD CONSTRAINT "CostDocAuditLog_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "GeneratedPDF"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExportBundleItem" ADD CONSTRAINT "ExportBundleItem_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "ExportBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExportBundleItem" ADD CONSTRAINT "ExportBundleItem_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "GeneratedPDF"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add foreign key constraint for export_bundle_id in GeneratedPDF
ALTER TABLE "GeneratedPDF" ADD CONSTRAINT "GeneratedPDF_export_bundle_id_fkey" FOREIGN KEY ("export_bundle_id") REFERENCES "ExportBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create enum types (PostgreSQL)
DO $$ BEGIN
    CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'LOCKED', 'EXPORTED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "AuditEvent" AS ENUM ('CREATED', 'UPDATED', 'LOCKED', 'EXPORTED', 'REFRESHED', 'SYNC_WARNING');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ExportStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Update existing GeneratedPDF records to have default values
UPDATE "GeneratedPDF" SET 
    "template_version" = '1.0',
    "status" = 'DRAFT',
    "content_hash" = encode(sha256(pdf_s3_key::bytea), 'hex')
WHERE "content_hash" IS NULL;

-- Create audit log entries for existing documents
INSERT INTO "CostDocAuditLog" ("id", "doc_id", "timestamp", "actor", "event", "new_hash", "details")
SELECT 
    gen_random_uuid()::text,
    id,
    generated_at,
    'system',
    'CREATED',
    encode(sha256(pdf_s3_key::bytea), 'hex'),
    '{"migration": "v1.0_to_v1.1", "auto_generated": true}'
FROM "GeneratedPDF";

-- Add comments for documentation
COMMENT ON TABLE "GeneratedPDF" IS 'Cost documentation PDFs with metadata and status tracking';
COMMENT ON TABLE "CostDocAuditLog" IS 'Audit trail for all cost documentation actions';
COMMENT ON TABLE "ExportBundle" IS 'Bundles of exported cost documentation PDFs';
COMMENT ON TABLE "ExportBundleItem" IS 'Individual documents within export bundles';
COMMENT ON TABLE "NotificationLog" IS 'System notifications for export events and sync warnings';

COMMENT ON COLUMN "GeneratedPDF"."content_hash" IS 'SHA256 hash of final PDF content for immutability verification';
COMMENT ON COLUMN "GeneratedPDF"."linked_tx_ids" IS 'Array of related transaction IDs from detection pipeline';
COMMENT ON COLUMN "GeneratedPDF"."status" IS 'Document lifecycle status: DRAFT, LOCKED, EXPORTED, ARCHIVED';
COMMENT ON COLUMN "GeneratedPDF"."locked_at" IS 'Timestamp when document was locked (made immutable)';
COMMENT ON COLUMN "GeneratedPDF"."exported_at" IS 'Timestamp when document was included in an export bundle';


