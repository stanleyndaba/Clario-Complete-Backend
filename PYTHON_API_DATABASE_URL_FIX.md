# 🔧 Python API DATABASE_URL Fix

## Issue
Python API is trying to connect to `localhost:5432` instead of Supabase because it's missing the `DATABASE_URL` environment variable.

## Solution
Add `DATABASE_URL` to Python API environment variables on Render.

### Current Environment Variables (Individual Components):
```
DATABASE_HOST=aws-0-us-east-1.pooler.supabase.com
DB_HOST=aws-0-us-east-1.pooler.supabase.com
DB_NAME=postgres
DB_PASSWORD=Lungilemzila@75
DB_PORT=6543
DB_SSL=true
DB_USER=postgres
```

### Required: Add DATABASE_URL
The Python API expects a full PostgreSQL connection string, not individual components.

**Add this to Python API environment variables:**
```
DATABASE_URL=postgresql://postgres:Lungilemzila@75@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
```

**Format:** `postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require`

**Note:** The `/api/v1/claim-detector/predict/batch` endpoint doesn't require database, so this won't fix detection failures, but it will stop the database connection errors in logs.

## Steps
1. Go to Render Dashboard → Python API service
2. Go to Environment tab
3. Add `DATABASE_URL` with the connection string above
4. Save and redeploy

















