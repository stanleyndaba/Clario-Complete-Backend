# Phase 2 Hardening Remediation Guide
## Quick Fix for 3 Failing Checks

## 🎯 Priority Fixes

### 1. Database URL Not Set

**Issue**: `DATABASE_URL` environment variable is not set.

**Fix**:

**Option A: Set in Environment (Recommended)**
```bash
# Linux/macOS
export DATABASE_URL="postgresql://user:password@host:5432/database"

# Windows PowerShell
$env:DATABASE_URL = "postgresql://user:password@host:5432/database"

# Windows CMD
set DATABASE_URL=postgresql://user:password@host:5432/database
```

**Option B: Set in Hosting Provider**
- **Render**: Environment → Add Variable → `DATABASE_URL`
- **Vercel**: Settings → Environment Variables → `DATABASE_URL`
- **Heroku**: Settings → Config Vars → `DATABASE_URL`
- **Supabase**: Project Settings → Database → Connection String

**Option C: Use .env File (Development Only)**
```bash
# .env
DATABASE_URL=postgresql://user:password@localhost:5432/clario_db
```

**Verify**:
```bash
# Check if set
echo $DATABASE_URL  # Linux/macOS
echo $env:DATABASE_URL  # PowerShell

# Test connection
psql "$DATABASE_URL" -c '\dt'
```

---

### 2. Credentials Present in .env

**Issue**: Potential secrets found in `.env` files.

**Fix**:

**Step 1: Ensure .env is in .gitignore**
```bash
# Check if .env is ignored
git check-ignore .env

# If not, add to .gitignore
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
echo ".env.production" >> .gitignore
```

**Step 2: Move Secrets to Secret Manager**

**Short-term (Development)**:
- Keep `.env` local only
- Never commit `.env` to git
- Use `.env.example` with placeholders

**Long-term (Production)**:
- Use hosting provider secret manager:
  - **Render**: Environment Variables
  - **Vercel**: Environment Variables
  - **Supabase**: Project Settings → API → Secrets
  - **AWS**: Secrets Manager
  - **HashiCorp**: Vault

**Step 3: Replace with Placeholders**
```bash
# .env.example (commit this)
AMAZON_SPAPI_CLIENT_ID=your_client_id_here
AMAZON_SPAPI_CLIENT_SECRET=your_secret_here
DATABASE_URL=postgresql://user:pass@host:5432/db
```

**Verify**:
```bash
# Check git doesn't track .env
git ls-files | grep -i .env

# Should return nothing (or only .env.example)
```

---

### 3. Encryption Keys Not Found

**Issue**: No encryption keys (`ENCRYPTION_KEY`, `APP_ENCRYPTION_KEY`, `SECRET_STORE_KEY`) found.

**Fix**:

**Step 1: Generate Encryption Key**

**Using Node.js**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Using OpenSSL**:
```bash
openssl rand -base64 32
```

**Using PowerShell**:
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

**Step 2: Set Environment Variable**

**Development**:
```bash
# .env
APP_ENCRYPTION_KEY=your_generated_key_here
```

**Production**:
- Set in hosting provider (Render/Vercel/etc.)
- Or use secrets manager

**Step 3: Verify**
```bash
# Check if set
echo $APP_ENCRYPTION_KEY  # Linux/macOS
echo $env:APP_ENCRYPTION_KEY  # PowerShell
```

---

## 🚀 Quick Remediation Script

Run the automated remediation script:

```powershell
# Check current status
powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening-remediation.ps1

# Generate encryption key and fix issues
powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening-remediation.ps1 -GenerateKeys
```

---

## ✅ Verification Steps

### Step 1: Fix Issues
```bash
# 1. Set DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/db"

# 2. Generate and set encryption key
export APP_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

# 3. Ensure .env is in .gitignore
echo ".env" >> .gitignore
```

### Step 2: Re-run Hardening
```powershell
powershell -ExecutionPolicy Bypass -File scripts/phase2-hardening.ps1 -Verbose
```

**Expected Result**: Pass rate should be **≥ 95%** (18-19/19 checks passed)

### Step 3: Verify Phase 2
```powershell
powershell -ExecutionPolicy Bypass -File scripts/automate-phase2-verification.ps1
```

---

## 📋 Complete Checklist

- [ ] **DATABASE_URL** is set in environment
- [ ] **APP_ENCRYPTION_KEY** is generated and set
- [ ] **.env** is in `.gitignore`
- [ ] **.env.example** exists with placeholders
- [ ] **No secrets** committed to git
- [ ] **Hardening script** shows ≥ 95% pass rate
- [ ] **Phase 2 verification** shows all systems ready

---

## 🔒 Security Best Practices

### For Development
1. Use `.env` file (never commit)
2. Use `.env.example` with placeholders
3. Keep `.env` in `.gitignore`
4. Rotate keys periodically

### For Production
1. Use hosting provider secret manager
2. Never use `.env` files
3. Rotate keys regularly
4. Use different keys per environment
5. Monitor for exposed secrets

---

## 🎯 Expected Results

After remediation:

```
========================================
Hardening Summary
========================================

Status: ✅ PASS
Pass Rate: 95.00% (18/19 checks passed)

[Or ideally 100% = 19/19]
```

---

## 📝 Notes

- **DATABASE_URL**: Required for production, optional for local dev
- **Encryption Keys**: Required for production, recommended for dev
- **Credentials in .env**: Acceptable for local dev if `.gitignore`d, use secret manager for production

---

**Once all checks pass, Phase 2 is fully hardened and ready for Phase 3!** 🚀

