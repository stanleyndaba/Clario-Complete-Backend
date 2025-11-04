# 🧹 Render Cleanup Guide - Remove Old Services

## ✅ KEEP THESE (Your New Consolidated Services)

**Only these 2 services should remain active:**

1. **`opside-python-api`** ✅
   - URL: `https://opside-python-api.onrender.com`
   - Contains: All Python services (main-api, mcde, claim-detector, evidence-engine, test-service)
   - **DO NOT DELETE**

2. **`opside-node-api`** ✅
   - URL: `https://opside-node-api.onrender.com`
   - Contains: All Node.js services (integrations-backend, stripe-payments, cost-docs, refund-engine, inventory-sync)
   - **DO NOT DELETE**

---

## ❌ REMOVE THESE (Old Separate Services)

**These were consolidated into the 2 services above. Delete them to save costs:**

### Python Services (Old)
1. **`main-api`** or **`clario-complete-backend-y5cd`** or similar
   - Old orchestrator/main API
   - Now part of `opside-python-api`
   - **SAFE TO DELETE** ✅

2. **`mcde`** (if exists separately)
   - Manufacturing Cost Document Engine
   - Now part of `opside-python-api`
   - **SAFE TO DELETE** ✅

3. **`claim-detector`** (if exists separately)
   - ML claim detection service
   - Now part of `opside-python-api`
   - **SAFE TO DELETE** ✅

4. **`evidence-engine`** (if exists separately)
   - Evidence processing service
   - Now part of `opside-python-api`
   - **SAFE TO DELETE** ✅

5. **`test-service`** (if exists separately)
   - Test runner service
   - Now part of `opside-python-api`
   - **SAFE TO DELETE** ✅

### Node.js Services (Old)
6. **`integrations-backend`** (if exists as separate service)
   - Old integrations hub
   - Now part of `opside-node-api`
   - **SAFE TO DELETE** ✅

7. **`stripe-payments`** (if exists separately)
   - Payment processing service
   - Now part of `opside-node-api`
   - **SAFE TO DELETE** ✅

8. **`cost-documentation-module`** or **`cost-docs`** (if exists separately)
   - Cost documentation service
   - Now part of `opside-node-api`
   - **SAFE TO DELETE** ✅

9. **`refund-engine`** (if exists separately)
   - Refund processing service
   - Now part of `opside-node-api`
   - **SAFE TO DELETE** ✅

10. **`smart-inventory-sync`** or **`inventory-sync`** (if exists separately)
    - Amazon data sync service
    - Now part of `opside-node-api`
    - **SAFE TO DELETE** ✅

---

## 🔍 How to Identify Old Services

### Step 1: Check Render Dashboard

1. Go to **Render Dashboard**: https://dashboard.render.com
2. Click **"Services"** in the sidebar
3. You'll see a list of all your services

### Step 2: Identify What to Keep

**Look for services with these names:**
- ✅ `opside-python-api`
- ✅ `opside-node-api`

**These are your NEW consolidated services - KEEP THEM!**

### Step 3: Identify What to Delete

**Look for services with these names (or similar):**
- ❌ `main-api`
- ❌ `clario-complete-backend-y5cd` (or any variation)
- ❌ `mcde`
- ❌ `claim-detector`
- ❌ `evidence-engine`
- ❌ `test-service`
- ❌ `integrations-backend` (if separate from `opside-node-api`)
- ❌ `stripe-payments`
- ❌ `cost-documentation-module` or `cost-docs`
- ❌ `refund-engine`
- ❌ `smart-inventory-sync` or `inventory-sync`

**Any service that's NOT `opside-python-api` or `opside-node-api` should be deleted!**

---

## 🗑️ How to Delete Services on Render

### ⚠️ IMPORTANT: Before Deleting

1. **Verify new services work:**
   ```bash
   curl https://opside-python-api.onrender.com/health
   curl https://opside-node-api.onrender.com/health
   ```
   Both should return `{"status":"ok"}` or similar.

2. **Check if anything is still using old URLs:**
   - Check your frontend environment variables
   - Check any other services that might call these
   - Check documentation that references old URLs

### Step-by-Step Deletion

1. **Go to Render Dashboard**
   - https://dashboard.render.com
   - Click **"Services"**

2. **For each old service:**
   - Click on the service name
   - Scroll to the bottom
   - Click **"Delete"** or **"Destroy"** button
   - Confirm deletion

3. **Repeat for all old services**

---

## 💰 Cost Savings

**Before:**
- Up to 10 services (potentially $7-10/month each = $70-100/month)

**After:**
- 2 services (free tier = $0/month, or $7-10/month each if you upgrade = $14-20/month)

**Potential savings: $50-80/month** 💰

---

## ✅ After Deletion Checklist

- [ ] Only 2 services remain: `opside-python-api` and `opside-node-api`
- [ ] Both new services are running and healthy
- [ ] Frontend is updated to use new URLs
- [ ] All old services are deleted
- [ ] Check Render billing to confirm cost reduction

---

## 🆘 If You're Not Sure

**If you see a service and you're not sure if it's old or new:**

1. **Check the service URL:**
   - New: `opside-python-api.onrender.com` or `opside-node-api.onrender.com`
   - Old: Any other domain

2. **Check the service name:**
   - New: Exactly `opside-python-api` or `opside-node-api`
   - Old: Any other name

3. **Check when it was last deployed:**
   - If it hasn't been deployed recently, it's likely old

4. **When in doubt, pause instead of delete:**
   - Render allows you to "Suspend" services
   - This stops them but keeps the configuration
   - You can resume later if needed

---

## 📝 Summary

**KEEP:**
- ✅ `opside-python-api`
- ✅ `opside-node-api`

**DELETE:**
- ❌ Everything else!

**This will save you money and reduce complexity.** 🎉


