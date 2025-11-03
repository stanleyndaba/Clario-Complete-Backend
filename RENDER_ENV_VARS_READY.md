# 🔧 Render Environment Variables - Ready to Copy

## ✅ For Both Services (Python & Node.js)

Copy these into **both** `opside-python-api` and `opside-node-api`:

```bash
# Database
DATABASE_URL=postgresql://postgres:Lungilemzila%4075@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
SUPABASE_URL=postgresql://postgres.fmzfjhrwbkebqaxjlvzt:Lungilemzila_75@aws-1-eu-central-1.pooler.supabase.com:5432/postgres

# Authentication & Security
JWT_SECRET=6d55b17615e87f15b252adc68a4b87ee69c2d910ef4b12d5b12fae94568b86cc
TOKEN_ENC_KEY=1Sp3Vl4N-dvoMk_d8mOkKW006xqrKw5xzBja91Oq-AU=
ENCRYPTION_KEY_VALUE=true

# Frontend & CORS
FRONTEND_URL=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app/app
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app/app

# Amazon SP-API (Sandbox)
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
AMAZON_SPAPI_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432

# Email (SendGrid)
EMAIL_API_KEY=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
EMAIL_FROM_EMAIL=clarioo@gmail.com
EMAIL_FROM_NAME=Clario
EMAIL_PROVIDER=sendgrid

# Application Settings
ENV=production
PORT=8000
PYTHON_VERSION=3.11.4
COOKIE_DOMAIN=.clario.com
REDIS_ENABLED=false

# Optional - Set if you have them, otherwise leave empty
REDIS_URL=
SUPABASE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
S3_BUCKET_NAME=
```

---

## 🎯 For Node.js Service Only (opside-node-api)

Add these **additional** variables to the Node.js service:

```bash
# Stripe Webhook (if you have it)
STRIPE_WEBHOOK_SECRET=

# Amazon SP-API Base URL (already in list above, but ensure it's set)
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
```

---

## ⚠️ Variables That Need Values

These are placeholders - fill them if you have them, or leave empty for now:

1. **SUPABASE_KEY** - Your Supabase anon/service key
   - Get it from: Supabase Dashboard → Settings → API
   - If not using Supabase client, can leave empty

2. **STRIPE_SECRET_KEY** - Your Stripe secret key
   - Get it from: Stripe Dashboard → Developers → API keys
   - Format: `sk_test_...` or `sk_live_...`
   - Can leave empty if not processing payments yet

3. **STRIPE_WEBHOOK_SECRET** - Stripe webhook secret (Node.js only)
   - Get it when you set up webhooks in Stripe
   - Can leave empty for now

4. **AWS_ACCESS_KEY_ID** & **AWS_SECRET_ACCESS_KEY** - AWS credentials
   - Only needed if using S3 for file storage
   - Can leave empty if not using S3

5. **AWS_REGION** & **S3_BUCKET_NAME** - AWS S3 settings
   - Only needed if using S3
   - Can leave empty for now

6. **REDIS_URL** - Redis connection string
   - You have `REDIS_ENABLED=false`, so can leave empty
   - If you enable Redis later, add the connection string

---

## 📝 How to Add in Render

### For Python Service:
1. Go to `opside-python-api` dashboard
2. Click **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Paste each variable (name and value)
5. Click **"Save Changes"**

### For Node.js Service:
1. Go to `opside-node-api` dashboard
2. Click **"Environment"** tab
3. Click **"Add Environment Variable"**
4. Paste all variables from "Both Services" list
5. Add the additional Node.js variables
6. Click **"Save Changes"**

---

## ✅ Quick Copy-Paste for Render

### Python Service - Copy all:
```
DATABASE_URL=postgresql://postgres:Lungilemzila%4075@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
SUPABASE_URL=postgresql://postgres.fmzfjhrwbkebqaxjlvzt:Lungilemzila_75@aws-1-eu-central-1.pooler.supabase.com:5432/postgres
JWT_SECRET=6d55b17615e87f15b252adc68a4b87ee69c2d910ef4b12d5b12fae94568b86cc
TOKEN_ENC_KEY=1Sp3Vl4N-dvoMk_d8mOkKW006xqrKw5xzBja91Oq-AU=
ENCRYPTION_KEY_VALUE=true
FRONTEND_URL=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app/app
CORS_ALLOW_ORIGINS=https://opside-complete-frontend-4poy2f2lh-mvelo-ndabas-projects.vercel.app/app
AMAZON_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
AMAZON_CLIENT_SECRET=amzn1.oa2-cs.v1.25d01a7bb1221bf43f59cd54a7867c5b6feefb0721593fd6370610455ab62ca7
AMAZON_SPAPI_REFRESH_TOKEN=Atzr|IwEBIGDfQ5v3EK-VNr4xQuvYiYeQz7vfeJDFeKcyEAG4sQwaJhDIaBB0bUHVxUdvfGRz-p9vTlvwBskd0sJW86GV80TXEig-dW203Ihr5snxUuBIgv3XWQEjxu4oSeqKrnTi180AjQukOcL_bKO-aYfePvF-LZwHlCLeojAwxT8gIbBKKILB5PRO137EuR2VRaVNkC9x7_rQFpzy9fnCiyGThf50ABK-qZC7GRzA9wzxRLoeJLfjONJDcGlVx9DVKHVmRzmQnv8lC6bS4ph1YHCobSnyxuiON_dfixwWSIAYsIg2YSDNAZyiInn0yLJeuOTEyPE
AMAZON_SPAPI_BASE_URL=https://sandbox.sellingpartnerapi-na.amazon.com
AMAZON_MARKETPLACE_ID=ATVPDKIKX0DER
AMAZON_SPAPI_CLIENT_ID=amzn1.application-oa2-client.2b55e98d58e94feb920b2f1efa166432
EMAIL_API_KEY=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
EMAIL_FROM_EMAIL=clarioo@gmail.com
EMAIL_FROM_NAME=Clario
EMAIL_PROVIDER=sendgrid
ENV=production
PORT=8000
PYTHON_VERSION=3.11.4
COOKIE_DOMAIN=.clario.com
REDIS_ENABLED=false
```

### Node.js Service - Copy all above + add:
```
STRIPE_WEBHOOK_SECRET=
```

---

## 🎯 After Adding Variables

1. Services will **automatically restart** with new variables
2. Check **"Logs"** tab to verify no errors
3. Test health endpoints:
   ```bash
   curl https://opside-python-api.onrender.com/health
   curl https://opside-node-api.onrender.com/health
   ```

---

## ✅ Checklist

- [ ] Python service has all variables set
- [ ] Node.js service has all variables set
- [ ] Both services show "Live" status
- [ ] Health checks return 200 OK
- [ ] No errors in logs

---

**You're all set! 🚀**

