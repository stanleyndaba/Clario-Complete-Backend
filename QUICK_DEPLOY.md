# ⚡ Quick Deploy - 3 Steps

## 🚀 Fastest Method (15-20 minutes)

### Step 1: Push to GitHub (2 minutes)
```bash
git add .
git commit -m "Ready for Render deployment"
git push origin main
```

### Step 2: Deploy via Blueprint (1 minute)
1. Go to https://dashboard.render.com
2. Click **"New"** → **"Blueprint"**
3. Connect your GitHub repo
4. Click **"Apply"**
5. ✅ **Both services deploy automatically!**

### Step 3: Set Environment Variables (5 minutes)
1. Go to each service's dashboard
2. Click **"Environment"** tab
3. Add all required variables (see list below)
4. Services restart automatically

### Step 4: Verify (2 minutes)
```bash
curl https://opside-python-api.onrender.com/health
curl https://opside-node-api.onrender.com/health
```

---

## ⏱️ Time Breakdown

| Step | Time |
|------|------|
| Push to GitHub | 2 min |
| Deploy via Blueprint | 1 min |
| Build (automatic) | 10-15 min |
| Set Environment Variables | 5 min |
| Verify | 2 min |
| **Total** | **20-25 minutes** |

---

## 📋 Required Environment Variables

Copy-paste these into both services:

```
DATABASE_URL=<your-postgres-url>
REDIS_URL=<your-redis-url>
JWT_SECRET=<generate-random-secret>
FRONTEND_URL=<your-frontend-url>
CORS_ALLOW_ORIGINS=<your-frontend-url>
SUPABASE_URL=<your-supabase-url>
SUPABASE_KEY=<your-supabase-key>
STRIPE_SECRET_KEY=<your-stripe-key>
AMAZON_CLIENT_ID=<your-amazon-client-id>
AMAZON_CLIENT_SECRET=<your-amazon-client-secret>
AMAZON_SPAPI_REFRESH_TOKEN=<your-refresh-token>
AMAZON_MARKETPLACE_ID=<your-marketplace-id>
AWS_ACCESS_KEY_ID=<your-aws-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret>
AWS_REGION=<your-aws-region>
S3_BUCKET_NAME=<your-s3-bucket>
```

**For Node.js service only, add:**
```
STRIPE_WEBHOOK_SECRET=<your-webhook-secret>
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
```

---

## 🎯 What Happens During Build?

1. **Cloning** (30 sec) - Render gets your code
2. **Installing** (5-8 min) - Installing dependencies
3. **Building** (2-3 min) - Compiling/processing code
4. **Starting** (30 sec) - Service starts up
5. **Health Check** (10 sec) - Render verifies it's running

**Total: ~10-15 minutes per service** (but they build in parallel!)

---

## ✅ Success Indicators

- ✅ Both services show **"Live"** status (green)
- ✅ Health checks return `{"status": "ok"}` or `{"status": "healthy"}`
- ✅ No errors in the "Logs" tab
- ✅ Services restart automatically after adding env vars

---

## 🆘 If Something Fails

1. **Check Logs** - Click "Logs" tab in Render dashboard
2. **Common Issues:**
   - Missing env var → Add it and restart
   - Build error → Check `requirements-consolidated.txt` or `package.json`
   - Import error → Check file paths in code

---

## 📱 Your Service URLs

After deployment:
- **Python API**: `https://opside-python-api.onrender.com`
- **Node.js API**: `https://opside-node-api.onrender.com`

Update your frontend:
```env
NEXT_PUBLIC_API_URL=https://opside-python-api.onrender.com
NEXT_PUBLIC_INTEGRATIONS_URL=https://opside-node-api.onrender.com
```

---

**That's it! You're deployed! 🎉**

