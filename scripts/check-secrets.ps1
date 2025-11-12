# PowerShell script to check for secrets in repository
# Scans codebase for hard-coded secrets and tokens

Write-Host "🔒 Checking for Secrets in Repository" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

$errors = 0
$warnings = 0

# Patterns to check for secrets
$secretPatterns = @{
    "Amazon Client ID" = "amzn1\.application-oa2-client\.[a-zA-Z0-9]{20,}"
    "Amazon Client Secret" = "amzn1\.oa2-cs\.v1\.[a-zA-Z0-9]{20,}"
    "Amazon Refresh Token" = "Atzr\|[a-zA-Z0-9\-_]{50,}"
    "Stripe Live Key" = "sk_live_[a-zA-Z0-9]{20,}"
    "Stripe Test Key" = "sk_test_[a-zA-Z0-9]{20,}"
    "SendGrid API Key" = "SG\.[a-zA-Z0-9\-_]{50,}"
    "JWT Secret" = "eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+"
    "Database Password" = "postgresql://[^:]+:[^@]+@"
}

# Exclude patterns (files/directories to skip)
$excludePatterns = @(
    "node_modules",
    ".git",
    "dist",
    "build",
    ".env.example",
    ".env.production.example",
    "package-lock.json",
    "yarn.lock",
    "*.log",
    "PHASE1_SECURITY_HARDENING_SUMMARY.md",
    "RENDER_ENV_VARS_READY.md"
)

Write-Host "Scanning repository for secrets..." -ForegroundColor Yellow
Write-Host ""

$foundSecrets = @()

foreach ($patternName in $secretPatterns.Keys) {
    $pattern = $secretPatterns[$patternName]
    Write-Host "Checking for $patternName..." -ForegroundColor Gray
    
    $files = Get-ChildItem -Recurse -File -Include *.ts,*.js,*.py,*.md,*.json,*.txt,*.yml,*.yaml |
        Where-Object {
            $shouldExclude = $false
            foreach ($exclude in $excludePatterns) {
                if ($_.FullName -match $exclude) {
                    $shouldExclude = $true
                    break
                }
            }
            -not $shouldExclude
        }
    
    foreach ($file in $files) {
        try {
            $content = Get-Content $file.FullName -Raw -ErrorAction Stop
            if ($content -match $pattern) {
                # Check if it's a placeholder or example
                $line = $content -split "`n" | Where-Object { $_ -match $pattern } | Select-Object -First 1
                if ($line -notmatch "your-|placeholder|example|change-in-production|TODO|FIXME") {
                    $foundSecrets += @{
                        Pattern = $patternName
                        File = $file.FullName
                        Line = $line.Trim()
                    }
                }
            }
        } catch {
            # Skip files that can't be read
        }
    }
}

if ($foundSecrets.Count -gt 0) {
    Write-Host ""
    Write-Host "❌ Found potential secrets:" -ForegroundColor Red
    foreach ($secret in $foundSecrets) {
        Write-Host "  Pattern: $($secret.Pattern)" -ForegroundColor Red
        Write-Host "  File: $($secret.File)" -ForegroundColor Red
        Write-Host "  Line: $($secret.Line.Substring(0, [Math]::Min(100, $secret.Line.Length)))..." -ForegroundColor Red
        Write-Host ""
    }
    $errors += $foundSecrets.Count
} else {
    Write-Host ""
    Write-Host "✅ No hard-coded secrets found" -ForegroundColor Green
}

# Check for .env files in git
Write-Host ""
Write-Host "Checking for .env files in git..." -ForegroundColor Yellow
$envFiles = git ls-files 2>$null | Select-String "\.env$"
if ($envFiles) {
    Write-Host "  ❌ Found .env files in git:" -ForegroundColor Red
    foreach ($file in $envFiles) {
        Write-Host "     - $file" -ForegroundColor Red
    }
    $errors++
} else {
    Write-Host "  ✅ No .env files in git" -ForegroundColor Green
}

# Summary
Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Secret Check Summary" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Secrets found: $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "Warnings: $warnings" -ForegroundColor $(if ($warnings -gt 0) { "Yellow" } else { "Green" })

if ($errors -gt 0) {
    Write-Host ""
    Write-Host "❌ Secret check failed" -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "✅ Secret check passed" -ForegroundColor Green
    exit 0
}

