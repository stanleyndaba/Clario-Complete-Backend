# Amazon User Registration & Data Persistence Flow

## 🔍 Answer to Your Question

**YES** - The system **DOES pull and store user data** when an Amazon seller connects their account. Here's exactly what happens:

---

## 📋 What Happens When Seller Clicks "Connect Amazon"

### Step 1: OAuth Flow Initiation
- User clicks "Connect Amazon" button
- System redirects to Amazon OAuth consent screen
- User grants permissions

### Step 2: OAuth Callback Processing
When Amazon redirects back with authorization code:

1. **Exchange Code for Tokens**
   - System exchanges authorization code for `access_token` and `refresh_token`
   - Tokens are stored securely in database

2. **Fetch Seller Data from Amazon SP-API**
   - System calls Amazon SP-API: `/sellers/v1/marketplaceParticipations`
   - Retrieves seller information:
     - **Seller ID** (`sellerId`)
     - **Company/Seller Name** (`sellerName` or `company_name`)
     - **Marketplace IDs** (list of marketplaces seller participates in)

3. **Create/Update User Profile in Database**
   ```python
   # From src/api/auth.py line 257
   user_id = db_module.db.upsert_user_profile(
       seller_id=seller_id,
       company_name=company_name or "",
       marketplaces=marketplaces
   )
   ```

   **What Gets Stored:**
   - `id` - User ID (format: `usr_{seller_id}`)
   - `amazon_seller_id` - Amazon Seller ID
   - `company_name` - Company/Seller Name from Amazon
   - `linked_marketplaces` - JSON array of marketplace IDs
   - `created_at` - First connection timestamp
   - `last_login` - Last connection/update timestamp

4. **Store OAuth Tokens**
   - `refresh_token` - Stored in `tokens` table (encrypted)
   - `access_token` - Stored temporarily (refreshed as needed)
   - Associated with `user_id` and provider `'amazon'`

5. **Trigger Automatic Data Sync**
   - Background job starts syncing seller's Amazon data
   - Inventory, orders, refunds, etc.

---

## 💾 Data Stored in Database

### User Profile Table (`users`)
```sql
- id: User ID (usr_{seller_id})
- amazon_seller_id: Amazon Seller ID
- company_name: Company/Seller Name (from Amazon)
- linked_marketplaces: JSON array of marketplace IDs
- created_at: First connection timestamp
- last_login: Last connection/update timestamp
- stripe_customer_id: (if Stripe connected)
- stripe_account_id: (if Stripe connected)
```

### Tokens Table (`tokens`)
```sql
- user_id: User ID
- provider: 'amazon'
- refresh_token: Encrypted refresh token
- access_token: Encrypted access token (temporary)
- expires_at: Token expiration timestamp
- status: 'active' | 'revoked' | 'expired'
```

---

## 🔄 What Happens When User Returns

When the seller comes back:

1. **User Lookup**
   - System looks up user by `amazon_seller_id`
   - If found, updates `last_login` timestamp
   - If not found, creates new user profile

2. **Token Validation**
   - System checks if refresh token exists and is valid
   - If expired, attempts to refresh using stored refresh token
   - If refresh fails, prompts user to reconnect

3. **Seamless Experience**
   - User doesn't need to re-enter credentials
   - System uses stored tokens to access Amazon SP-API
   - Data sync continues automatically

---

## ❌ What Happens on Disconnect

### Current Implementation
The `disconnectAmazon` function (line 584 in `amazonController.ts`) is currently a **stub**:

```typescript
export const disconnectAmazon = async (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Amazon account disconnected successfully'
  });
};
```

### What Should Happen (Not Fully Implemented)
1. **Revoke Tokens**
   - Mark tokens as `'revoked'` in database
   - Delete tokens from token manager
   - Revoke tokens from Amazon (if possible)

2. **Update Integration Status**
   - Set `status = 'disconnected'` in `evidence_sources` table
   - Update `last_disconnected_at` timestamp

3. **User Data Retention**
   - **User profile is NOT deleted** (kept for reconnection)
   - **Synced data is NOT deleted** (historical data preserved)
   - **Tokens are revoked/deleted** (can't access Amazon API)

### What Actually Happens Now
- ✅ Returns success message
- ❌ Tokens may not be revoked
- ❌ Integration status may not be updated
- ✅ User profile remains in database
- ✅ Historical data remains in database

---

## 🎯 Summary

### On Connect:
✅ **YES** - System pulls seller data (name, seller ID, marketplaces)  
✅ **YES** - System creates/updates user profile in database  
✅ **YES** - System stores OAuth tokens for future use  
✅ **YES** - System triggers automatic data sync  
✅ **YES** - Makes it easier when they come back (no re-authentication needed)

### On Disconnect:
⚠️ **PARTIAL** - Disconnect function exists but is not fully implemented  
✅ **YES** - User profile remains in database (for easy reconnection)  
✅ **YES** - Historical synced data remains (not deleted)  
❌ **NO** - Tokens should be revoked but may not be fully implemented  
❌ **NO** - Integration status may not be updated

### On Reconnect:
✅ **YES** - System recognizes existing user by `amazon_seller_id`  
✅ **YES** - Updates `last_login` timestamp  
✅ **YES** - Can reuse existing user profile  
✅ **YES** - Only needs new OAuth tokens (if old ones expired)

---

## 🔧 Code References

### User Profile Creation/Update
- **File**: `src/common/db.py` (line 246-275)
- **Function**: `upsert_user_profile()`
- **Called from**: `src/api/auth.py` (line 257)

### OAuth Callback Processing
- **File**: `src/api/auth.py` (line 138-258)
- **Function**: `amazon_callback()`
- **Fetches**: Seller ID, company name, marketplaces from Amazon SP-API

### Token Storage
- **File**: `Integrations-backend/src/controllers/amazonController.ts` (line 329-343)
- **Function**: `handleAmazonCallback()`
- **Stores**: Refresh token and access token in database

### Disconnect Function
- **File**: `Integrations-backend/src/controllers/amazonController.ts` (line 584-589)
- **Status**: Stub implementation (needs completion)

---

## 💡 Recommendation

**Current State**: User data IS stored and persists, making reconnection easier.

**Improvement Needed**: The disconnect function should be fully implemented to:
1. Properly revoke tokens
2. Update integration status
3. Optionally purge synced data (if user requests)

But even if disconnected, the user profile remains, so reconnection is seamless.

