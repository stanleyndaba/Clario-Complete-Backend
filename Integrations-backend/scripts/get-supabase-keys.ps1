# Helper script to get Supabase credentials
Write-Host "`n🔍 Supabase Credential Finder" -ForegroundColor Cyan
Write-Host "=============================" -ForegroundColor Cyan

# Method 1: Check .env file
Write-Host "`n1️⃣ Checking .env file..." -ForegroundColor Yellow
if (Test-Path "Integrations-backend/.env") {
    $envContent = Get-Content "Integrations-backend/.env" -Raw
    if ($envContent -match "SUPABASE_URL=(.+)") {
        Write-Host "   ✅ SUPABASE_URL found" -ForegroundColor Green
        $url = $matches[1].Trim()
        Write-Host "      URL: $url" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️ SUPABASE_URL not found in .env" -ForegroundColor Yellow
    }
    
    if ($envContent -match "SUPABASE_ANON_KEY=(.+)") {
        Write-Host "   ✅ SUPABASE_ANON_KEY found" -ForegroundColor Green
        $key = $matches[1].Trim()
        if ($key.Length -gt 20) {
            Write-Host "      Key: $($key.Substring(0, 20))..." -ForegroundColor Gray
        }
    } else {
        Write-Host "   ⚠️ SUPABASE_ANON_KEY not found in .env" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ .env file not found" -ForegroundColor Red
}

# Method 2: Extract from DATABASE_URL
Write-Host "`n2️⃣ Checking DATABASE_URL for Supabase info..." -ForegroundColor Yellow
if (Test-Path "Integrations-backend/.env") {
    $envContent = Get-Content "Integrations-backend/.env" -Raw
    if ($envContent -match "DATABASE_URL=postgresql://[^@]+@([^:]+)") {
        $host = $matches[1]
        Write-Host "   ✅ Found Supabase host: $host" -ForegroundColor Green
        Write-Host "      Your Supabase URL should be: https://$host" -ForegroundColor Gray
    }
}

# Method 3: Instructions
Write-Host "`n3️⃣ How to Get Your Supabase Keys:" -ForegroundColor Yellow
Write-Host "   Step 1: Go to https://supabase.com/dashboard" -ForegroundColor White
Write-Host "   Step 2: Select your project" -ForegroundColor White
Write-Host "   Step 3: Go to Settings → API" -ForegroundColor White
Write-Host "   Step 4: Copy 'Project URL' (this is SUPABASE_URL)" -ForegroundColor White
Write-Host "   Step 5: Copy 'anon public' key (this is SUPABASE_ANON_KEY)" -ForegroundColor White
Write-Host "   Step 6: Copy 'service_role' key (this is SUPABASE_SERVICE_ROLE_KEY)" -ForegroundColor White
Write-Host "`n   Then add to .env file:" -ForegroundColor Gray
Write-Host "   SUPABASE_URL=https://your-project.supabase.co" -ForegroundColor White
Write-Host "   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." -ForegroundColor White
Write-Host "   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." -ForegroundColor White

Write-Host "`n✅ Script complete!" -ForegroundColor Green
