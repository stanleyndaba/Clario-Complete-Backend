# Opside Backend Database Migration Script
# Run this script to migrate all databases to production

param(
    [string]$SupabaseUrl = "",
    [string]$SupabasePassword = "",
    [switch]$Force = $false
)

Write-Host "🗄️ Opside Backend Database Migration" -ForegroundColor Green

# Check if Fly CLI is installed
if (!(Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Fly CLI not found. Please install it first." -ForegroundColor Red
    exit 1
}

# Prompt for missing values
if ([string]::IsNullOrEmpty($SupabaseUrl)) {
    $SupabaseUrl = Read-Host "Enter your Supabase URL (https://your-project.supabase.co)"
}

if ([string]::IsNullOrEmpty($SupabasePassword)) {
    $SupabasePassword = Read-Host "Enter your Supabase database password"
}

$projectId = $SupabaseUrl.Replace('https://', '').Replace('.supabase.co', '')
$databaseUrl = "postgresql://postgres:$SupabasePassword@db.$projectId:5432/postgres"

Write-Host "`n🔧 Running migrations for main-api..." -ForegroundColor Yellow

# Main API migrations
fly ssh console -a opside-main-api -C "python scripts/migrate_to_postgresql.py"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ main-api migrations completed" -ForegroundColor Green
} else {
    Write-Host "❌ main-api migrations failed" -ForegroundColor Red
    if (!$Force) { exit 1 }
}

Write-Host "`n🔧 Running migrations for integrations-backend..." -ForegroundColor Yellow

# Integrations Backend migrations
fly ssh console -a opside-integrations-backend -C "npm run db:migrate"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ integrations-backend migrations completed" -ForegroundColor Green
} else {
    Write-Host "❌ integrations-backend migrations failed" -ForegroundColor Red
    if (!$Force) { exit 1 }
}

Write-Host "`n🔧 Running migrations for stripe-payments..." -ForegroundColor Yellow

# Stripe Payments migrations
fly ssh console -a opside-stripe-payments -C "npx prisma migrate deploy"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ stripe-payments migrations completed" -ForegroundColor Green
} else {
    Write-Host "❌ stripe-payments migrations failed" -ForegroundColor Red
    if (!$Force) { exit 1 }
}

Write-Host "`n🔧 Running migrations for cost-docs..." -ForegroundColor Yellow

# Cost Documentation migrations
fly ssh console -a opside-cost-docs -C "npx prisma migrate deploy"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ cost-docs migrations completed" -ForegroundColor Green
} else {
    Write-Host "❌ cost-docs migrations failed" -ForegroundColor Red
    if (!$Force) { exit 1 }
}

Write-Host "`n🔧 Running migrations for refund-engine..." -ForegroundColor Yellow

# Refund Engine migrations
fly ssh console -a opside-refund-engine -C "npm run db:migrate"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ refund-engine migrations completed" -ForegroundColor Green
} else {
    Write-Host "❌ refund-engine migrations failed" -ForegroundColor Red
    if (!$Force) { exit 1 }
}

Write-Host "`n🔧 Running migrations for mcde..." -ForegroundColor Yellow

# MCDE migrations
fly ssh console -a opside-mcde -C "python -c 'import psycopg2; conn = psycopg2.connect(\"$databaseUrl\"); cur = conn.cursor(); cur.execute(open(\"migrations/001_create_detection_tables.sql\").read()); conn.commit(); conn.close()'"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ mcde migrations completed" -ForegroundColor Green
} else {
    Write-Host "❌ mcde migrations failed" -ForegroundColor Red
    if (!$Force) { exit 1 }
}

Write-Host "`n🎉 All database migrations completed!" -ForegroundColor Green
Write-Host "`n📋 Next steps:" -ForegroundColor Yellow
Write-Host "1. Verify database connections" -ForegroundColor White
Write-Host "2. Test all service endpoints" -ForegroundColor White
Write-Host "3. Check service logs for any errors" -ForegroundColor White
Write-Host "4. Run health checks" -ForegroundColor White

