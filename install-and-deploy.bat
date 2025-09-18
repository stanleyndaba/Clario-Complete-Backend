@echo off
echo Installing Fly CLI...

REM Download and install Fly CLI
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

REM Add to PATH
set PATH=%PATH%;%USERPROFILE%\.fly\bin

echo Testing Fly CLI...
fly version

echo.
echo Now running deployment commands...
echo.

echo 1. Logging into Fly.io...
fly auth login

echo.
echo 2. Creating Fly.io apps...
fly apps create opside-main-api --org personal
fly apps create opside-integrations-backend --org personal
fly apps create opside-stripe-payments --org personal

echo.
echo 3. Setting up secrets for main-api...
fly secrets set -a opside-main-api DATABASE_URL="postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres" REDIS_URL="redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379" JWT_SECRET="your-super-secret-jwt-key" SUPABASE_URL="https://fmzfjhrwbkebqaxjlvzt.supabase.co" SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..." SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..." INTEGRATIONS_URL="https://opside-integrations-backend.fly.dev" STRIPE_SERVICE_URL="https://opside-stripe-payments.fly.dev" FRONTEND_URL="https://your-frontend-domain.com" ENV="production"

echo.
echo 4. Setting up secrets for integrations-backend...
fly secrets set -a opside-integrations-backend DATABASE_URL="postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres" REDIS_URL="redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379" JWT_SECRET="your-super-secret-jwt-key" SUPABASE_URL="https://fmzfjhrwbkebqaxjlvzt.supabase.co" SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..." SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..." AMAZON_CLIENT_ID="your-amazon-client-id" AMAZON_CLIENT_SECRET="your-amazon-client-secret" AMAZON_REDIRECT_URI="https://opside-integrations-backend.fly.dev/api/amazon/callback" FRONTEND_URL="https://your-frontend-domain.com" NODE_ENV="production"

echo.
echo 5. Setting up secrets for stripe-payments...
fly secrets set -a opside-stripe-payments DATABASE_URL="postgresql://postgres.fmzfjhrwbkebqaxjlvzt:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres" REDIS_URL="redis://default:YOUR_REDIS_PASSWORD@YOUR_REDIS_HOST:6379" JWT_SECRET="your-super-secret-jwt-key" SUPABASE_URL="https://fmzfjhrwbkebqaxjlvzt.supabase.co" SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..." SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBh..." STRIPE_SECRET_KEY="sk_live_..." STRIPE_WEBHOOK_SECRET="whsec_..." STRIPE_PUBLISHABLE_KEY="pk_live_..." NODE_ENV="production"

echo.
echo 6. Deploying main-api...
fly deploy -a opside-main-api --config fly-main-api.toml

echo.
echo 7. Deploying integrations-backend...
cd Integrations-backend
fly deploy -a opside-integrations-backend --config fly.toml
cd ..

echo.
echo 8. Deploying stripe-payments...
cd stripe-payments
fly deploy -a opside-stripe-payments --config fly.toml
cd ..

echo.
echo 9. Health checking...
curl https://opside-main-api.fly.dev/health
curl https://opside-integrations-backend.fly.dev/health
curl https://opside-stripe-payments.fly.dev/health

echo.
echo Deployment complete!
echo.
echo Your services are available at:
echo Main API: https://opside-main-api.fly.dev
echo Integrations: https://opside-integrations-backend.fly.dev
echo Stripe Payments: https://opside-stripe-payments.fly.dev

pause


