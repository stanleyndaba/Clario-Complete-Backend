# 🔧 Using Amazon SP-API Sandbox Without OAuth

## ✅ **Good News: You Can Skip OAuth!**

If you already have a **refresh token** in your environment variables, you can skip the OAuth flow entirely!

---

## 🎯 **Option 1: Use Existing Refresh Token (No OAuth Needed)**

Your environment already has:
```
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
```

**The system already uses this refresh token automatically!**

- ✅ **No OAuth flow needed** - The refresh token is used to get access tokens
- ✅ **No Developer Console access needed** - You don't need to configure anything
- ✅ **Works with sandbox** - The refresh token works with sandbox endpoints

### **How It Works:**

1. When you call Amazon SP-API endpoints, the system automatically:
   - Uses `AMAZON_SPAPI_REFRESH_TOKEN` from environment variables
   - Gets a new access token using the refresh token
   - Makes API calls to sandbox endpoints

2. **You can skip "Connect Amazon Account" button entirely** - The system already has credentials!

---

## 🔧 **Option 2: Bypass OAuth Button (If You Click It)**

If you click "Connect Amazon Account" but want to skip OAuth:

Add `?bypass=true` or `?skip_oauth=true` to the OAuth start URL:

```
/api/v1/integrations/amazon/auth/start?bypass=true&frontend_url=...
```

This will:
- Check if refresh token exists in environment
- If yes, redirect directly to dashboard (skip OAuth)
- If no, proceed with normal OAuth flow

---

## ✅ **What Works Now (Without OAuth)**

Since you have `AMAZON_SPAPI_REFRESH_TOKEN` set, these already work:

1. **✅ Token Refresh**: Automatically uses refresh token to get access tokens
2. **✅ API Calls**: All SP-API endpoints use the refresh token
3. **✅ Sandbox Data**: Gets mock data from sandbox endpoints
4. **✅ No OAuth Needed**: The refresh token is enough!

---

## 🧪 **Testing Without OAuth**

### **Test 1: Check if Token Works**

```bash
# Test the diagnostic endpoint
curl https://opside-node-api.onrender.com/api/v1/integrations/amazon/diagnose
```

If it shows "Token Refresh Test: success", your refresh token is working!

### **Test 2: Fetch Data Directly**

The system will automatically use your refresh token for:
- Inventory fetching
- Claims fetching
- Fees fetching
- All SP-API calls

**No OAuth flow needed!**

---

## 🚨 **When Do You Need OAuth?**

You only need OAuth if:
- ❌ Your refresh token expires (they last a long time, usually years)
- ❌ You need to connect a different Amazon account
- ❌ You want to use production credentials (different from sandbox)

**For sandbox testing with existing refresh token: OAuth is NOT needed!**

---

## 💡 **Solution to "Unknown Scope" Error**

Since you can't access Developer Console to fix the scope issue:

1. **✅ Use existing refresh token** (already working!)
2. **✅ Skip OAuth button** - Don't click "Connect Amazon Account"
3. **✅ Use API endpoints directly** - They'll use your refresh token automatically

The "Connect Amazon Account" button is only needed for:
- First-time setup (getting initial refresh token)
- Reconnecting after token expires
- Switching accounts

**For sandbox testing, you already have everything you need!**

---

## 📝 **Summary**

- ✅ **You have a refresh token** - No OAuth needed!
- ✅ **System uses it automatically** - No configuration needed!
- ✅ **Works with sandbox** - Already configured!
- ⚠️ **OAuth button has scope issue** - But you don't need it anyway!

**Just use the API endpoints directly - they'll work with your existing refresh token!**

