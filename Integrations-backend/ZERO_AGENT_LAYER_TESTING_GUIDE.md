# 🧪 Zero Agent Layer Testing Guide (Sandbox Mode)

## ✅ What You Can Test WITHOUT Real Amazon Credentials

The Zero Agent Layer is **100% testable** in sandbox mode. Here's what you can verify:

### 1. **Token Encryption/Decryption** ✅
- TokenManager encryption with IV+data format
- PBKDF2 fallback for encryption key
- Token storage in `tokens` table
- Token retrieval and decryption

### 2. **OAuth Callback Logic** ✅
- Full atomic callback flow
- User/tenant creation/upsert
- Token storage
- Evidence source creation
- Sync job scheduling

### 3. **Database Operations** ✅
- User upsert in `users` table
- Token storage in `tokens` table (encrypted)
- Evidence source creation in `evidence_sources` table
- Sync job creation in `sync_jobs` table

### 4. **End-to-End Pipeline** ✅
- OAuth callback → User creation → Token storage → Evidence source → Sync job

---

## 🎭 Mock Mode for Testing

The Zero Agent Layer includes a **mock mode** that allows full testing without real Amazon credentials.

### Enable Mock Mode

**Option 1: Environment Variable**
```bash
export ENABLE_MOCK_OAUTH=true
npm run dev
```

**Option 2: Use Mock Code in Callback**
```bash
# Call OAuth callback with mock code
GET /api/v1/integrations/amazon/auth/callback?code=mock_auth_code&state=test_state
```

### What Mock Mode Does

When mock mode is enabled:
1. **OAuth Token Exchange**: Returns mock tokens instead of calling Amazon
2. **Seller Profile**: Returns mock seller profile instead of calling SP-API
3. **All Other Steps**: Run normally (user creation, token storage, etc.)

This allows you to test the **entire Zero Agent Layer pipeline** without real credentials.

---

## 🧪 Running Tests

### Step 1: Run Unit Tests
```bash
npm run test:zero-agent
```

This test script:
- ✅ Tests token encryption/decryption
- ✅ Tests user creation
- ✅ Tests token storage/retrieval
- ✅ Tests evidence source creation
- ✅ Tests sync job scheduling
- ✅ Tests full OAuth callback flow (if backend is running)

### Step 2: Test OAuth Callback Manually

**Start backend:**
```bash
npm run dev
```

**Trigger mock OAuth callback:**
```bash
# Option 1: Using curl
curl "http://localhost:3001/api/v1/integrations/amazon/auth/callback?code=mock_auth_code&state=test_state"

# Option 2: Using browser
# Visit: http://localhost:3001/api/v1/integrations/amazon/auth/callback?code=mock_auth_code&state=test_state
```

**Expected Result:**
- User created in `users` table
- Tokens stored in `tokens` table (encrypted)
- Evidence source created in `evidence_sources` table
- Sync job scheduled

### Step 3: Verify in Supabase

Check these tables:

```sql
-- Check users table
SELECT id, seller_id, amazon_seller_id, company_name 
FROM users 
WHERE seller_id LIKE 'TEST_SELLER_%'
ORDER BY created_at DESC 
LIMIT 5;

-- Check tokens table (encrypted)
SELECT id, user_id, provider, access_token_iv, access_token_data, expires_at
FROM tokens
WHERE provider = 'amazon'
ORDER BY created_at DESC
LIMIT 5;

-- Check evidence_sources table
SELECT id, seller_id, provider, status, display_name
FROM evidence_sources
WHERE provider = 'amazon'
ORDER BY created_at DESC
LIMIT 5;

-- Check sync_jobs table
SELECT id, user_id, status, reason, created_at
FROM sync_jobs
WHERE reason = 'oauth_connect'
ORDER BY created_at DESC
LIMIT 5;
```

---

## ❌ What You CANNOT Test (Yet)

These require real Amazon credentials:

1. **Real Amazon OAuth Page**
   - The actual Amazon login/authorization page
   - Real OAuth redirect flow

2. **Real Amazon SP-API Calls**
   - Fetching real seller profile
   - Fetching real claims/inventory
   - Real data sync

**But these are NOT needed for Zero Agent Layer completion!**

These are needed for:
- Agent 4 (Evidence Ingestion)
- Agent 5 (Document Parsing)
- Agent 1 (Discovery/Claim Detection)

**NOT for the Zero Agent Layer foundation.**

---

## 🎯 Testing Checklist

Use this checklist to verify Zero Agent Layer:

- [ ] Migration `020_create_tokens_table.sql` applied successfully
- [ ] `npm run test:zero-agent` passes all tests
- [ ] Mock OAuth callback creates user in `users` table
- [ ] Mock OAuth callback stores encrypted tokens in `tokens` table
- [ ] Mock OAuth callback creates evidence source in `evidence_sources` table
- [ ] Mock OAuth callback schedules sync job
- [ ] Token encryption/decryption works correctly
- [ ] PBKDF2 fallback works if `ENCRYPTION_KEY` is missing
- [ ] RLS policies allow backend operations (using `supabaseAdmin`)

---

## 🚀 Next Steps After Zero Agent Layer

Once Zero Agent Layer is verified:

1. **Agent 1 (Discovery Agent)**: Already complete ✅
2. **Agent 2 (Data Sync)**: Can use mock data generator
3. **Agent 3 (Normalization)**: Can use mock data
4. **Agent 4 (Evidence Ingestion)**: Can use mock evidence sources

**You can build and test Agents 1-4 entirely with mock data!**

Real Amazon credentials are only needed for:
- Production deployment
- Final end-to-end testing with real data
- Agent 5+ (which use real evidence documents)

---

## 💡 Pro Tips

1. **Use Mock Mode Liberally**: Don't hesitate to use mock mode for development and testing
2. **Test Incrementally**: Test each component separately before testing the full flow
3. **Check Database**: Always verify database state after tests
4. **Clean Up**: The test script automatically cleans up test data
5. **Logs Are Your Friend**: Check backend logs to see exactly what's happening

---

## 🎉 Summary

**You can complete and fully verify the Zero Agent Layer without real Amazon credentials.**

The foundation is:
- ✅ Fully testable
- ✅ Production-ready
- ✅ Secure (encrypted tokens)
- ✅ Atomic (all-or-nothing operations)
- ✅ Mock-friendly

**Today = 100% achievable!** 🚀

