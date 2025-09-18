# Opside Backend Fly.io Deployment Guide

## 🚀 Complete Deployment Checklist

### Prerequisites
- [ ] Fly.io CLI installed
- [ ] Supabase account and project created
- [ ] Upstash Redis instance created
- [ ] Stripe account and API keys
- [ ] Amazon Developer Console OAuth credentials
- [ ] Gmail/Outlook OAuth credentials (optional)

### Step 1: Initial Setup

1. **Install Fly.io CLI**
   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex
   fly auth login
   ```

2. **Create Supabase Project**
   - Go to https://supabase.com
   - Create new project: "opside-backend"
   - Get connection details from Settings > API

3. **Create Upstash Redis**
   - Go to https://upstash.com
   - Create new database: "opside-redis"
   - Get connection string from dashboard

### Step 2: Deploy All Services

1. **Run the deployment script**
   ```powershell
   .\deploy.ps1
   ```

2. **Set up secrets**
   ```powershell
   .\setup-secrets.ps1
   ```

3. **Run database migrations**
   ```powershell
   .\migrate-database.ps1
   ```

4. **Set up monitoring**
   ```powershell
   .\monitoring-setup.ps1
   ```

### Step 3: Verify Deployment

1. **Run health checks**
   ```powershell
   .\health-check.ps1 -Detailed
   ```

2. **Test all endpoints**
   ```powershell
   # Main API
   curl https://opside-main-api.fly.dev/health
   
   # Integrations Backend
   curl https://opside-integrations-backend.fly.dev/health
   
   # Stripe Payments
   curl https://opside-stripe-payments.fly.dev/health
   
   # Cost Documentation
   curl https://opside-cost-docs.fly.dev/health
   
   # Refund Engine
   curl https://opside-refund-engine.fly.dev/health
   
   # MCDE
   curl https://opside-mcde.fly.dev/health
   ```

### Step 4: Configure Additional Services

1. **Update Stripe Webhooks**
   - Go to Stripe Dashboard > Webhooks
   - Add endpoint: `https://opside-stripe-payments.fly.dev/webhooks/stripe`
   - Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`

2. **Update OAuth Redirect URIs**
   - Amazon Developer Console: `https://opside-main-api.fly.dev/api/auth/amazon/callback`
   - Google Cloud Console: `https://opside-main-api.fly.dev/api/auth/callback/gmail`
   - Microsoft Azure: `https://opside-main-api.fly.dev/api/auth/callback/outlook`

3. **Configure CORS**
   - Update `FRONTEND_URL` in all services
   - Add your frontend domain to allowed origins

### Step 5: Production Hardening

1. **Enable SSL/TLS**
   - All Fly.io apps automatically get SSL certificates
   - Custom domains can be added via Fly.io dashboard

2. **Set up monitoring**
   - Configure log aggregation
   - Set up alerting for critical errors
   - Monitor service health and performance

3. **Configure backups**
   - Supabase provides automatic backups
   - Set up additional backup strategies if needed

## 📋 Service URLs

| Service | URL | Health Check |
|---------|-----|--------------|
| Main API | https://opside-main-api.fly.dev | /health |
| Integrations Backend | https://opside-integrations-backend.fly.dev | /health |
| Stripe Payments | https://opside-stripe-payments.fly.dev | /health |
| Cost Documentation | https://opside-cost-docs.fly.dev | /health |
| Refund Engine | https://opside-refund-engine.fly.dev | /health |
| MCDE | https://opside-mcde.fly.dev | /health |

## 🔧 Troubleshooting

### Common Issues

1. **Service won't start**
   ```powershell
   fly logs -a <app-name>
   fly status -a <app-name>
   ```

2. **Database connection issues**
   ```powershell
   fly secrets list -a <app-name>
   fly ssh console -a <app-name>
   ```

3. **Memory issues**
   ```powershell
   fly machine scale memory 512 -a <app-name>
   ```

4. **Restart service**
   ```powershell
   fly machine restart -a <app-name>
   ```

### Useful Commands

```powershell
# View logs
fly logs -a <app-name> --follow

# Check status
fly status -a <app-name>

# SSH into service
fly ssh console -a <app-name>

# View metrics
fly dashboard -a <app-name>

# Scale service
fly machine scale count 2 -a <app-name>

# Update secrets
fly secrets set -a <app-name> KEY=value

# Deploy specific service
fly deploy -a <app-name>
```

## 📊 Monitoring

### Health Checks
- Run `.\health-check.ps1` regularly
- Set up automated health monitoring
- Configure alerts for service failures

### Logs
- All services log to stdout
- Use `fly logs` to view logs
- Consider log aggregation service

### Metrics
- Fly.io provides built-in metrics
- Access via Fly.io dashboard
- Set up custom monitoring if needed

## 🔒 Security

### Secrets Management
- All secrets stored in Fly.io
- Never commit secrets to git
- Rotate secrets regularly

### Network Security
- All services use HTTPS
- Private networking between services
- CORS properly configured

### Access Control
- JWT tokens for authentication
- Rate limiting enabled
- Input validation on all endpoints

## 🚀 Scaling

### Horizontal Scaling
```powershell
fly machine scale count 3 -a <app-name>
```

### Vertical Scaling
```powershell
fly machine scale memory 1024 -a <app-name>
fly machine scale cpu 2 -a <app-name>
```

### Auto-scaling
- Configure auto-scaling in fly.toml
- Set min/max machine counts
- Configure scaling triggers

## 📝 Maintenance

### Regular Tasks
- Monitor service health
- Check logs for errors
- Update dependencies
- Rotate secrets
- Backup data

### Updates
- Use CI/CD for deployments
- Test in staging first
- Monitor after updates
- Rollback if issues occur

## 🆘 Support

### Documentation
- Service-specific README files
- API documentation
- Troubleshooting guides

### Monitoring
- Fly.io dashboard
- Service logs
- Health check endpoints

### Emergency Procedures
- Service restart procedures
- Rollback procedures
- Contact information

