# How to Disable Vercel Deployment Protection

If you're being prompted to log into Vercel to access your web app, this is because **Vercel Deployment Protection** is enabled. Here's how to disable it:

## Method 1: Via Vercel Dashboard (Recommended)

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Log in to your account

2. **Select Your Project**
   - Click on your project: `opside-complete-frontend` (or similar)

3. **Go to Settings**
   - Click on the **Settings** tab in the project navigation

4. **Find Deployment Protection**
   - Scroll down to **"Deployment Protection"** section
   - Or look for **"Preview Deployments"** settings

5. **Disable Protection**
   - Find the option: **"Deployment Protection"** or **"Password Protection"**
   - Toggle it **OFF** or set it to **"None"**
   - For preview deployments specifically, look for **"Preview Deployment Protection"**

6. **Save Changes**
   - Click **Save** or the changes will auto-save

## Method 2: Disable for Preview Deployments Only

If you want to keep protection on production but disable it for previews:

1. Go to **Settings** → **Deployments**
2. Find **"Preview Deployment Protection"**
3. Set it to **"None"** or **"Off"**

## Method 3: Via Vercel CLI (Alternative)

If you have Vercel CLI installed:

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Login to Vercel
vercel login

# Link to your project
vercel link

# Remove deployment protection
vercel env rm VERCEL_PASSWORD_PROTECTION
```

## Method 4: Check Environment-Specific Settings

Sometimes protection is enabled for specific environments:

1. Go to **Settings** → **Deployments**
2. Check **"Production", "Preview", and "Development"** settings
3. Make sure **"Deployment Protection"** is set to **"None"** for preview deployments

## Quick Fix: Check Team Settings

If you're on a Vercel team/organization:

1. Go to **Team Settings** (top right → your team)
2. Navigate to **"Deployments"** or **"Security"**
3. Check if there's a team-wide policy enabling deployment protection
4. Disable it or add an exception for your project

## Common Settings Locations in Vercel Dashboard

- **Settings** → **Deployments** → **Deployment Protection**
- **Settings** → **Security** → **Deployment Protection**
- **Settings** → **Preview Deployments** → **Preview Deployment Protection**
- **Project Settings** → **Deployments** → **Protection**

## After Disabling

1. **Redeploy** (optional but recommended):
   - Go to **Deployments** tab
   - Click the **"..."** menu on the latest deployment
   - Select **"Redeploy"**

2. **Clear Browser Cache**:
   - Clear cookies and cache for the Vercel domain
   - Or use incognito/private browsing mode to test

3. **Test Access**:
   - Visit your preview URL again
   - You should no longer be prompted for Vercel login

## If You Still See the Login Prompt

1. **Check if it's a different protection**:
   - Vercel Password Protection (different from login requirement)
   - Basic Authentication
   - IP Allowlist

2. **Check the deployment URL**:
   - Make sure you're accessing the correct URL
   - Preview deployments might have different protection settings

3. **Contact Vercel Support**:
   - If protection is disabled but you still see the prompt
   - There might be a team/organization-level policy

## Note

- **Preview deployments** (with `-mvelo-ndabas-projects.vercel.app` in the URL) often have protection enabled by default
- **Production deployments** (your custom domain) usually don't have this issue
- This is a **Vercel feature**, not something in your codebase


