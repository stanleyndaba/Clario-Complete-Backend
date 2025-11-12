# PowerShell script to run PostgreSQL migration
# Uses psql if available, otherwise provides alternative methods

param(
    [string]$DatabaseUrl = "postgresql://postgres:Lungilemzila%4075@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
    [string]$MigrationFile = "Integrations-backend/migrations/004_add_financial_events_and_detection.sql"
)

Write-Host "`n🚀 Running Database Migration" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

# Check if migration file exists
if (-not (Test-Path $MigrationFile)) {
    Write-Host "❌ Migration file not found: $MigrationFile" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Migration file found: $MigrationFile" -ForegroundColor Green

# Try to find psql
$psqlPath = $null
$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
if ($psqlCommand) {
    $psqlPath = $psqlCommand.Source
} else {
    # Check common PostgreSQL installation paths
    $commonPaths = @(
        "C:\Program Files\PostgreSQL\*\bin\psql.exe",
        "C:\Program Files (x86)\PostgreSQL\*\bin\psql.exe"
    )
    foreach ($pattern in $commonPaths) {
        $matches = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
        if ($matches) {
            $psqlPath = $matches[0].FullName
            break
        }
    }
}

if ($psqlPath) {
    Write-Host "✅ Found psql: $psqlPath" -ForegroundColor Green
    Write-Host "`n📝 Executing migration..." -ForegroundColor Yellow
    
    # Parse connection string
    if ($DatabaseUrl -match "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)") {
        $dbUsername = $matches[1]
        $dbPassword = [System.Web.HttpUtility]::UrlDecode($matches[2])
        $dbHost = $matches[3]
        $dbPort = $matches[4]
        $dbName = $matches[5]
        
        # Set PGPASSWORD environment variable
        $env:PGPASSWORD = $dbPassword
        
        # Run migration
        $migrationContent = Get-Content $MigrationFile -Raw
        $migrationContent | & $psqlPath -h $dbHost -p $dbPort -U $dbUsername -d $dbName
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "`n✅ Migration completed successfully!" -ForegroundColor Green
        } else {
            Write-Host "`n❌ Migration failed with exit code: $LASTEXITCODE" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "❌ Could not parse database URL" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ psql not found" -ForegroundColor Red
    Write-Host "`n💡 Options:" -ForegroundColor Yellow
    Write-Host "   1. Install PostgreSQL client tools" -ForegroundColor Gray
    Write-Host "   2. Use Supabase SQL Editor (recommended)" -ForegroundColor Gray
    Write-Host "   3. Use Docker with PostgreSQL client" -ForegroundColor Gray
    exit 1
}
