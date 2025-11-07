# 🔧 Fix Render GitHub Repository Access Error

## Problem
```
Deploy Error: We are unable to access to your GitHub repository.
```

## Solutions (Try in Order)

### Solution 1: Reconnect GitHub Account (Most Common Fix)

1. **Go to Render Dashboard**
   - Visit: https://dashboard.render.com
   - Click on your profile icon (top right)

2. **Disconnect GitHub**
   - Go to **Settings** → **Connected Accounts**
   - Find **GitHub** and click **"Disconnect"** or **"Remove"**

3. **Reconnect GitHub**
   - Click **"Connect GitHub"** or **"Add GitHub"**
   - Authorize Render to access your repositories
   - Make sure to grant access to:
     - ✅ **All repositories** (recommended), OR
     - ✅ **Specific repositories** (select `Clario-Complete-Backend`)

4. **Try Again**
   - Go back to create a new service
   - Select your repository again

### Solution 2: Check Repository Visibility

**If your repository is Private:**

1. **Grant Render Access to Private Repos**
   - When connecting GitHub, make sure you authorize access to **private repositories**
   - Render needs permission to access private repos

2. **Check Repository Settings**
   - Go to GitHub: https://github.com/stanleyndaba/Clario-Complete-Backend/settings
   - Make sure the repository exists and you have admin access

### Solution 3: Check GitHub App Permissions

1. **Go to GitHub Settings**
   - Visit: https://github.com/settings/applications
   - Find **"Render"** in Authorized GitHub Apps

2. **Check Permissions**
   - Click on **Render**
   - Make sure it has:
     - ✅ **Repository access** (read/write)
     - ✅ **Contents** (read)
     - ✅ **Metadata** (read)
   - If missing permissions, click **"Configure"** and update

3. **Revoke and Reauthorize**
   - Click **"Revoke"** to remove Render access
   - Go back to Render and reconnect GitHub
   - Grant all required permissions

### Solution 4: Use Manual Git URL (Alternative)

If automatic connection doesn't work:

1. **In Render Service Settings**
   - Look for **"Repository"** field
   - Instead of selecting from list, manually enter:
     ```
     https://github.com/stanleyndaba/Clario-Complete-Backend.git
     ```
   - Or use SSH format (if you have SSH keys set up):
     ```
     git@github.com:stanleyndaba/Clario-Complete-Backend.git
     ```

2. **Set Build Command Manually**
   - Build: `pip install -r requirements.txt`
   - Start: `uvicorn src.app:app --host 0.0.0.0 --port $PORT`

### Solution 5: Check GitHub Organization Settings

**If repository is in an organization:**

1. **Organization Settings**
   - Go to: https://github.com/organizations/[your-org]/settings/installations
   - Find **Render** in installed apps
   - Make sure it has access to `Clario-Complete-Backend` repository

2. **Request Organization Admin**
   - If you're not an admin, ask an admin to grant Render access
   - Or move the repository to your personal account

### Solution 6: Verify Repository Exists and is Accessible

1. **Test Repository Access**
   - Visit: https://github.com/stanleyndaba/Clario-Complete-Backend
   - Make sure you can access it in your browser
   - If it's private, make sure you're logged in

2. **Check Repository URL**
   - Make sure the URL is exactly: `stanleyndaba/Clario-Complete-Backend`
   - No typos or extra characters

### Solution 7: Use GitHub Personal Access Token (Advanced)

If OAuth connection doesn't work:

1. **Create GitHub Personal Access Token**
   - Go to: https://github.com/settings/tokens
   - Click **"Generate new token"** → **"Generate new token (classic)"**
   - Name: `Render Deployment`
   - Select scopes:
     - ✅ `repo` (Full control of private repositories)
     - ✅ `workflow` (if using GitHub Actions)
   - Click **"Generate token"**
   - **Copy the token** (you won't see it again!)

2. **Add Token to Render**
   - In Render, go to **Settings** → **Connected Accounts**
   - Look for **"GitHub Personal Access Token"** option
   - Paste your token

## Step-by-Step Troubleshooting Checklist

- [ ] **Try Solution 1**: Reconnect GitHub account
- [ ] **Check Repository**: Verify it exists and is accessible
- [ ] **Check Permissions**: Render has access to private repos (if applicable)
- [ ] **Check GitHub App**: Render app has correct permissions
- [ ] **Try Manual URL**: Enter repository URL manually
- [ ] **Check Organization**: If org repo, verify org-level access
- [ ] **Try Personal Token**: Use GitHub PAT as fallback

## Most Likely Fix

**90% of the time, Solution 1 works:**
1. Disconnect GitHub from Render
2. Reconnect and grant all permissions
3. Make sure to authorize access to private repos (if your repo is private)

## Still Not Working?

1. **Check Render Status**: https://status.render.com
2. **Check GitHub Status**: https://www.githubstatus.com
3. **Contact Render Support**: Include your repository URL and error message
4. **Try from Different Browser**: Sometimes browser cache causes issues

## Quick Test

After reconnecting GitHub:
1. Go to Render Dashboard
2. Click **"New"** → **"Web Service"**
3. You should see `Clario-Complete-Backend` in the repository list
4. If you see it, the connection is working!


