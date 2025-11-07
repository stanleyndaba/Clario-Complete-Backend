# 🔐 Gmail OAuth Setup - Environment Variables

## 📋 Environment Variables for Render.com (Node.js API)

Add these environment variables to your **Node.js API** service on Render.com:

### Step 1: Go to Render.com Dashboard

1. Visit: https://dashboard.render.com
2. Find your service: **Node.js API** (opside-node-api-woco)
3. Click **Environment** tab
4. Click **Add Environment Variable**

### Step 2: Add These Variables

Copy and paste these **exactly** as shown (replace with your actual credentials):

```
GMAIL_CLIENT_ID=your-gmail-client-id.apps.googleusercontent.com
```

```
GMAIL_CLIENT_SECRET=your-gmail-client-secret
```

```
GMAIL_REDIRECT_URI=https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/callback
```

```
FRONTEND_URL=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
```

### Step 3: Save and Redeploy

1. Click **Save Changes** after adding each variable
2. Render will automatically redeploy your service
3. Wait for deployment to complete (2-5 minutes)

---

## ✅ Verify Google Cloud Console Configuration

Make sure your **Google Cloud Console** OAuth credentials are configured correctly:

### 1. Go to Google Cloud Console
- Visit: https://console.cloud.google.com/apis/credentials
- Find your OAuth 2.0 Client ID (it should match your GMAIL_CLIENT_ID)

### 2. Check Authorized Redirect URIs

Make sure this redirect URI is **exactly** listed in your OAuth client:
```
https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/callback
```

**To add it:**
1. Click **Edit** on your OAuth 2.0 Client ID
2. Under **Authorized redirect URIs**, click **Add URI**
3. Paste: `https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/callback`
4. Click **Save**

### 3. Check Authorized JavaScript Origins

Also verify these are set (if required):
```
https://opside-node-api-woco.onrender.com
https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app
```

---

## 🧪 Test Gmail Connection

After setting environment variables and redeploying:

### Test 1: Check Gmail Status
```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/status
```

**Expected Response:**
```json
{
  "success": true,
  "connected": false,
  "sandbox": false
}
```

### Test 2: Initiate Gmail OAuth
```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://opside-node-api-woco.onrender.com/api/v1/integrations/gmail/auth
```

**Expected Response:**
```json
{
  "success": true,
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...",
  "state": "...",
  "message": "Gmail OAuth flow initiated"
}
```

### Test 3: Test in Frontend

1. Open your frontend: `https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app`
2. Navigate to Gmail integration page
3. Click **"Connect Gmail"** button
4. Should redirect to Google OAuth consent screen
5. After authorization, should redirect back to frontend with success message

---

## ⚠️ Important Notes

1. **Redirect URI Must Match Exactly**
   - The redirect URI in Google Cloud Console **must exactly match** the one in your environment variables
   - No trailing slashes
   - Must be HTTPS (not HTTP)

2. **Environment Variables**
   - These are set in **Render.com** (not Vercel)
   - Render will redeploy automatically after adding variables
   - Wait for deployment to complete before testing

3. **Google Cloud Console**
   - OAuth credentials must be from the correct Google Cloud project
   - API must be enabled: **Gmail API** must be enabled in your Google Cloud project
   - Check: https://console.cloud.google.com/apis/library/gmail.googleapis.com

4. **Frontend URL**
   - Used for redirecting after OAuth callback
   - Must match your actual Vercel deployment URL
   - Can be updated if you change your frontend URL

---

## 🔍 Troubleshooting

### Issue: "redirect_uri_mismatch" Error
**Fix:**
- Check that redirect URI in Google Cloud Console **exactly matches** the one in environment variables
- No trailing slashes, must be HTTPS

### Issue: "invalid_client" Error
**Fix:**
- Verify GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are correct
- Check that credentials are from the correct Google Cloud project

### Issue: Gmail Status Shows "sandbox: true"
**Fix:**
- Environment variables are not set or not loaded
- Check Render.com environment variables are saved
- Verify service was redeployed after adding variables

### Issue: "Invalid or expired OAuth state"
**Fix:**
- State store is working correctly
- This usually means the OAuth flow took too long (>10 minutes)
- Try initiating the connection again

---

## 📝 Summary

✅ **Set in Render.com:**
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REDIRECT_URI`
- `FRONTEND_URL`

✅ **Configure in Google Cloud Console:**
- Authorized redirect URIs
- Gmail API enabled

✅ **Test:**
- Gmail status endpoint
- OAuth initiation
- Frontend connection flow

**Once all environment variables are set and Google Cloud Console is configured, Gmail connection should work!** 🎉

