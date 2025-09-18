# Manual Deployment Commands
# Run these commands one by one after installing Fly CLI

Write-Host "🚀 Manual Deployment Commands" -ForegroundColor Green
Write-Host "First, install Fly CLI from: https://fly.io/docs/hands-on/install-flyctl/" -ForegroundColor Yellow
Write-Host "Then run these commands:" -ForegroundColor Yellow

Write-Host "`n1. Login to Fly.io:" -ForegroundColor Cyan
Write-Host "fly auth login" -ForegroundColor White

Write-Host "`n2. Create Fly.io apps:" -ForegroundColor Cyan
Write-Host "fly apps create opside-main-api --org personal" -ForegroundColor White
Write-Host "fly apps create opside-integrations-backend --org personal" -ForegroundColor White
Write-Host "fly apps create opside-stripe-payments --org personal" -ForegroundColor White

Write-Host "`n3. Set up main-api secrets:" -ForegroundColor Cyan
Write-Host "fly secrets set -a opside-main-api DATABASE_URL='postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres' REDIS_URL='redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379' JWT_SECRET='your-super-secret-jwt-key' SUPABASE_URL='https://fmzfjhrwbkebqaxjlvzt.supabase.co' SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...' SUPABASE_SERVICE_ROLE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...' INTEGRATIONS_URL='https://opside-integrations-backend.fly.dev' STRIPE_SERVICE_URL='https://opside-stripe-payments.fly.dev' FRONTEND_URL='https://your-frontend-domain.com' ENV='production'" -ForegroundColor White

Write-Host "`n4. Set up integrations-backend secrets:" -ForegroundColor Cyan
Write-Host "fly secrets set -a opside-integrations-backend DATABASE_URL='postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres' REDIS_URL='redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379' JWT_SECRET='your-super-secret-jwt-key' SUPABASE_URL='https://fmzfjhrwbkebqaxjlvzt.supabase.co' SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...' SUPABASE_SERVICE_ROLE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...' AMAZON_CLIENT_ID='your-amazon-client-id' AMAZON_CLIENT_SECRET='your-amazon-client-secret' AMAZON_REDIRECT_URI='https://opside-integrations-backend.fly.dev/api/amazon/callback' FRONTEND_URL='https://your-frontend-domain.com' NODE_ENV='production'" -ForegroundColor White

Write-Host "`n5. Set up stripe-payments secrets:" -ForegroundColor Cyan
Write-Host "fly secrets set -a opside-stripe-payments DATABASE_URL='postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres' REDIS_URL='redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379' JWT_SECRET='your-super-secret-jwt-key' SUPABASE_URL='https://fmzfjhrwbkebqaxjlvzt.supabase.co' SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...' SUPABASE_SERVICE_ROLE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh...' STRIPE_SECRET_KEY='sk_live_...' STRIPE_WEBHOOK_SECRET='whsec_...' STRIPE_PUBLISHABLE_KEY='pk_live_...' NODE_ENV='production'" -ForegroundColor White

Write-Host "`n6. Deploy main-api:" -ForegroundColor Cyan
Write-Host "fly deploy -a opside-main-api --config fly-main-api.toml" -ForegroundColor White

Write-Host "`n7. Deploy integrations-backend:" -ForegroundColor Cyan
Write-Host "cd Integrations-backend" -ForegroundColor White
Write-Host "fly deploy -a opside-integrations-backend --config fly.toml" -ForegroundColor White
Write-Host "cd .." -ForegroundColor White

Write-Host "`n8. Deploy stripe-payments:" -ForegroundColor Cyan
Write-Host "cd stripe-payments" -ForegroundColor White
Write-Host "fly deploy -a opside-stripe-payments --config fly.toml" -ForegroundColor White
Write-Host "cd .." -ForegroundColor White

Write-Host "`n9. Health check:" -ForegroundColor Cyan
Write-Host "curl https://opside-main-api.fly.dev/health" -ForegroundColor White
Write-Host "curl https://opside-integrations-backend.fly.dev/health" -ForegroundColor White
Write-Host "curl https://opside-stripe-payments.fly.dev/health" -ForegroundColor White

Write-Host "`n🎉 After deployment, your services will be available at:" -ForegroundColor Green
Write-Host "Main API: https://opside-main-api.fly.dev" -ForegroundColor White
Write-Host "Integrations: https://opside-integrations-backend.fly.dev" -ForegroundColor White
Write-Host "Stripe Payments: https://opside-stripe-payments.fly.dev" -ForegroundColor White


