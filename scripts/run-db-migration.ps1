# PowerShell script to run database migration
# Creates audit_logs table for security event logging

param(
    [Parameter(Mandatory=$true)]
    [string]$DatabaseUrl,
    
    [switch]$Verify = $false
)

Write-Host "🔧 Running Database Migration" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan
Write-Host ""

# Check if psql is available
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlPath) {
    Write-Host "❌ psql not found in PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install PostgreSQL client tools or use Supabase SQL Editor:" -ForegroundColor Yellow
    Write-Host "1. Go to Supabase Dashboard → SQL Editor" -ForegroundColor Gray
    Write-Host "2. Copy contents of: Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql" -ForegroundColor Gray
    Write-Host "3. Paste and run in SQL Editor" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

$migrationFile = "Integrations-backend/src/database/migrations/001_create_audit_logs_table.sql"

if (-not (Test-Path $migrationFile)) {
    Write-Host "❌ Migration file not found: $migrationFile" -ForegroundColor Red
    exit 1
}

Write-Host "📄 Migration file: $migrationFile" -ForegroundColor Gray
Write-Host ""

# Run migration
Write-Host "Running migration..." -ForegroundColor Yellow
try {
    $env:PGPASSWORD = ($DatabaseUrl -split '@')[0] -replace '.*:', ''
    $result = & psql $DatabaseUrl -f $migrationFile 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Migration completed successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Migration failed:" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Error running migration: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ""

# Verify table exists
if ($Verify) {
    Write-Host "Verifying audit_logs table..." -ForegroundColor Yellow
    try {
        $verifyQuery = "SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_logs';"
        $verifyResult = & psql $DatabaseUrl -c $verifyQuery 2>&1
        
        if ($verifyResult -match "audit_logs") {
            Write-Host "✅ audit_logs table verified" -ForegroundColor Green
            
            # Check table structure
            Write-Host ""
            Write-Host "Table structure:" -ForegroundColor Yellow
            & psql $DatabaseUrl -c "\d audit_logs" 2>&1 | Write-Host
            
            # Check indexes
            Write-Host ""
            Write-Host "Indexes:" -ForegroundColor Yellow
            & psql $DatabaseUrl -c "SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs';" 2>&1 | Write-Host
        } else {
            Write-Host "⚠️  Could not verify table (check manually)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "⚠️  Verification failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "✅ Migration complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Set environment variables in production" -ForegroundColor Gray
Write-Host "2. Test production endpoints" -ForegroundColor Gray
Write-Host "3. Monitor audit logs" -ForegroundColor Gray

