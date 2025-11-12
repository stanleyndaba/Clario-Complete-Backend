#!/bin/bash
# Run database migration for audit_logs table
# Usage: ./scripts/run-migration.sh [DATABASE_URL]

set -e

DATABASE_URL=${1:-${DATABASE_URL}}

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL not provided"
    echo "Usage: $0 [DATABASE_URL]"
    echo "Or set DATABASE_URL environment variable"
    exit 1
fi

echo "🔧 Running audit_logs table migration..."

# Run migration
psql "$DATABASE_URL" -f Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql

echo "✅ Migration completed"

# Verify table exists
echo "🔍 Verifying audit_logs table..."
psql "$DATABASE_URL" -c "\d audit_logs" || {
    echo "❌ Table audit_logs does not exist"
    exit 1
}

echo "✅ audit_logs table verified"

