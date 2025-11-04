# 🔧 Amazon OAuth Redirect URI Configuration Issue

## 🐛 **The Problem**

Error: `400 Bad Request - An unknown scope was requested`

Even with `scope=profile`, Amazon is rejecting the request. This is because:

1. **Redirect URI mismatch**: The redirect URI `http://localhost:3001/api/v1/integrations/amazon/auth/callback` is not registered in Amazon Seller Central
2. **Scope issue**: For SP-API OAuth, the scope might need to be omitted entirely

---

## ✅ **Solution**

### **Option 1: Configure Redirect URI in Amazon Seller Central**

1. Go to Amazon Seller Central → Settings → User Permissions → Manage Your Apps
2. Find your app (client ID: `amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432`)
3. Edit the app settings
4. Add the redirect URI:
   ```
   https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/callback
   ```
   (Or whatever your production callback URL is)

### **Option 2: Set AMAZON_REDIRECT_URI Environment Variable**

Set this in Render for the Node.js backend:

```bash
AMAZON_REDIRECT_URI=https://opside-node-api.onrender.com/api/v1/integrations/amazon/auth/callback
```

**Important**: The redirect URI must:
- Match EXACTLY what's configured in Amazon Seller Central
- Use HTTPS in production (not HTTP)
- Include the full path to the callback endpoint

---

## 🔍 **Current Issue**

The code is using:
- Redirect URI: `http://localhost:3001/api/v1/integrations/amazon/auth/callback` (fallback)
- This is NOT registered in Amazon, so OAuth fails

**Fix**: Set `AMAZON_REDIRECT_URI` to match what's configured in Amazon Seller Central.

---

## 📋 **Next Steps**

1. Check Amazon Seller Central → Your App → Redirect URIs
2. Set `AMAZON_REDIRECT_URI` environment variable in Render to match
3. Redeploy the backend
4. Test again

The scope parameter has been removed from the OAuth URL - this should help!

