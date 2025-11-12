# Seller Profile Template - Frontend Design

## 🎯 Overview

This document outlines what information should be displayed in the seller's profile page on the frontend.

---

## 📋 Profile Sections

### 1. **Header Section** (Top of Profile)

**Company/Seller Name**
- **Source**: `company_name` from database (fetched from Amazon SP-API)
- **Display**: Large, prominent heading
- **Fallback**: "Unknown Company" if not available

**Seller ID**
- **Source**: `amazon_seller_id` from database
- **Display**: Smaller text, muted color
- **Format**: `Seller ID: A1B2C3D4E5F6G7`

**Account Status Badge**
- **Source**: `amazon_connected` boolean
- **Display**: 
  - ✅ "Connected" (green) if `amazon_connected === true`
  - ⚠️ "Not Connected" (red) if `amazon_connected === false`

---

### 2. **Basic Information Section**

**Company Name**
- **Source**: `company_name` from database
- **Label**: "Company Name"
- **Editable**: No (pulled from Amazon)

**Amazon Seller ID**
- **Source**: `amazon_seller_id` from database
- **Label**: "Amazon Seller ID"
- **Editable**: No (read-only)
- **Format**: Display as-is or masked (e.g., `A1B2C3...F6G7`)

**Account Created**
- **Source**: `created_at` from database
- **Label**: "Member Since"
- **Format**: "January 15, 2025" or "15 days ago"
- **Icon**: Calendar icon

**Last Login**
- **Source**: `last_login` from database
- **Label**: "Last Active"
- **Format**: "2 hours ago" or "January 15, 2025 at 3:45 PM"
- **Icon**: Clock icon

---

### 3. **Marketplace Information Section**

**Active Marketplaces**
- **Source**: `linked_marketplaces` array from database
- **Label**: "Selling In"
- **Display**: 
  - List of marketplace names (not just IDs)
  - Flags/icons for each marketplace
  - Badge count: "3 Marketplaces"

**Marketplace Mapping** (for display):
```typescript
const MARKETPLACE_NAMES: Record<string, string> = {
  'ATVPDKIKX0DER': 'United States',
  'A1PA6795UKMFR9': 'Germany',
  'A1RKKUPIHCS9HS': 'Spain',
  'A13V1IB3VIYZZH': 'France',
  'A1F83G8C2ARO7P': 'United Kingdom',
  'A1VC38T7YXB528': 'Japan',
  'A1AM78C64UM0Y8': 'India',
  'A2EUQ1WTGCTBG2': 'Canada',
  'A39IBJ37TRP1C6': 'Australia',
  'A2Q3Y263D00KWC': 'Brazil',
  'A1VC38T7YXB528': 'Mexico',
  // Add more as needed
};
```

**Display Format**:
- 🇺🇸 United States
- 🇬🇧 United Kingdom
- 🇨🇦 Canada
- etc.

---

### 4. **Integration Status Section**

**Amazon Integration**
- **Source**: `amazon_connected` boolean
- **Status**: 
  - ✅ "Connected" (green) - with "Disconnect" button
  - ❌ "Not Connected" (red) - with "Connect Amazon" button
- **Last Sync**: `last_sync_completed_at` (if available)
- **Sync Status**: 
  - "Synced 2 hours ago"
  - "Syncing..." (if `last_sync_attempt_at` is recent)
  - "Never synced" (if null)

**Stripe Integration**
- **Source**: `stripe_connected` boolean
- **Status**:
  - ✅ "Connected" (green) - with "Manage" button
  - ❌ "Not Connected" (gray) - with "Connect Stripe" button

---

### 5. **Sync Information Section** (If Available)

**Last Sync Attempt**
- **Source**: `last_sync_attempt_at` from database
- **Label**: "Last Sync Attempt"
- **Format**: "2 hours ago" or "January 15, 2025 at 3:45 PM"
- **Status**: 
  - Success icon if `last_sync_completed_at` exists
  - Warning icon if sync failed

**Last Successful Sync**
- **Source**: `last_sync_completed_at` from database
- **Label**: "Last Successful Sync"
- **Format**: "2 hours ago" or "January 15, 2025 at 3:45 PM"
- **Display**: Only show if sync was successful

**Sync Job ID**
- **Source**: `last_sync_job_id` from database
- **Label**: "Current Sync Job"
- **Display**: Only show if sync is in progress
- **Format**: Clickable link to sync status/details

---

### 6. **Quick Stats Section** (Optional - Requires Additional Data)

**Total Claims**
- **Source**: Count from `claims` table (filtered by `user_id`)
- **Label**: "Total Claims"
- **Icon**: Document icon

**Total Recoveries**
- **Source**: Sum of recovered amounts from `claims` table
- **Label**: "Total Recovered"
- **Format**: "$12,345.67"
- **Icon**: Dollar icon

**Active Cases**
- **Source**: Count of claims with status "pending" or "in_progress"
- **Label**: "Active Cases"
- **Icon**: Clock icon

**Success Rate**
- **Source**: Calculated from claims (completed / total)
- **Label**: "Success Rate"
- **Format**: "85%" with progress bar
- **Icon**: Chart icon

---

## 🎨 UI/UX Recommendations

### Layout Structure

```
┌─────────────────────────────────────────┐
│  [Company Name]              [Status]   │
│  Seller ID: A1B2C3...                   │
├─────────────────────────────────────────┤
│  Basic Information                      │
│  ┌───────────────────────────────────┐  │
│  │ Company Name: [value]             │  │
│  │ Amazon Seller ID: [value]       │  │
│  │ Member Since: [date]             │  │
│  │ Last Active: [time]              │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  Marketplaces                           │
│  ┌───────────────────────────────────┐  │
│  │ 🇺🇸 United States                 │  │
│  │ 🇬🇧 United Kingdom                │  │
│  │ 🇨🇦 Canada                        │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  Integrations                           │
│  ┌───────────────────────────────────┐  │
│  │ Amazon: ✅ Connected [Disconnect] │  │
│  │ Stripe: ✅ Connected [Manage]      │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  Sync Status                            │
│  ┌───────────────────────────────────┐  │
│  │ Last Sync: 2 hours ago             │  │
│  │ Status: ✅ Success                 │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Visual Elements

1. **Status Badges**
   - Green: Connected, Active, Success
   - Red: Not Connected, Error, Failed
   - Yellow: Pending, In Progress
   - Gray: Not Available, Disabled

2. **Icons**
   - Company: Building/Store icon
   - Seller ID: ID card icon
   - Marketplaces: Globe/Map icon
   - Sync: Refresh/Clock icon
   - Integrations: Plug/Link icon

3. **Actions**
   - "Connect Amazon" button (if not connected)
   - "Disconnect" button (if connected)
   - "Manage" button (for Stripe)
   - "Sync Now" button (manual sync trigger)

---

## 📡 API Endpoints to Use

### Get User Profile
```typescript
GET /api/auth/me
// Returns:
{
  id: string,
  email: string,
  name: string, // company_name
  amazon_connected: boolean,
  stripe_connected: boolean,
  created_at: string,
  last_login: string
}
```

### Get Full User Data (Extended)
```typescript
GET /api/v1/users/profile
// Should return:
{
  id: string,
  amazon_seller_id: string,
  company_name: string,
  linked_marketplaces: string[],
  stripe_customer_id?: string,
  stripe_account_id?: string,
  last_sync_attempt_at?: string,
  last_sync_completed_at?: string,
  last_sync_job_id?: string,
  created_at: string,
  last_login: string
}
```

### Get Amazon Sellers Info (Real-time)
```typescript
GET /api/v1/integrations/amazon/sellers-info
// Returns:
{
  success: boolean,
  seller_id: string,
  company_name: string,
  marketplaces: Array<{
    id: string,
    name: string,
    countryCode: string
  }>
}
```

---

## 🔄 Data Refresh Strategy

### On Page Load
1. Fetch user profile from `/api/auth/me`
2. Fetch extended profile data (if endpoint exists)
3. Fetch real-time Amazon sellers info (optional, for verification)

### Real-time Updates
- Use WebSocket/SSE for sync status updates
- Poll sync status every 30 seconds if sync is in progress
- Update "Last Active" timestamp when user performs actions

### Cache Strategy
- Cache profile data for 5 minutes
- Invalidate cache on:
  - Connect/disconnect actions
  - Manual sync trigger
  - User settings changes

---

## 📝 Example React Component Structure

```typescript
interface SellerProfile {
  id: string;
  amazon_seller_id: string;
  company_name: string;
  linked_marketplaces: string[];
  stripe_customer_id?: string;
  stripe_account_id?: string;
  last_sync_attempt_at?: string;
  last_sync_completed_at?: string;
  last_sync_job_id?: string;
  created_at: string;
  last_login: string;
  amazon_connected: boolean;
  stripe_connected: boolean;
}

// Component sections:
1. ProfileHeader (name, seller ID, status)
2. BasicInfo (company name, dates)
3. MarketplacesList (marketplace badges)
4. IntegrationsStatus (Amazon, Stripe)
5. SyncStatus (last sync info)
6. QuickStats (optional - claims, recoveries)
```

---

## ✅ Required Fields (Must Display)

1. ✅ **Company Name** - Primary identifier
2. ✅ **Amazon Seller ID** - Unique identifier
3. ✅ **Marketplaces** - Where they sell
4. ✅ **Amazon Connection Status** - Connected/Not Connected
5. ✅ **Account Created Date** - Member since
6. ✅ **Last Login** - Activity indicator

---

## 🎁 Nice-to-Have Fields (Optional)

1. ⭐ **Last Sync Status** - Data freshness indicator
2. ⭐ **Stripe Connection Status** - Payment integration
3. ⭐ **Quick Stats** - Claims, recoveries, success rate
4. ⭐ **Marketplace Flags** - Visual country indicators
5. ⭐ **Sync Job Status** - Real-time sync progress

---

## 🚀 Implementation Priority

### Phase 1 (Essential)
- Company name
- Amazon Seller ID
- Marketplaces list
- Connection status
- Account dates

### Phase 2 (Enhanced)
- Sync status
- Stripe integration
- Marketplace flags/icons
- Quick stats

### Phase 3 (Advanced)
- Real-time sync progress
- Historical sync timeline
- Performance metrics
- Integration health checks

---

**Last Updated**: November 12, 2025  
**Status**: Ready for Frontend Implementation

